import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const history = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(history);
}
