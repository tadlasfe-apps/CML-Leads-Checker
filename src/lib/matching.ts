import { normalizeEmail, normalizePhone, normalizeName } from "./normalization";

export interface MatchCandidate {
  id: string;
  normalizedPhone?: string | null;
  normalizedEmail?: string | null;
  fullName?: string | null;
  clinicLocationNormalized?: string | null;
  serviceNormalized?: string | null;
  createdAtSource?: Date | null;
}

export interface MatchResult {
  score: number;
  reasons: string[];
}

export function computeMatchScore(a: MatchCandidate, b: MatchCandidate): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  // Phone match: +40
  const phoneA = normalizePhone(a.normalizedPhone);
  const phoneB = normalizePhone(b.normalizedPhone);
  if (phoneA && phoneB && phoneA === phoneB) {
    score += 40;
    reasons.push("phone_match");
  }

  // Email match: +30
  const emailA = normalizeEmail(a.normalizedEmail);
  const emailB = normalizeEmail(b.normalizedEmail);
  if (emailA && emailB && emailA === emailB) {
    score += 30;
    reasons.push("email_match");
  }

  // Name match: +15
  const nameA = normalizeName(a.fullName);
  const nameB = normalizeName(b.fullName);
  if (nameA && nameB && nameA === nameB) {
    score += 15;
    reasons.push("name_match");
  } else if (nameA && nameB && partialNameMatch(nameA, nameB)) {
    score += 8;
    reasons.push("partial_name_match");
  }

  // Same clinic: +10
  if (
    a.clinicLocationNormalized &&
    b.clinicLocationNormalized &&
    a.clinicLocationNormalized === b.clinicLocationNormalized
  ) {
    score += 10;
    reasons.push("clinic_match");
  } else if (
    a.clinicLocationNormalized &&
    b.clinicLocationNormalized &&
    a.clinicLocationNormalized !== b.clinicLocationNormalized
  ) {
    score -= 20;
    reasons.push("clinic_mismatch");
  }

  // Same service: +10
  if (a.serviceNormalized && b.serviceNormalized && a.serviceNormalized === b.serviceNormalized) {
    score += 10;
    reasons.push("service_match");
  } else if (a.serviceNormalized && b.serviceNormalized && a.serviceNormalized !== b.serviceNormalized) {
    score -= 20;
    reasons.push("service_mismatch");
  }

  // Date proximity: +10 if within 48 hours
  if (a.createdAtSource && b.createdAtSource) {
    const diffMs = Math.abs(a.createdAtSource.getTime() - b.createdAtSource.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours <= 48) {
      score += 10;
      reasons.push("date_proximity_48h");
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function partialNameMatch(a: string, b: string): boolean {
  const partsA = a.split(" ").filter(Boolean);
  const partsB = b.split(" ").filter(Boolean);
  // At least one shared token of length >= 3
  return partsA.some((pa) => pa.length >= 3 && partsB.some((pb) => pb === pa));
}

export const MATCH_THRESHOLD = 70;

export function getMatchStatus(score: number): "MATCHED" | "POSSIBLE_MATCH" | "UNMATCHED" {
  if (score >= MATCH_THRESHOLD) return "MATCHED";
  if (score >= 40) return "POSSIBLE_MATCH";
  return "UNMATCHED";
}
