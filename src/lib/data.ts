import prisma from "./prisma";
import { subDays } from "date-fns";

export function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(from) : subDays(new Date(), 90),
    lte: to ? new Date(to + "T23:59:59") : new Date(),
  };
}

export async function getOverviewKPIs(from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);
  const where = dateFilter ? { createdAtSource: dateFilter } : {};

  const [wp, meta, ghl, zenoti, duplicates] = await Promise.all([
    prisma.leadSourceRecord.count({ where: { ...where, sourceSystem: "WORDPRESS" } }),
    prisma.leadSourceRecord.count({ where: { ...where, sourceSystem: "META" } }),
    prisma.leadSourceRecord.count({ where: { ...where, sourceSystem: "GHL" } }),
    prisma.leadSourceRecord.count({ where: { ...where, sourceSystem: "ZENOTI" } }),
    prisma.leadSourceRecord.count({ where: { ...where, isDuplicate: true } }),
  ]);

  const totalSource = wp + meta;

  const matched = await prisma.leadMatch.count({
    where: {
      matchStatus: "MATCHED",
      primaryLead: { sourceSystem: { in: ["WORDPRESS", "META"] }, ...(dateFilter ? { createdAtSource: dateFilter } : {}) },
    },
  });

  const missingInGhl = Math.max(0, totalSource - ghl);
  const missingInZenoti = Math.max(0, ghl - zenoti);
  const reconciliationRate = totalSource > 0 ? Math.round((matched / totalSource) * 100) : 0;

  return {
    totalSourceLeads: totalSource,
    wordpressLeads: wp,
    metaLeads: meta,
    ghlLeads: ghl,
    zenotiLeads: zenoti,
    matchedLeads: matched,
    missingInGhl,
    missingInZenoti,
    duplicateLeads: duplicates,
    reconciliationRate,
  };
}

export async function getSourceComparison(from?: string, to?: string, clinicFilter?: string, serviceFilter?: string) {
  const dateFilter = buildDateFilter(from, to);

  const baseWhere = {
    ...(dateFilter ? { createdAtSource: dateFilter } : {}),
    ...(clinicFilter ? { clinicLocationNormalized: clinicFilter } : {}),
    ...(serviceFilter ? { serviceNormalized: serviceFilter } : {}),
  };

  const [wpRows, metaRows, ghlRows, zenotiRows] = await Promise.all([
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized", "serviceNormalized"],
      where: { ...baseWhere, sourceSystem: "WORDPRESS" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized", "serviceNormalized"],
      where: { ...baseWhere, sourceSystem: "META" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized", "serviceNormalized"],
      where: { ...baseWhere, sourceSystem: "GHL" },
      _count: { id: true },
    }),
    prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized", "serviceNormalized"],
      where: { ...baseWhere, sourceSystem: "ZENOTI" },
      _count: { id: true },
    }),
  ]);

  const keySet = new Set<string>();
  const toMap = (rows: typeof wpRows) => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      const key = `${r.clinicLocationNormalized || "Unknown"}::${r.serviceNormalized || "Other"}`;
      map[key] = r._count.id;
      keySet.add(key);
    }
    return map;
  };

  const wpMap = toMap(wpRows);
  const metaMap = toMap(metaRows);
  const ghlMap = toMap(ghlRows);
  const zenotiMap = toMap(zenotiRows);

  return Array.from(keySet).map((key) => {
    const [clinic, service] = key.split("::");
    const wp = wpMap[key] || 0;
    const meta = metaMap[key] || 0;
    const g = ghlMap[key] || 0;
    const z = zenotiMap[key] || 0;
    const totalSource = wp + meta;
    const diff1 = totalSource - g;
    const diff2 = g - z;
    const discPct = totalSource > 0 ? Math.round((Math.abs(diff1) / totalSource) * 100) : 0;

    let status: string = "HEALTHY";
    if (discPct === 0 && diff2 === 0) status = "HEALTHY";
    else if (g === 0 && totalSource > 0) status = "MISSING_GHL";
    else if (z === 0 && g > 0) status = "MISSING_ZENOTI";
    else if (discPct >= 15) status = "MAJOR_DISCREPANCY";
    else if (discPct > 0) status = "MINOR_DISCREPANCY";

    return { clinicLocation: clinic, service, wordpressCount: wp, metaCount: meta, ghlCount: g, zenotiCount: z,
      sourcesToGhlDiff: diff1, ghlToZenotoDiff: diff2, discrepancyPct: discPct, status };
  }).sort((a, b) => (b.wordpressCount + b.metaCount) - (a.wordpressCount + a.metaCount));
}

