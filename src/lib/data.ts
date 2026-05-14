import prisma from "./prisma";
import { EXCLUDED_META_ACTION_TYPES, EXCLUDED_WEBSITE_FORM_SOURCES } from "./normalization";
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
  ComparisonDimension,
  OverviewKPIs, TimelineEntry, SourceComparisonRow, ClinicBreakdownRow,
  ServiceBreakdownRow, WebsiteFormRow, SourceComparisonDiagnostics,
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

const UNMAPPED_LABELS = new Set(["Unknown", "Unknown / Needs Mapping", "Other", ""]);

function computeAuditStatus(
  websiteLeads: number,
  metaLeads: number,
  ghlLeads: number,
  zenotiLeads: number,
  clinic?: string,
  service?: string,
): AuditStatus {
  // NEEDS_MAPPING when clinic or service dimension is unknown/unmapped
  if (
    (clinic !== undefined && UNMAPPED_LABELS.has(clinic)) ||
    (service !== undefined && UNMAPPED_LABELS.has(service))
  ) return "NEEDS_MAPPING";

  const src = websiteLeads + metaLeads;
  const srcGhlMatch = src === ghlLeads;
  const ghlZenotiMatch = ghlLeads === zenotiLeads;

  if (srcGhlMatch && ghlZenotiMatch) return "PASSED";
  if (!srcGhlMatch && !ghlZenotiMatch) return "BOTH_ISSUES";
  if (!srcGhlMatch) return "SOURCE_TO_GHL_ISSUE";
  return "GHL_TO_ZENOTI_ISSUE";
}

