export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const GHL_SEARCH_ENDPOINT = "https://services.leadconnectorhq.com/opportunities/search";
const TIMEOUT_MS          = 45_000;
const BETWEEN_PAGES_MS    = 500;
const MAX_PAGES_DEFAULT   = 30;
const MAX_RECORDS_DEFAULT = 3_000;
const PAGE_LIMIT          = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DateBasis =
  | "opportunityCreatedDate"
  | "opportunityUpdatedDate"
  | "contactCreatedDate";

type StoppedReason =
  | "no_next_page"
  | "max_pages_reached"
  | "max_records_reached"
  | "reached_older_than_range"
  | "api_error"
  | "test_mode_single_page";

type PaginationMode = "page" | "offset" | "startAfter" | "nextPageUrl" | "unknown";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function pickDateStr(opp: any, dateBasis: DateBasis): string | undefined {
  switch (dateBasis) {
    case "opportunityCreatedDate":
      return opp.createdAt ?? opp.dateAdded ?? opp.created_at ?? opp.created ?? undefined;
    case "opportunityUpdatedDate":
      return opp.updatedAt ?? opp.dateUpdated ?? opp.updated_at ?? opp.updated ?? undefined;
    case "contactCreatedDate":
      return opp.contact?.dateAdded ?? opp.contact?.createdAt ?? opp.contactCreatedAt ?? undefined;
  }
}

function rawDateKeys(opp: any): string[] {
  const DATE_KEYS = [
    "createdAt","dateAdded","created_at","created",
    "updatedAt","dateUpdated","updated_at","updated",
    "lastModified","modifiedAt","closedDate","dueDate",
  ];
  const found: string[] = [];
  for (const k of DATE_KEYS) {
    if (opp[k] !== undefined && opp[k] !== null) found.push(`${k}=${opp[k]}`);
  }
  return found;
}

function fmtDate(val: any): string {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 10);
}

function dateRangeSummary(opps: any[], fields: string[]): { earliest: string; latest: string; nonNullCount: number } {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const opp of opps) {
    for (const f of fields) {
      const v = opp[f];
      if (!v) continue;
      const ms = new Date(v).getTime();
      if (isNaN(ms)) continue;
      count++;
      if (ms < min) min = ms;
      if (ms > max) max = ms;
    }
  }
  if (count === 0) return { earliest: "—", latest: "—", nonNullCount: 0 };
  return {
    earliest:     new Date(min).toISOString().slice(0, 10),
    latest:       new Date(max).toISOString().slice(0, 10),
    nonNullCount: count,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Single-page fetch (with 429 + timeout retry) ─────────────────────────────

interface PageResult {
  ok: boolean;
  statusCode: number | null;
  opportunities: any[];
  meta: Record<string, any>;
  errorMessage: string | null;
  retryAfterMs?: number;
}

async function fetchOnePage(url: string, headers: Record<string, string>): Promise<PageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err: any) {
    clearTimeout(timer);
    const isAbort = err?.name === "AbortError";
    const cause   = err?.cause;
    const detail  = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
    const msg     = isAbort
      ? `Request timed out after ${TIMEOUT_MS / 1000}s`
      : `Network error: ${err?.message ?? "Unknown"}${detail}`;
    return { ok: false, statusCode: null, opportunities: [], meta: {}, errorMessage: msg };
  }
  clearTimeout(timer);

  if (res.status === 429) {
    const raHeader = res.headers.get("Retry-After");
    const retryAfterMs = raHeader ? parseInt(raHeader, 10) * 1000 : 2_000;
    return { ok: false, statusCode: 429, opportunities: [], meta: {}, errorMessage: "Rate limited (429)", retryAfterMs };
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    const summary = bodyText.slice(0, 400);
    return { ok: false, statusCode: res.status, opportunities: [], meta: {}, errorMessage: `HTTP ${res.status}: ${summary}` };
  }

  let json: any;
  try { json = JSON.parse(bodyText); }
  catch {
    return { ok: false, statusCode: res.status, opportunities: [], meta: {}, errorMessage: "Non-JSON response" };
  }

  return {
    ok: true,
    statusCode: res.status,
    opportunities: json?.opportunities ?? [],
    meta: json?.meta ?? {},
    errorMessage: null,
  };
}