export async function getClinicBreakdown(from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);
  const where = dateFilter ? { createdAtSource: dateFilter } : {};

  const rows = await prisma.leadSourceRecord.groupBy({
    by: ["clinicLocationNormalized", "sourceSystem"],
    where,
    _count: { id: true },
  });

  const clinics = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const clinic = r.clinicLocationNormalized || "Unknown";
    if (!clinics.has(clinic)) clinics.set(clinic, {});
    clinics.get(clinic)![r.sourceSystem] = r._count.id;
  }

  const dupes = await prisma.leadSourceRecord.groupBy({
    by: ["clinicLocationNormalized"],
    where: { ...where, isDuplicate: true },
    _count: { id: true },
  });
  const dupeMap = Object.fromEntries(dupes.map((d) => [d.clinicLocationNormalized || "Unknown", d._count.id]));

  return Array.from(clinics.entries()).map(([clinic, bySrc]) => ({
    clinicLocation: clinic,
    totalLeads: Object.values(bySrc).reduce((a: number, b: number) => a + b, 0),
    wordpressLeads: bySrc["WORDPRESS"] || 0,
    metaLeads: bySrc["META"] || 0,
    ghlLeads: bySrc["GHL"] || 0,
    zenotiLeads: bySrc["ZENOTI"] || 0,
    duplicateCount: dupeMap[clinic] || 0,
  })).sort((a, b) => b.totalLeads - a.totalLeads);
}

export async function getServiceBreakdown(from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);
  const where = dateFilter ? { createdAtSource: dateFilter } : {};

  const rows = await prisma.leadSourceRecord.groupBy({
    by: ["serviceNormalized", "sourceSystem"],
    where,
    _count: { id: true },
  });

  const services = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const svc = r.serviceNormalized || "Other";
    if (!services.has(svc)) services.set(svc, {});
    services.get(svc)![r.sourceSystem] = r._count.id;
  }

  return Array.from(services.entries()).map(([service, bySrc]) => ({
    service,
    totalLeads: Object.values(bySrc).reduce((a: number, b: number) => a + b, 0),
    wordpressLeads: bySrc["WORDPRESS"] || 0,
    metaLeads: bySrc["META"] || 0,
    ghlLeads: bySrc["GHL"] || 0,
    zenotiLeads: bySrc["ZENOTI"] || 0,
  })).sort((a, b) => b.totalLeads - a.totalLeads);
}

export async function getWordPressForms(from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);

  return prisma.wordPressFormSummary.findMany({
    orderBy: { totalSubmissions: "desc" },
  });
}

export async function getWordPressFormLeads(formName: string, from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);
  return prisma.leadSourceRecord.findMany({
    where: {
      sourceSystem: "WORDPRESS",
      formName,
      ...(dateFilter ? { createdAtSource: dateFilter } : {}),
    },
    orderBy: { createdAtSource: "desc" },
    take: 200,
  });
}

export async function getReconciliationLeads(
  status?: string, source?: string, clinic?: string, service?: string, from?: string, to?: string, page = 1
) {
  const dateFilter = buildDateFilter(from, to);
  const PAGE_SIZE = 50;

  const where = {
    ...(source ? { sourceSystem: source as "WORDPRESS" | "META" | "GHL" | "ZENOTI" } : {}),
    ...(clinic ? { clinicLocationNormalized: clinic } : {}),
    ...(service ? { serviceNormalized: service } : {}),
    ...(dateFilter ? { createdAtSource: dateFilter } : {}),
    ...(status === "duplicate" ? { isDuplicate: true } : {}),
  };

  const [leads, total] = await Promise.all([
    prisma.leadSourceRecord.findMany({
      where,
      orderBy: { createdAtSource: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        primaryMatches: {
          take: 1,
          orderBy: { matchScore: "desc" },
        },
      },
    }),
    prisma.leadSourceRecord.count({ where }),
  ]);

  return { leads, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) };
}

export async function getLeadTimelineData(from?: string, to?: string) {
  const dateFilter = buildDateFilter(from, to);
  let rows: { day: Date; source: string; cnt: bigint }[];
  if (dateFilter) {
    rows = await prisma.$queryRaw`
      SELECT DATE_TRUNC('day', "createdAtSource") as day, "sourceSystem" as source, COUNT(*) as cnt
      FROM "LeadSourceRecord"
      WHERE "createdAtSource" IS NOT NULL
        AND "createdAtSource" >= ${dateFilter.gte}
        AND "createdAtSource" <= ${dateFilter.lte}
      GROUP BY 1, 2
      ORDER BY 1
    `;
  } else {
    rows = await prisma.$queryRaw`
      SELECT DATE_TRUNC('day', "createdAtSource") as day, "sourceSystem" as source, COUNT(*) as cnt
      FROM "LeadSourceRecord"
      WHERE "createdAtSource" IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1
    `;
  }

  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const d = r.day.toISOString().slice(0, 10);
    if (!map.has(d)) map.set(d, {});
    map.get(d)![r.source] = Number(r.cnt);
  }

  return Array.from(map.entries()).map(([date, bySrc]) => ({
    date, wordpress: bySrc["WORDPRESS"] || 0, meta: bySrc["META"] || 0,
    ghl: bySrc["GHL"] || 0, zenoti: bySrc["ZENOTI"] || 0,
  }));
}

export async function getImportHistory() {
  return prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
}

export async function getAllClinics() {
  const rows = await prisma.leadSourceRecord.groupBy({
    by: ["clinicLocationNormalized"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return rows.map((r) => r.clinicLocationNormalized).filter(Boolean) as string[];
}

export async function getAllServices() {
  const rows = await prisma.leadSourceRecord.groupBy({
    by: ["serviceNormalized"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return rows.map((r) => r.serviceNormalized).filter(Boolean) as string[];
}
