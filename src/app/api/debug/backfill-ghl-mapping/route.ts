export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  inferClinicFromGhlRecord,
  inferServiceFromGhlRecord,
} from "@/lib/normalization";

export async function POST() {
  try {
    // Fetch all GHL records — we re-infer from rawPayload regardless of existing values
    // so that any previous incorrect/missing mapping is corrected.
    const recs = await prisma.leadSourceRecord.findMany({
      where: { sourceSystem: "GHL" },
      select: {
        id:                       true,
        rawPayload:               true,
        clinicLocationNormalized: true,
        serviceNormalized:        true,
        // Fallback fields used when rawPayload is sparse
        clinicLocationRaw:        true,
        serviceRaw:               true,
        ghlStageName:             true,
        campaignName:             true,
        leadSource:               true,
      },
    });

    let clinicPatched   = 0;
    let servicePatched  = 0;
    let bothPatched     = 0;
    let noChange        = 0;
    let unknownClinic   = 0;
    let unknownService  = 0;

    const CHUNK = 50;
    for (let i = 0; i < recs.length; i += CHUNK) {
      const chunk = recs.slice(i, i + CHUNK);

      for (const r of chunk) {
        // Build a synthetic "opp" object: prefer rawPayload, supplement with stored fields
        const payload = r.rawPayload as Record<string, unknown> | null ?? {};

        // Enrich with stored scalar fields if rawPayload is sparse
        const synthetic: Record<string, unknown> = {
          ...payload,
          name:     payload["name"]     ?? r.serviceRaw ?? undefined,
          source:   payload["source"]   ?? r.leadSource ?? undefined,
          campaignName: payload["campaignName"] ?? r.campaignName ?? undefined,
          stage: payload["stage"] ?? (r.ghlStageName ? { name: r.ghlStageName } : undefined),
          contact: {
            ...(typeof payload["contact"] === "object" && payload["contact"] ? payload["contact"] as Record<string, unknown> : {}),
            locationName: (payload["contact"] as Record<string, unknown> | undefined)?.["locationName"]
              ?? r.clinicLocationRaw ?? undefined,
          },
        };

        const clinicInferred  = inferClinicFromGhlRecord(synthetic);
        const serviceInferred = inferServiceFromGhlRecord(synthetic);

        const newClinic  = clinicInferred.normalized;
        const newService = serviceInferred.normalized;

        if (newClinic  === "Unknown") unknownClinic++;
        if (newService === "Unknown") unknownService++;

        const clinicChanged  = newClinic  !== r.clinicLocationNormalized;
        const serviceChanged = newService !== r.serviceNormalized;

        if (!clinicChanged && !serviceChanged) { noChange++; continue; }

        await prisma.leadSourceRecord.update({
          where: { id: r.id },
          data: {
            ...(clinicChanged  ? { clinicLocationNormalized: newClinic,  clinicLocationRaw: clinicInferred.raw  ?? r.clinicLocationRaw ?? undefined } : {}),
            ...(serviceChanged ? { serviceNormalized:        newService, serviceRaw:        serviceInferred.raw ?? r.serviceRaw        ?? undefined } : {}),
          },
        });

        if (clinicChanged  && serviceChanged) bothPatched++;
        else if (clinicChanged)  clinicPatched++;
        else if (serviceChanged) servicePatched++;
      }
    }

    const total = recs.length;
    return NextResponse.json({
      total,
      clinicPatched,
      servicePatched,
      bothPatched,
      noChange,
      unknownClinic,
      unknownService,
      // sample of first 5 for diagnostic display
      sample: recs.slice(0, 5).map((r) => {
        const syn: Record<string, unknown> = {
          ...(r.rawPayload as Record<string, unknown> ?? {}),
          stage: r.ghlStageName ? { name: r.ghlStageName } : undefined,
        };
        const c = inferClinicFromGhlRecord(syn);
        const s = inferServiceFromGhlRecord(syn);
        return {
          id:                       r.id,
          clinicLocationRaw:        c.raw        ?? r.clinicLocationRaw,
          clinicLocationNormalized: c.normalized,
          serviceRaw:               s.raw        ?? r.serviceRaw,
          serviceNormalized:        s.normalized,
          ghlStageName:             r.ghlStageName,
        };
      }),
    });
  } catch (err: any) {
    console.error("[/api/debug/backfill-ghl-mapping]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
