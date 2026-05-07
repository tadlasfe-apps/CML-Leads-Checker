import { NextRequest, NextResponse } from "next/server";
import { parseWordPressCSV, parseMetaCSV, parseGHLCSV, parseZenotiCSV } from "@/lib/csv-parser";
import prisma from "@/lib/prisma";
import type { SourceSystem } from "@/types";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const source = formData.get("source") as SourceSystem | null;

  if (!file || !source) {
    return NextResponse.json({ error: "Missing file or source" }, { status: 400 });
  }

  const text = await file.text();
  let parsed;
  switch (source) {
    case "WORDPRESS": parsed = parseWordPressCSV(text); break;
    case "META": parsed = parseMetaCSV(text); break;
    case "GHL": parsed = parseGHLCSV(text); break;
    case "ZENOTI": parsed = parseZenotiCSV(text); break;
    default: return NextResponse.json({ error: "Unknown source" }, { status: 400 });
  }

  const valid = parsed.filter((r) => r.errors.length === 0);
  const invalid = parsed.filter((r) => r.errors.length > 0);
  const errors = invalid.flatMap((r) => r.errors).slice(0, 20);

  const batch = await prisma.importBatch.create({
    data: {
      sourceSystem: source,
      fileName: file.name,
      totalRows: parsed.length,
      validRows: valid.length,
      invalidRows: invalid.length,
      status: "PROCESSING",
      errorSummary: errors.length > 0 ? { errors } : undefined,
    },
  });

  let duplicateRows = 0;
  for (const lead of valid) {
    // Check duplicate by phone+source or email+source
    const existing = lead.normalizedPhone
      ? await prisma.leadSourceRecord.findFirst({
          where: { sourceSystem: source, normalizedPhone: lead.normalizedPhone },
        })
      : null;

    if (existing) {
      duplicateRows++;
      continue;
    }

    await prisma.leadSourceRecord.create({
      data: { ...lead, sourceSystem: source, importBatchId: batch.id, rawPayload: lead.rawPayload ?? undefined } as any,
    });
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { duplicateRows, status: "COMPLETED" },
  });

  return NextResponse.json({
    batchId: batch.id,
    totalRows: parsed.length,
    validRows: valid.length,
    invalidRows: invalid.length,
    duplicateRows,
    errors,
  });
}
