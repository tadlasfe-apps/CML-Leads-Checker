export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const GHL_SEARCH_ENDPOINT = "https://services.leadconnectorhq.com/opportunities/search";
const TIMEOUT_MS = 45_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DateBasis =
  | "opportunityCreatedDate"
  | "opportunityUpdatedDate"
  | "contactCreatedDate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickDateStr(opp: any, dateBasis: DateBasis): string | undefined {
  switch (dateBasis) {
    case "opportunityCreatedDate":
      return opp.createdAt ?? opp.dateAdded;
    case "opportunityUpdatedDate":
      return opp.updatedAt ?? opp.lastUpdated ?? opp.dateUpdated;
    case "contactCreatedDate":
      return opp.contact?.dateAdded ?? opp.contact?.createdAt ?? opp.contactCreatedAt;
  }
}

// ─── Core fetch: GET /opportunities/search ────────────────────────────────────

async function fetchOpportunities(
  locationId: string,
  pipelineId: string,
  limit: number,
  apiKey: string,
  apiVersion: string,
): Promise<{
  ok: boolean;
  statusCode: number | null;
  opportunities: any[];
  rawSummary: string;
  errorMessage: string | null;
  queryParams: Record<string, string>;
  url: string;
}> {
  // Always use URLSearchParams so values are never undefined in the query string
  const params = new URLSearchParams({
    location_id: locationId,
    pipeline_id: pipelineId,
    limit: String(limit),
  });
  const url = `${GHL_SEARCH_ENDPOINT}?${params.toString()}`;
  const queryParams = Object.fromEntries(params.entries());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: apiVersion,
        Accept: "application/json",
      },
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
    return { ok: false, statusCode: null, opportunities: [], rawSummary: msg, errorMessage: msg, queryParams, url };
  }

  clearTimeout(timer);

  const bodyText = await res.text().catch(() => "");

  if (!res.ok) {
    const summary = bodyText.slice(0, 400);
    return {
      ok: false,
      statusCode: res.status,
      opportunities: [],
      rawSummary: summary,
      errorMessage: `HTTP ${res.status}: ${summary}`,
      queryParams,
      url,
    };
  }

  let json: any;
  try { json = JSON.parse(bodyText); }
  catch {
    return { ok: false, statusCode: res.status, opportunities: [], rawSummary: "Non-JSON response", errorMessage: "Non-JSON response", queryParams, url };
  }

  const opportunities: any[] = json?.opportunities ?? [];
  const meta = json?.meta ?? {};
  const rawSummary = `total=${meta.total ?? "?"}, returned=${opportunities.length}`;

  return { ok: true, statusCode: res.status, opportunities, rawSummary, errorMessage: null, queryParams, url };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Validate env vars before doing anything ────────────────────────────────
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_LEAD_INQUIRY_PIPELINE_ID;
  const apiVersion = process.env.GHL_API_VERSION ?? "2021-07-28";

  if (!apiKey) {
    return NextResponse.json({ error: "Missing GHL_API_KEY in .env" }, { status: 200 });
  }
  if (!locationId) {
    return NextResponse.json({ error: "Missing GHL_LOCATION_ID in .env" }, { status: 200 });
  }
  if (!pipelineId) {
    return NextResponse.json({
      error: "Missing GHL_LEAD_INQUIRY_PIPELINE_ID in .env. " +
             "Use the GHL Pipeline Lookup tool on this page to find your pipeline ID.",
    }, { status: 200 });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const testMode:  boolean   = body.test      === true;
  const from:      string    = body.from      ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to:        string    = body.to        ?? new Date().toISOString().slice(0, 10);
  const dateBasis: DateBasis = body.dateBasis ?? "opportunityCreatedDate";

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate   = new Date(to   + "T23:59:59Z");

  const limit = testMode ? 20 : 100;

  // ── Base diagnostics ───────────────────────────────────────────────────────
  const diag: Record<string, any> = {
    endpoint:                GHL_SEARCH_ENDPOINT,
    method:                  "GET",
    hasLocationId:           !!locationId,
    hasPipelineId:           !!pipelineId,
    locationIdPrefix:        locationId.slice(0, 8) + "…",
    pipelineIdPrefix:        pipelineId.slice(0, 8) + "…",
    dateRange:               `${from} → ${to}`,
    dateBasis,
    testMode,
    queryParams:             {},
    url:                     "",
    apiStatusCode:           null as number | null,
    responseSummary:         "",
    recordsFetched:          0,
    recordsAfterDateFilter:  0,
    recordsCreated:          0,
    recordsSkipped:          0,
    warnings:                [] as string[],
  };

  // ── TEST MODE ──────────────────────────────────────────────────────────────
  if (testMode) {
    const result = await fetchOpportunities(locationId, pipelineId, limit, apiKey, apiVersion);

    diag.queryParams    = result.queryParams;
    diag.url            = result.url;
    diag.apiStatusCode  = result.statusCode;
    diag.responseSummary = result.rawSummary;
    diag.recordsFetched = result.opportunities.length;

    if (!result.ok) {
      return NextResponse.json({
        success:  false,
        testMode: true,
        error:    result.errorMessage,
        diag,
      }, { status: 200 });
    }

    const afterDate = result.opportunities.filter((opp) => {
      const dateStr = pickDateStr(opp, dateBasis);
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= fromDate && d <= toDate;
    });
    diag.recordsAfterDateFilter = afterDate.length;

    if (result.opportunities.length === 0) {
      diag.warnings.push("API returned 0 records. Pipeline may be empty or the API key may lack read access.");
    }

    return NextResponse.json({
      success:      true,
      testMode:     true,
      diag,
      sample: afterDate.slice(0, 3).map((o: any) => ({
        id:         o.id,
        name:       o.name,
        pipelineId: o.pipelineId,
        status:     o.status,
        createdAt:  o.createdAt ?? o.dateAdded,
        updatedAt:  o.updatedAt,
        contactId:  o.contactId ?? o.contact?.id,
        stageId:    o.pipelineStageId ?? o.stage?.id,
        stageName:  o.stage?.name,
      })),
    }, { status: 200 });
  }

  // ── FULL PULL ──────────────────────────────────────────────────────────────
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
    const result = await fetchOpportunities(locationId, pipelineId, limit, apiKey, apiVersion);

    diag.queryParams     = result.queryParams;
    diag.url             = result.url;
    diag.apiStatusCode   = result.statusCode;
    diag.responseSummary = result.rawSummary;
    diag.recordsFetched  = result.opportunities.length;

    if (!result.ok) {
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: result.errorMessage ?? "GHL API error" },
      });
      return NextResponse.json({ error: result.errorMessage, syncRunId: syncRun.id, diag }, { status: 200 });
    }

    // ── Date filter ──────────────────────────────────────────────────────────
    const afterDateFilter = result.opportunities.filter((opp) => {
      const dateStr = pickDateStr(opp, dateBasis);
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= fromDate && d <= toDate;
    });
    diag.recordsAfterDateFilter = afterDateFilter.length;

    if (result.opportunities.length > 0 && afterDateFilter.length === 0) {
      diag.warnings.push(
        `${result.opportunities.length} record(s) fetched but none matched ` +
        `date range ${from} → ${to} using date basis: ${dateBasis}. ` +
        `Try a wider date range or a different date basis.`,
      );
    }

    // ── Build DB records ─────────────────────────────────────────────────────
    const records = afterDateFilter.map((opp: any) => {
      const contact      = opp.contact ?? {};
      const opportunityId = opp.id      ?? undefined;
      const contactId    = contact.id   ?? opp.contactId ?? undefined;

      const externalId = opportunityId
        ? `GHL|${opportunityId}`
        : contactId
          ? `GHL|contact|${contactId}`
          : undefined;

      const dateStr   = opp.createdAt ?? opp.dateAdded;
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

    // ── Save ─────────────────────────────────────────────────────────────────
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
      data: { status: "COMPLETED", finishedAt: new Date(), recordsFetched: result.opportunities.length, recordsCreated: created, recordsSkipped: skipped },
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
