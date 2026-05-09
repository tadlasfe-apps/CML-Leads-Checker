import prisma from "./prisma";
import { EXCLUDED_META_ACTION_TYPES } from "./normalization";
import {
  format, startOfDay, endOfDay, startOfWeek,
  startOfMonth, startOfQuarter,
  parseISO,
} from "date-fns";

function toZonedTime(date: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const y = get("year"); const mo = get("month") - 1; const d = get("day");
  const h = get("hour") % 24; const mi = get("minute"); const s = get("second");
  return new Date(y, mo, d, h, mi, s);
}
import type {
  AuditStatus, DiscrepancyLocation, DateGrouping, ReportingTimezone,
  OverviewKPIs, TimelineEntry, SourceComparisonRow, ClinicBreakdownRow,
  ServiceBreakdownRow, WebsiteFormRow,
} from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return Math.round((num / denom) * 1000) / 10; // 1 decimal
}

export function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const filter: Record<string, Date> = {};
  if (from) filter.gte = startOfDay(parseISO(from));
  if (to) filter.lte = endOfDay(parseISO(to));
  return filter;
}

function sourceWhereDate(
  from?: string, to?: string, extra: object = {}
) {
  const dateFilter = buildDateFilter(from, to);
  return {
    ...extra,
    ...(dateFilter ? { createdAtSource: dateFilter } : {}),
  };
}

function computeAuditStatus(
  websiteLeads: number,
  metaLeads: number,
  ghlLeads: number,
  zenotiLeads: number
): AuditStatus {
  const src = websiteLeads + metaLeads;
  const srcGhlMatch = src === ghlLeads;
  const ghlZenotiMatch = ghlLeads === zenotiLeads;

  if (srcGhlMatch && ghlZenotiMatch) return "PASSED";
  if (!srcGhlMatch && !ghlZenotiMatch) return "BOTH_ISSUES";
  if (!srcGhlMatch) return "SOURCE_TO_GHL_ISSUE";
  return "GHL_TO_ZENOTI_ISSUE";
}

function computeDiscrepancyLocation(
  src: number, ghlLeads: number, zenotiLeads: number
): DiscrepancyLocation {
  const srcGhlMatch = src === ghlLeads;
  const ghlZenotiMatch = ghlLeads === zenotiLeads;
  if (srcGhlMatch && ghlZenotiMatch) return "NONE";
  if (!srcGhlMatch && ghlZenotiMatch) return "SOURCE_TO_GHL";
  if (srcGhlMatch && !ghlZenotiMatch) return "GHL_TO_ZENOTI";
  return "BOTH";
}

// ─── Date grouping ────────────────────────────────────────────────────────────

function getPeriodKey(date: Date, grouping: DateGrouping, tz: ReportingTimezone): string {
  const zoned = toZonedTime(date, tz);
  switch (grouping) {
    case "daily":   return format(zoned, "yyyy-MM-dd");
    case "weekly":  return format(startOfWeek(zoned, { weekStartsOn: 1 }), "yyyy-MM-dd");
    case "monthly": return format(zoned, "yyyy-MM");
    case "quarterly": {
      const q = Math.ceil((zoned.getMonth() + 1) / 3);
      return `${zoned.getFullYear()}-Q${q}`;
    }
  }
}

function periodLabel(key: string, grouping: DateGrouping): string {
  if (grouping === "daily") return format(parseISO(key), "MMM d, yyyy");
  if (grouping === "weekly") return `W/o ${format(parseISO(key), "MMM d")}`;
  if (grouping === "monthly") {
    const [y, m] = key.split("-");
    return format(new Date(+y, +m - 1, 1), "MMM yyyy");
  }
  return key; // quarterly: 2025-Q1
}

// ─── Overview KPIs ────────────────────────────────────────────────────────────