async function fetchOnePageWithRetry(url: string, headers: Record<string, string>): Promise<PageResult> {
  const backoffsMs = [2_000, 5_000, 10_000];
  for (let attempt = 0; attempt <= 2; attempt++) {
    const r = await fetchOnePage(url, headers);
    if (r.ok) return r;

    const isRetriable =
      r.statusCode === 429 ||
      r.errorMessage?.startsWith("Request timed out") ||
      r.errorMessage?.startsWith("Network error");

    if (!isRetriable || attempt === 2) return r;

    const waitMs = r.statusCode === 429 ? (r.retryAfterMs ?? backoffsMs[attempt]) : backoffsMs[attempt];
    await sleep(waitMs);
  }
  return { ok: false, statusCode: null, opportunities: [], meta: {}, errorMessage: "Failed after 3 retries" };
}

// ─── Build paginated URL from base params ─────────────────────────────────────

function buildNextUrl(
  baseParams: URLSearchParams,
  mode: PaginationMode,
  page: number,
  cursor: string | null,
): string {
  const p = new URLSearchParams(baseParams);
  if (mode === "page") {
    p.set("page", String(page));
  } else if (mode === "startAfter" && cursor) {
    p.set("startAfterId", cursor);
  }
  return `${GHL_SEARCH_ENDPOINT}?${p.toString()}`;
}

// ─── Core paginated fetch ─────────────────────────────────────────────────────

interface PaginatedResult {
  ok: boolean;
  allOpportunities: any[];
  pagesFetched: number;
  totalReported: number | null;
  stoppedReason: StoppedReason;
  paginationMode: PaginationMode;
  firstUrl: string;
  firstQueryParams: Record<string, string>;
  lastStatusCode: number | null;
  errorMessage: string | null;
}

