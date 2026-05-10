export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inferWebsiteFormSource } from "@/lib/normalization";

/**
 * POST /api/debug/fix-website-sources
 *
 * One-time bulk fix: re-infers websiteFormSource for every WEBSITE record
 * where it is currently "Unknown" or empty, using the already-stored formName
 * and pageUrl. Groups by (formName, pageUrl) so it does one updateMany per
 * unique combination rather than one per row.
 */
export async function POST() {
  try {
    // 1. Fetch all distinct (formName, pageUrl) combos where source is Unknown
    const groups = await prisma.leadSourceRecord.groupBy({
      by: ["formName", "pageUrl"],
      where: {
        sourceSystem: "WEBSITE",
        websiteFormSource: { in: ["Unknown", ""] },
      },
      _count: { id: true },
    });

    let totalPatched = 0;
    const results: Array<{
      formName: string | null;
      pageUrl: string | null;
      inferredSource: string;
      count: number;
      patched: number;
    }> = [];

    for (const g of groups) {
      const inferredSource = inferWebsiteFormSource(g.formName, g.pageUrl);
      if (inferredSource === "Unknown") {
        // Still can't infer — leave it
        results.push({
          formName: g.formName,
          pageUrl: g.pageUrl,
          inferredSource: "Unknown (skipped)",
          count: g._count.id,
          patched: 0,
        });
        continue;
      }

      const result = await prisma.leadSourceRecord.updateMany({
        where: {
          sourceSystem: "WEBSITE",
          formName: g.formName === null ? { equals: null } : g.formName,
          pageUrl:  g.pageUrl  === null ? { equals: null } : g.pageUrl,
          websiteFormSource: { in: ["Unknown", ""] },
        },
        data: { websiteFormSource: inferredSource },
      });

      totalPatched += result.count;
      results.push({
        formName: g.formName,
        pageUrl: g.pageUrl,
        inferredSource,
        count: g._count.id,
        patched: result.count,
      });
    }

    return NextResponse.json({
      success: true,
      groupsProcessed: groups.length,
      totalPatched,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err), stack: err?.stack?.slice(0, 500) },
      { status: 500 },
    );
  }
}
