import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation";

export async function POST() {
  const result = await runReconciliation();
  return NextResponse.json({ success: true, ...result });
}
