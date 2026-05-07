import { NextResponse } from "next/server";
import { getImportHistory } from "@/lib/data";

export async function GET() {
  const data = await getImportHistory();
  return NextResponse.json(data);
}