function computeDiscrepancyLocation(
  src: number, ghlLeads: number, zenotiLeads: number,
  status?: AuditStatus,
): DiscrepancyLocation {
  if (status === "NEEDS_MAPPING") return "NEEDS_MAPPING";
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
  const dateFilter   = buildDateFilter(from, to);
  // Use simple (no-OR) date filters for counts — avoids Prisma OR runtime issues.
  // getWebsiteForms handles the OR fallback in its own findMany.
  const simpleDW = websiteDateWhereSimple(dateFilter);
  const ghlDW    = dateFilter ? { createdAtSource: dateFilter } : {};

  const [websiteCount, metaSum, ghlCount, zenotiCount, dupeCount] =
    await Promise.all([
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...simpleDW, sourceSystem: "WEBSITE", isDuplicate: false,
          websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
      }),
      prisma.leadSourceRecord.aggregate({
        where: {
          ...baseWhere,
          sourceSystem: "META",
          metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES },
          ...(dateFilter ? { reportDate: dateFilter } : {}),
        },
        _sum: { metaLeadCount: true },
      }),
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...ghlDW, sourceSystem: "GHL" },
      }),
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...ghlDW, sourceSystem: "ZENOTI", isAppointmentBased: false },
      }),
      prisma.leadSourceRecord.count({
        where: { ...baseWhere, ...simpleDW, sourceSystem: "WEBSITE", isDuplicate: true,
          websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
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
      where: { ...ghlDW, clinicLocationNormalized: "Unknown" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["serviceNormalized"],
      where: { ...ghlDW, serviceNormalized: "Other" },
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
  const dateFilter   = buildDateFilter(from, to);
  // Use simple (no-OR) date filter here. getWebsiteForms already handles the
  // reportDate fallback; for the timeline we use createdAtSource as the grouping key.
  const simpleDW     = websiteDateWhereSimple(dateFilter);
  const ghlDateWhere = dateFilter ? { createdAtSource: dateFilter } : {};

  const [websiteRows, metaRows, ghlRows, zenotiRows] = await Promise.all([
    prisma.leadSourceRecord.findMany({
      where: { ...baseWhere, ...simpleDW, sourceSystem: "WEBSITE", isDuplicate: false,
        websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
      select: { createdAtSource: true, reportDate: true },
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
      where: { ...baseWhere, ...ghlDateWhere, sourceSystem: "GHL" },
      select: { createdAtSource: true },
    }),
    prisma.leadSourceRecord.findMany({
      where: { ...baseWhere, ...ghlDateWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
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
    const d = r.createdAtSource ?? r.reportDate;
    if (!d) continue;
    const key = getPeriodKey(d, grouping, tz);
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
  const dateFilter    = buildDateFilter(periodStart, periodEnd);
  const webDrillDW    = websiteDateWhereSimple(dateFilter);
  const ghlDrillDW    = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};

  let groupField: string;
  if (by === "clinic") groupField = "clinicLocationNormalized";
  else if (by === "service") groupField = "serviceNormalized";
  else if (by === "websiteFormSource") groupField = "websiteFormSource";
  else groupField = "campaignName";

  // Sequential findMany + JS aggregation — avoids exhausting pgbouncer connection pool
  const websiteRecs = await prisma.leadSourceRecord.findMany({
    where: { ...webDrillDW, sourceSystem: "WEBSITE", isDuplicate: false,
      websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
    select: { [groupField]: true } as any,
  });
  const metaRecs = await prisma.leadSourceRecord.findMany({
    where: { ...metaDateWhere, sourceSystem: "META", metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
    select: { [groupField]: true, metaLeadCount: true } as any,
  });
  const ghlRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlDrillDW, sourceSystem: "GHL" },
    select: { [groupField]: true } as any,
  });
  const zenotiRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlDrillDW, sourceSystem: "ZENOTI", isAppointmentBased: false },
    select: { [groupField]: true } as any,
  });

  const labels = new Set<string>();
  const wb: Record<string, number> = {};
  const mb: Record<string, number> = {};
  const gb: Record<string, number> = {};
  const zb: Record<string, number> = {};

  for (const r of websiteRecs) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); wb[k] = (wb[k] ?? 0) + 1;
  }
  for (const r of metaRecs) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); mb[k] = (mb[k] ?? 0) + ((r as any).metaLeadCount ?? 0);
  }
  for (const r of ghlRecs) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); gb[k] = (gb[k] ?? 0) + 1;
  }
  for (const r of zenotiRecs) {
    const k = (r as any)[groupField] ?? "Unknown";
    labels.add(k); zb[k] = (zb[k] ?? 0) + 1;
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

// ─── Source Comparison Multi-Dimensional ─────────────────────────────────────

/**
 * Groups source comparison data by Date + optional Clinic and/or Service dimensions.
 * Returns one row per unique (date, clinic?, service?) combination across all sources.
 *
 * Rows appear even if only one source has data — this is intentional for discrepancy detection.
 */
export async function getSourceComparisonDims(
  from?: string,
  to?: string,
  grouping: DateGrouping = "daily",
  tz: ReportingTimezone = "America/Toronto",
  clinicFilter?: string,
  serviceFilter?: string,
  dimensionGroupBy: ComparisonDimension = "date+clinic+service",
  adAccountId?: string,
): Promise<{ rows: SourceComparisonRow[]; diagnostics: SourceComparisonDiagnostics }> {
  const includeClinic  = dimensionGroupBy.includes("clinic");
  const includeService = dimensionGroupBy.includes("service");

  const UNKNOWN = "Unknown / Needs Mapping";

  // Normalize a field value to its display label for grouping
  function clinicKey(v: string | null | undefined): string {
    const s = v?.trim();
    return s && s !== "Unknown" && s !== "Other" ? s : UNKNOWN;
  }
  function serviceKey(v: string | null | undefined): string {
    const s = v?.trim();
    return s && s !== "Unknown" && s !== "Other" ? s : UNKNOWN;
  }

  const dateFilter   = buildDateFilter(from, to);
  const simpleDW     = websiteDateWhereSimple(dateFilter);
  const ghlDW        = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};

  const clinicWhere   = clinicFilter  ? { clinicLocationNormalized:  clinicFilter  } : {};
  const serviceWhere  = serviceFilter ? { serviceNormalized:         serviceFilter } : {};

  // Fetch all records sequentially (avoids pgbouncer pool exhaustion)
  const websiteRecs = await prisma.leadSourceRecord.findMany({
    where: { ...simpleDW,     ...clinicWhere, ...serviceWhere,
      sourceSystem: "WEBSITE", isDuplicate: false,
      websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
    select: { createdAtSource: true, reportDate: true, clinicLocationNormalized: true, serviceNormalized: true },
  });

  const metaRecs = await prisma.leadSourceRecord.findMany({
    where: { ...metaDateWhere, ...clinicWhere, ...serviceWhere,
      sourceSystem: "META",
      metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES },
      ...(adAccountId ? { metaAdAccountId: adAccountId } : {}) },
    select: { reportDate: true, createdAtSource: true, clinicLocationNormalized: true, serviceNormalized: true, metaLeadCount: true },
  });

  const ghlRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlDW,        ...clinicWhere, ...serviceWhere,
      sourceSystem: "GHL" },
    select: { createdAtSource: true, clinicLocationNormalized: true, serviceNormalized: true },
  });

  const zenotiRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlDW,        ...clinicWhere, ...serviceWhere,
      sourceSystem: "ZENOTI", isAppointmentBased: false },
    select: { createdAtSource: true, leadCreatedDate: true, reportDate: true, clinicLocationNormalized: true, serviceNormalized: true },
  });

  // ── Build group key ────────────────────────────────────────────────────────
  function groupKey(dateKey: string, clinic: string, service: string): string {
    if (dimensionGroupBy === "date")               return dateKey;
    if (dimensionGroupBy === "date+clinic")        return `${dateKey}|${clinic}`;
    if (dimensionGroupBy === "date+service")       return `${dateKey}|${service}`;
    return `${dateKey}|${clinic}|${service}`;
  }

  type Entry = { dateKey: string; clinic: string; service: string; web: number; meta: number; ghl: number; zenoti: number };
  const map = new Map<string, Entry>();

  function getOrCreate(dateKey: string, clinic: string, service: string): Entry {
    const k = groupKey(dateKey, clinic, service);
    if (!map.has(k)) {
      map.set(k, { dateKey, clinic, service, web: 0, meta: 0, ghl: 0, zenoti: 0 });
    }
    return map.get(k)!;
  }

  // WEBSITE
  let wTotal = 0; let wUnkClinic = 0; let wUnkService = 0;
  for (const r of websiteRecs) {
    const d = r.createdAtSource ?? r.reportDate;
    if (!d) continue;
    const dk = getPeriodKey(d, grouping, tz);
    const c  = includeClinic  ? clinicKey(r.clinicLocationNormalized)  : UNKNOWN;
    const s  = includeService ? serviceKey(r.serviceNormalized)        : UNKNOWN;
    getOrCreate(dk, c, s).web++;
    wTotal++;
    if (clinicKey(r.clinicLocationNormalized)  === UNKNOWN) wUnkClinic++;
    if (serviceKey(r.serviceNormalized)         === UNKNOWN) wUnkService++;
  }

  // META (sum metaLeadCount)
  let mTotal = 0; let mUnkClinic = 0; let mUnkService = 0;
  for (const r of metaRecs) {
    const d = r.reportDate ?? r.createdAtSource;
    if (!d) continue;
    const dk    = getPeriodKey(d, grouping, tz);
    const c     = includeClinic  ? clinicKey(r.clinicLocationNormalized)  : UNKNOWN;
    const s     = includeService ? serviceKey(r.serviceNormalized)        : UNKNOWN;
    const leads = r.metaLeadCount ?? 0;
    getOrCreate(dk, c, s).meta += leads;
    mTotal += leads;
    if (clinicKey(r.clinicLocationNormalized)  === UNKNOWN) mUnkClinic  += leads;
    if (serviceKey(r.serviceNormalized)         === UNKNOWN) mUnkService += leads;
  }

  // GHL
  let gTotal = 0; let gUnkClinic = 0; let gUnkService = 0;
  for (const r of ghlRecs) {
    if (!r.createdAtSource) continue;
    const dk = getPeriodKey(r.createdAtSource, grouping, tz);
    const c  = includeClinic  ? clinicKey(r.clinicLocationNormalized)  : UNKNOWN;
    const s  = includeService ? serviceKey(r.serviceNormalized)        : UNKNOWN;
    getOrCreate(dk, c, s).ghl++;
    gTotal++;
    if (clinicKey(r.clinicLocationNormalized)  === UNKNOWN) gUnkClinic++;
    if (serviceKey(r.serviceNormalized)         === UNKNOWN) gUnkService++;
  }

  // ZENOTI
  let zTotal = 0; let zUnkClinic = 0; let zUnkService = 0;
  for (const r of zenotiRecs) {
    const d = r.createdAtSource ?? r.leadCreatedDate ?? r.reportDate;
    if (!d) continue;
    const dk = getPeriodKey(d, grouping, tz);
    const c  = includeClinic  ? clinicKey(r.clinicLocationNormalized)  : UNKNOWN;
    const s  = includeService ? serviceKey(r.serviceNormalized)        : UNKNOWN;
    getOrCreate(dk, c, s).zenoti++;
    zTotal++;
    if (clinicKey(r.clinicLocationNormalized)  === UNKNOWN) zUnkClinic++;
    if (serviceKey(r.serviceNormalized)         === UNKNOWN) zUnkService++;
  }

  // ── Build result rows ──────────────────────────────────────────────────────
  const rows: SourceComparisonRow[] = Array.from(map.values()).map((e) => {
    const src    = e.web + e.meta;
    const clinic  = includeClinic  ? e.clinic  : undefined;
    const service = includeService ? e.service : undefined;
    const status  = computeAuditStatus(e.web, e.meta, e.ghl, e.zenoti, clinic, service);
    const discrepancyLocation = computeDiscrepancyLocation(src, e.ghl, e.zenoti, status);
    return {
      period:               periodLabel(e.dateKey, grouping),
      periodStart:          e.dateKey,
      periodEnd:            e.dateKey,
      clinic,
      service,
      websiteLeads:         e.web,
      metaLeads:            e.meta,
      totalSourceLeads:     src,
      ghlLeads:             e.ghl,
      zenotiLeads:          e.zenoti,
      srcToGhlDiff:         src - e.ghl,
      ghlToZenotiDiff:      e.ghl - e.zenoti,
      srcToGhlMatchRate:    pct(e.ghl, src),
      ghlToZenotiMatchRate: pct(e.zenoti, e.ghl),
      discrepancyLocation,
      status,
    };
  }).sort((a, b) => {
    // Sort by date desc, then clinic, then service
    const dateCmp = b.periodStart.localeCompare(a.periodStart);
    if (dateCmp !== 0) return dateCmp;
    const clinicCmp = (a.clinic ?? "").localeCompare(b.clinic ?? "");
    if (clinicCmp !== 0) return clinicCmp;
    return (a.service ?? "").localeCompare(b.service ?? "");
  });

  const diagnostics: SourceComparisonDiagnostics = {
    websiteTotal: wTotal,
    metaTotal: mTotal,
    ghlTotal: gTotal,
    zenotiTotal: zTotal,
    websiteUnknownClinic: wUnkClinic,
    websiteUnknownService: wUnkService,
    metaUnknownClinic: mUnkClinic,
    metaUnknownService: mUnkService,
    ghlUnknownClinic: gUnkClinic,
    ghlUnknownService: gUnkService,
    zenotiUnknownClinic: zUnkClinic,
    zenotiUnknownService: zUnkService,
    groupCount: rows.length,
    dateRange: `${from ?? "all"} → ${to ?? "all"}`,
    dimensionGroupBy,
    serviceFilter: serviceFilter ?? "all",
    clinicFilter:  clinicFilter  ?? "all",
  };

  return { rows, diagnostics };
}

