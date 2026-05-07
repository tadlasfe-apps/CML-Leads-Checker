import prisma from "./prisma";
import { computeMatchScore, getMatchStatus, MATCH_THRESHOLD } from "./matching";

export async function runReconciliation(): Promise<{ matched: number; possible: number; unmatched: number }> {
  // Load all leads grouped by source
  const allLeads = await prisma.leadSourceRecord.findMany({
    select: {
      id: true,
      sourceSystem: true,
      normalizedPhone: true,
      normalizedEmail: true,
      fullName: true,
      clinicLocationNormalized: true,
      serviceNormalized: true,
      createdAtSource: true,
    },
  });

  const wordpress = allLeads.filter((l) => l.sourceSystem === "WORDPRESS");
  const meta = allLeads.filter((l) => l.sourceSystem === "META");
  const ghl = allLeads.filter((l) => l.sourceSystem === "GHL");
  const zenoti = allLeads.filter((l) => l.sourceSystem === "ZENOTI");

  const sourceleads = [...wordpress, ...meta];
  let matched = 0, possible = 0, unmatched = 0;

  // Clear existing matches
  await prisma.leadMatch.deleteMany({});

  const matchCreates: {
    primaryLeadId: string;
    matchedLeadId: string;
    matchScore: number;
    matchStatus: "MATCHED" | "POSSIBLE_MATCH" | "UNMATCHED" | "DUPLICATE" | "NEEDS_REVIEW";
    matchReasons: { type: string };
  }[] = [];

  // Match source leads → GHL
  for (const src of sourceleads) {
    let bestScore = 0;
    let bestGhl = null;

    for (const g of ghl) {
      const { score } = computeMatchScore(src, g);
      if (score > bestScore) {
        bestScore = score;
        bestGhl = g;
      }
    }

    const status = getMatchStatus(bestScore);
    if (bestGhl) {
      matchCreates.push({
        primaryLeadId: src.id,
        matchedLeadId: bestGhl.id,
        matchScore: bestScore,
        matchStatus: status,
        matchReasons: { type: "source_to_ghl" },
      });
    }

    if (status === "MATCHED") matched++;
    else if (status === "POSSIBLE_MATCH") possible++;
    else unmatched++;
  }

  // Match GHL → Zenoti
  for (const g of ghl) {
    let bestScore = 0;
    let bestZenoti = null;

    for (const z of zenoti) {
      const { score } = computeMatchScore(g, z);
      if (score > bestScore) {
        bestScore = score;
        bestZenoti = z;
      }
    }

    if (bestZenoti) {
      matchCreates.push({
        primaryLeadId: g.id,
        matchedLeadId: bestZenoti.id,
        matchScore: bestScore,
        matchStatus: getMatchStatus(bestScore),
        matchReasons: { type: "ghl_to_zenoti" },
      });
    }
  }

  // Batch insert matches (skip duplicates)
  const seen = new Set<string>();
  const deduped = matchCreates.filter((m) => {
    const key = `${m.primaryLeadId}::${m.matchedLeadId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length > 0) {
    await prisma.leadMatch.createMany({ data: deduped, skipDuplicates: true });
  }

  // Detect duplicates within same source
  await detectDuplicates(wordpress, "WORDPRESS", 7);
  await detectDuplicates(meta, "META", 7);

  // Rebuild WordPress form summaries
  await rebuildWordPressSummaries();

  return { matched, possible, unmatched };
}

async function detectDuplicates(
  leads: { id: string; normalizedPhone?: string | null; normalizedEmail?: string | null; createdAtSource?: Date | null; clinicLocationNormalized?: string | null; serviceNormalized?: string | null; fullName?: string | null }[],
  _source: string,
  windowDays: number
) {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const duplicateIds = new Set<string>();

  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const a = leads[i], b = leads[j];
      if (!a.normalizedPhone && !a.normalizedEmail) continue;

      const phoneMatch = a.normalizedPhone && b.normalizedPhone && a.normalizedPhone === b.normalizedPhone;
      const emailMatch = a.normalizedEmail && b.normalizedEmail && a.normalizedEmail === b.normalizedEmail;

      if (!phoneMatch && !emailMatch) continue;

      const withinWindow =
        !a.createdAtSource ||
        !b.createdAtSource ||
        Math.abs(a.createdAtSource.getTime() - b.createdAtSource.getTime()) <= windowMs;

      if (withinWindow) duplicateIds.add(b.id);
    }
  }

  if (duplicateIds.size > 0) {
    await prisma.leadSourceRecord.updateMany({
      where: { id: { in: Array.from(duplicateIds) } },
      data: { isDuplicate: true },
    });
  }
}

async function rebuildWordPressSummaries() {
  const forms = await prisma.leadSourceRecord.groupBy({
    by: ["formName"],
    where: { sourceSystem: "WORDPRESS", formName: { not: null } },
    _count: { id: true },
  });

  for (const f of forms) {
    if (!f.formName) continue;

    const leads = await prisma.leadSourceRecord.findMany({
      where: { sourceSystem: "WORDPRESS", formName: f.formName },
      select: { id: true, isDuplicate: true, createdAtSource: true, pageUrl: true, formId: true, wordpressFormPlugin: true },
    });

    const ids = leads.map((l) => l.id);
    const total = ids.length;
    const dupes = leads.filter((l) => l.isDuplicate).length;
    const unique = total - dupes;

    const ghlMatches = await prisma.leadMatch.count({
      where: {
        primaryLeadId: { in: ids },
        matchStatus: "MATCHED",
        matchReasons: { path: ["type"], equals: "source_to_ghl" },
      },
    });

    const ghlPossible = await prisma.leadMatch.count({
      where: {
        primaryLeadId: { in: ids },
        matchStatus: "POSSIBLE_MATCH",
        matchReasons: { path: ["type"], equals: "source_to_ghl" },
      },
    });

    const ghlMatched = ghlMatches + ghlPossible;
    const missingGhl = Math.max(0, unique - ghlMatched);

    // For Zenoti, find GHL ids matched to this form's leads, then check Zenoti
    const ghlMatchRecords = await prisma.leadMatch.findMany({
      where: {
        primaryLeadId: { in: ids },
        matchStatus: { in: ["MATCHED", "POSSIBLE_MATCH"] },
        matchReasons: { path: ["type"], equals: "source_to_ghl" },
      },
      select: { matchedLeadId: true },
    });

    const ghlIds = ghlMatchRecords.map((m) => m.matchedLeadId);
    const zenotiMatched = ghlIds.length > 0
      ? await prisma.leadMatch.count({
          where: {
            primaryLeadId: { in: ghlIds },
            matchStatus: { in: ["MATCHED", "POSSIBLE_MATCH"] },
          },
        })
      : 0;
    const missingZenoti = Math.max(0, ghlIds.length - zenotiMatched);

    const ghlRate = unique > 0 ? (ghlMatched / unique) * 100 : 0;
    const zenotiRate = unique > 0 ? (zenotiMatched / unique) * 100 : 0;
    const reconcRate = Math.min(ghlRate, zenotiRate);

    let status: "HEALTHY" | "MINOR_DISCREPANCY" | "MAJOR_DISCREPANCY" | "MISSING_GHL" | "MISSING_ZENOTI" | "DUPLICATE_ISSUE" | "NEEDS_REVIEW" = "NEEDS_REVIEW";
    const dupeRate = total > 0 ? (dupes / total) * 100 : 0;

    if (dupeRate > 10) status = "DUPLICATE_ISSUE";
    else if (missingGhl > 0) status = "MISSING_GHL";
    else if (missingZenoti > 0) status = "MISSING_ZENOTI";
    else if (reconcRate >= 95) status = "HEALTHY";
    else if (reconcRate >= 85) status = "MINOR_DISCREPANCY";
    else if (reconcRate < 85) status = "MAJOR_DISCREPANCY";

    const lastLead = leads
      .filter((l) => l.createdAtSource)
      .sort((a, b) => (b.createdAtSource!.getTime() - a.createdAtSource!.getTime()))[0];

    await prisma.wordPressFormSummary.upsert({
      where: { id: f.formName },
      create: {
        id: f.formName,
        formName: f.formName,
        formId: leads[0]?.formId,
        wordpressFormPlugin: leads[0]?.wordpressFormPlugin,
        pageUrl: leads[0]?.pageUrl,
        totalSubmissions: total,
        uniqueLeads: unique,
        duplicateSubmissions: dupes,
        ghlMatchedCount: ghlMatched,
        zenotiMatchedCount: zenotiMatched,
        missingInGhlCount: missingGhl,
        missingInZenotiCount: missingZenoti,
        formToGhlReconciliationRate: ghlRate,
        formToZenotiReconciliationRate: zenotiRate,
        reconciliationStatus: status,
        lastSubmissionAt: lastLead?.createdAtSource,
      },
      update: {
        totalSubmissions: total,
        uniqueLeads: unique,
        duplicateSubmissions: dupes,
        ghlMatchedCount: ghlMatched,
        zenotiMatchedCount: zenotiMatched,
        missingInGhlCount: missingGhl,
        missingInZenotiCount: missingZenoti,
        formToGhlReconciliationRate: ghlRate,
        formToZenotiReconciliationRate: zenotiRate,
        reconciliationStatus: status,
        lastSubmissionAt: lastLead?.createdAtSource,
      },
    });
  }
}