export async function getOverviewKPIs(
  from?: string, to?: string,
  clinic?: string, service?: string
): Promise<OverviewKPIs> {
  const baseWhere = {
    ...(clinic ? { clinicLocationNormalized: clinic } : {}),
    ...(service ? { serviceNormalized: service } : {}),
  };
  const dateFilter = buildDateFilter(from, to);
  const dateWhere = dateFilter ? { createdAtSource: dateFilter } : {};

  const [websiteCount, metaSum, ghlCount, zenotiCount, dupeCount] =
    await Promise.all([
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...dateWhere, sourceSystem: "WEBSITE", isDuplicate: false },
      }),
      prisma.leadSourceRecord.aggregate({
        where: { ...baseWhere, ...(dateFilter ? { reportDate: dateFilter } : {}), sourceSystem: "META", metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
        _sum: { metaLeadCount: true },
      }),
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...dateWhere, sourceSystem: "GHL" },
      }),
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...dateWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
      }),
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...dateWhere, sourceSystem: "WEBSITE", isDuplicate: true },
      }),
    ]);

  const metaLeads = metaSum._sum.metaLeadCount ?? 0;
  const totalSource = websiteCount + metaLeads;
  const srcToGhlDiff = totalSource - ghlCount;
  const ghlToZenotiDiff = ghlCount - zenotiCount;

  // Unmapped counts
  const [unmappedClinic, unmappedService] = await Promise.all([
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized"],
      where: { ...dateWhere, clinicLocationNormalized: "Unknown" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["serviceNormalized"],
      where: { ...dateWhere, serviceNormalized: "Other" },
      _count: { id: true },
    }),
  ]);

  // Timeline for discrepancy date counts
  const timeline = await getLeadTimeline(from, to, "daily", "America/Toronto", clinic, service);
  const datesWithSrcGhl = timeline.filter((t) => t.srcToGhlDiff !== 0).length;
  const datesWithGhlZenoti = timeline.filter((t) => t.ghlToZenotiDiff !== 0).length;

  let biggestDiscrepancyDate: string | null = null;
  let biggestDiscrepancyValue = 0;
  for (const t of timeline) {
    const val = Math.max(Math.abs(t.srcToGhlDiff), Math.abs(t.ghlToZenotiDiff));
    if (val > biggestDiscrepancyValue) {
      biggestDiscrepancyValue = val;
      biggestDiscrepancyDate = t.date;
    }
  }

  return {
    websiteLeads: websiteCount,
    metaLeads,
    totalSourceLeads: totalSource,
    ghlLeads: ghlCount,
    zenotiLeads: zenotiCount,
    srcToGhlDiff,
    ghlToZenotiDiff,
    srcToGhlMatchRate: pct(ghlCount, totalSource),
    ghlToZenotiMatchRate: pct(zenotiCount, ghlCount),
    datesWithSrcGhlDiscrepancy: datesWithSrcGhl,
    datesWithGhlZenotiDiscrepancy: datesWithGhlZenoti,
    biggestDiscrepancyDate,
    biggestDiscrepancyValue,
    duplicateWebsiteLeads: dupeCount,
    unmappedClinicCount: unmappedClinic.length,
    unmappedServiceCount: unmappedService.length,
  };
}

// ─── Lead Timeline ────────────────────────────────────────────────────────────