// ─── Clinic Breakdown ─────────────────────────────────────────────────────────

export async function getClinicBreakdown(
  from?: string, to?: string
): Promise<ClinicBreakdownRow[]> {
  const dateFilter    = buildDateFilter(from, to);
  const webClinicDW   = websiteDateWhereSimple(dateFilter);
  const ghlClinicDW   = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};

  // Run sequentially — avoids exhausting Supabase pgbouncer connection pool
  // (Promise.all with 5 concurrent groupBy queries can hit the pool_size limit)
  const websiteRecs = await prisma.leadSourceRecord.findMany({
    where: { ...webClinicDW, sourceSystem: "WEBSITE",
      websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
    select: { clinicLocationNormalized: true, isDuplicate: true },
  });
  const metaRecs = await prisma.leadSourceRecord.findMany({
    where: { ...metaDateWhere, sourceSystem: "META",
      metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
    select: { clinicLocationNormalized: true, metaLeadCount: true },
  });
  const ghlRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlClinicDW, sourceSystem: "GHL" },
    select: { clinicLocationNormalized: true },
  });
  const zenotiRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlClinicDW, sourceSystem: "ZENOTI", isAppointmentBased: false },
    select: { clinicLocationNormalized: true },
  });

  const clinics = new Set<string>();
  const wb: Record<string, number> = {};
  const mb: Record<string, number> = {};
  const gb: Record<string, number> = {};
  const zb: Record<string, number> = {};
  const db: Record<string, number> = {};

  for (const r of websiteRecs) {
    const k = r.clinicLocationNormalized ?? "Unknown";
    clinics.add(k);
    if (r.isDuplicate) { db[k] = (db[k] ?? 0) + 1; }
    else               { wb[k] = (wb[k] ?? 0) + 1; }
  }
  for (const r of metaRecs) {
    const k = r.clinicLocationNormalized ?? "Unknown";
    clinics.add(k);
    mb[k] = (mb[k] ?? 0) + (r.metaLeadCount ?? 0);
  }
  for (const r of ghlRecs) {
    const k = r.clinicLocationNormalized ?? "Unknown";
    clinics.add(k);
    gb[k] = (gb[k] ?? 0) + 1;
  }
  for (const r of zenotiRecs) {
    const k = r.clinicLocationNormalized ?? "Unknown";
    clinics.add(k);
    zb[k] = (zb[k] ?? 0) + 1;
  }

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
  const dateFilter    = buildDateFilter(from, to);
  const webSvcDW      = websiteDateWhereSimple(dateFilter);
  const ghlSvcDW      = dateFilter ? { createdAtSource: dateFilter } : {};
  const metaDateWhere = dateFilter ? { reportDate: dateFilter } : {};
  const clinicWhere   = clinic ? { clinicLocationNormalized: clinic } : {};

  // Sequential findMany + JS aggregation — avoids exhausting the pgbouncer connection pool
  const websiteRecs = await prisma.leadSourceRecord.findMany({
    where: { ...webSvcDW, ...clinicWhere, sourceSystem: "WEBSITE", isDuplicate: false,
      websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES } },
    select: { serviceNormalized: true },
  });
  const metaRecs = await prisma.leadSourceRecord.findMany({
    where: { ...metaDateWhere, ...clinicWhere, sourceSystem: "META",
      metaResultType: { notIn: EXCLUDED_META_ACTION_TYPES } },
    select: { serviceNormalized: true, metaLeadCount: true },
  });
  const ghlRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlSvcDW, ...clinicWhere, sourceSystem: "GHL" },
    select: { serviceNormalized: true },
  });
  const zenotiRecs = await prisma.leadSourceRecord.findMany({
    where: { ...ghlSvcDW, ...clinicWhere, sourceSystem: "ZENOTI", isAppointmentBased: false },
    select: { serviceNormalized: true },
  });

  const services = new Set<string>();
  const wb: Record<string, number> = {};
  const mb: Record<string, number> = {};
  const gb: Record<string, number> = {};
  const zb: Record<string, number> = {};

  for (const r of websiteRecs) { const k = r.serviceNormalized ?? "Other"; services.add(k); wb[k] = (wb[k] ?? 0) + 1; }
  for (const r of metaRecs)    { const k = r.serviceNormalized ?? "Other"; services.add(k); mb[k] = (mb[k] ?? 0) + (r.metaLeadCount ?? 0); }
  for (const r of ghlRecs)     { const k = r.serviceNormalized ?? "Other"; services.add(k); gb[k] = (gb[k] ?? 0) + 1; }
  for (const r of zenotiRecs)  { const k = r.serviceNormalized ?? "Other"; services.add(k); zb[k] = (zb[k] ?? 0) + 1; }

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

