import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { buildDateFilter } from "@/lib/data";

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => {
      const v = row[h];
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    }).join(","));
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type") || "source-comparison";
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const dateFilter = buildDateFilter(from, to);
  const where = dateFilter ? { createdAtSource: dateFilter } : {};

  let rows: Record<string, unknown>[] = [];
  let filename = "export.csv";

  if (type === "duplicates") {
    filename = "duplicate-leads.csv";
    const leads = await prisma.leadSourceRecord.findMany({
      where: { ...where, isDuplicate: true },
      take: 5000,
    });
    rows = leads.map((l) => ({
      id: l.id,
      source: l.sourceSystem,
      date: l.createdAtSource?.toISOString().slice(0, 10),
      name: l.fullName,
      email: l.email,
      phone: l.phone,
      clinic: l.clinicLocationNormalized,
      service: l.serviceNormalized,
      formName: l.formName,
      websiteFormSource: l.websiteFormSource,
    }));
  } else if (type === "website-leads") {
    filename = "website-leads.csv";
    const leads = await prisma.leadSourceRecord.findMany({
      where: { ...where, sourceSystem: "WEBSITE" },
      take: 10000,
      orderBy: { createdAtSource: "desc" },
    });
    rows = leads.map((l) => ({
      id: l.id,
      date: l.createdAtSource?.toISOString().slice(0, 10),
      name: l.fullName,
      email: l.email,
      phone: l.phone,
      clinic: l.clinicLocationNormalized,
      service: l.serviceNormalized,
      formName: l.formName,
      websiteFormSource: l.websiteFormSource,
      isDuplicate: l.isDuplicate,
      backendProvider: l.backendProvider,
      pageUrl: l.pageUrl,
    }));
  } else if (type === "meta-leads") {
    filename = "meta-leads.csv";
    const leads = await prisma.leadSourceRecord.findMany({
      where: { ...(dateFilter ? { reportDate: dateFilter } : {}), sourceSystem: "META" },
      take: 10000,
      orderBy: { reportDate: "desc" },
    });
    rows = leads.map((l) => ({
      date: l.reportDate?.toISOString().slice(0, 10),
      campaign: l.campaignName,
      adSet: l.metaAdSetName,
      ad: l.metaAdName,
      resultType: l.metaResultType,
      leads: l.metaLeadCount,
      spend: l.spend,
      costPerResult: l.costPerResult,
      impressions: l.impressions,
    }));
  } else {
    filename = "source-comparison.csv";
    const groups = await prisma.leadSourceRecord.groupBy({
      by: ["clinicLocationNormalized", "serviceNormalized", "sourceSystem"],
      where,
      _count: { id: true },
    });
    const map = new Map<string, Record<string, number>>();
    for (const g of groups) {
      const key = `${g.clinicLocationNormalized ?? "Unknown"}::${g.serviceNormalized ?? "Other"}`;
      if (!map.has(key)) map.set(key, {});
      map.get(key)![g.sourceSystem] = g._count.id;
    }
    rows = Array.from(map.entries()).map(([key, bySrc]) => {
      const [clinic, service] = key.split("::");
      return {
        clinic,
        service,
        website: bySrc["WEBSITE"] || 0,
        meta: bySrc["META"] || 0,
        ghl: bySrc["GHL"] || 0,
        zenoti: bySrc["ZENOTI"] || 0,
      };
    });
  }

  const csv = toCSV(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
