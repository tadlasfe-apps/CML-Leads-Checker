import { PrismaClient } from "@prisma/client";
import { subDays, format } from "date-fns";

const prisma = new PrismaClient();

function d(daysAgo: number): Date {
  return subDays(new Date(), daysAgo);
}

function phone(n: number) {
  return `416555${String(n).padStart(4, "0")}`;
}

async function main() {
  console.log("Seeding…");

  // ─── Mappings ──────────────────────────────────────────────────────────────
  await prisma.clinicMapping.createMany({
    skipDuplicates: true,
    data: [
      { rawValue: "CML Toronto",     normalizedValue: "Toronto" },
      { rawValue: "CML Mississauga", normalizedValue: "Mississauga" },
      { rawValue: "CML Markham",     normalizedValue: "Markham" },
      { rawValue: "CML Vaughan",     normalizedValue: "Vaughan" },
      { rawValue: "Toronto",         normalizedValue: "Toronto" },
      { rawValue: "Mississauga",     normalizedValue: "Mississauga" },
      { rawValue: "Markham",         normalizedValue: "Markham" },
    ],
  });

  await prisma.serviceMapping.createMany({
    skipDuplicates: true,
    data: [
      { rawValue: "Laser Hair Removal", normalizedValue: "Laser Hair Removal" },
      { rawValue: "LHR",                normalizedValue: "Laser Hair Removal" },
      { rawValue: "Skin Rejuvenation",  normalizedValue: "Skin Rejuvenation" },
      { rawValue: "IPL Photofacial",    normalizedValue: "Skin Rejuvenation" },
      { rawValue: "Body Contouring",    normalizedValue: "Body Contouring" },
      { rawValue: "Tattoo Removal",     normalizedValue: "Tattoo Removal" },
    ],
  });

  await prisma.websiteFormSourceMapping.createMany({
    skipDuplicates: true,
    data: [
      { rawValue: "popup",        normalizedValue: "Popup" },
      { rawValue: "exit intent",  normalizedValue: "Exit Intent Popup" },
      { rawValue: "quiz",         normalizedValue: "Website Quiz" },
      { rawValue: "landing page", normalizedValue: "Landing Page Form" },
      { rawValue: "free consult", normalizedValue: "Free Consultation Form" },
    ],
  });

  // ─── Import batches ────────────────────────────────────────────────────────
  const [websiteBatch, metaBatch, ghlBatch, zenotiBatch] = await Promise.all([
    prisma.importBatch.create({
      data: {
        sourceSystem: "WEBSITE", fileName: "website-leads-seed.csv",
        totalRows: 120, validRows: 115, invalidRows: 5, duplicateRows: 8,
        unmappedClinicRows: 2, unmappedServiceRows: 3,
        importedDateRangeStart: d(60), importedDateRangeEnd: d(1),
        status: "COMPLETED",
      },
    }),
    prisma.importBatch.create({
      data: {
        sourceSystem: "META", fileName: "meta-ads-seed.csv",
        totalRows: 90, validRows: 90, invalidRows: 0, duplicateRows: 0,
        importedDateRangeStart: d(60), importedDateRangeEnd: d(1),
        status: "COMPLETED",
      },
    }),
    prisma.importBatch.create({
      data: {
        sourceSystem: "GHL", fileName: "ghl-leads-seed.csv",
        totalRows: 95, validRows: 93, invalidRows: 2, duplicateRows: 4,
        unmappedClinicRows: 1,
        importedDateRangeStart: d(60), importedDateRangeEnd: d(1),
        status: "COMPLETED",
      },
    }),
    prisma.importBatch.create({
      data: {
        sourceSystem: "ZENOTI", fileName: "zenoti-leads-seed.csv",
        totalRows: 85, validRows: 80, invalidRows: 5, duplicateRows: 3,
        importedDateRangeStart: d(60), importedDateRangeEnd: d(1),
        status: "COMPLETED",
      },
    }),
  ]);

  const CLINICS      = ["Toronto", "Mississauga", "Markham", "Vaughan"];
  const SERVICES     = ["Laser Hair Removal", "Skin Rejuvenation", "Body Contouring", "Tattoo Removal"];
  const FORM_SOURCES = ["Popup", "Website Quiz", "Landing Page Form", "Free Consultation Form", "Contact Form"];
  const FORM_NAMES   = [
    "Free Consultation Popup",
    "Laser Hair Removal Quiz",
    "Landing Page — Summer Promo",
    "Contact Form — Main",
    "Free Consult — Mississauga",
  ];
  const CAMPAIGNS = [
    "Summer LHR Promo",
    "Skin Rejuvenation Awareness",
    "Body Contouring — Q2",
    "Tattoo Removal Retargeting",
  ];

  // ─── Website Leads ─────────────────────────────────────────────────────────
  const websiteLeads = [];
  for (let i = 0; i < 115; i++) {
    const daysAgo  = Math.floor(Math.random() * 60);
    const clinic   = CLINICS[i % CLINICS.length];
    const service  = SERVICES[i % SERVICES.length];
    const formName = FORM_NAMES[i % FORM_NAMES.length];
    const formSrc  = FORM_SOURCES[i % FORM_SOURCES.length];
    const ph = phone(i + 1);
    websiteLeads.push({
      sourceSystem: "WEBSITE" as const,
      recordType: "INDIVIDUAL_LEAD" as const,
      externalId: `WS_${i + 1}`,
      importBatchId: websiteBatch.id,
      createdAtSource: d(daysAgo),
      fullName: `Website Lead ${i + 1}`,
      email: `lead${i + 1}@example.com`,
      phone: ph,
      normalizedPhone: ph,
      clinicLocationRaw: clinic,
      clinicLocationNormalized: clinic,
      serviceRaw: service,
      serviceNormalized: service,
      formName,
      websiteFormSource: formSrc,
      backendProvider: "Gravity Forms",
      pageUrl: `https://canadamedlaser.ca/${service.toLowerCase().replace(/ /g, "-")}`,
      isDuplicate: i >= 107,
    });
  }
  await prisma.leadSourceRecord.createMany({ data: websiteLeads, skipDuplicates: true });

  // ─── Meta Ads ──────────────────────────────────────────────────────────────
  const metaRows = [];
  for (let i = 0; i < 90; i++) {
    const daysAgo    = Math.floor(Math.random() * 60);
    const campaign   = CAMPAIGNS[i % CAMPAIGNS.length];
    const isLeadType = i % 5 !== 0;
    const resultType = isLeadType ? "Leads" : "ThruPlays";
    const results    = isLeadType ? Math.floor(Math.random() * 10) + 1 : Math.floor(Math.random() * 100) + 50;
    const rDate      = d(daysAgo);
    metaRows.push({
      sourceSystem: "META" as const,
      recordType: "AGGREGATE_REPORT" as const,
      externalId: `META_AGG|${format(rDate, "yyyy-MM-dd")}|CAMP${i % 4}|ADSET${i % 8}|AD${i}|${resultType}`,
      importBatchId: metaBatch.id,
      reportDate: rDate,
      campaignName: campaign,
      metaCampaignId: `CAMP${i % 4}`,
      metaAdSetName: `${campaign} — Ad Set ${i % 3 + 1}`,
      metaAdSetId: `ADSET${i % 8}`,
      metaAdName: `${campaign} — Creative ${i % 5 + 1}`,
      metaAdId: `AD${i}`,
      metaResultType: resultType,
      metaResults: results,
      metaLeadCount: isLeadType ? results : 0,
      spend: isLeadType ? results * (Math.random() * 15 + 8) : Math.random() * 50 + 20,
      costPerResult: isLeadType ? (Math.random() * 15 + 8) : null,
      impressions: Math.floor(Math.random() * 5000) + 500,
    });
  }
  await prisma.leadSourceRecord.createMany({ data: metaRows, skipDuplicates: true });

  // ─── GHL Leads ─────────────────────────────────────────────────────────────
  const ghlLeads = [];
  for (let i = 0; i < 93; i++) {
    const daysAgo = Math.floor(Math.random() * 60);
    const clinic  = CLINICS[i % CLINICS.length];
    const service = SERVICES[i % SERVICES.length];
    const ph = phone(i + 1);
    ghlLeads.push({
      sourceSystem: "GHL" as const,
      recordType: "INDIVIDUAL_LEAD" as const,
      externalId: `GHL_${i + 1}`,
      importBatchId: ghlBatch.id,
      createdAtSource: d(daysAgo),
      fullName: `GHL Lead ${i + 1}`,
      email: `lead${i + 1}@example.com`,
      phone: ph,
      normalizedPhone: ph,
      clinicLocationRaw: clinic,
      clinicLocationNormalized: clinic,
      serviceRaw: service,
      serviceNormalized: service,
      ghlContactId: `GHL_C_${i + 1}`,
      ghlOpportunityId: `GHL_OPP_${i + 1}`,
      ghlPipelineName: "Lead Inquiry",
      ghlStageName: i % 3 === 0 ? "New Lead" : i % 3 === 1 ? "Consultation Booked" : "Converted",
    });
  }
  await prisma.leadSourceRecord.createMany({ data: ghlLeads, skipDuplicates: true });

  // ─── Zenoti Leads ──────────────────────────────────────────────────────────
  const zenotiLeads = [];
  for (let i = 0; i < 80; i++) {
    const daysAgo     = Math.floor(Math.random() * 60);
    const clinic      = CLINICS[i % CLINICS.length];
    const service     = SERVICES[i % SERVICES.length];
    const ph          = phone(i + 1);
    const isApptBased = i >= 75;
    const leadDate    = isApptBased ? undefined : d(daysAgo);
    zenotiLeads.push({
      sourceSystem: "ZENOTI" as const,
      recordType: "INDIVIDUAL_LEAD" as const,
      externalId: `ZEN_${i + 1}`,
      importBatchId: zenotiBatch.id,
      createdAtSource: isApptBased ? undefined : d(daysAgo),
      leadCreatedDate: leadDate,
      appointmentDate: d(daysAgo - 2),
      isAppointmentBased: isApptBased,
      fullName: `Zenoti Lead ${i + 1}`,
      email: `lead${i + 1}@example.com`,
      phone: ph,
      normalizedPhone: ph,
      clinicLocationRaw: clinic,
      clinicLocationNormalized: clinic,
      serviceRaw: service,
      serviceNormalized: service,
      zenotiGuestId: `ZEN_G_${i + 1}`,
      zenotiLeadId: isApptBased ? undefined : `ZEN_L_${i + 1}`,
    });
  }
  await prisma.leadSourceRecord.createMany({ data: zenotiLeads, skipDuplicates: true });

  console.log("Seed complete.");
  console.log(`  Website Leads: ${websiteLeads.length}`);
  console.log(`  Meta Rows:     ${metaRows.length}`);
  console.log(`  GHL Leads:     ${ghlLeads.length}`);
  console.log(`  Zenoti Leads:  ${zenotiLeads.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