// Returns a Prisma where fragment that matches WEBSITE records in the date range.
// Uses createdAtSource when set; falls back to reportDate for CSV-imported records
// that may have been saved without createdAtSource.
//
// IMPORTANT: we intentionally avoid using this inside groupBy() because Prisma's
// groupBy + OR has fragile runtime behaviour on some DB providers (Supabase/pgbouncer).
// For groupBy we use a separate plain createdAtSource filter and merge in JS.
function websiteDateWhere(dateFilter: ReturnType<typeof buildDateFilter>) {
  if (!dateFilter) return {};
  return {
    OR: [
      { createdAtSource: dateFilter },
      // Use { equals: null } — the explicit Prisma idiom — rather than bare `null`.
      { createdAtSource: { equals: null as null }, reportDate: dateFilter },
    ],
  };
}

// Returns a simple (no-OR) date condition suitable for groupBy queries.
function websiteDateWhereSimple(dateFilter: ReturnType<typeof buildDateFilter>) {
  if (!dateFilter) return {};
  // Primary: createdAtSource. Records without a date are excluded from date-range
  // views but will appear in an "all time" query.
  return { createdAtSource: dateFilter };
}

export async function getWebsiteForms(
  from?: string, to?: string, clinic?: string, service?: string
): Promise<WebsiteFormRow[]> {
  const dateFilter = buildDateFilter(from, to);
  const extra = {
    ...(clinic ? { clinicLocationNormalized: clinic } : {}),
    ...(service ? { serviceNormalized: service } : {}),
  };

  // ── Fetch matching records then group in JS ──────────────────────────────────
  // We deliberately avoid Prisma groupBy+OR (fragile on Supabase/pgbouncer).
  // Instead: one findMany with OR date condition, then aggregate in memory.
  const dateCond = websiteDateWhere(dateFilter);

  const records = await prisma.leadSourceRecord.findMany({
    where: {
      ...extra,
      sourceSystem: "WEBSITE",
      ...(Object.keys(dateCond).length ? dateCond : {}),
    },
    select: {
      formName:          true,
      websiteFormSource: true,
      formId:            true,
      backendProvider:   true,
      pageUrl:           true,
      isDuplicate:       true,
      createdAtSource:   true,
      reportDate:        true,
    },
  });

  // Group by (formName, websiteFormSource, formId, backendProvider, pageUrl)
  type Group = {
    formName: string;
    websiteFormSource: string | null;
    formId: string | null;
    backendProvider: string | null;
    pageUrl: string | null;
    total: number;
    unique: number;
    dupes: number;
    lastDate: Date | null;
  };
  const groupMap = new Map<string, Group>();

  for (const r of records) {
    // Use formName when present; fall back to formId or backendProvider so that
    // records without a form title (e.g. GF entries when form_title is not
    // returned by the API) are still grouped and displayed rather than dropped.
    const displayName =
      r.formName ||
      (r.formId ? `Form ${r.formId}` : null) ||
      (r.backendProvider ? `(${r.backendProvider})` : null) ||
      "(Unknown Form)";

    const key = [
      displayName,
      r.websiteFormSource ?? "\x00",
      r.formId            ?? "\x00",
      r.backendProvider   ?? "\x00",
      r.pageUrl           ?? "\x00",
    ].join("||");

    const d = r.createdAtSource ?? r.reportDate ?? null;
    const g = groupMap.get(key);
    if (!g) {
      groupMap.set(key, {
        formName:          displayName,
        websiteFormSource: r.websiteFormSource,
        formId:            r.formId,
        backendProvider:   r.backendProvider,
        pageUrl:           r.pageUrl,
        total:  1,
        unique: r.isDuplicate ? 0 : 1,
        dupes:  r.isDuplicate ? 1 : 0,
        lastDate: d,
      });
    } else {
      g.total++;
      if (r.isDuplicate) g.dupes++; else g.unique++;
      if (d && (!g.lastDate || d > g.lastDate)) g.lastDate = d;
    }
  }

  const results: WebsiteFormRow[] = [];
  for (const g of Array.from(groupMap.values()).sort((a, b) => b.unique - a.unique)) {
    const uniqueLeads    = Math.min(g.unique, g.total);
    const duplicateCount = Math.max(0, g.total - uniqueLeads);
    const isExcluded     = EXCLUDED_WEBSITE_FORM_SOURCES.includes(g.websiteFormSource ?? "");
    const status: import("@/types").AuditStatus = isExcluded
      ? "EXCLUDED"
      : uniqueLeads === 0 ? "NEEDS_REVIEW" : "PASSED";
    results.push({
      id:                    g.formName,
      formName:              g.formName,
      formId:                g.formId,
      websiteFormSource:     g.websiteFormSource,
      backendProvider:       g.backendProvider,
      pageUrl:               g.pageUrl,
      totalSubmissions:      g.total,
      uniqueLeads,
      duplicateCount,
      ghlCount:              0,
      zenotiCount:           0,
      websiteToGhlDiff:      0,
      websiteToZenotiDiff:   0,
      websiteToGhlMatchRate: 0,
      websiteToZenotiMatchRate: 0,
      status,
      lastSubmissionAt: g.lastDate?.toISOString() ?? null,
      excludedFromLeadCount: isExcluded,
    });
  }
  return results;
}

