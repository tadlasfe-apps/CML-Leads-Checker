export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

const GHL_BASE = "https://services.leadconnectorhq.com";

export async function GET() {
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    return NextResponse.json(
      { error: "Missing credentials: GHL_API_KEY and GHL_LOCATION_ID must be set in .env" },
      { status: 200 }
    );
  }

  const apiVersion = process.env.GHL_API_VERSION ?? "2021-07-28";
  const requestUrl = `${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;

  let res: Response;
  try {
    res = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: apiVersion,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err: any) {
    const cause = (err as any)?.cause;
    const causeDetail = cause
      ? ` — ${cause?.code ?? cause?.message ?? String(cause)}`
      : "";
    return NextResponse.json(
      {
        error: `Network error reaching GHL API: ${err?.message ?? "Unknown"}${causeDetail}. Check that your server can reach services.leadconnectorhq.com on port 443.`,
        details: { causeCode: cause?.code, causeMessage: cause?.message },
        requestedUrl: requestUrl,
        hint: "This usually means DNS failed or the host is unreachable from your server. Try curl https://services.leadconnectorhq.com in a terminal to verify connectivity.",
      },
      { status: 200 }
    );
  }

  if (res.status === 401 || res.status === 403) {
    return NextResponse.json(
      {
        error: `GHL API returned ${res.status}: your API key is invalid or does not have read access to pipelines for this location.`,
        hint: "Verify GHL_API_KEY is a valid Private Integration token with read access, and GHL_LOCATION_ID matches the location.",
        requestedUrl: requestUrl,
      },
      { status: 200 }
    );
  }

  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    return NextResponse.json(
      {
        error: `GHL API error ${res.status}: ${body.slice(0, 300)}`,
        requestedUrl: requestUrl,
      },
      { status: 200 }
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    return NextResponse.json(
      {
        error: "GHL API returned a non-JSON response. The API key or location ID may be incorrect.",
        requestedUrl: requestUrl,
      },
      { status: 200 }
    );
  }

  // Normalise to a flat, predictable shape regardless of GHL response version
  const pipelines: Array<{
    id: string;
    name: string;
    stages: Array<{ id: string; name: string; position: number }>;
  }> = (json.pipelines ?? []).map((p: any) => ({
    id: p.id ?? "",
    name: p.name ?? "(Unnamed pipeline)",
    stages: (p.stages ?? [])
      .map((s: any) => ({
        id: s.id ?? "",
        name: s.name ?? "(Unnamed stage)",
        position: s.position ?? 0,
      }))
      .sort((a: any, b: any) => a.position - b.position),
  }));

  return NextResponse.json({ pipelines, locationId });
}
