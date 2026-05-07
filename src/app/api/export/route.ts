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

  if (type === "unmatched") {
    filename = "unmatched-leads.csv";
    const leads = await prisma.leadSourceRecord.findMany({
      where: { ...where, sourceSystem: { in: ["WORDPRESS", "META"] } },
      include: { primaryMatches: { take: 1, orderBy: { matchScore: "desc" } } },
      take: 5000,
    });
    rows = leads.filter((l) => !l.primaryMatches.some((m) => m.matchStatus === "MATCHED"))
      .map((l) => ({
        id: l.id, source: l.sourceSystem, date: l.createdAtSource?.toISOString().slice(0, 10),
        name: l.fullName, email: l.email, phone: l.phone,
        clinic: l.clinicLocationNormalized, service: l.serviceNormalized,
        formName: l.formName, campaign: l.campaignName,
      }));
  } else if (type === "duplicates") {
    filename = "duplicate-leads.csv";
    const leads = await prisma.leadSourceRecord.findMany({
      where: { ...where, isDuplicate: true },
      take: 5000,
    });
    rows = leads.map((l) => ({
      id: l.id, source: l.sourceSystem, date: l.createdAtSource?.toISOString().slice(0, 10),
      name: l.fullName, email: l.email, phone: l.phone,
      clinic: l.clinicLocationNormalized, service: l.serviceNormalized,
    }));
  } else if (type === "missing-ghl") {
    filename = "missing-in-ghl.csv";
    const sourceleads = await prisma.leadSourceRecord.findMany({
      where: { ...where, sourceSystem: { in: ["WORDPRESS", "META"] } },
      include: { primaryMatches: { take: 1 } },
      take: 5000,
    });
    rows = sourceleads.filter((l) => l.primaryMatches.length === 0 || l.primaryMatches[0].matchStatus === "UNMATCHED")
      .map((l) => ({
        source: l.sourceSystem, date: l.createdAtSource?.toISOString().slice(0, 10),
        name: l.fullName, email: l.email, phone: l.phone,
        clinic: l.clinicLocationNormalized, service: l.serviceNormalized,
        form: l.formName,
      }));
  } else if (type === "wordpress-forms") {
    filename = "wordpress-forms.csv";
    const forms = await prisma.wordPressFormSummary.findMany({ orderBy: { totalSubmissions: "desc" } });
    rows = forms.map((f) => ({
      formName: f.formName, plugin: f.wordpressFormPlugin, pageUrl: f.pageUrl,
      totalSubmissions: f.totalSubmissions, uniqueLeads: f.uniqueLeads,
      duplicates: f.duplicateSubmissions, ghlMatched: f.ghlMatchedCount,
      zenotiMatched: f.zenotiMatchedCount, missingGhl: f.missingInGhlCount,
      missingZenoti: f.missingInZenotiCount,
      ghlRate: f.formToGhlReconciliationRate.toFixed(1) + "%",
      zenotiRate: f.formToZenotiReconciliationRate.toFixed(1) + "%",
      status: f.reconciliationStatus,
      lastSubmission: f.lastSubmissionAt?.toISOString().slice(0, 10),
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
      const key = `${g.clinicLocationNormalized}::${g.serviceNormalized}`;
      if (!map.has(key)) map.set(key, {});
      map.get(key)![g.sourceSystem] = g._count.id;
    }
    rows = Array.from(map.entries()).map(([key, bySrc]) => {
      const [clinic, service] = key.split("::");
      return { clinic, service, wordpress: bySrc["WORDPRESS"] || 0, meta: bySrc["META"] || 0,
        ghl: bySrc["GHL"] || 0, zenoti: bySrc["ZENOTI"] || 0 };
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
