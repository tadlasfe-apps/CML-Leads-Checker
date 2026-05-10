import prisma from "./prisma";

// ─── Safe string helpers ───────────────────────────────────────────────────────

export function toSafeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return (value as unknown[]).map(toSafeString).filter(Boolean).join(" ");
  if (typeof value === "object") return JSON.stringify(value);
  return "";
}

export function normalizeLower(value: unknown): string {
  return toSafeString(value).trim().toLowerCase();
}

// ─── Basic normalizers ────────────────────────────────────────────────────────

export function normalizeEmail(email: unknown): string {
  const s = toSafeString(email).trim();
  if (!s) return "";
  return s.toLowerCase();
}

export function normalizePhone(phone: unknown): string {
  const s = toSafeString(phone);
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeName(name: unknown): string {
  const s = toSafeString(name).trim();
  if (!s) return "";
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "");
}

// ─── Keyword maps ─────────────────────────────────────────────────────────────

const CLINIC_KEYWORDS: Record<string, string> = {
  "toronto midtown": "Toronto Midtown",
  midtown: "Toronto Midtown",
  toronto: "Toronto",
  yorkville: "Yorkville",
  mississauga: "Mississauga",
  oakville: "Oakville",
  whitby: "Whitby",
  scarborough: "Scarborough",
  newmarket: "Newmarket",
  vaughan: "Vaughan",
  "richmond hill": "Richmond Hill",
  thornhill: "Thornhill",
  etobicoke: "Etobicoke",
  "north york": "North York",
  burlington: "Burlington",
  hamilton: "Hamilton",
  kitchener: "Kitchener",
  london: "London",
};

const SERVICE_KEYWORDS: Record<string, string> = {
  "laser hair removal": "Laser Hair Removal",
  "full body laser": "Laser Hair Removal",
  "laser hair": "Laser Hair Removal",
  lhr: "Laser Hair Removal",
  laser: "Laser Hair Removal",
  morpheus8: "Morpheus8",
  morpheus: "Morpheus8",
  "hair restoration": "Hair Restoration",
  "hair loss": "Hair Restoration",
  "hair growth": "Hair Restoration",
  "prp hair": "Hair Restoration",
  microneedling: "Microneedling",
  "micro needling": "Microneedling",
  "rf microneedling": "Microneedling",
  "salmon dna": "Salmon DNA",
  pdrn: "Salmon DNA",
  "express facial": "Express Facial",
  "$69 facial": "Express Facial",
  botox: "Botox",
  "anti-wrinkle": "Botox",
  filler: "Fillers",
  fillers: "Fillers",
  "lip filler": "Fillers",
  "cheek filler": "Fillers",
  "dermal filler": "Fillers",
  coolsculpting: "CoolSculpting",
  "fat freezing": "CoolSculpting",
  "skin tightening": "Skin Tightening",
  radiofrequency: "Skin Tightening",
  "rf skin": "Skin Tightening",
};

const WEBSITE_FORM_SOURCE_KEYWORDS: Record<string, string> = {
  popup: "Popup",
  "pop up": "Popup",
  "exit popup": "Exit Intent Popup",
  "exit intent": "Exit Intent Popup",
  "exit-intent": "Exit Intent Popup",
  quiz: "Website Quiz",
  "website quiz": "Website Quiz",
  "skin quiz": "Website Quiz",
  "landing page": "Landing Page Form",
  "lp form": "Landing Page Form",
  "landing form": "Landing Page Form",
  contact: "Contact Form",
  "contact form": "Contact Form",
  "free consultation": "Free Consultation Form",
  consultation: "Free Consultation Form",
  "service page": "Service Page Form",
  "treatment page": "Service Page Form",
  promo: "Promo Page Form",
  "promo page": "Promo Page Form",
  "promo form": "Promo Page Form",
};

