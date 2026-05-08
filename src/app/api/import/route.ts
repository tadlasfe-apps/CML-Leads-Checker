export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { parseCSV, type ParsedSourceSystem } from "@/lib/csv-parser";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  const source = formData.get("source") as ParsedSourceSystem | null;

  if (!file || !source) {
    return NextResponse.json({ error: "Missing file or source" }, { status: 400 });
  }

  const validSources: ParsedSourceSystem[] = ["WEBSITE", "META", "GHL", "ZENOTI"];
  if (!validSources.includes(source)) {
    return NextResponse.json({ error: "Unknown source system" }, { status: 400 });
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "Could not read file" }, { status: 400 });
  }
  const { records, invalidRows: parseInvalidRows, errors: parseErrors } = parseCSV(text, source);

  const validRecords = records.filter((r) => !r._dateInvalid);
  const invalidCount = parseInvalidRows + records.filter((r) => r._dateInvalid).length;

  let unmappedClinicRows = 0;
  let unmappedServiceRows = 0;
  let unmappedFormSourceRows = 0;
  let minDate: Date | undefined;
  let maxDate: Date | undefined;

  for (const r of validRecords) {
    if (r._unmappedClinic) unmappedClinicRows++;
    if (r._unmappedService) unmappedServiceRows++;
    if (r._unmappedFormSource) unmappedFormSourceRows++;
    const d = r.reportDate ?? r.createdAtSource;
    if (d) {
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
  }

  const errors = parseErrors.slice(0, 30);

  try {
  const batch = await prisma.importBatch.create({
    data: {
      sourceSystem: source,
      fileName: file.name,
      totalRows: records.length + parseInvalidRows,
      validRows: validRecords.length,
      invalidRows: invalidCount,
      unmappedClinicRows,
      unmappedServiceRows,
      unmappedFormSourceRows,
      importedDateRangeStart: minDate,
      importedDateRangeEnd: maxDate,
      status: "PROCESSING",
      errorSummary: errors.length > 0 ? { errors } : undefined,
    },
  });

  let duplicateRows = 0;
  const toCreate: any[] = [];

  for (const record of validRecords) {
    // Skip-duplicate logic for aggregate Meta rows: use externalId uniqueness
    if (source === "META" && record.externalId) {
      const exists = await prisma.leadSourceRecord.findFirst({
        where: { sourceSystem: "META", externalId: record.externalId },
        select: { id: true },
      });
      if (exists) { duplicateRows++; continue; }
    }

    // For individual leads: phone/email+source dedup
    if (source !== "META" && record.externalId) {
      const exists = await prisma.leadSourceRecord.findFirst({
        where: { sourceSystem: source, externalId: record.externalId },
        select: { id: true },
      });
      if (exists) { duplicateRows++; continue; }
    }

    const { _unmappedClinic, _unmappedService, _unmappedFormSource, _dateInvalid, ...rest } = record;
    toCreate.push({ ...rest, sourceSystem: source, importBatchId: batch.id });
  }

  if (toCreate.length > 0) {
    await prisma.leadSourceRecord.createMany({ data: toCreate as any, skipDuplicates: true });
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { duplicateRows, validRows: toCreate.length, status: "COMPLETED" },
  });

  return NextResponse.json({
    batchId: batch.id,
    totalRows: records.length + parseInvalidRows,
    validRows: toCreate.length,
    invalidRows: invalidCount,
    duplicateRows,
    unmappedClinicRows,
    unmappedServiceRows,
    unmappedFormSourceRows,
    importedDateRangeStart: minDate?.toISOString().slice(0, 10) ?? null,
    importedDateRangeEnd: maxDate?.toISOString().slice(0, 10) ?? null,
    errors,
  });
  } catch (err: any) {
    console.error("[/api/import POST]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Database error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const history = await prisma.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(history);
  } catch (err: any) {
    console.error("[/api/import GET]", err?.message ?? err);
    return NextResponse.json([], { status: 200 });
  }
}
