export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const GHL_BASE        = "https://services.leadconnectorhq.com";
const POST_ENDPOINT   = `${GHL_BASE}/opportunities/search`;
const GET_ENDPOINT    = `${GHL_BASE}/opportunities/search`;   // same path, GET + query params
const PAGE_SIZE       = 20;   // conservative — minimal payload per request
const TIMEOUT_MS      = 45_000;
const RETRY_DELAYS_MS = [2_000, 5_000];   // shorter list so both strategies fit in budget

// ─── Types ────────────────────────────────────────────────────────────────────

export type DateBasis =
  | "opportunityCreatedDate"
  | "opportunityUpdatedDate"
  | "contactCreatedDate";

export interface StrategyDiag {
  strategy:       "A" | "B";
  method:         "POST" | "GET";
  endpoint:       string;
  requestParams:  Record<string, any>;  // body (POST) or query params (GET) — no token
  timedOut:       boolean;
  statusCode:     number | null;
  responseText:   string;
  succeeded:      boolean;
  errorMessage:   string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

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

function isRetryableNetworkError(err: any): boolean {
  if (err?.name === "AbortError") return true;
  const code = err?.cause?.code ?? "";
  return ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"].includes(code);
}

// ─── Strategy A: POST /opportunities/search ───────────────────────────────────

async function tryStrategyA(
  reqBody: Record<string, any>,
  apiKey: string,
  apiVersion: string,
): Promise<{ timedOut: boolean; status: number; json: any; rawSummary: string; stratDiag: StrategyDiag }> {
  const stratDiag: StrategyDiag = {
    strategy:       "A",
    method:         "POST",
    endpoint:       POST_ENDPOINT,
    requestParams:  reqBody,
    timedOut:       false,
    statusCode:     null,
    responseText:   "",
    succeeded:      false,
    errorMessage:   null,
  };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(POST_ENDPOINT, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          Version:        apiVersion,
          Accept:         "application/json",
          "Content-Type": "application/json",
        },
        body:   JSON.stringify(reqBody),
        signal: controller.signal,
        cache:  "no-store",
      });
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err?.name === "AbortError";
      if (isAbort) {
        stratDiag.timedOut    = true;
        stratDiag.errorMessage = `Strategy A timed out after ${TIMEOUT_MS / 1000}s (attempt ${attempt + 1})`;
        stratDiag.responseText = stratDiag.errorMessage;
        return { timedOut: true, status: 0, json: null, rawSummary: "timed out", stratDiag };
      }
      if (isRetryableNetworkError(err) && attempt < RETRY_DELAYS_MS.length) continue;
      const cause  = err?.cause;
      const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
      stratDiag.errorMessage = `Network error: ${err?.message ?? "Unknown"}${detail}`;
      stratDiag.responseText = stratDiag.errorMessage;
      return { timedOut: false, status: 0, json: null, rawSummary: "network error", stratDiag };
    }

    clearTimeout(timer);
    stratDiag.statusCode = res.status;

    if (res.status === 429) {
      if (attempt < RETRY_DELAYS_MS.length) continue;
      stratDiag.responseText = "429 rate limited after all retries";
      stratDiag.errorMessage = "Rate limited (429)";
      return { timedOut: false, status: 429, json: null, rawSummary: "rate limited", stratDiag };
    }

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      stratDiag.responseText = body.slice(0, 300);
      stratDiag.errorMessage = `GHL API returned ${res.status}`;
      return { timedOut: false, status: res.status, json: null, rawSummary: `auth error ${res.status}`, stratDiag };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      stratDiag.responseText = body.slice(0, 300);
      stratDiag.errorMessage = `HTTP ${res.status}`;
      return { timedOut: false, status: res.status, json: null, rawSummary: `error ${res.status}`, stratDiag };
    }

    let json: any;
    try { json = await res.json(); }
    catch {
      stratDiag.responseText = "Non-JSON response";
      stratDiag.errorMessage = "Non-JSON response";
      return { timedOut: false, status: res.status, json: null, rawSummary: "non-JSON", stratDiag };
    }

    const meta       = json?.meta ?? {};
    const rawSummary = `total=${meta.total ?? "?"}, count=${meta.count ?? json?.opportunities?.length ?? "?"}`;
    stratDiag.responseText = rawSummary;
    stratDiag.succeeded    = true;
    return { timedOut: false, status: res.status, json, rawSummary, stratDiag };
  }

  stratDiag.errorMessage = "Exhausted retries";
  stratDiag.responseText = "Exhausted retries";
  return { timedOut: false, status: 0, json: null, rawSummary: "exhausted retries", stratDiag };
}

// ─── Strategy B: GET /opportunities/search ────────────────────────────────────

