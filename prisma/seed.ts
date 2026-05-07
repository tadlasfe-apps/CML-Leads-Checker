import { PrismaClient, SourceSystem } from "@prisma/client";
import { normalizeEmail, normalizePhone, normalizeClinicLocation, normalizeService } from "../src/lib/normalization";
import { runReconciliation } from "../src/lib/reconciliation";

const prisma = new PrismaClient();

const CLINICS = [
  "Toronto", "Yorkville", "Mississauga", "Oakville", "Whitby",
  "Scarborough", "Newmarket", "Vaughan", "Thornhill", "Etobicoke", "Burlington",
];

const SERVICES = [
  "Laser Hair Removal", "Morpheus8", "Hair Restoration", "Microneedling",
  "Salmon DNA", "Express Facial", "Botox", "Fillers", "Skin Tightening", "CoolSculpting",
];

const WP_FORMS = [
  { name: "Laser Hair Removal Consultation Form", plugin: "Gravity Forms", url: "/laser-hair-removal/" },
  { name: "Morpheus8 Consultation Form", plugin: "WPForms", url: "/morpheus8/" },
  { name: "Hair Restoration Inquiry Form", plugin: "Contact Form 7", url: "/hair-restoration/" },
  { name: "Microneedling Promo Form", plugin: "Elementor Forms", url: "/microneedling-promo/" },
  { name: "Salmon DNA Promo Form", plugin: "Gravity Forms", url: "/salmon-dna/" },
  { name: "Express Facial $69 Form", plugin: "Fluent Forms", url: "/express-facial-promo/" },
  { name: "General Contact Form", plugin: "Contact Form 7", url: "/contact/" },
  { name: "Book a Free Consultation Form", plugin: "WPForms", url: "/free-consultation/" },
  { name: "Landing Page Lead Form", plugin: "Elementor Forms", url: "/lp/summer-promo/" },
  { name: "Clinic Location Inquiry Form", plugin: "Formidable Forms", url: "/locations/" },
];

const CAMPAIGNS = ["summer2024", "fall-promo", "new-year", "valentines", "mothers-day", "spring-launch"];
const UTM_SOURCES = ["facebook", "instagram", "google", "email", "direct", "referral"];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(randInt(8, 20), randInt(0, 59), 0, 0);
  return d;
}

interface LeadData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  clinic: string;
  service: string;
  daysBack: number;
}

function makeLeadData(overrides: Partial<LeadData> = {}): LeadData {
  const firstNames = ["Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "James",
    "Mia", "Alexander", "Charlotte", "William", "Amelia", "Benjamin", "Harper", "Lucas", "Evelyn", "Henry",
    "Aria", "Sebastian", "Luna", "Jack", "Scarlett", "Owen", "Grace", "Elijah", "Chloe", "Daniel"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Moore",
    "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Young", "Lee",
    "Patel", "Kim", "Nguyen", "Chen", "Singh", "Kumar", "Ali", "Khan", "Ramos", "Lopez"];

  const fn = rand(firstNames);
  const ln = rand(lastNames);
  const area = ["416", "647", "905", "289", "519"][randInt(0, 4)];
  const phone = `(${area}) ${randInt(200, 999)}-${String(randInt(1000, 9999)).padStart(4, "0")}`;

  return {
    firstName: fn,
    lastName: ln,
    email: `${fn.toLowerCase()}.${ln.toLowerCase()}${randInt(1, 99)}@example.com`,
    phone,
    clinic: rand(CLINICS),
    service: rand(SERVICES),
    daysBack: randInt(1, 90),
    ...overrides,
  };
}

