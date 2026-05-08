import { NextResponse } from "next/server";

const DB_PUSH_MSG = "Database schema is out of date. Run: npx prisma db push && npx prisma generate";

export async function withDb<T>(
  fn: () => Promise<T>,
  fallback: T,
  label = "API"
): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data);
  } catch (err: any) {
    // P2021 = table does not exist; P2002 = unique constraint; P1001 = can't reach DB
    const isPrismaSchemaError = err?.code === "P2021" || err?.message?.includes("does not exist");
    console.error(`[${label}]`, err?.message ?? err);
    return NextResponse.json(
      isPrismaSchemaError
        ? { ...((typeof fallback === "object" && fallback !== null) ? fallback as object : { data: fallback }), _error: DB_PUSH_MSG }
        : { ...((typeof fallback === "object" && fallback !== null) ? fallback as object : { data: fallback }), _error: err?.message ?? "Unknown error" },
      { status: 200 }
    );
  }
}
