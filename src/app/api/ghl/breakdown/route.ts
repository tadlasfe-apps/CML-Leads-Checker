export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { EXCLUDED_META_ACTION_TYPES, EXCLUDED_WEBSITE_FORM_SOURCES } from "@/lib/normalization";
import { startOfDay, endOfDay, parseISO } from "date-fns";

// ─── Source classification ─────────────────────────────────────────────────────

// GHL source values that map to Facebook / Meta Ads leads
const FACEBOOK_EXACT: string[] = [
  "facebook ads", "facebook ad", "facebook", "fb", "fb ads",
  "meta", "meta ads", "instagram", "ig",
];

// GHL source values that map to Website form leads
const WEBSITE_EXACT: string[] = [
  "website", "popup form", "pop up form", "popup", "website quiz", "quiz form",
  "location form", "web form", "contact form", "landing page",
  "website form", "organic search", "direct",
];

type SourceCategory = "Facebook Ads" | "Website Forms" | "Other";

function classifyGhlSource(raw: string | null | undefined): SourceCategory {
  if (!raw) return "Other";
  const s = raw.toLowerCase().trim();
  if (FACEBOOK_EXACT.some((k) => s === k || s.startsWith(k + " "))) return "Facebook Ads";
  if (WEBSITE_EXACT.some((k)  => s === k || s.startsWith(k + " "))) return "Website Forms";
  return "Other";
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") || undefined;
  const to   = searchParams.get("to")   || undefined;

  try {
    const dateFilter = (from || to) ? {
      ...(from ? { gte: startOfDay(parseISO(from)) } : {}),
      ...(to   ? { lte: endOfDay(parseISO(to))     } : {}),
    } : undefined;

    const ghlWhere   = { sourceSystem: "GHL"     as const, ...(dateFilter ? { createdAtSource: dateFilter } : {}) };
    const metaWhere  = { sourceSystem: "META"    as const, metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES }, ...(dateFilter ? { reportDate: dateFilter } : {}) };
    const webWhere   = { sourceSystem: "WEBSITE" as const, isDuplicate: false, websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES }, ...(dateFilter ? { createdAtSource: dateFilter } : {}) };

    // Run sequentially to stay within pgbouncer pool
    const ghlRecs = await prisma.leadSourceRecord.findMany({
      where: ghlWhere,
      select: {
        leadSource:               true,
        attributedChannel:        true,
        clinicLocationNormalized: true,
        serviceNormalized:        true,
        ghlStageName:             true,
        rawPayload:               true,
      },
    });

    const metaAgg = await prisma.leadSourceRecord.aggregate({
      where: metaWhere,
      _sum: { metaLeadCount: true },
    });
    const metaLeads = metaAgg._sum.metaLeadCount ?? 0;

    const websiteLeads = await prisma.leadSourceRecord.count({ where: webWhere });

    // ── Aggregate GHL records ─────────────────────────────────────────────────
    const sourceMap  = new Map<string, { raw: string; category: SourceCategory; count: number }>();
    const categoryMap = new Map<SourceCategory, number>();
    const clinicMap  = new Map<string, number>();
    const serviceMap = new Map<string, number>();
    const stageMap   = new Map<string, number>();

    let unknownSourceCount = 0;

    for (const r of ghlRecs) {
      // Extract source: stored field first, then fall back to rawPayload
      const raw = r.leadSource
        ?? (r.rawPayload as any)?.contact?.source
        ?? (r.rawPayload as any)?.source
        ?? null;

      const displayRaw = raw ?? "Unknown";
      if (!raw) unknownSourceCount++;

      const category = classifyGhlSource(raw);

      const existing = sourceMap.get(displayRaw) ?? { raw: displayRaw, category, count: 0 };
      existing.count++;
      sourceMap.set(displayRaw, existing);

      categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);

      const clinic = r.clinicLocationNormalized ?? "Unknown";
      clinicMap.set(clinic, (clinicMap.get(clinic) ?? 0) + 1);

      const service = r.serviceNormalized ?? "Other";
      serviceMap.set(service, (serviceMap.get(service) ?? 0) + 1);

      const stage = r.ghlStageName ?? "Unknown Stage";
      stageMap.set(stage, (stageMap.get(stage) ?? 0) + 1);
    }

    const total = ghlRecs.length;

    // Build category comparison rows
    const facebookGhl   = categoryMap.get("Facebook Ads")  ?? 0;
    const websiteGhl    = categoryMap.get("Website Forms") ?? 0;
    const otherGhl      = categoryMap.get("Other")         ?? 0;

    const categoryComparison = [
      {
        category:      "Facebook Ads",
        ghlCount:      facebookGhl,
        matchedSource: "Meta Leads",
        sourceCount:   metaLeads,
        diff:          facebookGhl - metaLeads,
      },
      {
        category:      "Website Forms",
        ghlCount:      websiteGhl,
        matchedSource: "Website Leads",
        sourceCount:   websiteLeads,
        diff:          websiteGhl - websiteLeads,
      },
      {
        category:      "Other / Unknown",
        ghlCount:      otherGhl,
        matchedSource: null,
        sourceCount:   null,
        diff:          null,
      },
    ];

    return NextResponse.json({
      total,
      metaLeads,
      websiteLeads,
      unknownSourceCount,
      categoryComparison,
      bySource: Array.from(sourceMap.values()).sort((a, b) => b.count - a.count),
      byClinic:  Array.from(clinicMap.entries()).map(([clinic,  count]) => ({ clinic,  count })).sort((a, b) => b.count - a.count),
      byService: Array.from(serviceMap.entries()).map(([service, count]) => ({ service, count })).sort((a, b) => b.count - a.count),
      byStage:   Array.from(stageMap.entries()).map(([stage,   count]) => ({ stage,   count })).sort((a, b) => b.count - a.count),
    });
  } catch (err: any) {
    console.error("[/api/ghl/breakdown]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
