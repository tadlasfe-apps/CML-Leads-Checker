export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  toSafeString,
  normalizeLower,
  normalizeEmail,
  normalizePhone,
  normalizeClinicLocation,
  normalizeService,
  normalizeWebsiteFormSource,
  inferWebsiteFormSource,
  isUnmappedClinic,
  isUnmappedService,
  inferServiceFromWebsiteRecord,
} from "@/lib/normalization";

const GF_PAGE_SIZE = 100;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function gfBase(): string {
  return (process.env.GRAVITY_FORMS_BASE_URL ?? "").replace(/\/$/, "");
}

function basicAuthHeader(): string {
  const ck = process.env.GRAVITY_FORMS_CONSUMER_KEY ?? "";
  const cs = process.env.GRAVITY_FORMS_CONSUMER_SECRET ?? "";
  return "Basic " + Buffer.from(`${ck}:${cs}`).toString("base64");
}

function appendQsAuth(url: string): string {
  const ck  = encodeURIComponent(process.env.GRAVITY_FORMS_CONSUMER_KEY ?? "");
  const cs  = encodeURIComponent(process.env.GRAVITY_FORMS_CONSUMER_SECRET ?? "");
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}consumer_key=${ck}&consumer_secret=${cs}`;
}

// ─── Auth-aware fetch with fallback ──────────────────────────────────────────

async function gfFetch(url: string): Promise<any> {
  let res: Response;
  let basicStatus = 0;
  let basicBody   = "";

  try {
    res = await fetch(url, {
      headers: { Authorization: basicAuthHeader(), Accept: "application/json" },
      cache:   "no-store",
    });
    basicStatus = res.status;
  } catch (err: any) {
    const cause  = err?.cause;
    const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
    throw new Error(`Network error reaching Gravity Forms API: ${err?.message ?? "Unknown"}${detail}`);
  }

  if (basicStatus !== 401 && basicStatus !== 403) {
    if (!res!.ok) {
      basicBody = await res!.text().catch(() => "");
      throw new Error(
        `Gravity Forms API error ${basicStatus} (Basic Auth): ${basicBody.slice(0, 300)}`,
      );
    }
    return res!.json();
  }

  basicBody = await res!.text().catch(() => "");

  const qsUrl = appendQsAuth(url);
  let qsRes: Response;
  let qsStatus = 0;
  let qsBody   = "";

  try {
    qsRes = await fetch(qsUrl, {
      headers: { Accept: "application/json" },
      cache:   "no-store",
    });
    qsStatus = qsRes.status;
  } catch (err: any) {
    const cause  = err?.cause;
    const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
    throw new Error(
      `Basic Auth returned ${basicStatus}. ` +
      `Query-string auth also failed with a network error: ${err?.message ?? "Unknown"}${detail}`,
    );
  }

  if (!qsRes!.ok) {
    qsBody = await qsRes!.text().catch(() => "");
    throw new Error(
      `Gravity Forms auth failed with both methods. ` +
      `Basic Auth: ${basicStatus} — "${basicBody.slice(0, 150)}". ` +
      `Query-string auth: ${qsStatus} — "${qsBody.slice(0, 150)}". ` +
      `Check that the API key belongs to a user with permission to read entries ` +
      `and that the Gravity Forms REST API is enabled.`,
    );
  }

  return qsRes!.json();
}

// ─── Paginated entries fetch ──────────────────────────────────────────────────

async function fetchAllEntries(from: string, to: string): Promise<any[]> {
  const base    = gfBase();
  const entries: any[] = [];
  let page  = 1;
  let total: number | null = null;

  while (true) {
    const search = JSON.stringify({ start_date: from, end_date: to });
    const url =
      `${base}/wp-json/gf/v2/entries` +
      `?_labels=1` +
      `&paging[page_size]=${GF_PAGE_SIZE}` +
      `&paging[current_page]=${page}` +
      `&search=${encodeURIComponent(search)}`;

    const json  = await gfFetch(url);
    const batch: any[] = json.entries ?? [];
    entries.push(...batch);

    if (total === null) total = parseInt(toSafeString(json.total_count || "0"), 10);
    if (isNaN(total)) total = 0;
    if (entries.length >= total || batch.length < GF_PAGE_SIZE) break;
    page++;
  }

  return entries;
}

// ─── Form title lookup ────────────────────────────────────────────────────────
//
// The /gf/v2/entries endpoint does NOT include the form title in the entry body.
// We fetch /gf/v2/forms (all forms list in one request) and build a map of
// formId → title so parseEntry can attach the real GF form name.
// Falls back to individual /gf/v2/forms/{id} requests if the list endpoint fails.

async function fetchFormTitles(entries: any[]): Promise<Map<string, string>> {
  const base     = gfBase();
  const titleMap = new Map<string, string>();

  // Collect the unique form IDs we actually need
  const uniqueIds = new Set(
    entries.map((e) => toSafeString(e.form_id).trim()).filter(Boolean)
  );
  if (uniqueIds.size === 0) return titleMap;

  // Helper: extract title from a single form object
  function extractTitle(form: any): string {
    return toSafeString(form?.title ?? form?.form_title ?? form?.name ?? "").trim();
  }

  // Helper: populate titleMap from a GF forms response (object or array)
  function populateFromFormsResponse(data: any) {
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data)) {
      // GF can return an array of form objects
      for (const form of data) {
        const id = toSafeString(form?.id ?? form?.form_id ?? "").trim();
        const title = extractTitle(form);
        if (id && title) titleMap.set(id, title);
      }
    } else {
      // GF returns an object keyed by form ID: { "1": { title: "..." }, "17": { title: "..." } }
      for (const [id, form] of Object.entries(data)) {
        const title = extractTitle(form as any);
        if (title) titleMap.set(String(id), title);
      }
    }
  }

  // ── Strategy 1: Fetch all forms in a single request ──────────────────────
  try {
    const data = await gfFetch(`${base}/wp-json/gf/v2/forms`);
    populateFromFormsResponse(data);
  } catch { /* fall through to individual requests */ }

  // ── Strategy 2: Fetch any still-missing forms individually ───────────────
  const stillMissing = [...uniqueIds].filter((id) => !titleMap.has(id));
  if (stillMissing.length > 0) {
    await Promise.all(
      stillMissing.map(async (formId) => {
        try {
          const formData = await gfFetch(`${base}/wp-json/gf/v2/forms/${formId}`);
          const title = extractTitle(formData);
          if (title) titleMap.set(formId, title);
        } catch {
          // Non-fatal: entry will fall back to form ID label
        }
      })
    );
  }

  return titleMap;
}

// ─── Safe field extractor ─────────────────────────────────────────────────────
//
// Searches entry._labels for any label that contains ALL of the given keywords
// (case-insensitive). Returns the field value as a trimmed string, or undefined.
// Never throws — non-string labels and values are coerced safely.

function labelField(
  entry: Record<string, unknown>,
  labels: Record<string, unknown>,
  ...keywords: string[]
): string | undefined {
  for (const [fieldId, label] of Object.entries(labels)) {
    const lowerLabel = normalizeLower(label);
    if (keywords.every((kw) => lowerLabel.includes(kw))) {
      const val = toSafeString(entry[fieldId]).trim();
      if (val) return val;
    }
  }
  return undefined;
}

// Variant: matches if ANY keyword is found (for fields with multiple possible labels)
function labelFieldAny(
  entry: Record<string, unknown>,
  labels: Record<string, unknown>,
  ...keywords: string[]
): string | undefined {
  for (const [fieldId, label] of Object.entries(labels)) {
    const lowerLabel = normalizeLower(label);
    if (keywords.some((kw) => lowerLabel.includes(kw))) {
      const val = toSafeString(entry[fieldId]).trim();
      if (val) return val;
    }
  }
  return undefined;
}

// ─── Row-level parse error type ───────────────────────────────────────────────

interface ParseError {
  entryId: string;
  formId:  string;
  field?:  string;
  type?:   string;
  message: string;
}

// ─── Entry parser ─────────────────────────────────────────────────────────────

function parseEntry(entry: any, formTitleMap?: Map<string, string>): {
  record: Record<string, any>;
  needsReview: boolean;
  errors: ParseError[];
} {
  const errors: ParseError[] = [];

  // Safely get labels — GF returns _labels as an object, but guard against anything else
  const rawLabels: unknown = entry._labels;
  const labels: Record<string, unknown> =
    rawLabels && typeof rawLabels === "object" && !Array.isArray(rawLabels)
      ? (rawLabels as Record<string, unknown>)
      : {};

  const entryId = toSafeString(entry.id).trim();
  const formId  = toSafeString(entry.form_id).trim();

  // ── Core identity fields ──────────────────────────────────────────────────

  let firstName: string | undefined;
  let lastName:  string | undefined;
  let fullName:  string | undefined;
  let email:     string | undefined;
  let phone:     string | undefined;

  try {
    firstName = labelFieldAny(entry, labels, "first name", "firstname", "first");
    lastName  = labelFieldAny(entry, labels, "last name", "lastname", "last");
    // GF Name field sub-fields: .3 = first, .6 = last
    if (!firstName) {
      const nameKeys = Object.keys(labels).filter((k) => k.endsWith(".3"));
      for (const k of nameKeys) {
        const v = toSafeString(entry[k]).trim();
        if (v) { firstName = v; break; }
      }
    }
    if (!lastName) {
      const nameKeys = Object.keys(labels).filter((k) => k.endsWith(".6"));
      for (const k of nameKeys) {
        const v = toSafeString(entry[k]).trim();
        if (v) { lastName = v; break; }
      }
    }
    fullName =
      labelFieldAny(entry, labels, "full name", "fullname", "name") ??
      ([firstName, lastName].filter(Boolean).join(" ") || undefined);
  } catch (e: any) {
    errors.push({ entryId, formId, field: "name", message: toSafeString(e?.message) || "name parse error" });
  }

  try {
    email = labelFieldAny(entry, labels, "email", "e-mail");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "email", message: toSafeString(e?.message) || "email parse error" });
  }

  try {
    phone = labelFieldAny(entry, labels, "phone", "mobile", "telephone", "tel", "cell");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "phone", message: toSafeString(e?.message) || "phone parse error" });
  }

  // ── Clinic / service ──────────────────────────────────────────────────────

  let clinicRaw:  string | undefined;
  let serviceRaw: string | undefined;

  try {
    clinicRaw = labelFieldAny(entry, labels, "clinic", "location", "branch", "centre", "center");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "clinic", message: toSafeString(e?.message) || "clinic parse error" });
  }

  try {
    serviceRaw = labelFieldAny(entry, labels, "service", "treatment", "procedure", "interest", "interested");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "service", message: toSafeString(e?.message) || "service parse error" });
  }

  // ── Dates ─────────────────────────────────────────────────────────────────

  let createdAt: Date;
  try {
    const raw = toSafeString(entry.date_created).trim();
    // GF stores in "YYYY-MM-DD HH:MM:SS" (server time) — treat as UTC
    const iso = raw ? raw.replace(" ", "T") + (raw.includes("T") ? "" : "Z") : "";
    const d   = iso ? new Date(iso) : null;
    createdAt = d && !isNaN(d.getTime()) ? d : new Date();
  } catch {
    createdAt = new Date();
    errors.push({ entryId, formId, field: "date_created", message: "date parse error" });
  }

  // ── URL fields ────────────────────────────────────────────────────────────

  let pageUrl:        string | undefined;
  let landingPageUrl: string | undefined;
  let referrerUrl:    string | undefined;

  try {
    pageUrl        = toSafeString(entry.source_url).trim() || undefined;
    landingPageUrl =
      labelFieldAny(entry, labels, "landing page", "landingpage", "initial url", "initial page") ??
      labelFieldAny(entry, labels, "landing", "first page");
    referrerUrl    =
      labelFieldAny(entry, labels, "referrer", "referring", "referer") ??
      (toSafeString(entry.referer_url).trim() || undefined);
  } catch (e: any) {
    errors.push({ entryId, formId, field: "urls", message: toSafeString(e?.message) || "url parse error" });
  }

  // ── UTM / tracking fields ─────────────────────────────────────────────────

  let utmSource:   string | undefined;
  let utmMedium:   string | undefined;
  let utmCampaign: string | undefined;
  let utmContent:  string | undefined;
  let utmTerm:     string | undefined;
  let fbclid:      string | undefined;

  try {
    utmSource   = labelFieldAny(entry, labels, "utm source",   "utm_source",   "utmsource");
    utmMedium   = labelFieldAny(entry, labels, "utm medium",   "utm_medium",   "utmmedium");
    utmCampaign = labelFieldAny(entry, labels, "utm campaign", "utm_campaign", "utmcampaign");
    utmContent  = labelFieldAny(entry, labels, "utm content",  "utm_content",  "utmcontent");
    utmTerm     = labelFieldAny(entry, labels, "utm term",     "utm_term",     "utmterm");
    fbclid      = labelFieldAny(entry, labels, "fbclid", "fb click", "facebook click");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "utm", message: toSafeString(e?.message) || "utm parse error" });
  }

  // ── Form name ─────────────────────────────────────────────────────────────
  // GF entries endpoint does not include form_title in the entry body.
  // We look it up from the pre-fetched formTitleMap first, then fall back
  // to whatever the entry provides, then to "Form {formId}" as a last resort.

  const formName: string | undefined =
    (formId && formTitleMap?.get(formId)) ||
    toSafeString(entry.form_title ?? entry.form_name).trim() ||
    (formId ? `Form ${formId}` : undefined);

  // ── Normalize (each wrapped individually for row-level diagnostics) ────────

  let clinicNorm   = "Unknown";
  let serviceNorm  = "Other";
  let formSourceNorm = "Unknown";

  try {
    clinicNorm = normalizeClinicLocation(clinicRaw);
  } catch (e: any) {
    errors.push({ entryId, formId, field: "clinicNorm", message: `clinic mapping error: ${toSafeString(e?.message)}` });
  }

  try {
    serviceNorm = normalizeService(serviceRaw);
  } catch (e: any) {
    errors.push({ entryId, formId, field: "serviceNorm", message: `service mapping error: ${toSafeString(e?.message)}` });
  }

  // If explicit service field gave us "Other", try inferring from form metadata
  if (serviceNorm === "Other") {
    try {
      const inferred = inferServiceFromWebsiteRecord(
        undefined, // no explicit serviceRaw — already tried above
        formName,
        formSourceNorm,
        pageUrl,
        landingPageUrl,
      );
      if (inferred.normalized !== "Other") {
        serviceNorm = inferred.normalized;
        if (!serviceRaw) serviceRaw = inferred.raw !== "Other" ? inferred.raw : undefined;
      }
    } catch { /* non-fatal */ }
  }

  try {
    // 1. Look for an explicit source hidden field in the form entry
    const explicitSource = labelFieldAny(
      entry, labels,
      "form source", "form_source", "lead source", "lead_source",
      "popup source", "popup_source", "source type", "source_type",
    );
    if (explicitSource) {
      formSourceNorm = normalizeWebsiteFormSource(explicitSource);
    } else {
      // 2. Infer from formName keywords and pageUrl
      formSourceNorm = inferWebsiteFormSource(formName, pageUrl);
    }
  } catch (e: any) {
    errors.push({ entryId, formId, field: "formSourceNorm", message: `form source inference error: ${toSafeString(e?.message)}` });
  }

  // ── Needs-review flag ──────────────────────────────────────────────────────

  const needsReview = !email && !phone && !fullName && !firstName;

  // ── Assembled DB record (only schema fields) ─────────────────────────────

  const record = {
    sourceSystem:      "WEBSITE"          as const,
    recordType:        "INDIVIDUAL_LEAD"  as const,
    backendProvider:   "GRAVITY_FORMS",
    externalId:        entryId ? `GF|${entryId}` : undefined,
    createdAtSource:   createdAt,
    firstName:         firstName          ?? undefined,
    lastName:          lastName           ?? undefined,
    fullName:          fullName           ?? undefined,
    email:             email              ?? undefined,
    phone:             phone              ?? undefined,
    normalizedEmail:   normalizeEmail(email),
    normalizedPhone:   normalizePhone(phone),
    clinicLocationRaw: clinicRaw          ?? undefined,
    clinicLocationNormalized: clinicNorm,
    serviceRaw:        serviceRaw         ?? undefined,
    serviceNormalized: serviceNorm,
    formId:            formId             || undefined,
    gravityFormsEntryId: entryId          || undefined,
    gravityFormsFormId:  formId           || undefined,
    formName:          formName           ?? undefined,
    websiteFormSource: formSourceNorm,
    pageUrl:           pageUrl            ?? undefined,
    landingPageUrl:    landingPageUrl     ?? undefined,
    referrerUrl:       referrerUrl        ?? undefined,
    utmSource:         utmSource          ?? undefined,
    utmMedium:         utmMedium          ?? undefined,
    utmCampaign:       utmCampaign        ?? undefined,
    utmContent:        utmContent         ?? undefined,
    utmTerm:           utmTerm            ?? undefined,
    fbclid:            fbclid             ?? undefined,
    rawPayload:        entry,
  };

  return { record, needsReview, errors };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const isVercel    = !!process.env.VERCEL || !!process.env.VERCEL_URL;
  const runtimeLabel = isVercel ? "vercel" : "local";

  const baseUrl = process.env.GRAVITY_FORMS_BASE_URL;
  const ck      = process.env.GRAVITY_FORMS_CONSUMER_KEY;
  const cs      = process.env.GRAVITY_FORMS_CONSUMER_SECRET;

  if (!baseUrl || !ck || !cs) {
    return NextResponse.json(
      {
        error:
          "Missing credentials: GRAVITY_FORMS_BASE_URL, GRAVITY_FORMS_CONSUMER_KEY, " +
          "and GRAVITY_FORMS_CONSUMER_SECRET must be set in .env",
      },
      { status: 200 },
    );
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const from: string =
    body.from ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const to: string =
    body.to ?? new Date().toISOString().slice(0, 10);

  const syncRun = await prisma.syncRun.create({
    data: {
      sourceSystem:   "WEBSITE",
      syncType:       "API",
      status:         "RUNNING",
      dateRangeStart: new Date(from),
      dateRangeEnd:   new Date(to),
    },
  });

  // Track totals outside try so they survive into the catch block
  let entries: any[]      = [];
  let created             = 0;
  let skipped             = 0;
  let invalidRows         = 0;
  let needsReview         = 0;
  const parseErrors: ParseError[] = [];
  let currentStep         = "init";

  try {
    // ── Step 1: Fetch entries from Gravity Forms ──────────────────────────────
    currentStep = "fetchEntries";
    entries = await fetchAllEntries(from, to);

    // ── Step 1b: Resolve form titles (GF entries don't include form_title) ────
    currentStep = "fetchFormTitles";
    let formTitleMap: Map<string, string>;
    try {
      formTitleMap = await fetchFormTitles(entries);
    } catch {
      formTitleMap = new Map(); // Non-fatal: fall back to form ID labels
    }

    // ── Step 2: Parse each entry defensively ─────────────────────────────────
    currentStep = "parseEntries";
    const validRecords: any[] = [];

    for (const entry of entries) {
      try {
        const { record, needsReview: nr, errors } = parseEntry(entry, formTitleMap);

        if (errors.length > 0) parseErrors.push(...errors);
        if (nr) needsReview++;

        if (!record.externalId) {
          invalidRows++;
          parseErrors.push({
            entryId: toSafeString(entry.id),
            formId:  toSafeString(entry.form_id),
            message: "No entry ID — cannot deduplicate; row skipped",
          });
          continue;
        }

        validRecords.push(record);
      } catch (e: any) {
        invalidRows++;
        parseErrors.push({
          entryId: toSafeString(entry?.id),
          formId:  toSafeString(entry?.form_id),
          field:   "unknown",
          type:    typeof entry,
          message: toSafeString(e?.message) || "Unexpected parse error",
        });
      }
    }

    // ── Step 3: Save to database ──────────────────────────────────────────────
    currentStep = "saveToDB";
    const BATCH = 100;

    // 3a. Insert new records (fast batch insert, skip duplicates).
    for (let i = 0; i < validRecords.length; i += BATCH) {
      const chunk  = validRecords.slice(i, i + BATCH);
      const result = await prisma.leadSourceRecord.createMany({
        data:           chunk,
        skipDuplicates: true,
      });
      created += result.count;
      skipped += chunk.length - result.count;
    }

    // 3b. Patch formName AND websiteFormSource on existing records that had
    //   stale/placeholder values when first saved:
    //   - formName null or matching "Form N" pattern  → overwrite with real title
    //   - websiteFormSource "Unknown" or null          → re-infer from real formName
    //   Only runs when we now have a real (non-fallback) title from fetchFormTitles.
    currentStep = "patchFormNames";
    let updated = 0;
    // Only patch when we resolved a real title (not just another "Form N" fallback)
    const recordsWithRealName = validRecords.filter((rec) => {
      if (!rec.formName || !rec.externalId) return false;
      const isStillFallback = /^Form \d+$/i.test(rec.formName);
      return !isStillFallback;
    });
    for (let i = 0; i < recordsWithRealName.length; i += BATCH) {
      const chunk = recordsWithRealName.slice(i, i + BATCH);
      await Promise.all(
        chunk.map((rec) => {
          // Re-infer source from the real form name + stored pageUrl
          const reInferredSource = inferWebsiteFormSource(rec.formName, rec.pageUrl);
          return prisma.leadSourceRecord.updateMany({
            where: {
              sourceSystem: rec.sourceSystem,
              externalId:   rec.externalId,
              OR: [
                { formName: { equals: null } },
                // Also overwrite "Form N" placeholder names
                { formName: { startsWith: "Form " } },
              ],
            },
            data: {
              formName: rec.formName,
              // Re-set websiteFormSource when it's still "Unknown" so it reflects
              // the real form name we just resolved
              ...(reInferredSource !== "Unknown"
                ? { websiteFormSource: reInferredSource }
                : {}),
            },
          }).then((r) => { updated += r.count; }).catch(() => { /* ignore */ });
        })
      );
    }

    // 3c. Also patch websiteFormSource for records whose formName is already
    //     correct (resolved in a previous pull) but whose source is still "Unknown"
    //     because the inference used to not handle "pop up" with a space.
    currentStep = "patchFormSources";
    const recordsWithUnknownSource = validRecords.filter(
      (rec) => rec.formName && rec.externalId && !/^Form \d+$/i.test(rec.formName)
    );
    for (let i = 0; i < recordsWithUnknownSource.length; i += BATCH) {
      const chunk = recordsWithUnknownSource.slice(i, i + BATCH);
      await Promise.all(
        chunk.map((rec) => {
          const reInferredSource = inferWebsiteFormSource(rec.formName, rec.pageUrl);
          if (reInferredSource === "Unknown") return Promise.resolve();
          return prisma.leadSourceRecord.updateMany({
            where: {
              sourceSystem:      rec.sourceSystem,
              externalId:        rec.externalId,
              websiteFormSource: { in: ["Unknown", ""] },
            },
            data: { websiteFormSource: reInferredSource },
          }).catch(() => { /* ignore */ });
        })
      );
    }

    // ── Step 4: Update sync run history ───────────────────────────────────────
    currentStep = "updateSyncRun";
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status:         "COMPLETED",
        finishedAt:     new Date(),
        recordsFetched: entries.length,
        recordsCreated: created,
        recordsSkipped: skipped,
      },
    });
    const updatedCount = updated; // renamed to avoid shadowing

    // ── Step 5: Fetch sample saved records and date range for diagnostics ────
    currentStep = "formatResponse";
    let sampleSaved: any[] = [];
    let savedSourceSystems: string[] = [];
    let savedBackendProviders: string[] = [];
    let earliestCreatedAtSource: string | null = null;
    let latestCreatedAtSource: string | null = null;
    try {
      const [samples, earliest, latest, ssBySys, ssByProv] = await Promise.all([
        prisma.leadSourceRecord.findMany({
          where: { sourceSystem: "WEBSITE" },
          orderBy: { importedAt: "desc" },
          take: 5,
          select: {
            id: true, externalId: true, formName: true, websiteFormSource: true,
            backendProvider: true, createdAtSource: true, reportDate: true,
            importedAt: true, isDuplicate: true, sourceSystem: true,
          },
        }),
        prisma.leadSourceRecord.findFirst({
          where: { sourceSystem: "WEBSITE", createdAtSource: { not: null } },
          orderBy: { createdAtSource: "asc" },
          select: { createdAtSource: true },
        }),
        prisma.leadSourceRecord.findFirst({
          where: { sourceSystem: "WEBSITE", createdAtSource: { not: null } },
          orderBy: { createdAtSource: "desc" },
          select: { createdAtSource: true },
        }),
        prisma.leadSourceRecord.groupBy({ by: ["sourceSystem"], where: { sourceSystem: "WEBSITE" }, _count: { id: true } }),
        prisma.leadSourceRecord.groupBy({ by: ["backendProvider"], where: { sourceSystem: "WEBSITE" }, _count: { id: true } }),
      ]);
      sampleSaved = samples;
      earliestCreatedAtSource = earliest?.createdAtSource?.toISOString() ?? null;
      latestCreatedAtSource   = latest?.createdAtSource?.toISOString()   ?? null;
      savedSourceSystems      = ssBySys.map((r) => r.sourceSystem);
      savedBackendProviders   = ssByProv.map((r) => r.backendProvider ?? "(null)");
    } catch { /* non-critical */ }

    return NextResponse.json({
      success:     true,
      fetched:     entries.length,
      created,
      updated:     updatedCount,
      skipped,
      invalidRows,
      needsReview,
      syncRunId:   syncRun.id,
      parseErrors: parseErrors.slice(0, 20),
      // Diagnostic fields
      sampleSaved,
      savedSourceSystems,
      savedBackendProviders,
      earliestCreatedAtSource,
      latestCreatedAtSource,
    });

  } catch (err: any) {
    const errorMessage  = toSafeString(err?.message) || "Website leads pull failed";
    const stack         = toSafeString(err?.stack);
    const partialSuccess = created > 0;

    console.error(
      `[website-leads POST] step="${currentStep}" runtime="${runtimeLabel}" partial=${partialSuccess}`,
      "\nError:", errorMessage,
      "\nStack:", stack || "(no stack)",
    );

    // If records were already saved, mark the run COMPLETED with a warning note
    try {
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: partialSuccess
          ? {
              status:         "COMPLETED",
              finishedAt:     new Date(),
              recordsFetched: entries.length,
              recordsCreated: created,
              recordsSkipped: skipped,
              errorMessage:   `Post-processing warning (step: ${currentStep}): ${errorMessage}`,
            }
          : {
              status:       "FAILED",
              finishedAt:   new Date(),
              errorMessage,
            },
      });
    } catch (updateErr: any) {
      console.error("[website-leads POST] syncRun update also failed:", toSafeString(updateErr?.message));
    }

    if (partialSuccess) {
      return NextResponse.json({
        success:        true,
        partialSuccess: true,
        fetched:        entries.length,
        created,
        updated:        0,
        skipped,
        invalidRows,
        needsReview,
        syncRunId:      syncRun.id,
        parseErrors:    parseErrors.slice(0, 20),
        warning:        errorMessage,
        step:           currentStep,
        runtime:        runtimeLabel,
        hint:           "Records were saved, but a post-processing step failed. Check server logs for the full stack trace.",
      });
    }

    return NextResponse.json({
      success:        false,
      partialSuccess: false,
      recordsFetched: entries.length,
      recordsCreated: created,
      recordsUpdated: 0,
      error:          "Website Leads processing failed",
      details:        errorMessage,
      stack:          stack.slice(0, 1000),
      runtime:        runtimeLabel,
      step:           currentStep,
      hint:           "A non-string value was passed to a string method. Check parseErrors and server logs.",
    }, { status: 200 });
  }
}
