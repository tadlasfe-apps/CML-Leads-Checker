export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation";

export async function POST() {
  try {
    const result = await runReconciliation();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[/api/reconcile]", err?.message ?? err);
    return NextResponse.json({ success: false, error: err?.message ?? "Reconciliation failed" }, { status: 500 });
  }
}
