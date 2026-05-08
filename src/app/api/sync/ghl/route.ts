export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const GHL_BASE = "https://services.leadconnectorhq.com";
const PAGE_SIZE = 100;

export async function POST(req: NextRequest) {
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_LEAD_INQUIRY_PIPELINE_ID;
  const apiVersion = process.env.GHL_API_VERSION ?? "2021-07-28";

  if (!apiKey || !locationId) {
    return NextResponse.json(
      { error: "Missing GHL_API_KEY or GHL_LOCATION_ID in .env" },
      { status: 200 },
    );
  }

  if (!pipelineId) {
    return NextResponse.json(
      {
        error:
          "GHL_LEAD_INQUIRY_PIPELINE_ID is not set in .env. " +
          "Use the GHL Pipeline Lookup tool on this page to find your pipeline ID, then add it to your .env file.",
      },
      { status: 200 },
    );
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const from: string = body.from ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const to: string   = body.to   ?? new Date().toISOString().slice(0, 10);

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate   = new Date(to   + "T23:59:59Z");

  const syncRun = await prisma.syncRun.create({
    data: {
      sourceSystem: "GHL",
      syncType: "API",
      status: "RUNNING",
      dateRangeStart: fromDate,
      dateRangeEnd: toDate,
    },
  });

  try {
    const opportunities: any[] = [];
    let startAfterId: string | null = null;

    while (true) {
      const params = new URLSearchParams({
        location_id: locationId,
        pipeline_id: pipelineId,
        limit: String(PAGE_SIZE),
      });
      if (startAfterId) params.set("startAfterId", startAfterId);

      let res: Response;
      try {
        res = await fetch(`${GHL_BASE}/opportunities/search?${params}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Version: apiVersion,
            Accept: "application/json",
          },
          cache: "no-store",
        });
      } catch (err: any) {
        const cause = err?.cause;
        const detail = cause ? ` (${cause?.code ?? cause?.message ?? String(cause)})` : "";
        throw new Error(
          `Network error reaching GHL API: ${err?.message ?? "Unknown"}${detail}`,
        );
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `GHL API returned ${res.status}: check that GHL_API_KEY is valid and has read access to opportunities.`,
        );
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`GHL API error ${res.status}: ${errBody.slice(0, 300)}`);
      }

      const json = await res.json();
      const batch: any[] = json.opportunities ?? [];
      opportunities.push(...batch);

      const nextId: string | null = json.meta?.startAfterId ?? null;
      if (!nextId || batch.length < PAGE_SIZE) break;
      startAfterId = nextId;
    }

    // Filter by date range (server-side; GHL returns all pipeline records, we scope to the requested window)
    const filtered = opportunities.filter((opp) => {
      const dateStr = opp.createdAt ?? opp.dateAdded ?? opp.contactCreatedAt;
      if (!dateStr) return true;
      const d = new Date(dateStr);
      return d >= fromDate && d <= toDate;
    });

    let created = 0;
    let skipped = 0;

    const records = filtered.map((opp: any) => {
      const contact         = opp.contact ?? {};
      const opportunityId   = opp.id ?? undefined;
      const dateStr         = opp.createdAt ?? opp.dateAdded ?? opp.contactCreatedAt;
      const createdAt       = dateStr ? new Date(dateStr) : new Date();
      const fullName        =
        contact.name ??
        (`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || undefined);

      return {
        sourceSystem: "GHL" as const,
        recordType: "INDIVIDUAL_LEAD" as const,
        backendProvider: "GHL",
        externalId: opportunityId ? `GHL|${opportunityId}` : undefined,
        createdAtSource: createdAt,
        fullName,
        firstName: contact.firstName ?? undefined,
        lastName:  contact.lastName  ?? undefined,
        email:     contact.email     ?? undefined,
        phone:     contact.phone     ?? undefined,
        clinicLocationRaw: contact.locationName ?? undefined,
        serviceRaw: opp.name ?? undefined,
        ghlContactId:     contact.id ?? opp.contactId ?? undefined,
        ghlOpportunityId: opportunityId,
        ghlPipelineName:  opp.pipelineName ?? undefined,
        ghlPipelineId:    pipelineId,
        ghlStageName:     opp.stage?.name ?? undefined,
        ghlStageId:       opp.stage?.id   ?? undefined,
        rawPayload: opp,
      };
    });

    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const result = await prisma.leadSourceRecord.createMany({
        data: batch,
        skipDuplicates: true,
      });
      created += result.count;
      skipped += batch.length - result.count;
    }

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        recordsFetched: opportunities.length,
        recordsCreated: created,
        recordsSkipped: skipped,
      },
    });

    return NextResponse.json({
      success: true,
      fetched: opportunities.length,
      inDateRange: filtered.length,
      created,
      skipped,
      syncRunId: syncRun.id,
    });
  } catch (err: any) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: err?.message ?? "Unknown error",
      },
    });
    return NextResponse.json(
      { error: err?.message ?? "GHL pull failed", syncRunId: syncRun.id },
      { status: 200 },
    );
  }
}
