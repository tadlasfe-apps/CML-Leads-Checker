export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  const website = !!(
    process.env.GRAVITY_FORMS_BASE_URL &&
    process.env.GRAVITY_FORMS_CONSUMER_KEY &&
    process.env.GRAVITY_FORMS_CONSUMER_SECRET
  );

  const meta = !!(
    process.env.META_ACCESS_TOKEN &&
    process.env.META_AD_ACCOUNT_IDS
  );

  const ghl = !!(
    process.env.GHL_API_KEY &&
    process.env.GHL_LOCATION_ID &&
    process.env.GHL_LEAD_INQUIRY_PIPELINE_ID
  );

  const ghlMissingPipelineId = !!(
    process.env.GHL_API_KEY &&
    process.env.GHL_LOCATION_ID &&
    !process.env.GHL_LEAD_INQUIRY_PIPELINE_ID
  );

  return NextResponse.json({ website, meta, ghl, ghlMissingPipelineId });
}