export async function getLeadTimeline(
  from?: string, to?: string,
  grouping: DateGrouping = "daily",
  tz: ReportingTimezone = "America/Toronto",
  clinic?: string, service?: string,
  adAccountId?: string,
): Promise<TimelineEntry[]> {
  const baseWhere = {
    ...(clinic ? { clinicLocationNormalized: clinic } : {}),
    ...(service ? { serviceNormalized: service } : {}),
  };
  const dateFilter = buildDateFilter(from, to);
  const dateWhere = dateFilter ? { createdAtSource: dateFilter } : {};

  const [websiteRows, metaRows, ghlRows, zenotiRows] = await Promise.all([
    prisma.leadSourceRecord.findMany({
      where: { ...baseWhere, ...dateWhere, sourceSystem: "WEBSITE", isDuplicate: false },
      select: { createdAtSource: true },
    }),
    prisma.leadSourceRecord.findMany({
      where: {
        ...baseWhere,
        ...(dateFilter ? { reportDate: dateFilter } : {}),
        sourceSystem: "META",
        metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES },
        ...(adAccountId ? { metaAdAccountId: adAccountId } : {}),
      },
      select: { reportDate: true, createdAtSource: true, metaLeadCount: true },
    }),
    prisma.leadSourceRecord.findMany({
      where: { ...baseWhere, ...dateWhere, sourceSystem: "GHL" },
      select: { createdAtSource: true },
    }),
    prisma.leadSourceRecord.findMany({
      where: { ...baseWhere, ...dateWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
      select: { createdAtSource: true },
    }),
  ]);

  const map = new Map<string, TimelineEntry>();

  function getOrCreate(key: string): TimelineEntry {
    if (!map.has(key)) map.set(key, {
      date: key, websiteLeads: 0, metaLeads: 0, totalSource: 0,
      ghlLeads: 0, zenotiLeads: 0, srcToGhlDiff: 0, ghlToZenotiDiff: 0,
    });
    return map.get(key)!;
  }

  for (const r of websiteRows) {
    if (!r.createdAtSource) continue;
    const key = getPeriodKey(r.createdAtSource, grouping, tz);
    getOrCreate(key).websiteLeads++;
  }
  for (const r of metaRows) {
    const d = r.reportDate ?? r.createdAtSource;
    if (!d) continue;
    const key = getPeriodKey(d, grouping, tz);
    getOrCreate(key).metaLeads += r.metaLeadCount ?? 0;
  }
  for (const r of ghlRows) {
    if (!r.createdAtSource) continue;
    const key = getPeriodKey(r.createdAtSource, grouping, tz);
    getOrCreate(key).ghlLeads++;
  }
  for (const r of zenotiRows) {
    if (!r.createdAtSource) continue;
    const key = getPeriodKey(r.createdAtSource, grouping, tz);
    getOrCreate(key).zenotiLeads++;
  }

  const entries = Array.from(map.values())
    .map((e) => ({
      ...e,
      totalSource: e.websiteLeads + e.metaLeads,
      srcToGhlDiff: (e.websiteLeads + e.metaLeads) - e.ghlLeads,
      ghlToZenotiDiff: e.ghlLeads - e.zenotiLeads,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return entries;
}

// ─── Source Comparison ────────────────────────────────────────────────────────

export async function getSourceComparison(
  from?: string, to?: string,
  grouping: DateGrouping = "daily",
  tz: ReportingTimezone = "America/Toronto",
  clinic?: string, service?: string,
  adAccountId?: string,
): Promise<SourceComparisonRow[]> {
  const timeline = await getLeadTimeline(from, to, grouping, tz, clinic, service, adAccountId);

  return timeline.map((t) => {
    const src = t.totalSource;
    const status = computeAuditStatus(t.websiteLeads, t.metaLeads, t.ghlLeads, t.zenotiLeads);
    const discrepancyLocation = computeDiscrepancyLocation(src, t.ghlLeads, t.zenotiLeads);

    return {
      period: periodLabel(t.date, grouping),
      periodStart: t.date,
      periodEnd: t.date,
      websiteLeads: t.websiteLeads,
      metaLeads: t.metaLeads,
      totalSourceLeads: src,
      ghlLeads: t.ghlLeads,
      zenotiLeads: t.zenotiLeads,
      srcToGhlDiff: t.srcToGhlDiff,
      ghlToZenotiDiff: t.ghlToZenotiDiff,
      srcToGhlMatchRate: pct(t.ghlLeads, src),
      ghlToZenotiMatchRate: pct(t.zenotiLeads, t.ghlLeads),
      discrepancyLocation,
      status,
    };
  });
}

// ─── Source Comparison Drilldown ──────────────────────────────────────────────

export async function getSourceComparisonDrilldown(
  periodStart: string, periodEnd: string,
  by: "clinic" | "service" | "websiteFormSource" | "campaign"
) {
  const dateFilter = buildDateFilter(periodStart, periodEnd);
  const dateWhere = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};

  let groupField: string;
  if (by === "clinic") groupField = "clinicLocationNormalized";
  else if (by === "service") groupField = "serviceNormalized";
  else if (by === "websiteFormSource") groupField = "websiteFormSource";
  else groupField = "campaignName";

  const [websiteRows, metaRows, ghlRows, zenotiRows] = await Promise.all([
    prisma.leadSourceRecord.groupBy({
      by: [groupField as any],
      where: { ...dateWhere, sourceSystem: "WEBSITE", isDuplicate: false },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: [groupField as any],
      where: { ...metaDateWhere, sourceSystem: "META", metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
      _sum: { metaLeadCount: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: [groupField as any],
      where: { ...dateWhere, sourceSystem: "GHL" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: [groupField as any],
      where: { ...dateWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
      _count: { id: true },
    }),
  ]);

  const labels = new Set<string>();
  const wb: Record<string, number> = {};
  const mb: Record<string, number> = {};
  const gb: Record<string, number> = {};
  const zb: Record<string, number> = {};

  for (const r of websiteRows) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); wb[k] = r._count.id;
  }
  for (const r of metaRows) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); mb[k] = r._sum.metaLeadCount ?? 0;
  }
  for (const r of ghlRows) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); gb[k] = r._count.id;
  }
  for (const r of zenotiRows) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); zb[k] = r._count.id;
  }

  return Array.from(labels).map((label) => {
    const web = wb[label] ?? 0;
    const meta = mb[label] ?? 0;
    const ghl = gb[label] ?? 0;
    const zenoti = zb[label] ?? 0;
    const src = web + meta;
    return {
      label,
      websiteLeads: web,
      metaLeads: meta,
      totalSourceLeads: src,
      ghlLeads: ghl,
      zenotiLeads: zenoti,
      srcToGhlDiff: src - ghl,
      ghlToZenotiDiff: ghl - zenoti,
      status: computeAuditStatus(web, meta, ghl, zenoti),
    };
  }).sort((a, b) => (b.totalSourceLeads + b.ghlLeads) - (a.totalSourceLeads + a.ghlLeads));
}

