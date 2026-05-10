export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const [total, bySourceSystem, byBackendProvider, byRecordType] = await Promise.all([
      prisma.leadSourceRecord.count(),
      prisma.leadSourceRecord.groupBy({
        by: ["sourceSystem"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.leadSourceRecord.groupBy({
        by: ["backendProvider"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.leadSourceRecord.groupBy({
        by: ["recordType"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
    ]);

    const combinations = await prisma.leadSourceRecord.groupBy({
      by: ["sourceSystem", "backendProvider"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    // Per-sourceSystem date ranges and samples
    const sourceSystems = bySourceSystem.map((r) => r.sourceSystem);
    const perSourceStats = await Promise.all(
      sourceSystems.map(async (sys) => {
        const [
          missingCreatedAt,
          missingReportDate,
          earliestCreatedAt,
          latestCreatedAt,
          earliestReportDate,
          latestReportDate,
          sample,
        ] = await Promise.all([
          prisma.leadSourceRecord.count({ where: { sourceSystem: sys, createdAtSource: { equals: null } } }),
          prisma.leadSourceRecord.count({ where: { sourceSystem: sys, reportDate: { equals: null } } }),
          prisma.leadSourceRecord.findFirst({
            where: { sourceSystem: sys, createdAtSource: { not: null } },
            orderBy: { createdAtSource: "asc" },
            select: { createdAtSource: true },
          }),
          prisma.leadSourceRecord.findFirst({
            where: { sourceSystem: sys, createdAtSource: { not: null } },
            orderBy: { createdAtSource: "desc" },
            select: { createdAtSource: true },
          }),
          prisma.leadSourceRecord.findFirst({
            where: { sourceSystem: sys, reportDate: { not: null } },
            orderBy: { reportDate: "asc" },
            select: { reportDate: true },
          }),
          prisma.leadSourceRecord.findFirst({
            where: { sourceSystem: sys, reportDate: { not: null } },
            orderBy: { reportDate: "desc" },
            select: { reportDate: true },
          }),
          prisma.leadSourceRecord.findMany({
            where: { sourceSystem: sys },
            orderBy: { importedAt: "desc" },
            take: 5,
            select: {
              id: true,
              sourceSystem: true,
              backendProvider: true,
              recordType: true,
              externalId: true,
              formName: true,
              campaignName: true,
              metaAdAccountId: true,
              createdAtSource: true,
              reportDate: true,
              importedAt: true,
              isDuplicate: true,
              metaResultType: true,
              metaLeadCount: true,
            },
          }),
        ]);

        // Derive rawPayload exists from sample
        const sampleWithRaw = await prisma.leadSourceRecord.findMany({
          where: { sourceSystem: sys },
          orderBy: { importedAt: "desc" },
          take: 5,
          select: {
            id: true,
            sourceSystem: true,
            backendProvider: true,
            recordType: true,
            externalId: true,
            formName: true,
            campaignName: true,
            metaAdAccountId: true,
            createdAtSource: true,
            reportDate: true,
            importedAt: true,
            isDuplicate: true,
            metaResultType: true,
            metaLeadCount: true,
            rawPayload: true,
          },
        });

        return {
          sourceSystem: sys,
          count: bySourceSystem.find((r) => r.sourceSystem === sys)?._count.id ?? 0,
          missingCreatedAt,
          missingReportDate,
          earliestCreatedAt: earliestCreatedAt?.createdAtSource?.toISOString() ?? null,
          latestCreatedAt:   latestCreatedAt?.createdAtSource?.toISOString()   ?? null,
          earliestReportDate: earliestReportDate?.reportDate?.toISOString() ?? null,
          latestReportDate:   latestReportDate?.reportDate?.toISOString()   ?? null,
          sample: sampleWithRaw.map((r) => ({
            id:               r.id,
            sourceSystem:     r.sourceSystem,
            backendProvider:  r.backendProvider,
            recordType:       r.recordType,
            externalId:       r.externalId,
            formName:         r.formName,
            campaignName:     r.campaignName,
            metaAdAccountId:  r.metaAdAccountId,
            createdAtSource:  r.createdAtSource?.toISOString() ?? null,
            reportDate:       r.reportDate?.toISOString()      ?? null,
            importedAt:       r.importedAt?.toISOString()      ?? null,
            isDuplicate:      r.isDuplicate,
            metaResultType:   r.metaResultType,
            metaLeadCount:    r.metaLeadCount,
            rawPayloadExists: r.rawPayload != null,
          })),
        };
      })
    );

    // Meta-specific: total metaLeadCount
    const metaLeadTotal = await prisma.leadSourceRecord.aggregate({
      where: { sourceSystem: "META" },
      _sum: { metaLeadCount: true },
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      total,
      bySourceSystem: bySourceSystem.map((r) => ({ sourceSystem: r.sourceSystem, count: r._count.id })),
      byBackendProvider: byBackendProvider.map((r) => ({ backendProvider: r.backendProvider ?? "(null)", count: r._count.id })),
      byRecordType: byRecordType.map((r) => ({ recordType: r.recordType ?? "(null)", count: r._count.id })),
      combinations: combinations.map((r) => ({
        sourceSystem: r.sourceSystem,
        backendProvider: r.backendProvider ?? "(null)",
        count: r._count.id,
      })),
      metaTotalLeadCount: metaLeadTotal._sum.metaLeadCount ?? 0,
      perSourceStats,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err), stack: err?.stack?.slice(0, 500) }, { status: 500 });
  }
}
