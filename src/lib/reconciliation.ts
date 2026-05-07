import prisma from "./prisma";
import { normalizeClinicLocation, normalizeService, normalizeWebsiteFormSource,
  inferWebsiteFormSource, loadMappingCaches, clearMappingCaches } from "./normalization";

export interface ReconciliationResult {
  totalLeads: number;
  duplicatesMarked: number;
  appointmentBasedFlagged: number;
}

/**
 * Re-apply clinic/service/form-source normalizations using current mapping tables.
 */
async function renormalizeLeads(): Promise<number> {
  await loadMappingCaches();

  const all = await prisma.leadSourceRecord.findMany({
    select: {
      id: true, clinicLocationRaw: true, serviceRaw: true,
      formName: true, websiteFormSource: true, pageUrl: true,
      sourceSystem: true,
    },
  });

  let updated = 0;
  const batchSize = 200;

  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    await Promise.all(batch.map(async (r) => {
      const clinicNorm = normalizeClinicLocation(r.clinicLocationRaw || undefined);
      const serviceNorm = normalizeService(r.serviceRaw || undefined);

      let websiteFormSource = r.websiteFormSource;
      if (r.sourceSystem === "WEBSITE" && !websiteFormSource) {
        websiteFormSource = inferWebsiteFormSource(r.formName || undefined, r.pageUrl || undefined);
      } else if (r.sourceSystem === "WEBSITE" && websiteFormSource) {
        websiteFormSource = normalizeWebsiteFormSource(websiteFormSource);
      }

      await prisma.leadSourceRecord.update({
        where: { id: r.id },
        data: {
          clinicLocationNormalized: clinicNorm,
          serviceNormalized: serviceNorm,
          websiteFormSource: websiteFormSource ?? undefined,
        },
      });
      updated++;
    }));
  }

  clearMappingCaches();
  return updated;
}

/**
 * Mark duplicate Website Leads within a 7-day window per clinic+service+formName.
 */
async function detectDuplicates(): Promise<number> {
  // Reset all duplicate flags first
  await prisma.leadSourceRecord.updateMany({
    where: { sourceSystem: "WEBSITE" },
    data: { isDuplicate: false },
  });

  const websiteLeads = await prisma.leadSourceRecord.findMany({
    where: { sourceSystem: "WEBSITE" },
    select: {
      id: true, normalizedPhone: true, normalizedEmail: true,
      clinicLocationNormalized: true, serviceNormalized: true,
      websiteFormSource: true, formName: true, createdAtSource: true,
    },
    orderBy: { createdAtSource: "asc" },
  });

  let dupeCount = 0;
  const seen = new Map<string, Date>();

  for (const lead of websiteLeads) {
    const identifier = lead.normalizedPhone || lead.normalizedEmail;
    if (!identifier) continue;

    const key = [
      identifier,
      lead.clinicLocationNormalized ?? "",
      lead.serviceNormalized ?? "",
      lead.formName ?? lead.websiteFormSource ?? "",
    ].join("|");

    const prevDate = seen.get(key);
    const thisDate = lead.createdAtSource;

    if (prevDate && thisDate) {
      const diffMs = thisDate.getTime() - prevDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays <= 7) {
        await prisma.leadSourceRecord.update({
          where: { id: lead.id },
          data: { isDuplicate: true },
        });
        dupeCount++;
        continue; // keep seen[key] as the original date
      }
    }

    seen.set(key, thisDate ?? new Date());
  }

  return dupeCount;
}

/**
 * Flag Zenoti records that appear to be appointment-based only.
 */
async function flagAppointmentBasedZenoti(): Promise<number> {
  const result = await prisma.leadSourceRecord.updateMany({
    where: {
      sourceSystem: "ZENOTI",
      isAppointmentBased: true,
    },
    data: { status: "Needs review: Zenoti source is appointment-based" },
  });
  return result.count;
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const totalLeads = await prisma.leadSourceRecord.count();

  await renormalizeLeads();
  const duplicatesMarked = await detectDuplicates();
  const appointmentBasedFlagged = await flagAppointmentBasedZenoti();

  return { totalLeads, duplicatesMarked, appointmentBasedFlagged };
}