async function fetchAllPages(opts: {
  locationId: string;
  pipelineId: string;
  apiKey: string;
  apiVersion: string;
  fromDate: Date | null;
  dateBasis: DateBasis;
  maxPages: number;
  maxRecords: number;
}): Promise<PaginatedResult> {
  const { locationId, pipelineId, apiKey, apiVersion, fromDate, dateBasis, maxPages, maxRecords } = opts;

  const baseParams = new URLSearchParams({
    location_id: locationId,
    pipeline_id: pipelineId,
    limit: String(PAGE_LIMIT),
  });
  const firstUrl        = `${GHL_SEARCH_ENDPOINT}?${baseParams.toString()}`;
  const firstQueryParams = Object.fromEntries(baseParams.entries());
  const headers          = { Authorization: `Bearer ${apiKey}`, Version: apiVersion };

  const allOpps: any[]     = [];
  let pagesFetched           = 0;
  let totalReported: number | null = null;
  let lastStatusCode: number | null = null;
  let errorMessage: string | null   = null;
  let stoppedReason: StoppedReason  = "no_next_page";
  let paginationMode: PaginationMode = "unknown";
  let currentPage = 1;
  let cursor: string | null = null;
  let nextUrl: string | null = firstUrl;

  while (nextUrl && pagesFetched < maxPages && allOpps.length < maxRecords) {
    const r = await fetchOnePageWithRetry(nextUrl, headers);
    lastStatusCode = r.statusCode;

    if (!r.ok) {
      stoppedReason = "api_error";
      errorMessage  = r.errorMessage;
      break;
    }

    pagesFetched++;
    allOpps.push(...r.opportunities);

    if (totalReported === null && r.meta?.total != null) {
      totalReported = typeof r.meta.total === "number" ? r.meta.total : parseInt(r.meta.total, 10);
    }

    // ── Detect pagination mode from first response ──────────────────────────
    if (paginationMode === "unknown") {
      const m = r.meta;
      if (m?.nextPageUrl && typeof m.nextPageUrl === "string" && m.nextPageUrl.startsWith("http")) {
        paginationMode = "nextPageUrl";
      } else if (m?.startAfterId || m?.startAfter) {
        paginationMode = "startAfter";
      } else if (typeof m?.nextPage === "number" || typeof m?.currentPage === "number") {
        paginationMode = "page";
      } else if (r.opportunities.length === PAGE_LIMIT) {
        paginationMode = "page"; // assume page-based when we got a full page
      }
    }

    // ── Check stop conditions ────────────────────────────────────────────────

    // 1. Fetched all known records
    if (totalReported !== null && allOpps.length >= totalReported) {
      stoppedReason = "no_next_page";
      break;
    }

    // 2. Got fewer records than limit → last page
    if (r.opportunities.length < PAGE_LIMIT) {
      stoppedReason = "no_next_page";
      break;
    }

    // 3. Max records guard
    if (allOpps.length >= maxRecords) {
      stoppedReason = "max_records_reached";
      break;
    }

    // 4. Early stop when records sorted newest-first and oldest on page < fromDate
    if (fromDate && r.opportunities.length > 0) {
      const lastOpp     = r.opportunities[r.opportunities.length - 1];
      const lastDateStr = pickDateStr(lastOpp, dateBasis);
      if (lastDateStr) {
        const lastDate = new Date(lastDateStr);
        if (!isNaN(lastDate.getTime()) && lastDate < fromDate) {
          stoppedReason = "reached_older_than_range";
          break;
        }
      }
    }

    // 5. Max pages guard (pre-check before building next URL)
    if (pagesFetched >= maxPages) {
      stoppedReason = "max_pages_reached";
      break;
    }

    // ── Build next URL ───────────────────────────────────────────────────────
    const m = r.meta;
    if (paginationMode === "nextPageUrl") {
      const nu = m?.nextPageUrl;
      if (!nu || typeof nu !== "string" || !nu.startsWith("http")) { stoppedReason = "no_next_page"; break; }
      nextUrl = nu;
    } else if (paginationMode === "startAfter") {
      cursor = m?.startAfterId ?? m?.startAfter ?? (r.opportunities[r.opportunities.length - 1]?.id ?? null);
      if (!cursor) { stoppedReason = "no_next_page"; break; }
      nextUrl = buildNextUrl(baseParams, "startAfter", 0, cursor);
    } else {
      // page-based (or unknown falling back to page)
      const explicitNext = typeof m?.nextPage === "number" ? m.nextPage : null;
      if (explicitNext !== null) {
        if (explicitNext <= currentPage) { stoppedReason = "no_next_page"; break; }
        currentPage = explicitNext;
      } else {
        currentPage++;
      }
      paginationMode = "page";
      nextUrl = buildNextUrl(baseParams, "page", currentPage, null);
    }

    await sleep(BETWEEN_PAGES_MS);
  }

  // Post-loop: if we exited while loop because pagesFetched >= maxPages without explicit break
  if (stoppedReason === "no_next_page" && pagesFetched >= maxPages) {
    stoppedReason = "max_pages_reached";
  }

  return {
    ok: pagesFetched > 0,
    allOpportunities: allOpps,
    pagesFetched,
    totalReported,
    stoppedReason,
    paginationMode,
    firstUrl,
    firstQueryParams,
    lastStatusCode,
    errorMessage,
  };
}

// ─── Build date-field sample (first N + last N, deduplicated) ─────────────────

