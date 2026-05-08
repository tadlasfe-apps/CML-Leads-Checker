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

function parseEntry(entry: any): {
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
    errors.push({ entryId, formId, field: "name", message: e?.message ?? "name parse error" });
  }

  try {
    email = labelFieldAny(entry, labels, "email", "e-mail");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "email", message: e?.message ?? "email parse error" });
  }

  try {
    phone = labelFieldAny(entry, labels, "phone", "mobile", "telephone", "tel", "cell");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "phone", message: e?.message ?? "phone parse error" });
  }

  // ── Clinic / service ──────────────────────────────────────────────────────

  let clinicRaw:  string | undefined;
  let serviceRaw: string | undefined;

  try {
    clinicRaw = labelFieldAny(entry, labels, "clinic", "location", "branch", "centre", "center");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "clinic", message: e?.message ?? "clinic parse error" });
  }

  try {
    serviceRaw = labelFieldAny(entry, labels, "service", "treatment", "procedure", "interest", "interested");
  } catch (e: any) {
    errors.push({ entryId, formId, field: "service", message: e?.message ?? "service parse error" });
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
    errors.push({ entryId, formId, field: "urls", message: e?.message ?? "url parse error" });
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
    errors.push({ entryId, formId, field: "utm", message: e?.message ?? "utm parse error" });
  }

  // ── Form name ─────────────────────────────────────────────────────────────

  const formName: string | undefined =
    toSafeString(entry.form_title ?? entry.form_name).trim() || undefined;

  // ── Normalize ─────────────────────────────────────────────────────────────

  const clinicNorm  = normalizeClinicLocation(clinicRaw);
  const serviceNorm = normalizeService(serviceRaw);
  const formSourceNorm = formName
    ? normalizeWebsiteFormSource(formName)
    : inferWebsiteFormSource(formName, pageUrl);

  // ── Needs-review flag ──────────────────────────────────────────────────────
  // Mark if no contact info at all and no identifier

  const needsReview =
    !email && !phone && !fullName && !firstName;

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

  try {
    const entries = await fetchAllEntries(from, to);

    let created     = 0;
    let skipped     = 0;
    let invalidRows = 0;
    let needsReview = 0;
    const parseErrors: ParseError[] = [];

    const validRecords: any[] = [];

    // ── Parse each entry defensively ─────────────────────────────────────────
    for (const entry of entries) {
      try {
        const { record, needsReview: nr, errors } = parseEntry(entry);

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
          message: e?.message ?? "Unexpected parse error",
        });
      }
    }

    // ── Upsert in batches of 100 ──────────────────────────────────────────────
    const BATCH = 100;
    for (let i = 0; i < validRecords.length; i += BATCH) {
      const chunk  = validRecords.slice(i, i + BATCH);
      const result = await prisma.leadSourceRecord.createMany({
        data:           chunk,
        skipDuplicates: true,
      });
      created += result.count;
      skipped += chunk.length - result.count;
    }

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

    return NextResponse.json({
      success:     true,
      fetched:     entries.length,
      created,
      updated:     0,
      skipped,
      invalidRows,
      needsReview,
      syncRunId:   syncRun.id,
      parseErrors: parseErrors.slice(0, 20),  // cap to avoid bloating response
    });
  } catch (err: any) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status:       "FAILED",
        finishedAt:   new Date(),
        errorMessage: err?.message ?? "Unknown error",
      },
    });
    return NextResponse.json(
      { error: err?.message ?? "Website leads pull failed", syncRunId: syncRun.id },
      { status: 200 },
    );
  }
}
