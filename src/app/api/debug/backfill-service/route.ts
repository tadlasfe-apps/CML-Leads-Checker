export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inferServiceFromMetaRecord, inferServiceFromWebsiteRecord } from "@/lib/normalization";

export async function POST() {
  try {
    const BATCH = 200;
    let offset = 0;
    let websitePatched = 0;
    let metaPatched = 0;

    // Backfill META records
    offset = 0;
    while (true) {
      const records = await prisma.leadSourceRecord.findMany({
        where: { sourceSystem: "META" },
        select: { id: true, campaignName: true, metaAdSetName: true, metaAdName: true },
        orderBy: { id: "asc" },
        skip: offset,
        take: BATCH,
      });
      if (records.length === 0) break;
      await Promise.all(records.map((rec) => {
        const inferred = inferServiceFromMetaRecord(rec.campaignName, rec.metaAdSetName, rec.metaAdName);
        return prisma.leadSourceRecord.update({
          where: { id: rec.id },
          data: {
            serviceRaw:        inferred.raw !== "Other" ? inferred.raw : undefined,
            serviceNormalized: inferred.normalized,
          },
        }).then(() => { metaPatched++; }).catch(() => {});
      }));
      offset += BATCH;
    }

    // Backfill WEBSITE records
    offset = 0;
    while (true) {
      const records = await prisma.leadSourceRecord.findMany({
        where: { sourceSystem: "WEBSITE" },
        select: { id: true, serviceRaw: true, formName: true, websiteFormSource: true, pageUrl: true, landingPageUrl: true },
        orderBy: { id: "asc" },
        skip: offset,
        take: BATCH,
      });
      if (records.length === 0) break;
      await Promise.all(records.map((rec) => {
        const inferred = inferServiceFromWebsiteRecord(rec.serviceRaw, rec.formName, rec.websiteFormSource, rec.pageUrl, rec.landingPageUrl);
        return prisma.leadSourceRecord.update({
          where: { id: rec.id },
          data: { serviceNormalized: inferred.normalized },
        }).then(() => { websitePatched++; }).catch(() => {});
      }));
      offset += BATCH;
    }

    return NextResponse.json({ success: true, metaPatched, websitePatched });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
