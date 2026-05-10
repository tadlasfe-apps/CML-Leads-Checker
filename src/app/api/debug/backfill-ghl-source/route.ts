export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST() {
  try {
    // Fetch all GHL records that have no leadSource stored but have rawPayload
    const recs = await prisma.leadSourceRecord.findMany({
      where: { sourceSystem: "GHL", leadSource: null },
      select: { id: true, rawPayload: true },
    });

    let patched = 0;
    let noSource = 0;

    for (const r of recs) {
      const payload = r.rawPayload as any;
      const source =
        payload?.contact?.source ??
        payload?.source ??
        payload?.attributionSource?.medium ??
        null;

      if (!source) { noSource++; continue; }

      await prisma.leadSourceRecord.update({
        where: { id: r.id },
        data: {
          leadSource: String(source),
          ...(payload?.contact?.attributionSource?.medium
            ? { attributedChannel: String(payload.contact.attributionSource.medium) }
            : {}),
        },
      });
      patched++;
    }

    return NextResponse.json({
      total: recs.length,
      patched,
      noSource,
    });
  } catch (err: any) {
    console.error("[/api/debug/backfill-ghl-source]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
