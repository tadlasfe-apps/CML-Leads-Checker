export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inferClinicFromMetaRecord } from "@/lib/normalization";

// Only the canonical Meta Ads "lead" action type is counted.
// All other action types (onsite_conversion.lead_grouped, leadgen_grouped, etc.)
// are stored in rawPayload for reference but never included in metaLeadCount.
const COUNTED_ACTION_TYPE = "lead";

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
    fields: "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,actions,spend,impressions,reach,clicks,inline_link_clicks,objective,optimization_goal,date_start,date_stop",
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

  // Load manual Meta location mappings
  let metaLocationMappings: Array<{ matchType: string; matchValue: string; mappedClinicLocation: string; priority: number }> = [];
  try {
    metaLocationMappings = await prisma.metaLocationMapping.findMany({
      where: { active: true },
      orderBy: { priority: "desc" },
      select: { matchType: true, matchValue: true, mappedClinicLocation: true, priority: true },
    });
  } catch { /* table may not exist yet */ }

  try {
    const allRows: any[] = [];
    const errors: string[] = [];

    // Per-account tracking
    const accountStats = new Map<string, {
      accountId: string;
      accountName: string;
      rowsFetched: number;
      leadsFound: number;
      spend: number;
    }>();

    for (const accountId of accountIds) {
      try {
        const rows = await fetchAccountInsights(accountId, from, to, accessToken, apiVersion);
        allRows.push(...rows);

        // Tally per-account stats from raw rows
        let leadsFound = 0;
        let spend = 0;
        let accountName = accountId;
        for (const row of rows) {
          if (row.account_name) accountName = row.account_name;
          const actions: any[] = row.actions ?? [];
          const leadAction = actions.find((a: any) => a.action_type === COUNTED_ACTION_TYPE);
          if (leadAction) leadsFound += Math.round(parseFloat(leadAction.value ?? "0"));
          spend += row.spend ? parseFloat(row.spend) : 0;
        }
        accountStats.set(accountId, {
          accountId,
          accountName,
          rowsFetched: rows.length,
          leadsFound,
          spend,
        });
      } catch (e: any) {
        errors.push(`${accountId}: ${e?.message ?? "Unknown"}`);
        accountStats.set(accountId, {
          accountId,
          accountName: accountId,
          rowsFetched: 0,
          leadsFound: 0,
          spend: 0,
        });
      }
    }

    const records: any[] = [];
    for (const row of allRows) {
      const actions: any[] = row.actions ?? [];
      // Find only the canonical "lead" action — one record per insight row, no double-counting
      const leadAction = actions.find((a: any) => a.action_type === COUNTED_ACTION_TYPE);
      if (!leadAction) continue;

      const date = row.date_start ?? from;
      const accountId = row.account_id ?? "";
      // externalId includes account ID to prevent cross-account collisions
      const externalId =
        `META_AGG|${accountId}|${date}|${row.campaign_id ?? ""}|${row.adset_id ?? ""}|${row.ad_id ?? ""}`;

      const clinicInferred = inferClinicFromMetaRecord(
        row.account_name,
        row.campaign_name,
        row.adset_name,
        row.ad_name,
        metaLocationMappings,
      );

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
        metaAdAccountId: row.account_id ?? undefined,
        metaAdAccountName: row.account_name ?? undefined,
        sourceAccountName: row.account_name ?? undefined,
        metaObjective: row.objective ?? undefined,
        metaResultType: "Lead",  // normalized display label
        metaResults: parseFloat(leadAction.value ?? "0"),
        metaLeadCount: Math.round(parseFloat(leadAction.value ?? "0")),
        spend: row.spend ? parseFloat(row.spend) : undefined,
        impressions: row.impressions ? parseInt(row.impressions, 10) : undefined,
        reach: row.reach ? parseInt(row.reach, 10) : undefined,
        clicks: row.clicks ? parseInt(row.clicks, 10) : undefined,
        linkClicks: row.inline_link_clicks ? parseInt(row.inline_link_clicks, 10) : undefined,
        clinicLocationRaw:        clinicInferred.raw,
        clinicLocationNormalized: clinicInferred.normalized,
        rawPayload: row,  // full row including all action types for reference
      });
    }

    let created = 0;
    let skipped = 0;

    // Per-account created/skipped tracking
    const accountCreated = new Map<string, number>();
    const accountSkipped = new Map<string, number>();

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

    // Build byAccount response (best-effort: created/skipped per account not tracked at batch level)
    const byAccount = Array.from(accountStats.values()).map((s) => ({
      accountId: s.accountId,
      accountName: s.accountName !== s.accountId ? s.accountName : undefined,
      rowsFetched: s.rowsFetched,
      leadsFound: s.leadsFound,
      spend: Math.round(s.spend * 100) / 100,
    }));

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

    let sampleSaved: any[] = [];
    let earliestReportDate: string | null = null;
    let latestReportDate:   string | null = null;
    let totalMetaLeadCountSaved = 0;
    try {
      const [samples, earliest, latest, agg] = await Promise.all([
        prisma.leadSourceRecord.findMany({
          where: { sourceSystem: "META" },
          orderBy: { importedAt: "desc" },
          take: 5,
          select: {
            id: true, externalId: true, campaignName: true, metaAdAccountId: true,
            metaAdAccountName: true, metaResultType: true, metaLeadCount: true,
            reportDate: true, importedAt: true, sourceSystem: true,
          },
        }),
        prisma.leadSourceRecord.findFirst({
          where: { sourceSystem: "META", reportDate: { not: null } },
          orderBy: { reportDate: "asc" },
          select: { reportDate: true },
        }),
        prisma.leadSourceRecord.findFirst({
          where: { sourceSystem: "META", reportDate: { not: null } },
          orderBy: { reportDate: "desc" },
          select: { reportDate: true },
        }),
        prisma.leadSourceRecord.aggregate({
          where: { sourceSystem: "META" },
          _sum: { metaLeadCount: true },
        }),
      ]);
      sampleSaved              = samples;
      earliestReportDate       = earliest?.reportDate?.toISOString() ?? null;
      latestReportDate         = latest?.reportDate?.toISOString()   ?? null;
      totalMetaLeadCountSaved  = agg._sum.metaLeadCount ?? 0;
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      accountsAttempted: accountIds.length,
      accountsFailed: errors.length,
      rowsFetched: allRows.length,
      recordsCreated: created,
      recordsSkipped: skipped,
      byAccount,
      errors: errors.length > 0 ? errors : undefined,
      syncRunId: syncRun.id,
      // Diagnostic fields
      sampleSaved,
      savedSourceSystems: ["META"],
      earliestReportDate,
      latestReportDate,
      totalMetaLeadCountSaved,
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
