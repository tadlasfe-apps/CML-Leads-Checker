import { NextResponse } from "next/server";
import { getAllClinics, getAllServices } from "@/lib/data";

export async function GET() {
  const [clinics, services] = await Promise.all([getAllClinics(), getAllServices()]);
  return NextResponse.json({ clinics, services });
}
