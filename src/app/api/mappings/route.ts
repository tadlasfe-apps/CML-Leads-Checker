export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const [clinics, services, websiteFormSources, websiteFormNames, metaLocations] = await Promise.all([
      prisma.clinicMapping.findMany({ orderBy: { rawValue: "asc" } }),
      prisma.serviceMapping.findMany({ orderBy: { rawValue: "asc" } }),
      prisma.websiteFormSourceMapping.findMany({ orderBy: { rawValue: "asc" } }),
      prisma.websiteFormNameMapping.findMany({ orderBy: { rawValue: "asc" } }),
      prisma.metaLocationMapping.findMany({ orderBy: [{ priority: "desc" }, { matchType: "asc" }, { matchValue: "asc" }] }),
    ]);
    return NextResponse.json({ clinics, services, websiteFormSources, websiteFormNames, metaLocations });
  } catch (err) {
    console.error("[/api/mappings GET]", err);
    return NextResponse.json(
      { clinics: [], services: [], websiteFormSources: [], websiteFormNames: [], metaLocations: [], _error: "DB error — run: npx prisma db push" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, rawValue, normalizedValue, formId, backendProvider } = body;

  try {
    let record;
    if (type === "clinic") {
      if (!rawValue || !normalizedValue) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      record = await prisma.clinicMapping.upsert({
        where: { rawValue },
        create: { rawValue, normalizedValue },
        update: { normalizedValue },
      });
    } else if (type === "service") {
      if (!rawValue || !normalizedValue) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      record = await prisma.serviceMapping.upsert({
        where: { rawValue },
        create: { rawValue, normalizedValue },
        update: { normalizedValue },
      });
    } else if (type === "websiteFormSource") {
      if (!rawValue || !normalizedValue) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      record = await prisma.websiteFormSourceMapping.upsert({
        where: { rawValue },
        create: { rawValue, normalizedValue },
        update: { normalizedValue },
      });
    } else if (type === "websiteFormName") {
      if (!rawValue || !normalizedValue) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      record = await prisma.websiteFormNameMapping.upsert({
        where: { rawValue },
        create: { rawValue, normalizedValue, formId, backendProvider },
        update: { normalizedValue, formId, backendProvider },
      });
    } else if (type === "metaLocation") {
      const { matchType, matchValue, normalizedValue: mappedClinicLocation, priority } = body;
      if (!matchType || !matchValue || !mappedClinicLocation) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      }
      record = await prisma.metaLocationMapping.upsert({
        where: { matchType_matchValue: { matchType, matchValue } },
        create: { matchType, matchValue, mappedClinicLocation, priority: priority ?? 0 },
        update: { mappedClinicLocation, priority: priority ?? 0 },
      });
    } else {
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }
    return NextResponse.json(record);
  } catch (err) {
    console.error("[/api/mappings POST]", err);
    return NextResponse.json({ error: "DB error — run: npx prisma db push" }, { status: 500 });
  }
}