async function tryStrategyB(
  locationId: string,
  pipelineId: string,
  limit: number,
  apiKey: string,
  apiVersion: string,
): Promise<{ timedOut: boolean; status: number; json: any; rawSummary: string; stratDiag: StrategyDiag }> {
  const queryParams: Record<string, any> = { locationId, pipelineId, limit };
  const qs  = new URLSearchParams({
    locationId,
    pipelineId,
    limit: String(limit),
  }).toString();
  const url = `${GET_ENDPOINT}?${qs}`;

  const stratDiag: StrategyDiag = {
    strategy:       "B",
    method:         "GET",
    endpoint:       GET_ENDPOINT,
    requestParams:  queryParams,
    timedOut:       false,
    statusCode:     null,
    responseText:   "",
    succeeded:      false,
    errorMessage:   null,
  };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method:  "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version:       apiVersion,
          Accept:        "application/json",
        },
        signal: controller.signal,
        cache:  "no-store",
      });
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err?.name === "AbortError";
      if (isAbort) {
        stratDiag.timedOut     = true;
        stratDiag.errorMessage = `Strategy B timed out after ${TIMEOUT_MS / 1000}s (attempt ${attempt + 1})`;
        stratDiag.responseText = stratDiag.errorMessage;
        return { timedOut: true, status: 0, json: null, rawSummary: "timed out", stratDiag };
      }
      if (isRetryableNetworkError(err) && attempt < RETRY_DELAYS_MS.length) continue;
      const cause  = err?.cause;
      const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
      stratDiag.errorMessage = `Network error: ${err?.message ?? "Unknown"}${detail}`;
      stratDiag.responseText = stratDiag.errorMessage;
      return { timedOut: false, status: 0, json: null, rawSummary: "network error", stratDiag };
    }

    clearTimeout(timer);
    stratDiag.statusCode = res.status;

    if (res.status === 429) {
      if (attempt < RETRY_DELAYS_MS.length) continue;
      stratDiag.responseText = "429 rate limited after all retries";
      stratDiag.errorMessage = "Rate limited (429)";
      return { timedOut: false, status: 429, json: null, rawSummary: "rate limited", stratDiag };
    }

    const bodyText = await res.text().catch(() => "");
    stratDiag.responseText = bodyText.slice(0, 400);

    if (!res.ok) {
      stratDiag.errorMessage = `HTTP ${res.status}`;
      return { timedOut: false, status: res.status, json: null, rawSummary: `error ${res.status}`, stratDiag };
    }

    let json: any;
    try { json = JSON.parse(bodyText); }
    catch {
      stratDiag.responseText = bodyText.slice(0, 400);
      stratDiag.errorMessage = "Non-JSON response";
      return { timedOut: false, status: res.status, json: null, rawSummary: "non-JSON", stratDiag };
    }

    const meta       = json?.meta ?? {};
    const rawSummary = `total=${meta.total ?? "?"}, count=${meta.count ?? json?.opportunities?.length ?? "?"}`;
    stratDiag.responseText = rawSummary;
    stratDiag.succeeded    = true;
    return { timedOut: false, status: res.status, json, rawSummary, stratDiag };
  }

  stratDiag.errorMessage = "Exhausted retries";
  stratDiag.responseText = "Exhausted retries";
  return { timedOut: false, status: 0, json: null, rawSummary: "exhausted retries", stratDiag };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_LEAD_INQUIRY_PIPELINE_ID;
  const apiVersion = process.env.GHL_API_VERSION ?? "2021-07-28";

  if (!apiKey || !locationId) {
    return NextResponse.json(
      { error: "Missing GHL_API_KEY or GHL_LOCATION_ID in .env" },
      { status: 200 },
    );
  }
  if (!pipelineId) {
    return NextResponse.json(
      {
        error:
          "GHL_LEAD_INQUIRY_PIPELINE_ID is not set in .env. " +
          "Use the GHL Pipeline Lookup tool to find your pipeline ID, then add it to .env.",
      },
      { status: 200 },
    );
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const testMode:  boolean    = body.test      === true;
  const from:      string     = body.from      ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to:        string     = body.to        ?? new Date().toISOString().slice(0, 10);
  const dateBasis: DateBasis  = body.dateBasis ?? "opportunityCreatedDate";

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate   = new Date(to   + "T23:59:59Z");

  const minimalBody: Record<string, any> = {
    locationId,
    pipelineId,
    limit: testMode ? 20 : PAGE_SIZE,
  };

  const diag: Record<string, any> = {
    endpoint:                   POST_ENDPOINT,
    method:                     "POST",
    locationId,
    pipelineId,
    dateRange:                  { from, to },
    dateBasis,
    testMode,
    requestBody:                minimalBody,
    pagesRequested:             0,
    recordsFetchedTotal:        0,
    recordsAfterPipelineFilter: 0,
    recordsAfterDateFilter:     0,
    recordsCreated:             0,
    recordsSkipped:             0,
    apiStatusCodes:             [] as number[],
    responseSummary:            "",
    warnings:                   [] as string[],
    strategies:                 [] as StrategyDiag[],
  };

  // ── TEST MODE ─────────────────────────────────────────────────────────────

  if (testMode) {
    // Strategy A
    const a = await tryStrategyA(minimalBody, apiKey, apiVersion);
    diag.strategies.push(a.stratDiag);
    diag.apiStatusCodes.push(a.status);
    diag.responseSummary = a.rawSummary;
    diag.endpoint        = POST_ENDPOINT;
    diag.method          = "POST";

    let opps: any[]    = a.json?.opportunities ?? [];
    let successStrat   = a.stratDiag.succeeded ? "A" : null;

    // Strategy B fallback if A timed out or failed without auth error
    if (!a.stratDiag.succeeded && a.status !== 401 && a.status !== 403 && a.status !== 429) {
      const b = await tryStrategyB(locationId, pipelineId, 20, apiKey, apiVersion);
      diag.strategies.push(b.stratDiag);
      diag.apiStatusCodes.push(b.status);
      if (b.stratDiag.succeeded) {
        opps         = b.json?.opportunities ?? [];
        successStrat = "B";
        diag.responseSummary = b.rawSummary;
        diag.endpoint        = GET_ENDPOINT;
        diag.method          = "GET";
      }
    }

    diag.recordsFetchedTotal = opps.length;

    // Both strategies failed
    if (!successStrat) {
      const allTimedOut = diag.strategies.every((s: StrategyDiag) => s.timedOut);
      if (allTimedOut) {
        diag.warnings.push("Both strategies (POST and GET) timed out.");
        return NextResponse.json({
          success:    false,
          testMode:   true,
          error:      "GHL opportunity endpoint timed out",
          hint:       "Pipeline lookup works, but the opportunity search/list endpoint did not respond. " +
                      "This is likely a firewall or routing issue on your hosting provider. " +
                      "Try CSV import or verify the opportunity endpoint with GHL support.",
          diag,
        }, { status: 200 });
      }
      const lastErr = diag.strategies[diag.strategies.length - 1]?.errorMessage ?? "Unknown error";
      diag.warnings.push(`Both strategies failed. Last error: ${lastErr}`);
      return NextResponse.json({
        success:  false,
        testMode: true,
        error:    lastErr,
        diag,
      }, { status: 200 });
    }

    if (opps.length === 0) {
      diag.warnings.push(
        `Strategy ${successStrat} succeeded but returned 0 records. ` +
        "The pipeline may be empty or the API key may lack read access.",
      );
    }

    return NextResponse.json({
      success:      true,
      testMode:     true,
      strategyUsed: successStrat,
      diag,
      sample: opps.slice(0, 3).map((o: any) => ({
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
    });
  }

  // ── FULL PULL ─────────────────────────────────────────────────────────────

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
    const allOpportunities: any[] = [];
    let startAfterId: string | null = null;
    let rateLimited  = false;
    let strategyUsed: "A" | "B" | null = null;

    // Determine which strategy works using a probe on page 1
    {
      const probeBody = { ...minimalBody };
      const a = await tryStrategyA(probeBody, apiKey, apiVersion);
      diag.strategies.push(a.stratDiag);
      diag.apiStatusCodes.push(a.status);
      diag.pagesRequested++;

      if (a.stratDiag.succeeded) {
        strategyUsed         = "A";
        diag.responseSummary = a.rawSummary;
        diag.endpoint        = POST_ENDPOINT;
        diag.method          = "POST";

        const batch: any[] = a.json?.opportunities ?? [];
        allOpportunities.push(...batch);
        diag.recordsFetchedTotal = allOpportunities.length;

        const nextCursor: string | null = a.json?.meta?.startAfterId ?? null;
        if (nextCursor && batch.length >= PAGE_SIZE) startAfterId = nextCursor;
        else startAfterId = null;  // signal: no more pages needed from probe
      } else if (a.status === 429) {
        rateLimited = true;
        diag.warnings.push("Rate limited (429) — partial results only.");
      } else if (a.status !== 401 && a.status !== 403) {
        // Try strategy B as probe
        const b = await tryStrategyB(locationId, pipelineId, PAGE_SIZE, apiKey, apiVersion);
        diag.strategies.push(b.stratDiag);
        diag.apiStatusCodes.push(b.status);

        if (b.stratDiag.succeeded) {
          strategyUsed         = "B";
          diag.responseSummary = b.rawSummary;
          diag.endpoint        = GET_ENDPOINT;
          diag.method          = "GET";

          const batch: any[] = b.json?.opportunities ?? [];
          allOpportunities.push(...batch);
          diag.recordsFetchedTotal = allOpportunities.length;
          // GET fallback doesn't support cursor pagination in the same way; stop after first page
          startAfterId = null;
        } else if (b.status === 429) {
          rateLimited = true;
          diag.warnings.push("Rate limited (429) on both strategies — partial results only.");
        } else {
          // Both failed
          const allTimedOut = diag.strategies.every((s: StrategyDiag) => s.timedOut);
          const lastErr     = diag.strategies[diag.strategies.length - 1]?.errorMessage ?? "Unknown error";

          await prisma.syncRun.update({
            where: { id: syncRun.id },
            data: {
              status:       "FAILED",
              finishedAt:   new Date(),
              errorMessage: allTimedOut ? "GHL opportunity endpoint timed out (both strategies)" : lastErr,
            },
          });

          if (allTimedOut) {
            return NextResponse.json({
              success:    false,
              error:      "GHL opportunity endpoint timed out",
              hint:       "Pipeline lookup works, but the opportunity search/list endpoint did not respond. " +
                          "This is likely a firewall or routing issue on your hosting provider. " +
                          "Try CSV import or verify the opportunity endpoint with GHL support.",
              syncRunId:  syncRun.id,
              diag,
            }, { status: 200 });
          }

          return NextResponse.json({
            error:     lastErr,
            syncRunId: syncRun.id,
            diag,
          }, { status: 200 });
        }
      }
    }

    // Continue paginating with Strategy A if it worked and there's a cursor
    if (strategyUsed === "A" && startAfterId) {
      while (!rateLimited) {
        const pageBody = { ...minimalBody, startAfterId };
        const a = await tryStrategyA(pageBody, apiKey, apiVersion);
        diag.strategies.push(a.stratDiag);
        diag.apiStatusCodes.push(a.status);
        diag.pagesRequested++;

        if (a.status === 429) {
          rateLimited = true;
          diag.warnings.push("Rate limited (429) after retries — partial results only.");
          break;
        }
        if (!a.stratDiag.succeeded) {
          diag.warnings.push(`Pagination stopped: ${a.stratDiag.errorMessage}`);
          break;
        }

        const batch: any[] = a.json?.opportunities ?? [];
        allOpportunities.push(...batch);
        diag.recordsFetchedTotal = allOpportunities.length;

        const nextCursor: string | null = a.json?.meta?.startAfterId ?? null;
        if (!nextCursor || batch.length < PAGE_SIZE) break;
        startAfterId = nextCursor;
      }
    }

    // ── Pipeline filter ───────────────────────────────────────────────────────
    const afterPipelineFilter = allOpportunities.filter(
      (opp) => !opp.pipelineId || opp.pipelineId === pipelineId,
    );
    diag.recordsAfterPipelineFilter = afterPipelineFilter.length;

    if (allOpportunities.length > 0 && afterPipelineFilter.length === 0) {
      diag.warnings.push(
        `Records were found (${allOpportunities.length}), but none matched the configured ` +
        `Lead Inquiry Pipeline ID (${pipelineId}). ` +
        `The API may be returning opportunities from a different pipeline.`,
      );
    }

    // ── Date filter ───────────────────────────────────────────────────────────
    const afterDateFilter = afterPipelineFilter.filter((opp) => {
      const dateStr = pickDateStr(opp, dateBasis);
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= fromDate && d <= toDate;
    });
    diag.recordsAfterDateFilter = afterDateFilter.length;

    if (afterPipelineFilter.length > 0 && afterDateFilter.length === 0) {
      diag.warnings.push(
        `Records were found (${afterPipelineFilter.length}), but none matched the selected ` +
        `date range (${from} → ${to}) using date basis: ${dateBasis}. ` +
        `Try a wider date range or a different date basis.`,
      );
    }

    // ── Build DB records ──────────────────────────────────────────────────────
    const records = afterDateFilter.map((opp: any) => {
      const contact       = opp.contact ?? {};
      const opportunityId = opp.id      ?? undefined;
      const contactId     = contact.id  ?? opp.contactId ?? undefined;

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
      diag.warnings.push(
        `${records.length - insertable.length} record(s) skipped — no opportunityId or contactId.`,
      );
    }

    // ── Upsert ────────────────────────────────────────────────────────────────
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < insertable.length; i += 100) {
      const chunk  = insertable.slice(i, i + 100);
      const result = await prisma.leadSourceRecord.createMany({
        data: chunk,
        skipDuplicates: true,
      });
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
        recordsFetched: allOpportunities.length,
        recordsCreated: created,
        recordsSkipped: skipped,
        errorMessage:   rateLimited ? "Completed with rate-limiting (partial results)" : undefined,
      },
    });

    return NextResponse.json({
      success:      true,
      syncRunId:    syncRun.id,
      strategyUsed,
      rateLimited,
      diag,
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
      { error: err?.message ?? "GHL pull failed", syncRunId: syncRun.id, diag },
      { status: 200 },
    );
  }
}