// Acceptable Meta lead result type labels
const META_LEAD_RESULT_LABELS = new Set([
  "lead",
  "leads",
  "on-facebook leads",
  "on-facebook lead",
  "website leads",
  "website lead",
  "messaging leads",
  "messaging lead",
  "conversion leads",
  "conversion lead",
  "instant form leads",
  "instant form lead",
  "instant form",
]);

// ─── Cache ────────────────────────────────────────────────────────────────────

let clinicMappingCache: Record<string, string> | null = null;
let serviceMappingCache: Record<string, string> | null = null;
let formSourceMappingCache: Record<string, string> | null = null;
let formNameMappingCache: Record<string, string> | null = null;

export async function loadMappingCaches() {
  const [clinics, services, formSources, formNames] = await Promise.all([
    prisma.clinicMapping.findMany({ where: { active: true } }),
    prisma.serviceMapping.findMany({ where: { active: true } }),
    prisma.websiteFormSourceMapping.findMany({ where: { active: true } }),
    prisma.websiteFormNameMapping.findMany({ where: { active: true } }),
  ]);
  clinicMappingCache    = Object.fromEntries(clinics.map((c) => [toSafeString(c.rawValue).toLowerCase(), c.normalizedValue]));
  serviceMappingCache   = Object.fromEntries(services.map((s) => [toSafeString(s.rawValue).toLowerCase(), s.normalizedValue]));
  formSourceMappingCache = Object.fromEntries(formSources.map((f) => [toSafeString(f.rawValue).toLowerCase(), f.normalizedValue]));
  formNameMappingCache  = Object.fromEntries(formNames.map((f) => [toSafeString(f.rawValue).toLowerCase(), f.normalizedValue]));
}