// ─── Clinic Breakdown ─────────────────────────────────────────────────────────

export async function getClinicBreakdown(
  from?: string, to?: string
): Promise<ClinicBreakdownRow[]> {
  const dateFilter = buildDateFilter(from, to);
  const dateWhere = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};

  const [websiteRows, metaRows, ghlRows, zenotiRows, dupeRows] = await Promise.all([
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized"],
      where: { ...dateWhere, sourceSystem: "WEBSITE", isDuplicate: false },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized"],
      where: { ...metaDateWhere, sourceSystem: "META", metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
      _sum: { metaLeadCount: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized"],
      where: { ...dateWhere, sourceSystem: "GHL" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized"],
      where: { ...dateWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized"],
      where: { ...dateWhere, sourceSystem: "WEBSITE", isDuplicate: true },
      _count: { id: true },
    }),
  ]);

  const clinics = new Set<string>();
  const wb: Record<string, number> = {};
  const mb: Record<string, number> = {};
  const gb: Record<string, number> = {};
  const zb: Record<string, number> = {};
  const db: Record<string, number> = {};

  for (const r of websiteRows) { const k = r.clinicLocationNormalized ?? "Unknown"; clinics.add(k); wb[k] = r._count.id; }
  for (const r of metaRows) { const k = r.clinicLocationNormalized ?? "Unknown"; clinics.add(k); mb[k] = r._sum.metaLeadCount ?? 0; }
  for (const r of ghlRows) { const k = r.clinicLocationNormalized ?? "Unknown"; clinics.add(k); gb[k] = r._count.id; }
  for (const r of zenotiRows) { const k = r.clinicLocationNormalized ?? "Unknown"; clinics.add(k); zb[k] = r._count.id; }
  for (const r of dupeRows) { const k = r.clinicLocationNormalized ?? "Unknown"; db[k] = r._count.id; }

  return Array.from(clinics).map((clinic) => {
    const web = wb[clinic] ?? 0;
    const meta = mb[clinic] ?? 0;
    const ghl = gb[clinic] ?? 0;
    const zenoti = zb[clinic] ?? 0;
    const src = web + meta;
    return {
      clinicLocation: clinic,
      websiteLeads: web, metaLeads: meta, totalSourceLeads: src,
      ghlLeads: ghl, zenotiLeads: zenoti,
      duplicateCount: db[clinic] ?? 0,
      srcToGhlDiff: src - ghl,
      ghlToZenotiDiff: ghl - zenoti,
      srcToGhlMatchRate: pct(ghl, src),
      ghlToZenotiMatchRate: pct(zenoti, ghl),
      unmappedServiceCount: 0,
      discrepancyLocation: computeDiscrepancyLocation(src, ghl, zenoti),
      status: computeAuditStatus(web, meta, ghl, zenoti),
    };
  }).sort((a, b) => b.totalSourceLeads - a.totalSourceLeads);
}

// ─── Service Breakdown ────────────────────────────────────────────────────────

export async function getServiceBreakdown(
  from?: string, to?: string, clinic?: string
): Promise<ServiceBreakdownRow[]> {
  const dateFilter = buildDateFilter(from, to);
  const dateWhere = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};
  const clinicWhere = clinic ? { clinicLocationNormalized: clinic } : {};

  const [websiteRows, metaRows, ghlRows, zenotiRows] = await Promise.all([
    prisma.leadSourceRecord.groupBy({
      by: ["serviceNormalized"],
      where: { ...dateWhere, ...clinicWhere, sourceSystem: "WEBSITE", isDuplicate: false },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["serviceNormalized"],
      where: { ...metaDateWhere, ...clinicWhere, sourceSystem: "META", metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
      _sum: { metaLeadCount: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["serviceNormalized"],
      where: { ...dateWhere, ...clinicWhere, sourceSystem: "GHL" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["serviceNormalized"],
      where: { ...dateWhere, ...clinicWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
      _count: { id: true },
    }),
  ]);

  const services = new Set<string>();
  const wb: Record<string, number> = {};
  const mb: Record<string, number> = {};
  const gb: Record<string, number> = {};
  const zb: Record<string, number> = {};

  for (const r of websiteRows) { const k = r.serviceNormalized ?? "Other"; services.add(k); wb[k] = r._count.id; }
  for (const r of metaRows) { const k = r.serviceNormalized ?? "Other"; services.add(k); mb[k] = r._sum.metaLeadCount ?? 0; }
  for (const r of ghlRows) { const k = r.serviceNormalized ?? "Other"; services.add(k); gb[k] = r._count.id; }
  for (const r of zenotiRows) { const k = r.serviceNormalized ?? "Other"; services.add(k); zb[k] = r._count.id; }

  return Array.from(services).map((service) => {
    const web = wb[service] ?? 0;
    const meta = mb[service] ?? 0;
    const ghl = gb[service] ?? 0;
    const zenoti = zb[service] ?? 0;
    const src = web + meta;
    return {
      service, websiteLeads: web, metaLeads: meta, totalSourceLeads: src,
      ghlLeads: ghl, zenotiLeads: zenoti,
      srcToGhlDiff: src - ghl, ghlToZenotiDiff: ghl - zenoti,
      srcToGhlMatchRate: pct(ghl, src),
      ghlToZenotiMatchRate: pct(zenoti, ghl),
      discrepancyLocation: computeDiscrepancyLocation(src, ghl, zenoti),
      status: computeAuditStatus(web, meta, ghl, zenoti),
    };
  }).sort((a, b) => b.totalSourceLeads - a.totalSourceLeads);
}

// ─── Website Forms ────────────────────────────────────────────────────────────

export async function getWebsiteForms(
  from?: string, to?: string, clinic?: string, service?: string
): Promise<WebsiteFormRow[]> {
  const dateFilter = buildDateFilter(from, to);
  const dateWhere = dateFilter ? { createdAtSource: dateFilter } : {};
  const extra = {
    ...(clinic ? { clinicLocationNormalized: clinic } : {}),
    ...(service ? { serviceNormalized: service } : {}),
  };

  const forms = await prisma.leadSourceRecord.groupBy({
    by: ["formName", "websiteFormSource", "formId", "backendProvider", "pageUrl"],
    where: { ...dateWhere, ...extra, sourceSystem: "WEBSITE" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  const results: WebsiteFormRow[] = [];
  for (const f of forms) {
    if (!f.formName) continue;
    const total = f._count.id;

    const [unique, dupes, ghlMatches, zenotiMatches, lastSub] = await Promise.all([
      prisma.leadSourceRecord.count({
        where: { ...dateWhere, ...extra, sourceSystem: "WEBSITE", formName: f.formName, isDuplicate: false },
      }),
      prisma.leadSourceRecord.count({
        where: { ...dateWhere, ...extra, sourceSystem: "WEBSITE", formName: f.formName, isDuplicate: true },
      }),
      prisma.leadSourceRecord.count({
        where: {
          ...dateWhere, ...extra, sourceSystem: "GHL",
          normalizedPhone: { in: await getFormPhoneSet(f.formName, dateWhere, extra) },
        },
      }),
      prisma.leadSourceRecord.count({
        where: {
          ...dateWhere, ...extra, sourceSystem: "ZENOTI", isAppointmentBased: false,
          normalizedPhone: { in: await getFormPhoneSet(f.formName, dateWhere, extra) },
        },
      }),
      prisma.leadSourceRecord.findFirst({
        where: { ...dateWhere, sourceSystem: "WEBSITE", formName: f.formName },
        orderBy: { createdAtSource: "desc" },
        select: { createdAtSource: true },
      }),
    ]);

    const websiteToGhlDiff = unique - ghlMatches;
    const websiteToZenotiDiff = unique - zenotiMatches;

    results.push({
      id: f.formName,
      formName: f.formName,
      formId: f.formId,
      websiteFormSource: f.websiteFormSource,
      backendProvider: f.backendProvider,
      pageUrl: f.pageUrl,
      totalSubmissions: total,
      uniqueLeads: unique,
      duplicateCount: dupes,
      ghlCount: ghlMatches,
      zenotiCount: zenotiMatches,
      websiteToGhlDiff,
      websiteToZenotiDiff,
      websiteToGhlMatchRate: pct(ghlMatches, unique) ?? 0,
      websiteToZenotiMatchRate: pct(zenotiMatches, unique) ?? 0,
      status: computeAuditStatus(unique, 0, ghlMatches, zenotiMatches),
      lastSubmissionAt: lastSub?.createdAtSource?.toISOString() ?? null,
    });
  }

  return results;
}

async function getFormPhoneSet(
  formName: string, dateWhere: object, extra: object
): Promise<string[]> {
  const rows = await prisma.leadSourceRecord.findMany({
    where: { ...dateWhere, ...extra, sourceSystem: "WEBSITE", formName, isDuplicate: false },
    select: { normalizedPhone: true, normalizedEmail: true },
  });
  return rows.map((r) => r.normalizedPhone ?? r.normalizedEmail ?? "").filter(Boolean);
}

// ─── Meta Breakdown ───────────────────────────────────────────────────────────

export async function getMetaBreakdown(from?: string, to?: string, adAccountId?: string) {
  const dateFilter = buildDateFilter(from, to);
  const dateWhere = dateFilter ? { reportDate: dateFilter } : {};

  const rows = await prisma.leadSourceRecord.findMany({
    where: {
      ...dateWhere,
      sourceSystem: "META",
      metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES },
      ...(adAccountId ? { metaAdAccountId: adAccountId } : {}),
    },
    select: {
      reportDate: true, createdAtSource: true,
      campaignName: true, metaCampaignId: true,
      metaAdSetName: true, metaAdSetId: true,
      metaAdName: true, metaAdId: true,
      metaAdAccountId: true, metaAdAccountName: true,
      metaObjective: true, metaConversionGoal: true, metaResultType: true,
      metaResults: true, metaLeadCount: true,
      spend: true, costPerResult: true,
      impressions: true, reach: true, clicks: true, linkClicks: true,
      clinicLocationNormalized: true, serviceNormalized: true,
    },
    orderBy: { reportDate: "desc" },
  });

  // Aggregate by campaign, result type, and ad account
  const byCampaign = new Map<string, { leads: number; spend: number; accountId: string | null; accountName: string | null }>();
  const byResultType = new Map<string, number>();
  const byAdAccount = new Map<string, { accountId: string; accountName: string; leads: number; spend: number; campaignSet: Set<string> }>();
  let totalLeads = 0;
  let totalSpend = 0;

  for (const r of rows) {
    const leads = r.metaLeadCount ?? 0;
    const spend = r.spend ?? 0;
    totalLeads += leads;
    totalSpend += spend;

    const camp = r.campaignName ?? "Unknown Campaign";
    const existing = byCampaign.get(camp) ?? { leads: 0, spend: 0, accountId: r.metaAdAccountId ?? null, accountName: r.metaAdAccountName ?? null };
    byCampaign.set(camp, { leads: existing.leads + leads, spend: existing.spend + spend, accountId: existing.accountId, accountName: existing.accountName });

    const rt = r.metaResultType ?? "Unknown";
    byResultType.set(rt, (byResultType.get(rt) ?? 0) + leads);

    const acctId = r.metaAdAccountId ?? "unknown";
    const acctName = r.metaAdAccountId
      ? (r.metaAdAccountName ?? r.metaAdAccountId)
      : "Unknown / legacy Meta records";
    const acctExisting = byAdAccount.get(acctId) ?? { accountId: acctId, accountName: acctName, leads: 0, spend: 0, campaignSet: new Set<string>() };
    acctExisting.leads += leads;
    acctExisting.spend += spend;
    if (r.campaignName) acctExisting.campaignSet.add(r.campaignName);
    byAdAccount.set(acctId, acctExisting);
  }

  return {
    rows,
    totalLeads,
    totalSpend,
    adAccountCount: Array.from(byAdAccount.keys()).filter((k) => k !== "unknown").length,
    byCampaign: Array.from(byCampaign.entries())
      .map(([campaign, v]) => ({ campaign, leads: v.leads, spend: v.spend, accountId: v.accountId, accountName: v.accountName }))
      .sort((a, b) => b.leads - a.leads),
    byResultType: Array.from(byResultType.entries())
      .map(([resultType, leads]) => ({ resultType, leads }))
      .sort((a, b) => b.leads - a.leads),
    byAdAccount: Array.from(byAdAccount.values())
      .map(({ campaignSet, ...rest }) => ({ ...rest, campaignCount: campaignSet.size }))
      .sort((a, b) => b.leads - a.leads),
  };
}

// ─── Export helpers ───────────────────────────────────────────────────────────

export { buildDateFilter as buildDateFilterExport };
