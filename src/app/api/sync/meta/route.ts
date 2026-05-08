import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const LEAD_ACTION_TYPES = new Set([
  "lead",
  "leadgen_other",
  "onsite_conversion.lead_grouped",
  "contact_total",
]);

const META_BASE = "https://graph.facebook.com";

async function fetchAccountInsights(
  accountId: string,
  from: string,
  to: string,
  accessToken: string,
  apiVersion: string,
): Promise<any[]> {
  const results: any[] = [];

  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,actions,spend,impressions,date_start",
    time_range: JSON.stringify({ since: from, until: to }),
    level: "ad",
    time_increment: "1",
    limit: "500",
  });

  let nextUrl: string | null =
    `${META_BASE}/${apiVersion}/${accountId}/insights?${params}`;

  while (nextUrl) {
    let res: Response;
    try {
      res = await fetch(nextUrl, { cache: "no-store" });
    } catch (err: any) {
      const cause = err?.cause;
      const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
      throw new Error(`Network error reaching Meta API for ${accountId}: ${err?.message ?? "Unknown"}${detail}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Meta API ${res.status} for ${accountId}: ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(
        `Meta API error for ${accountId}: ${json.error.message ?? JSON.stringify(json.error)}`,
      );
    }

    const data: any[] = json.data ?? [];
    results.push(...data);
    nextUrl = json.paging?.next ?? null;
  }

  return results;
}

export async function POST(req: NextRequest) {
  const accessToken   = process.env.META_ACCESS_TOKEN;
  const accountIdsRaw = process.env.META_AD_ACCOUNT_IDS ?? "";
  const apiVersion    = process.env.META_API_VERSION ?? "v20.0";

  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing META_ACCESS_TOKEN in .env" },
      { status: 200 },
    );
  }

  const accountIds = accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (accountIds.length === 0) {
    return NextResponse.json(
      { error: "META_AD_ACCOUNT_IDS is empty or not set in .env" },
      { status: 200 },
    );
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const from: string = body.from ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const to: string   = body.to   ?? new Date().toISOString().slice(0, 10);

  const syncRun = await prisma.syncRun.create({
    data: {
      sourceSystem: "META",
      syncType: "API",
      status: "RUNNING",
      dateRangeStart: new Date(from),
      dateRangeEnd: new Date(to),
    },
  });

  try {
    const allRows: any[] = [];
    const errors: string[] = [];

    for (const accountId of accountIds) {
      try {
        const rows = await fetchAccountInsights(accountId, from, to, accessToken, apiVersion);
        allRows.push(...rows);
      } catch (e: any) {
        errors.push(`${accountId}: ${e?.message ?? "Unknown"}`);
      }
    }

    const records: any[] = [];
    for (const row of allRows) {
      const actions: any[] = row.actions ?? [];
      const leadActions = actions.filter((a: any) => LEAD_ACTION_TYPES.has(a.action_type));
      if (leadActions.length === 0) continue;

      const date = row.date_start ?? from;

      for (const action of leadActions) {
        const externalId =
          `META_AGG|${date}|${row.campaign_id ?? ""}|${row.adset_id ?? ""}|${row.ad_id ?? ""}|${action.action_type}`;

        records.push({
          sourceSystem: "META" as const,
          recordType: "AGGREGATE_REPORT" as const,
          backendProvider: "META_ADS",
          externalId,
          reportDate: new Date(date),
          campaignName: row.campaign_name ?? undefined,
          metaCampaignId: row.campaign_id ?? undefined,
          metaAdSetName: row.adset_name ?? undefined,
          metaAdSetId: row.adset_id ?? undefined,
          metaAdName: row.ad_name ?? undefined,
          metaAdId: row.ad_id ?? undefined,
          metaResultType: action.action_type,
          metaResults: parseFloat(action.value ?? "0"),
          metaLeadCount: Math.round(parseFloat(action.value ?? "0")),
          spend: row.spend ? parseFloat(row.spend) : undefined,
          impressions: row.impressions ? parseInt(row.impressions, 10) : undefined,
          rawPayload: row,
        });
      }
    }

    let created = 0;
    let skipped = 0;

    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
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
        recordsFetched: allRows.length,
        recordsCreated: created,
        recordsSkipped: skipped,
        errorMessage: errors.length > 0 ? errors.slice(0, 3).join("; ") : undefined,
      },
    });

    return NextResponse.json({
      success: true,
      accountsAttempted: accountIds.length,
      accountsFailed: errors.length,
      rowsFetched: allRows.length,
      recordsCreated: created,
      recordsSkipped: skipped,
      errors: errors.length > 0 ? errors : undefined,
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
      { error: err?.message ?? "Meta pull failed", syncRunId: syncRun.id },
      { status: 200 },
    );
  }
}