export async function getWebsiteDiagnostics(from?: string, to?: string) {
  const dateFilter   = buildDateFilter(from, to);
  // Use simple (no OR) count for the "in date range" number — avoids Prisma count+OR issues.
  // Records without createdAtSource are counted separately.
  const simpleDW = websiteDateWhereSimple(dateFilter);

  const [totalAll, websiteTotal, websiteInRange, missingDate, websiteNoDate] = await Promise.all([
    prisma.leadSourceRecord.count(),
    prisma.leadSourceRecord.count({ where: { sourceSystem: "WEBSITE" } }),
    // Count records in range by createdAtSource only (simple, reliable).
    prisma.leadSourceRecord.count({
      where: { sourceSystem: "WEBSITE", ...(Object.keys(simpleDW).length ? simpleDW : {}) },
    }),
    prisma.leadSourceRecord.count({ where: { sourceSystem: "WEBSITE", createdAtSource: { equals: null } } }),
    // Also count records with reportDate in range (for CSV imports).
    prisma.leadSourceRecord.count({
      where: {
        sourceSystem: "WEBSITE",
        createdAtSource: { equals: null },
        ...(dateFilter ? { reportDate: dateFilter } : {}),
      },
    }),
  ]);

  const [earliest, latest, sample] = await Promise.all([
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
    prisma.leadSourceRecord.findMany({
      where: { sourceSystem: "WEBSITE" },
      orderBy: { importedAt: "desc" },
      take: 5,
      select: {
        id: true, sourceSystem: true, backendProvider: true,
        formName: true, websiteFormSource: true,
        createdAtSource: true, reportDate: true, importedAt: true,
      },
    }),
  ]);

  return {
    totalRecords: totalAll,
    websiteRecords: websiteTotal,
    // createdAtSource-based count (the primary date field for GF API records).
    websiteInDateRange: websiteInRange,
    // Additional: how many would also be matched via reportDate fallback.
    websiteInDateRangeViaReportDate: websiteNoDate,
    missingCreatedAtSource: missingDate,
    earliestCreatedAtSource: earliest?.createdAtSource?.toISOString() ?? null,
    latestCreatedAtSource:   latest?.createdAtSource?.toISOString()   ?? null,
    sampleRecords: sample,
  };
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

  // byClinicLocation aggregation
  const byClinicLocation = new Map<string, {
    clinic: string;
    leads: number;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    campaignSet: Set<string>;
    adSetSet: Set<string>;
    adSet2: Set<string>;
    accountNames: Set<string>;
  }>();

  // Aggregate by campaign, result type, ad account, and service
  const byCampaign = new Map<string, { leads: number; spend: number; accountId: string | null; accountName: string | null }>();
  const byResultType = new Map<string, number>();
  const byAdAccount = new Map<string, { accountId: string; accountName: string; leads: number; spend: number; campaignSet: Set<string> }>();
  const byService = new Map<string, {
    service: string;
    leads: number;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    campaignSet: Set<string>;
    accountNames: Set<string>;
  }>();
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

    // Clinic location aggregation
    const clinic = r.clinicLocationNormalized ?? "Unknown";
    const clExisting = byClinicLocation.get(clinic) ?? {
      clinic, leads: 0, spend: 0, impressions: 0, reach: 0, clicks: 0,
      campaignSet: new Set<string>(), adSetSet: new Set<string>(), adSet2: new Set<string>(), accountNames: new Set<string>(),
    };
    clExisting.leads += leads;
    clExisting.spend += spend;
    clExisting.impressions += r.impressions ?? 0;
    clExisting.reach += r.reach ?? 0;
    clExisting.clicks += r.clicks ?? 0;
    if (r.campaignName) clExisting.campaignSet.add(r.campaignName);
    if (r.metaAdSetName) clExisting.adSetSet.add(r.metaAdSetName);
    if (r.metaAdName) clExisting.adSet2.add(r.metaAdName);
    if (r.metaAdAccountName) clExisting.accountNames.add(r.metaAdAccountName);
    byClinicLocation.set(clinic, clExisting);

    // Service aggregation
    const svc = r.serviceNormalized ?? "Other";
    const svcEx = byService.get(svc) ?? {
      service: svc, leads: 0, spend: 0, impressions: 0, reach: 0, clicks: 0,
      campaignSet: new Set<string>(), accountNames: new Set<string>(),
    };
    svcEx.leads += leads;
    svcEx.spend += spend;
    svcEx.impressions += r.impressions ?? 0;
    svcEx.reach += r.reach ?? 0;
    svcEx.clicks += r.clicks ?? 0;
    if (r.campaignName) svcEx.campaignSet.add(r.campaignName);
    if (r.metaAdAccountName) svcEx.accountNames.add(r.metaAdAccountName);
    byService.set(svc, svcEx);
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
    byClinicLocation: Array.from(byClinicLocation.values())
      .map(({ campaignSet, adSetSet, adSet2, accountNames, ...rest }) => ({
        ...rest,
        cpl: rest.leads > 0 ? Math.round((rest.spend / rest.leads) * 100) / 100 : null,
        campaignCount: campaignSet.size,
        adSetCount: adSetSet.size,
        adCount: adSet2.size,
        accountNames: Array.from(accountNames),
      }))
      .sort((a, b) => b.leads - a.leads),
    byService: Array.from(byService.values())
      .map(({ campaignSet, accountNames, ...rest }) => ({
        ...rest,
        cpl: rest.leads > 0 ? Math.round((rest.spend / rest.leads) * 100) / 100 : null,
        campaignCount: campaignSet.size,
        accountNames: Array.from(accountNames),
      }))
      .sort((a, b) => b.leads - a.leads),
  };
}

