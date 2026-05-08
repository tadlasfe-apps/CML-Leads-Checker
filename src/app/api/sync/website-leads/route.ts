export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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
  const ck = encodeURIComponent(process.env.GRAVITY_FORMS_CONSUMER_KEY ?? "");
  const cs = encodeURIComponent(process.env.GRAVITY_FORMS_CONSUMER_SECRET ?? "");
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}consumer_key=${ck}&consumer_secret=${cs}`;
}

// ─── Auth-aware fetch with fallback ──────────────────────────────────────────
//
// Tries Basic Auth first. If the server returns 401 or 403, retries the same
// URL using query-string credentials instead. Throws a descriptive error if
// both methods fail, without leaking key/secret values into the message.

async function gfFetch(url: string): Promise<any> {
  // --- attempt 1: Basic Auth header ---
  let res: Response;
  let basicStatus = 0;
  let basicBody   = "";

  try {
    res = await fetch(url, {
      headers: { Authorization: basicAuthHeader(), Accept: "application/json" },
      cache: "no-store",
    });
    basicStatus = res.status;
  } catch (err: any) {
    const cause = err?.cause;
    const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
    throw new Error(`Network error reaching Gravity Forms API: ${err?.message ?? "Unknown"}${detail}`);
  }

  if (basicStatus !== 401 && basicStatus !== 403) {
    // Success or a non-auth error — handle here
    if (!res!.ok) {
      basicBody = await res!.text().catch(() => "");
      throw new Error(
        `Gravity Forms API error ${basicStatus} (Basic Auth): ${basicBody.slice(0, 300)}`,
      );
    }
    return res!.json();
  }

  // Basic Auth was rejected — capture body for diagnostics
  basicBody = await res!.text().catch(() => "");

  // --- attempt 2: query-string credentials ---
  const qsUrl = appendQsAuth(url);
  let qsRes: Response;
  let qsStatus = 0;
  let qsBody   = "";

  try {
    qsRes = await fetch(qsUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    qsStatus = qsRes.status;
  } catch (err: any) {
    const cause = err?.cause;
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
      `Check that the API key belongs to a user with permission to read entries and that the Gravity Forms REST API is enabled.`,
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

    if (total === null) total = parseInt(json.total_count ?? "0", 10);
    if (entries.length >= total || batch.length < GF_PAGE_SIZE) break;
    page++;
  }

  return entries;
}

// ─── Field extractor ─────────────────────────────────────────────────────────

function labelField(
  entry: any,
  labels: Record<string, string>,
  ...keywords: string[]
): string | undefined {
  for (const [fieldId, label] of Object.entries(labels)) {
    const lowerLabel = (label as string).toLowerCase();
    if (keywords.some((kw) => lowerLabel.includes(kw))) {
      const val = entry[fieldId];
      if (val !== undefined && val !== null && String(val).trim() !== "")
        return String(val).trim();
    }
  }
  return undefined;
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
      sourceSystem: "WEBSITE",
      syncType: "API",
      status: "RUNNING",
      dateRangeStart: new Date(from),
      dateRangeEnd: new Date(to),
    },
  });

  try {
    const entries = await fetchAllEntries(from, to);
    let created = 0;
    let skipped = 0;

    const records = entries.map((entry: any) => {
      const labels: Record<string, string> = entry._labels ?? {};
      const entryId = String(entry.id ?? "");
      const formId  = String(entry.form_id ?? "");

      const firstName = labelField(entry, labels, "first name", "firstname");
      const lastName  = labelField(entry, labels, "last name", "lastname");
      const email     = labelField(entry, labels, "email", "e-mail");
      const phone     = labelField(entry, labels, "phone", "mobile", "telephone", "tel");
      const clinic    = labelField(entry, labels, "clinic", "location", "branch", "centre", "center");
      const service   = labelField(entry, labels, "service", "treatment", "procedure", "interest");

      const createdAt = entry.date_created
        ? new Date(entry.date_created.replace(" ", "T") + "Z")
        : new Date();

      return {
        sourceSystem: "WEBSITE" as const,
        recordType: "INDIVIDUAL_LEAD" as const,
        backendProvider: "GRAVITY_FORMS",
        externalId: `GF|${entryId}`,
        createdAtSource: createdAt,
        firstName,
        lastName,
        fullName:
          firstName && lastName
            ? `${firstName} ${lastName}`.trim()
            : firstName ?? lastName,
        email,
        phone,
        clinicLocationRaw: clinic,
        serviceRaw: service,
        formId,
        gravityFormsEntryId: entryId,
        gravityFormsFormId: formId,
        pageUrl: entry.source_url ?? undefined,
        rawPayload: entry,
      };
    });

    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch  = records.slice(i, i + BATCH);
      const result = await prisma.leadSourceRecord.createMany({
        data: batch,
        skipDuplicates: true,
      });
      created += result.count;
      skipped += batch.length - result.count;
    }

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        recordsFetched: entries.length,
        recordsCreated: created,
        recordsSkipped: skipped,
      },
    });

    return NextResponse.json({
      success: true,
      fetched: entries.length,
      created,
      skipped,
      syncRunId: syncRun.id,
    });
  } catch (err: any) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: err?.message ?? "Unknown error",
      },
    });
    return NextResponse.json(
      { error: err?.message ?? "Website leads pull failed", syncRunId: syncRun.id },
      { status: 200 },
    );
  }
}