async function seedMappings() {
  console.log("Seeding mappings...");

  const clinicMappings = [
    ["Toronto Midtown", "Toronto Midtown"], ["Midtown Toronto", "Toronto Midtown"], ["CML Midtown", "Toronto Midtown"],
    ["Canada MedLaser Midtown", "Toronto Midtown"], ["Toronto", "Toronto"], ["TO", "Toronto"],
    ["YKV", "Yorkville"], ["Yorkville Toronto", "Yorkville"],
    ["Mississauga", "Mississauga"], ["Miss", "Mississauga"], ["CML Mississauga", "Mississauga"],
    ["Oakville", "Oakville"], ["OAK", "Oakville"],
    ["Whitby", "Whitby"], ["Durham", "Whitby"],
    ["Scarborough", "Scarborough"], ["Scar", "Scarborough"],
    ["Newmarket", "Newmarket"], ["NM", "Newmarket"],
    ["Vaughan", "Vaughan"], ["VAU", "Vaughan"],
    ["Thornhill", "Thornhill"], ["TH", "Thornhill"],
    ["Etobicoke", "Etobicoke"], ["Etob", "Etobicoke"],
    ["Burlington", "Burlington"], ["BUR", "Burlington"],
  ];

  for (const [raw, normalized] of clinicMappings) {
    await prisma.clinicMapping.upsert({
      where: { rawValue: raw },
      create: { rawValue: raw, normalizedValue: normalized },
      update: { normalizedValue: normalized },
    });
  }

  const serviceMappings = [
    ["LHR", "Laser Hair Removal"], ["Laser", "Laser Hair Removal"],
    ["Laser Hair", "Laser Hair Removal"], ["Full Body Laser", "Laser Hair Removal"],
    ["Morpheus", "Morpheus8"], ["Morpheus 8", "Morpheus8"],
    ["Hair Loss", "Hair Restoration"], ["Hair Growth", "Hair Restoration"], ["PRP Hair", "Hair Restoration"],
    ["Micro Needling", "Microneedling"], ["RF Microneedling", "Microneedling"],
    ["Salmon DNA", "Salmon DNA"], ["PDRN", "Salmon DNA"],
    ["Express Facial", "Express Facial"], ["$69 Facial", "Express Facial"],
    ["Botox", "Botox"], ["Anti-Wrinkle", "Botox"],
    ["Lip Filler", "Fillers"], ["Cheek Filler", "Fillers"], ["Dermal Filler", "Fillers"],
    ["CoolSculpt", "CoolSculpting"], ["Fat Freezing", "CoolSculpting"],
    ["RF Skin Tightening", "Skin Tightening"], ["Radiofrequency", "Skin Tightening"],
  ];

  for (const [raw, normalized] of serviceMappings) {
    await prisma.serviceMapping.upsert({
      where: { rawValue: raw },
      create: { rawValue: raw, normalizedValue: normalized },
      update: { normalizedValue: normalized },
    });
  }

  const sourceMappings = [
    ["Facebook", "Meta"], ["FB", "Meta"], ["Instagram", "Meta"], ["IG", "Meta"],
    ["FB Instant Form", "Meta"], ["Meta Ads", "Meta"],
    ["WordPress", "WordPress"], ["Website Form", "WordPress"], ["Web Form", "WordPress"],
    ["Gravity Forms", "WordPress"], ["WPForms", "WordPress"], ["CF7", "WordPress"],
    ["GoHighLevel", "GHL"], ["Go High Level", "GHL"], ["CRM", "GHL"],
    ["Zenoti CRM", "Zenoti"], ["Zenoti Booking", "Zenoti"],
  ];

  for (const [raw, normalized] of sourceMappings) {
    await prisma.sourceMapping.upsert({
      where: { rawValue: raw },
      create: { rawValue: raw, normalizedValue: normalized },
      update: { normalizedValue: normalized },
    });
  }
}