// ─── Website Service Breakdown ────────────────────────────────────────────────

export async function getWebsiteServiceBreakdown(from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);
  const dateCond = websiteDateWhere(dateFilter);

  const records = await prisma.leadSourceRecord.findMany({
    where: {
      sourceSystem: "WEBSITE",
      websiteFormSource: { notIn: EXCLUDED_WEBSITE_FORM_SOURCES },
      ...(Object.keys(dateCond).length ? dateCond : {}),
    },
    select: {
      serviceNormalized: true,
      serviceRaw: true,
      formName: true,
      isDuplicate: true,
      createdAtSource: true,
      reportDate: true,
    },
  });

  const map = new Map<string, {
    service: string;
    total: number;
    unique: number;
    dupes: number;
    formSet: Set<string>;
    lastDate: Date | null;
  }>();

  for (const r of records) {
    const svc = r.serviceNormalized ?? "Other";
    const existing = map.get(svc) ?? { service: svc, total: 0, unique: 0, dupes: 0, formSet: new Set<string>(), lastDate: null };
    existing.total++;
    if (r.isDuplicate) existing.dupes++; else existing.unique++;
    if (r.formName) existing.formSet.add(r.formName);
    const d = r.createdAtSource ?? r.reportDate;
    if (d && (!existing.lastDate || d > existing.lastDate)) existing.lastDate = d;
    map.set(svc, existing);
  }

  return Array.from(map.values())
    .map(({ formSet, ...rest }) => ({
      ...rest,
      formCount: formSet.size,
      lastSubmissionAt: rest.lastDate?.toISOString() ?? null,
    }))
    .sort((a, b) => b.unique - a.unique);
}

// ─── Export helpers ───────────────────────────────────────────────────────────

export { buildDateFilter as buildDateFilterExport };
