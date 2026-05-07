import prisma from "./prisma";

export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "");
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
  clinicMappingCache = Object.fromEntries(clinics.map((c) => [c.rawValue.toLowerCase(), c.normalizedValue]));
  serviceMappingCache = Object.fromEntries(services.map((s) => [s.rawValue.toLowerCase(), s.normalizedValue]));
  formSourceMappingCache = Object.fromEntries(formSources.map((f) => [f.rawValue.toLowerCase(), f.normalizedValue]));
  formNameMappingCache = Object.fromEntries(formNames.map((f) => [f.rawValue.toLowerCase(), f.normalizedValue]));
}

export function clearMappingCaches() {
  clinicMappingCache = null;
  serviceMappingCache = null;
  formSourceMappingCache = null;
  formNameMappingCache = null;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeClinicLocation(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.trim().toLowerCase();
  if (clinicMappingCache?.[key]) return clinicMappingCache[key];
  for (const [kw, canonical] of Object.entries(CLINIC_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  return value.trim();
}

export function normalizeService(value: string | null | undefined): string {
  if (!value) return "Other";
  const key = value.trim().toLowerCase();
  if (serviceMappingCache?.[key]) return serviceMappingCache[key];
  for (const [kw, canonical] of Object.entries(SERVICE_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  return value.trim();
}

export function normalizeWebsiteFormSource(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.trim().toLowerCase();
  if (formSourceMappingCache?.[key]) return formSourceMappingCache[key];
  for (const [kw, canonical] of Object.entries(WEBSITE_FORM_SOURCE_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  // Infer from form name or URL patterns
  return value.trim() || "Unknown";
}

export function normalizeWebsiteFormName(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.trim().toLowerCase();
  if (formNameMappingCache?.[key]) return formNameMappingCache[key];
  return value.trim();
}

/**
 * Determines whether a Meta result type/conversion goal represents a Lead result.
 * Returns the normalized lead label, or null if it is NOT a lead result.
 */
export function normalizeMetaResultType(resultType: string | null | undefined): string | null {
  if (!resultType) return null;
  const key = resultType.trim().toLowerCase();
  if (META_LEAD_RESULT_LABELS.has(key)) return resultType.trim();
  return null;
}

/**
 * Infers websiteFormSource from form name or page URL when no explicit source field is present.
 */
export function inferWebsiteFormSource(
  formName: string | null | undefined,
  pageUrl: string | null | undefined
): string {
  const name = (formName || "").toLowerCase();
  const url = (pageUrl || "").toLowerCase();

  if (name.includes("quiz") || url.includes("quiz")) return "Website Quiz";
  if (name.includes("popup") || name.includes("pop-up") || url.includes("popup")) return "Popup";
  if (name.includes("exit intent") || name.includes("exit-intent")) return "Exit Intent Popup";
  if (name.includes("landing") || url.includes("/lp/") || url.includes("/landing")) return "Landing Page Form";
  if (name.includes("promo") || url.includes("/promo")) return "Promo Page Form";
  if (name.includes("free consultation") || name.includes("book a free")) return "Free Consultation Form";
  if (name.includes("contact")) return "Contact Form";
  if (name.includes("service") || name.includes("treatment")) return "Service Page Form";
  return "Unknown";
}

export function isUnmappedClinic(value: string): boolean {
  return value === "Unknown" || value === "";
}

export function isUnmappedService(value: string): boolean {
  return value === "Other" || value === "";
}
