import prisma from "./prisma";

export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  // Keep last 10 digits for North American numbers
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

const CLINIC_KEYWORDS: Record<string, string> = {
  toronto: "Toronto",
  midtown: "Toronto Midtown",
  yorkville: "Yorkville",
  mississauga: "Mississauga",
  oakville: "Oakville",
  whitby: "Whitby",
  scarborough: "Scarborough",
  newmarket: "Newmarket",
  vaughan: "Vaughan",
  thornhill: "Thornhill",
  etobicoke: "Etobicoke",
  burlington: "Burlington",
};

const SERVICE_KEYWORDS: Record<string, string> = {
  lhr: "Laser Hair Removal",
  laser: "Laser Hair Removal",
  "laser hair": "Laser Hair Removal",
  "laser hair removal": "Laser Hair Removal",
  "full body laser": "Laser Hair Removal",
  morpheus: "Morpheus8",
  morpheus8: "Morpheus8",
  "hair restoration": "Hair Restoration",
  "hair loss": "Hair Restoration",
  prp: "Hair Restoration",
  microneedling: "Microneedling",
  "micro needling": "Microneedling",
  "salmon dna": "Salmon DNA",
  pdrn: "Salmon DNA",
  "express facial": "Express Facial",
  facial: "Express Facial",
  botox: "Botox",
  "botulinum toxin": "Botox",
  filler: "Fillers",
  fillers: "Fillers",
  "lip filler": "Fillers",
  coolsculpting: "CoolSculpting",
  cryolipolysis: "CoolSculpting",
  "skin tightening": "Skin Tightening",
  "skin tight": "Skin Tightening",
  rf: "Skin Tightening",
  "radio frequency": "Skin Tightening",
};

const SOURCE_KEYWORDS: Record<string, string> = {
  facebook: "Meta",
  fb: "Meta",
  meta: "Meta",
  instagram: "Meta",
  ig: "Meta",
  "fb instant form": "Meta",
  "facebook lead": "Meta",
  wordpress: "WordPress",
  "website form": "WordPress",
  "web form": "WordPress",
  "contact form": "WordPress",
  "gravity forms": "WordPress",
  wpforms: "WordPress",
  "cf7": "WordPress",
  "contact form 7": "WordPress",
  elementor: "WordPress",
  "fluent forms": "WordPress",
  formidable: "WordPress",
  ghl: "GHL",
  "go high level": "GHL",
  "gohighlevel": "GHL",
  zenoti: "Zenoti",
};

let clinicMappingCache: Record<string, string> | null = null;
let serviceMappingCache: Record<string, string> | null = null;
let sourceMappingCache: Record<string, string> | null = null;

export async function loadMappingCaches() {
  const [clinics, services, sources] = await Promise.all([
    prisma.clinicMapping.findMany({ where: { active: true } }),
    prisma.serviceMapping.findMany({ where: { active: true } }),
    prisma.sourceMapping.findMany({ where: { active: true } }),
  ]);
  clinicMappingCache = Object.fromEntries(clinics.map((c) => [c.rawValue.toLowerCase(), c.normalizedValue]));
  serviceMappingCache = Object.fromEntries(services.map((s) => [s.rawValue.toLowerCase(), s.normalizedValue]));
  sourceMappingCache = Object.fromEntries(sources.map((s) => [s.rawValue.toLowerCase(), s.normalizedValue]));
}

export function normalizeClinicLocation(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.trim().toLowerCase();
  if (clinicMappingCache?.[key]) return clinicMappingCache[key];
  // Fuzzy keyword match
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

export function normalizeSource(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.trim().toLowerCase();
  if (sourceMappingCache?.[key]) return sourceMappingCache[key];
  for (const [kw, canonical] of Object.entries(SOURCE_KEYWORDS)) {
    if (key.includes(kw)) return canonical;
  }
  return value.trim();
}