async function seedLeads() {
  console.log("Seeding leads...");

  const batch = await prisma.importBatch.create({
    data: {
      sourceSystem: "WORDPRESS",
      fileName: "seed_data.csv",
      uploadedBy: "system",
      status: "COMPLETED",
    },
  });

  const leads: Omit<Parameters<typeof prisma.leadSourceRecord.create>[0]["data"], "id">[] = [];

  // ── SCENARIO 1: Perfect match form (Laser Hair Removal Consultation Form)
  const form1 = WP_FORMS[0];
  for (let i = 0; i < 25; i++) {
    const ld = makeLeadData({ clinic: rand(["Toronto", "Yorkville", "Mississauga"]), service: "Laser Hair Removal", daysBack: randInt(1, 30) });
    const wpLead = {
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form1.name, formId: "form_001",
      wordpressFormPlugin: form1.plugin, pageUrl: form1.url,
      createdAtSource: daysAgo(ld.daysBack), firstName: ld.firstName, lastName: ld.lastName,
      fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationRaw: ld.clinic, clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceRaw: ld.service, serviceNormalized: normalizeService(ld.service),
      utmSource: "facebook", utmCampaign: rand(CAMPAIGNS), importBatchId: batch.id,
    };
    leads.push(wpLead);
    // Matching GHL lead
    leads.push({
      sourceSystem: "GHL" as SourceSystem, ghlContactId: `ghl_${i}_form1`,
      createdAtSource: new Date(wpLead.createdAtSource!.getTime() + randInt(1, 24) * 3600000),
      firstName: ld.firstName, lastName: ld.lastName, fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationRaw: ld.clinic, clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceRaw: ld.service, serviceNormalized: normalizeService(ld.service),
      status: "New Lead", importBatchId: batch.id,
    });
    // Matching Zenoti
    leads.push({
      sourceSystem: "ZENOTI" as SourceSystem, zenotiGuestId: `zen_${i}_form1`,
      createdAtSource: new Date(wpLead.createdAtSource!.getTime() + randInt(1, 72) * 3600000),
      fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationRaw: ld.clinic, clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceRaw: ld.service, serviceNormalized: normalizeService(ld.service),
      status: "Booked", importBatchId: batch.id,
    });
  }

  // ── SCENARIO 2: Morpheus8 – missing in GHL
  const form2 = WP_FORMS[1];
  for (let i = 0; i < 18; i++) {
    const ld = makeLeadData({ service: "Morpheus8", daysBack: randInt(5, 45) });
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form2.name, formId: "form_002",
      wordpressFormPlugin: form2.plugin, pageUrl: form2.url,
      createdAtSource: daysAgo(ld.daysBack), firstName: ld.firstName, lastName: ld.lastName,
      fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationRaw: ld.clinic, clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceRaw: ld.service, serviceNormalized: normalizeService(ld.service),
      utmSource: "instagram", utmCampaign: "morpheus8-promo", importBatchId: batch.id,
    });
    // Only first 10 have GHL matches
    if (i < 10) {
      leads.push({
        sourceSystem: "GHL" as SourceSystem, ghlContactId: `ghl_${i}_form2`,
        createdAtSource: daysAgo(ld.daysBack - 1), fullName: `${ld.firstName} ${ld.lastName}`,
        email: ld.email, phone: ld.phone,
        normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
        clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
        serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
      });
    }
  }

  // ── SCENARIO 3: Hair Restoration – missing in Zenoti
  const form3 = WP_FORMS[2];
  for (let i = 0; i < 15; i++) {
    const ld = makeLeadData({ service: "Hair Restoration", daysBack: randInt(3, 60) });
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form3.name, formId: "form_003",
      wordpressFormPlugin: form3.plugin, pageUrl: form3.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
    });
    // All have GHL
    leads.push({
      sourceSystem: "GHL" as SourceSystem, ghlContactId: `ghl_${i}_form3`,
      createdAtSource: daysAgo(ld.daysBack - 1), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
    });
    // Only first 7 have Zenoti
    if (i < 7) {
      leads.push({
        sourceSystem: "ZENOTI" as SourceSystem, zenotiGuestId: `zen_${i}_form3`,
        createdAtSource: daysAgo(ld.daysBack - 2), fullName: `${ld.firstName} ${ld.lastName}`,
        email: ld.email, phone: ld.phone,
        normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
        clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
        serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
      });
    }
  }

  // ── SCENARIO 4: Microneedling – duplicate submissions
  const form4 = WP_FORMS[3];
  const dupLeads: typeof leads = [];
  for (let i = 0; i < 12; i++) {
    const ld = makeLeadData({ service: "Microneedling", daysBack: randInt(2, 30) });
    const base = {
      formName: form4.name, formId: "form_004", wordpressFormPlugin: form4.plugin, pageUrl: form4.url,
      fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
    };
    const createdAt = daysAgo(ld.daysBack);
    leads.push({ sourceSystem: "WORDPRESS" as SourceSystem, ...base, createdAtSource: createdAt });
    // 30% have intentional duplicates (same person, same day)
    if (i < 4) {
      const dupAt = new Date(createdAt.getTime() + 2 * 3600000);
      dupLeads.push({ sourceSystem: "WORDPRESS" as SourceSystem, ...base, createdAtSource: dupAt });
    }
  }
  leads.push(...dupLeads);

  // ── SCENARIO 5: Salmon DNA – inconsistent clinic naming
  const form5 = WP_FORMS[4];
  const clinicVariants = ["Mississauga", "Miss", "CML Mississauga", "Mississauga ON", "mississauga"];
  for (let i = 0; i < 14; i++) {
    const ld = makeLeadData({ service: "Salmon DNA", daysBack: randInt(1, 45) });
    const rawClinic = rand(clinicVariants);
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form5.name, formId: "form_005",
      wordpressFormPlugin: form5.plugin, pageUrl: form5.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationRaw: rawClinic, clinicLocationNormalized: normalizeClinicLocation(rawClinic),
      serviceRaw: ld.service, serviceNormalized: normalizeService(ld.service),
      importBatchId: batch.id,
    });
  }

  // ── SCENARIO 6: Express Facial – inconsistent service naming
  const form6 = WP_FORMS[5];
  const serviceVariants = ["Express Facial", "$69 Facial", "facial", "Express Facial $69", "Facial Treatment"];
  for (let i = 0; i < 20; i++) {
    const ld = makeLeadData({ daysBack: randInt(1, 30) });
    const rawService = rand(serviceVariants);
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form6.name, formId: "form_006",
      wordpressFormPlugin: form6.plugin, pageUrl: form6.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceRaw: rawService, serviceNormalized: normalizeService(rawService),
      importBatchId: batch.id,
    });
  }

  // ── SCENARIO 7: General Contact Form – missing UTMs
  const form7 = WP_FORMS[6];
  for (let i = 0; i < 22; i++) {
    const ld = makeLeadData({ daysBack: randInt(1, 60) });
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form7.name, formId: "form_007",
      wordpressFormPlugin: form7.plugin, pageUrl: form7.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service),
      // Intentionally no UTMs
      importBatchId: batch.id,
    });
  }

  // ── SCENARIO 8: Free Consultation – high volume, low reconciliation
  const form8 = WP_FORMS[7];
  for (let i = 0; i < 40; i++) {
    const ld = makeLeadData({ daysBack: randInt(1, 90) });
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form8.name, formId: "form_008",
      wordpressFormPlugin: form8.plugin, pageUrl: form8.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service),
      utmSource: rand(UTM_SOURCES), utmCampaign: rand(CAMPAIGNS), importBatchId: batch.id,
    });
    // Only 30% have GHL matches
    if (i < 12) {
      leads.push({
        sourceSystem: "GHL" as SourceSystem, ghlContactId: `ghl_${i}_form8`,
        createdAtSource: daysAgo(ld.daysBack - 1), fullName: `${ld.firstName} ${ld.lastName}`,
        email: ld.email, phone: ld.phone,
        normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
        clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
        serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
      });
    }
  }

  // ── SCENARIO 9: Landing Page Lead Form – mixed UTMs
  const form9 = WP_FORMS[8];
  for (let i = 0; i < 16; i++) {
    const ld = makeLeadData({ daysBack: randInt(2, 45) });
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form9.name, formId: "form_009",
      wordpressFormPlugin: form9.plugin, pageUrl: form9.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service),
      utmSource: rand(UTM_SOURCES), utmMedium: rand(["cpc", "paid", "social", "email"]),
      utmCampaign: rand(CAMPAIGNS), utmContent: `ad_variant_${randInt(1, 4)}`,
      importBatchId: batch.id,
    });
  }

  // ── SCENARIO 10: Clinic Location Inquiry
  const form10 = WP_FORMS[9];
  for (let i = 0; i < 10; i++) {
    const ld = makeLeadData({ daysBack: randInt(1, 30) });
    leads.push({
      sourceSystem: "WORDPRESS" as SourceSystem, formName: form10.name, formId: "form_010",
      wordpressFormPlugin: form10.plugin, pageUrl: form10.url,
      createdAtSource: daysAgo(ld.daysBack), fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
    });
  }

  // ── Meta leads (independent set)
  for (let i = 0; i < 80; i++) {
    const ld = makeLeadData({ daysBack: randInt(1, 90) });
    const phoneVariant = i % 5 === 0 ? ld.phone.replace("(", "").replace(")", "").replace("-", " ") : ld.phone;
    leads.push({
      sourceSystem: "META" as SourceSystem,
      externalId: `meta_lead_${i}`,
      createdAtSource: daysAgo(ld.daysBack),
      fullName: `${ld.firstName} ${ld.lastName}`,
      email: ld.email, phone: phoneVariant,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(phoneVariant),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service),
      campaignName: rand(CAMPAIGNS),
      formName: rand(["Summer Promo Form", "Free Consultation Meta", "LHR Meta Form"]),
      leadSource: "Meta",
      importBatchId: batch.id,
    });

    // ~70% have GHL matches
    if (i % 10 < 7) {
      leads.push({
        sourceSystem: "GHL" as SourceSystem, ghlContactId: `ghl_meta_${i}`,
        createdAtSource: daysAgo(ld.daysBack - 1),
        fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
        normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
        clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
        serviceNormalized: normalizeService(ld.service),
        status: rand(["New Lead", "Contacted", "Qualified", "Lost"]),
        importBatchId: batch.id,
      });
    }

    // ~50% have Zenoti
    if (i % 10 < 5) {
      leads.push({
        sourceSystem: "ZENOTI" as SourceSystem, zenotiGuestId: `zen_meta_${i}`,
        createdAtSource: daysAgo(ld.daysBack - 2),
        fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
        normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
        clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
        serviceNormalized: normalizeService(ld.service),
        status: rand(["Booked", "Confirmed", "Completed", "No Show"]),
        importBatchId: batch.id,
      });
    }
  }

  // GHL-only leads (no source match)
  for (let i = 0; i < 15; i++) {
    const ld = makeLeadData({ daysBack: randInt(1, 60) });
    leads.push({
      sourceSystem: "GHL" as SourceSystem, ghlContactId: `ghl_only_${i}`,
      createdAtSource: daysAgo(ld.daysBack),
      fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      clinicLocationNormalized: normalizeClinicLocation(ld.clinic),
      serviceNormalized: normalizeService(ld.service),
      status: "New Lead", importBatchId: batch.id,
    });
  }

  // Zenoti with wrong clinic
  for (let i = 0; i < 8; i++) {
    const ld = makeLeadData({ daysBack: randInt(5, 30) });
    leads.push({
      sourceSystem: "ZENOTI" as SourceSystem, zenotiGuestId: `zen_wrongclinic_${i}`,
      createdAtSource: daysAgo(ld.daysBack),
      fullName: `${ld.firstName} ${ld.lastName}`, email: ld.email, phone: ld.phone,
      normalizedEmail: normalizeEmail(ld.email), normalizedPhone: normalizePhone(ld.phone),
      // Wrong clinic assignment
      clinicLocationRaw: rand(CLINICS.filter((c) => c !== ld.clinic)),
      clinicLocationNormalized: rand(CLINICS.filter((c) => c !== ld.clinic)),
      serviceNormalized: normalizeService(ld.service), importBatchId: batch.id,
    });
  }

  console.log(`Creating ${leads.length} lead records...`);
  await prisma.leadSourceRecord.createMany({ data: leads as any, skipDuplicates: true });

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { totalRows: leads.length, validRows: leads.length, status: "COMPLETED" },
  });
}

async function main() {
  console.log("🌱 Seeding database...");

  await prisma.$executeRaw`TRUNCATE TABLE "LeadMatch", "LeadSourceRecord", "WordPressFormSummary", "ImportBatch", "ClinicMapping", "ServiceMapping", "SourceMapping" CASCADE`;

  await seedMappings();
  await seedLeads();

  console.log("Running reconciliation engine...");
  const result = await runReconciliation();
  console.log(`Reconciliation: matched=${result.matched}, possible=${result.possible}, unmatched=${result.unmatched}`);

  const counts = await prisma.leadSourceRecord.groupBy({
    by: ["sourceSystem"],
    _count: { id: true },
  });
  console.log("Lead counts by source:", counts);

  console.log("✅ Seed complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