export function clearMappingCaches() {
  clinicMappingCache    = null;
  serviceMappingCache   = null;
  formSourceMappingCache = null;
  formNameMappingCache  = null;
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

export function normalizeClinicLocation(value: unknown): string {
  const s = toSafeString(value).trim();
  if (!s) return "Unknown";
  const key = s.toLowerCase();
  if (clinicMappingCache?.[key]) return clinicMappingCache[key];
  for (const [kw, canonical] of Object.entries(CLINIC_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  return s;
}

export function normalizeService(value: unknown): string {
  const s = toSafeString(value).trim();
  if (!s) return "Other";
  const key = s.toLowerCase();
  if (serviceMappingCache?.[key]) return serviceMappingCache[key];
  for (const [kw, canonical] of Object.entries(SERVICE_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  return s;
}

export function normalizeWebsiteFormSource(value: unknown): string {
  const s = toSafeString(value).trim();
  if (!s) return "Unknown";
  const key = s.toLowerCase();
  if (formSourceMappingCache?.[key]) return formSourceMappingCache[key];
  for (const [kw, canonical] of Object.entries(WEBSITE_FORM_SOURCE_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  return s || "Unknown";
}

export function normalizeWebsiteFormName(value: unknown): string {
  const s = toSafeString(value).trim();
  if (!s) return "Unknown";
  const key = s.toLowerCase();
  if (formNameMappingCache?.[key]) return formNameMappingCache[key];
  return s;
}

/**
 * Determines whether a Meta result type/conversion goal represents a Lead result.
 * Returns the normalized lead label, or null if it is NOT a lead result.
 */
export function normalizeMetaResultType(resultType: unknown): string | null {
  const s = toSafeString(resultType).trim();
  if (!s) return null;
  const key = s.toLowerCase();
  if (META_LEAD_RESULT_LABELS.has(key)) return s;
  return null;
}

/**
 * Infers websiteFormSource from form name or page URL when no explicit source field is present.
 */
export function inferWebsiteFormSource(
  formName: unknown,
  pageUrl: unknown,
): string {
  const name = normalizeLower(formName);
  const url  = normalizeLower(pageUrl);

  if (name.includes("quiz") || name.includes("multi step") || url.includes("quiz"))                          return "Website Quiz";
  if (name.includes("popup") || name.includes("pop-up") || name.includes("pop up") || url.includes("popup")) return "Popup";
  if (name.includes("exit intent") || name.includes("exit-intent"))                                          return "Exit Intent Popup";
  if (name.includes("franchise"))                                                                             return "Franchise Form";
  if (name.includes("location single") || name.includes("location form") ||
      name.includes("location page") || url.includes("/location"))                                           return "Location Form";
  if (name.includes("landing") || url.includes("/lp/") || url.includes("/landing"))                         return "Landing Page Form";
  if (name.includes("promo") || url.includes("/promo"))                                                      return "Promo Page Form";
  if (name.includes("free consultation") || name.includes("book a free"))                                    return "Free Consultation Form";
  if (name.includes("contact"))                                                                               return "Contact Form";
  if (name.includes("service") || name.includes("treatment"))                                                return "Service Page Form";
  return "Unknown";
}

/**
 * Website form sources that should be excluded from lead counts throughout the app.
 * Entries from these sources appear in the table with an "Excluded" status but are
 * not counted in KPI totals or cross-source comparisons.
 */
export const EXCLUDED_WEBSITE_FORM_SOURCES: string[] = ["Franchise Form"];

// ─── Meta Clinic Location Inference ──────────────────────────────────────────

export const CORPORATE_META_ACCOUNTS = [
  "canada medlaser corporate",
  "cml corporate",
  "corporate",
  "canada medlaser clinics",
  "canada medlaser",
];

// Direct account-name → clinic map (keyed lowercase)
const META_ACCOUNT_CLINIC_MAP: Record<string, string> = {
  "cml queen west":       "Queen West",
  "cml thornhill":        "Thornhill",
  "cml yorkville":        "Yorkville",
  "cml oakville":         "Oakville",
  "cml burlington":       "Burlington",
  "cml scarborough new":  "Scarborough",
  "cml scarborough":      "Scarborough",
  "cml newmarket":        "Newmarket",
  "cml richmond hill":    "Richmond Hill",
  "cml mississauga":      "Mississauga",
  "cml maple":            "Maple",
  "cml whitby":           "Whitby",
  "cml ajax":             "Ajax",
  "cml pickering":        "Pickering",
  "cml north york":       "North York",
  "cml downtown toronto": "Downtown Toronto",
  "cml etobicoke":        "Etobicoke",
  "cml vaughan":          "Vaughan",
  "cml midtown":          "Midtown",
  "cml toronto midtown":  "Midtown",
  "cml toronto yorkville":"Yorkville",
  "cml toronto queen west":"Queen West",
  "cml toronto":          "Toronto",
};

// Ordered keyword list for scanning campaign/adset/ad names
// More specific keywords must come before shorter substrings
export const META_CAMPAIGN_CLINIC_KEYWORDS: [string, string][] = [
  ["queen west",      "Queen West"],
  ["scarborough new", "Scarborough"],
  ["toronto midtown", "Midtown"],
  ["toronto yorkville","Yorkville"],
  ["downtown toronto","Downtown Toronto"],
  ["north york",      "North York"],
  ["richmond hill",   "Richmond Hill"],
  ["midtown",         "Midtown"],
  ["yorkville",       "Yorkville"],
  ["thornhill",       "Thornhill"],
  ["vaughan",         "Vaughan"],
  ["oakville",        "Oakville"],
  ["burlington",      "Burlington"],
  ["etobicoke",       "Etobicoke"],
  ["scarborough",     "Scarborough"],
  ["newmarket",       "Newmarket"],
  ["mississauga",     "Mississauga"],
  ["maple",           "Maple"],
  ["whitby",          "Whitby"],
  ["ajax",            "Ajax"],
  ["pickering",       "Pickering"],
  ["toronto",         "Toronto"],
];

function scanForClinic(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [kw, normalized] of META_CAMPAIGN_CLINIC_KEYWORDS) {
    if (lower.includes(kw)) return normalized;
  }
  return null;
}

export interface MetaLocationManualMapping {
  matchType: string;
  matchValue: string;
  mappedClinicLocation: string;
  priority?: number;
}

/**
 * Infers clinicLocationRaw and clinicLocationNormalized for a Meta ad record.
 *
 * Priority:
 * 1. Manual override mappings (DB-loaded, sorted by priority desc)
 * 2. If account is clinic-specific → map from account name
 * 3. If account is corporate/shared → scan campaign name, then adset, then ad name
 * 4. Unknown
 */
export function inferClinicFromMetaRecord(
  accountName: string | null | undefined,
  campaignName: string | null | undefined,
  adSetName?: string | null,
  adName?: string | null,
  manualMappings: MetaLocationManualMapping[] = [],
): { raw: string; normalized: string } {
  const accLow  = normalizeLower(accountName);
  const campLow = normalizeLower(campaignName);
  const adsetLow = normalizeLower(adSetName);
  const adLow   = normalizeLower(adName);

  // 1. Manual overrides — check in priority order (already sorted by caller)
  for (const m of manualMappings) {
    if (!m.mappedClinicLocation) continue;
    const mv = m.matchValue.toLowerCase();
    if (m.matchType === "accountName"  && accLow.includes(mv))  return { raw: accountName  ?? m.mappedClinicLocation, normalized: m.mappedClinicLocation };
    if (m.matchType === "campaignName" && campLow.includes(mv)) return { raw: campaignName ?? m.mappedClinicLocation, normalized: m.mappedClinicLocation };
    if (m.matchType === "adSetName"    && adsetLow.includes(mv))return { raw: adSetName    ?? m.mappedClinicLocation, normalized: m.mappedClinicLocation };
    if (m.matchType === "adName"       && adLow.includes(mv))   return { raw: adName       ?? m.mappedClinicLocation, normalized: m.mappedClinicLocation };
  }

  // 2. Corporate account check
  const isCorporate = CORPORATE_META_ACCOUNTS.some((c) => accLow === c || accLow.includes(c));

  if (!isCorporate && accountName) {
    // Direct map from account name
    const direct = META_ACCOUNT_CLINIC_MAP[accLow];
    if (direct) return { raw: accountName, normalized: direct };
    // Keyword scan on account name
    const kw = scanForClinic(accountName);
    if (kw) return { raw: accountName, normalized: kw };
  }

  // 3. Scan campaign name
  if (campaignName) {
    const kw = scanForClinic(campaignName);
    if (kw) return { raw: campaignName, normalized: kw };
  }

  // 4. Scan ad set name
  if (adSetName) {
    const kw = scanForClinic(adSetName);
    if (kw) return { raw: adSetName, normalized: kw };
  }

  // 5. Scan ad name
  if (adName) {
    const kw = scanForClinic(adName);
    if (kw) return { raw: adName, normalized: kw };
  }

  return { raw: accountName ?? campaignName ?? "Unknown", normalized: "Unknown" };
}

export function isUnmappedClinic(value: string): boolean {
  return value === "Unknown" || value === "";
}

export function isUnmappedService(value: string): boolean {
  return value === "Other" || value === "";
}

export function safeLocaleCompare(a: unknown, b: unknown): number {
  return toSafeString(a).localeCompare(toSafeString(b));
}

// Meta action types that must NEVER be counted as Meta Leads.
// Only action_type = "lead" is valid. These are excluded from all metaLeadCount queries
// to prevent double-counting with onsite_conversion.lead_grouped and similar variants.
export const EXCLUDED_META_ACTION_TYPES: string[] = [
  "onsite_conversion.lead_grouped",
  "leadgen_grouped",
  "offsite_conversion.fb_pixel_lead",
  "offsite_conversion.lead",
  "website_lead",
  "omni_lead",
  "onsite_conversion.lead",
  "onsite_conversion.messaging_lead",
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.messaging_user_subscribed",
  "offsite_conversion.fb_pixel_custom",
  "leadgen_other",
  "contact_total",
];