function buildDateSample(opps: any[], dateBasis: DateBasis, n = 5): any[] {
  const head = opps.slice(0, n);
  const tail = opps.length > n ? opps.slice(-n) : [];
  const seen = new Set<number>();
  const result: any[] = [];
  for (const [list, label] of [[head, "first"], [tail, "last"]] as [any[], string][]) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const idx = label === "first" ? i : opps.length - list.length + i;
      if (seen.has(idx)) continue;
      seen.add(idx);
      result.push({
        _position:            label === "first" ? `#${i + 1}` : `#${idx + 1} (last ${list.length - i})`,
        id:                   o.id             ?? "—",
        name:                 o.name           ?? "—",
        contactName:          (o.contact?.name ?? (`${o.contact?.firstName ?? ""} ${o.contact?.lastName ?? ""}`.trim() || "—")),
        createdAt:            fmtDate(o.createdAt),
        dateAdded:            fmtDate(o.dateAdded),
        updatedAt:            fmtDate(o.updatedAt),
        dateUpdated:          fmtDate(o.dateUpdated),
        resolvedBasisValue:   fmtDate(pickDateStr(o, dateBasis)),
        rawDateKeys:          rawDateKeys(o),
      });
    }
  }
  return result;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Validate env vars ──────────────────────────────────────────────────────
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_LEAD_INQUIRY_PIPELINE_ID;
  const apiVersion = process.env.GHL_API_VERSION ?? "2021-07-28";

  if (!apiKey)     return NextResponse.json({ error: "Missing GHL_API_KEY in .env" },     { status: 200 });
  if (!locationId) return NextResponse.json({ error: "Missing GHL_LOCATION_ID in .env" }, { status: 200 });
  if (!pipelineId) return NextResponse.json({
    error: "Missing GHL_LEAD_INQUIRY_PIPELINE_ID in .env. Use the GHL Pipeline Lookup tool on this page to find your pipeline ID.",
  }, { status: 200 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const testMode:  boolean   = body.test      === true;
  const from:      string    = body.from      ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to:        string    = body.to        ?? new Date().toISOString().slice(0, 10);
  const dateBasis: DateBasis = body.dateBasis ?? "opportunityCreatedDate";

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate   = new Date(to   + "T23:59:59Z");

  const diag: Record<string, any> = {
    endpoint:               GHL_SEARCH_ENDPOINT,
    method:                 "GET",
    hasLocationId:          !!locationId,
    hasPipelineId:          !!pipelineId,
    dateRange:              `${from} → ${to}`,
    dateBasis,
    testMode,
    paginationMode:         "unknown",
    firstQueryParams:       {},
    firstUrl:               "",
    apiStatusCode:          null as number | null,
    totalReported:          null as number | null,
    pagesFetched:           0,
    recordsFetched:         0,
    earliestFetchedDate:    "—",
    latestFetchedDate:      "—",
    recordsAfterDateFilter: 0,
    recordsCreated:         0,
    recordsSkipped:         0,
    stoppedReason:          "—",
    warnings:               [] as string[],
  };

  // ── TEST MODE (single page, no DB write) ───────────────────────────────────
  if (testMode) {
    const headers = { Authorization: `Bearer ${apiKey}`, Version: apiVersion };
    const baseParams = new URLSearchParams({
      location_id: locationId,
      pipeline_id: pipelineId,
      limit: String(PAGE_LIMIT),
    });
    const url = `${GHL_SEARCH_ENDPOINT}?${baseParams.toString()}`;

    const r = await fetchOnePageWithRetry(url, headers);

    diag.firstQueryParams  = Object.fromEntries(baseParams.entries());
    diag.firstUrl          = url;
    diag.apiStatusCode     = r.statusCode;
    diag.stoppedReason     = "test_mode_single_page";
    diag.paginationMode    = "—";

    if (!r.ok) {
      return NextResponse.json({ success: false, testMode: true, error: r.errorMessage, diag }, { status: 200 });
    }

    const opps = r.opportunities;
    const total = r.meta?.total ?? null;
    diag.totalReported  = total;
    diag.pagesFetched   = 1;
    diag.recordsFetched = opps.length;

    // Date ranges across fetched records
    const crRange = dateRangeSummary(opps, ["createdAt", "dateAdded", "created_at", "created"]);
    const upRange = dateRangeSummary(opps, ["updatedAt", "dateUpdated", "updated_at", "updated"]);
    diag.earliestFetchedDate = crRange.earliest;
    diag.latestFetchedDate   = crRange.latest;

    diag.dateFieldRanges = {
      createdAt:   crRange,
      updatedAt:   upRange,
      contactDate: dateRangeSummary(
        opps.map((o) => ({ _d: o.contact?.dateAdded ?? o.contact?.createdAt ?? o.contactCreatedAt })),
        ["_d"],
      ),
    };

    // Date filter
    const afterDate = opps.filter((opp) => {
      const ds = pickDateStr(opp, dateBasis);
      if (!ds) return false;
      const d = new Date(ds);
      return !isNaN(d.getTime()) && d >= fromDate && d <= toDate;
    });
    diag.recordsAfterDateFilter = afterDate.length;

    // Warnings
    const basisOk = opps.some((o) => !!pickDateStr(o, dateBasis));
    if (opps.length === 0) {
      diag.warnings.push("API returned 0 records. Pipeline may be empty or the API key may lack read access.");
    } else if (!basisOk) {
      diag.warnings.push(`No valid dates found for selected date basis "${dateBasis}". Try "Opportunity Updated Date" or inspect raw date fields below.`);
    } else if (afterDate.length === 0) {
      diag.warnings.push(
        `Dates exist for "${dateBasis}" but none fall within ${from} → ${to}. ` +
        `Earliest fetched date: ${crRange.earliest}. Try widening your date range.`,
      );
    }
    if (total !== null && total > opps.length) {
      diag.warnings.push(
        `Only first page fetched (${opps.length} records). API reports ${total} total. ` +
        `Use "Pull via GHL API" to fetch all pages with pagination.`,
      );
    }

    // Date sample (first 5 + last 5)
    diag.dateSample = buildDateSample(opps, dateBasis);

    return NextResponse.json({ success: true, testMode: true, diag }, { status: 200 });
  }

  // ── FULL PAGINATED PULL ────────────────────────────────────────────────────
  const syncRun = await prisma.syncRun.create({
    data: {
      sourceSystem:   "GHL",
      syncType:       "API",
      status:         "RUNNING",
      dateRangeStart: fromDate,
      dateRangeEnd:   toDate,
    },
  });

  try {
    const fetched = await fetchAllPages({
      locationId,
      pipelineId,
      apiKey,
      apiVersion,
      fromDate,
      dateBasis,
      maxPages:    MAX_PAGES_DEFAULT,
      maxRecords:  MAX_RECORDS_DEFAULT,
    });

    diag.firstQueryParams  = fetched.firstQueryParams;
    diag.firstUrl          = fetched.firstUrl;
    diag.apiStatusCode     = fetched.lastStatusCode;
    diag.totalReported     = fetched.totalReported;
    diag.pagesFetched      = fetched.pagesFetched;
    diag.recordsFetched    = fetched.allOpportunities.length;
    diag.paginationMode    = fetched.paginationMode;
    diag.stoppedReason     = fetched.stoppedReason;

    // Earliest/latest across all fetched
    const crRange = dateRangeSummary(fetched.allOpportunities, ["createdAt", "dateAdded", "created_at", "created"]);
    diag.earliestFetchedDate = crRange.earliest;
    diag.latestFetchedDate   = crRange.latest;

    if (!fetched.ok) {
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: fetched.errorMessage ?? "GHL API error" },
      });
      return NextResponse.json({ error: fetched.errorMessage, syncRunId: syncRun.id, diag }, { status: 200 });
    }

    // ── Date filter ──────────────────────────────────────────────────────────
    const afterDateFilter = fetched.allOpportunities.filter((opp) => {
      const ds = pickDateStr(opp, dateBasis);
      if (!ds) return false;
      const d = new Date(ds);
      return !isNaN(d.getTime()) && d >= fromDate && d <= toDate;
    });
    diag.recordsAfterDateFilter = afterDateFilter.length;

    if (fetched.allOpportunities.length > 0 && afterDateFilter.length === 0) {
      diag.warnings.push(
        `${fetched.allOpportunities.length} record(s) fetched across ${fetched.pagesFetched} page(s) ` +
        `but none matched date range ${from} → ${to} using date basis: ${dateBasis}. ` +
        `Earliest fetched date: ${crRange.earliest}. Run Test Pull to inspect date fields.`,
      );
    }

    // Date sample (first 5 + last 5 of all fetched)
    diag.dateSample = buildDateSample(fetched.allOpportunities, dateBasis);

    // ── Build DB records ─────────────────────────────────────────────────────
    const records = afterDateFilter.map((opp: any) => {
      const contact       = opp.contact ?? {};
      const opportunityId = opp.id      ?? undefined;
      const contactId     = contact.id  ?? opp.contactId ?? undefined;

      const externalId = opportunityId
        ? `GHL|${opportunityId}`
        : contactId
          ? `GHL|contact|${contactId}`
          : undefined;

      const dateStr   = pickDateStr(opp, "opportunityCreatedDate");
      const createdAt = dateStr ? new Date(dateStr) : new Date();

      const fullName =
        contact.name ??
        (`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || undefined);

      return {
        sourceSystem:      "GHL"             as const,
        recordType:        "INDIVIDUAL_LEAD" as const,
        backendProvider:   "GHL",
        externalId,
        createdAtSource:   createdAt,
        fullName,
        firstName:         contact.firstName    ?? undefined,
        lastName:          contact.lastName     ?? undefined,
        email:             contact.email        ?? undefined,
        phone:             contact.phone        ?? undefined,
        clinicLocationRaw: contact.locationName ?? undefined,
        serviceRaw:        opp.name             ?? undefined,
        status:            opp.status           ?? undefined,
        leadSource:        contact.source       ?? opp.source       ?? undefined,
        attributedChannel: contact.attributionSource?.medium ?? opp.attributionSource?.medium ?? undefined,
        ghlContactId:      contactId,
        ghlOpportunityId:  opportunityId,
        ghlPipelineName:   opp.pipelineName     ?? undefined,
        ghlPipelineId:     pipelineId,
        ghlStageName:      opp.stage?.name      ?? undefined,
        ghlStageId:        opp.stage?.id        ?? undefined,
        rawPayload:        opp,
      };
    });

    const insertable = records.filter((r) => r.externalId != null);
    if (records.length > insertable.length) {
      diag.warnings.push(`${records.length - insertable.length} record(s) skipped — no opportunityId or contactId.`);
    }

    // ── Save in chunks ───────────────────────────────────────────────────────
    let created = 0;
    let skipped = 0;
    for (let i = 0; i < insertable.length; i += 100) {
      const chunk  = insertable.slice(i, i + 100);
      const result = await prisma.leadSourceRecord.createMany({ data: chunk, skipDuplicates: true });
      created += result.count;
      skipped += chunk.length - result.count;
    }
    diag.recordsCreated = created;
    diag.recordsSkipped = skipped;

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status:         "COMPLETED",
        finishedAt:     new Date(),
        recordsFetched: fetched.allOpportunities.length,
        recordsCreated: created,
        recordsSkipped: skipped,
      },
    });

    return NextResponse.json({ success: true, syncRunId: syncRun.id, diag }, { status: 200 });

  } catch (err: any) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: err?.message ?? "Unknown error" },
    });
    return NextResponse.json({ error: err?.message ?? "GHL pull failed", syncRunId: syncRun.id, diag }, { status: 200 });
  }
}
