export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inferClinicFromMetaRecord } from "@/lib/normalization";

export async function POST() {
  try {
    // Load manual mappings
    let manualMappings: Array<{ matchType: string; matchValue: string; mappedClinicLocation: string; priority: number }> = [];
    try {
      manualMappings = await prisma.metaLocationMapping.findMany({
        where: { active: true },
        orderBy: { priority: "desc" },
        select: { matchType: true, matchValue: true, mappedClinicLocation: true, priority: true },
      });
    } catch { /* table may not exist yet */ }

    // Fetch all META records in batches
    const BATCH = 200;
    let offset = 0;
    let totalPatched = 0;
    let totalProcessed = 0;

    while (true) {
      const records = await prisma.leadSourceRecord.findMany({
        where: { sourceSystem: "META" },
        select: {
          id: true,
          metaAdAccountName: true,
          campaignName: true,
          metaAdSetName: true,
          metaAdName: true,
        },
        orderBy: { id: "asc" },
        skip: offset,
        take: BATCH,
      });
      if (records.length === 0) break;
      totalProcessed += records.length;

      await Promise.all(
        records.map((rec) => {
          const inferred = inferClinicFromMetaRecord(
            rec.metaAdAccountName,
            rec.campaignName,
            rec.metaAdSetName,
            rec.metaAdName,
            manualMappings,
          );
          return prisma.leadSourceRecord.update({
            where: { id: rec.id },
            data: {
              clinicLocationRaw:        inferred.raw,
              clinicLocationNormalized: inferred.normalized,
            },
          }).then(() => { totalPatched++; }).catch(() => {});
        })
      );

      offset += BATCH;
    }

    return NextResponse.json({ success: true, totalProcessed, totalPatched });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
