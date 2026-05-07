import Papa from "papaparse";
import {
  normalizeEmail, normalizePhone, normalizeClinicLocation, normalizeService,
  normalizeWebsiteFormSource, inferWebsiteFormSource, normalizeMetaResultType,
  isUnmappedClinic, isUnmappedService,
} from "./normalization";

export type ParsedSourceSystem = "WEBSITE" | "META" | "GHL" | "ZENOTI";

export interface ParsedRecord {
  sourceSystem: ParsedSourceSystem;
  recordType: "INDIVIDUAL_LEAD" | "AGGREGATE_REPORT";
  backendProvider?: string;
  externalId?: string;
  createdAtSource?: Date;
  reportDate?: Date;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  normalizedEmail?: string;
  normalizedPhone?: string;
  clinicLocationRaw?: string;
  clinicLocationNormalized?: string;
  serviceRaw?: string;
  serviceNormalized?: string;
  campaignName?: string;
  leadSource?: string;
  // Website
  formName?: string;
  formId?: string;
  websiteFormSource?: string;
  pageUrl?: string;
  landingPageUrl?: string;
  referrerUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gravityFormsEntryId?: string;
  gravityFormsFormId?: string;
  // Meta
  metaObjective?: string;
  metaConversionGoal?: string;
  metaResultType?: string;
  metaResults?: number;
  metaLeadCount?: number;
  spend?: number;
  costPerResult?: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  linkClicks?: number;
  landingPageViews?: number;
  attributionSetting?: string;
  metaCampaignId?: string;
  metaAdSetName?: string;
  metaAdSetId?: string;
  metaAdName?: string;
  metaAdId?: string;
  // GHL
  ghlContactId?: string;
  ghlOpportunityId?: string;
  ghlPipelineName?: string;
  ghlPipelineId?: string;
  ghlStageName?: string;
  // Zenoti
  zenotiLeadId?: string;
  zenotiInquiryId?: string;
  zenotiProspectId?: string;
  zenotiGuestId?: string;
  zenotiCenterName?: string;
  leadCreatedDate?: Date;
  inquiryDate?: Date;
  guestCreatedDate?: Date;
  appointmentDate?: Date;
  zenotiAppointmentId?: string;
  appointmentStatus?: string;
  isAppointmentBased?: boolean;
  status?: string;
  rawPayload?: object;
  // Flags
  _unmappedClinic?: boolean;
  _unmappedService?: boolean;
  _unmappedFormSource?: boolean;
  _dateInvalid?: boolean;
}

export interface ParseResult {
  records: ParsedRecord[];
  invalidRows: number;
  errors: string[];
}

// ─── Header matching ──────────────────────────────────────────────────────────

function h(row: Record<string, string>, ...keys: string[]): string {
  const clean = (s: string) => s.toLowerCase().replace(/[\s_\-\.\/]+/g, "");
  for (const k of keys) {
    const ck = clean(k);
    const found = Object.keys(row).find((rk) => clean(rk) === ck);
    if (found !== undefined && row[found]?.trim()) return row[found].trim();
  }
  return "";
}

function parseDate(val: string): Date | undefined {
  if (!val) return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseNum(val: string): number | undefined {
  if (!val) return undefined;
  const n = parseFloat(val.replace(/,/g, "").replace(/\$/g, ""));
  return isNaN(n) ? undefined : n;
}

// ─── Website / Gravity Forms ─────────────────────────────────────────────────

function parseWebsiteRow(row: Record<string, string>): ParsedRecord {
  const dateVal = h(row, "date", "date created", "created at", "submitted at",
    "submission date", "created", "createdatsource");
  const createdAtSource = parseDate(dateVal);

  const formName = h(row, "form name", "form title", "form");
  const formId = h(row, "form id", "form_id", "gravity forms form id", "gravityformsformid");
  const entryId = h(row, "entry id", "entry_id", "submission id",
    "id", "gravityformsentryid");
  const websiteFormSourceRaw = h(row, "website form source", "form source",
    "lead source", "popup source", "source type", "websiteformsource");
  const clinicRaw = h(row, "clinic location", "clinic", "location", "center");
  const serviceRaw = h(row, "service", "treatment", "interested service");
  const pageUrl = h(row, "page url", "source url", "pageurl");
  const landingPageUrl = h(row, "landing page url", "landingpageurl");
  const referrerUrl = h(row, "referrer url", "referrer", "referrerurl");
  const firstName = h(row, "first name", "firstname");
  const lastName = h(row, "last name", "lastname");
  const fullName = h(row, "full name", "name", "fullname") ||
    `${firstName} ${lastName}`.trim();
  const email = h(row, "email", "email address");
  const phone = h(row, "phone", "phone number", "mobile", "telephone");

  const clinicNorm = normalizeClinicLocation(clinicRaw || undefined);
  const serviceNorm = normalizeService(serviceRaw || undefined);
  const websiteFormSourceNorm = websiteFormSourceRaw
    ? normalizeWebsiteFormSource(websiteFormSourceRaw)
    : inferWebsiteFormSource(formName || undefined, pageUrl || undefined);

  return {
    sourceSystem: "WEBSITE",
    recordType: "INDIVIDUAL_LEAD",
    backendProvider: "GRAVITY_FORMS",
    externalId: entryId || undefined,
    createdAtSource,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: fullName || undefined,
    email: email || undefined,
    phone: phone || undefined,
    normalizedEmail: normalizeEmail(email),
    normalizedPhone: normalizePhone(phone),
    clinicLocationRaw: clinicRaw || undefined,
    clinicLocationNormalized: clinicNorm,
    serviceRaw: serviceRaw || undefined,
    serviceNormalized: serviceNorm,
    formName: formName || undefined,
    formId: formId || undefined,
    gravityFormsEntryId: entryId || undefined,
    gravityFormsFormId: formId || undefined,
    websiteFormSource: websiteFormSourceNorm,
    pageUrl: pageUrl || undefined,
    landingPageUrl: landingPageUrl || undefined,
    referrerUrl: referrerUrl || undefined,
    utmSource: h(row, "utm source", "utmsource") || undefined,
    utmMedium: h(row, "utm medium", "utmmedium") || undefined,
    utmCampaign: h(row, "utm campaign", "utmcampaign") || undefined,
    utmContent: h(row, "utm content", "utmcontent") || undefined,
    utmTerm: h(row, "utm term", "utmterm") || undefined,
    fbclid: h(row, "fbclid") || undefined,
    status: h(row, "status") || undefined,
    rawPayload: row,
    _unmappedClinic: isUnmappedClinic(clinicNorm),
    _unmappedService: isUnmappedService(serviceNorm),
    _unmappedFormSource: websiteFormSourceNorm === "Unknown",
    _dateInvalid: !createdAtSource,
  };
}

// ─── Meta Ads Manager ─────────────────────────────────────────────────────────

function parseMetaRow(row: Record<string, string>): ParsedRecord {
  const dateVal = h(row, "day", "date", "reporting starts", "report date", "reportdate");
  const reportDate = parseDate(dateVal);

  const campaignName = h(row, "campaign name", "campaign");
  const campaignId = h(row, "campaign id", "campaignid");
  const adSetName = h(row, "ad set name", "adsetname");
  const adSetId = h(row, "ad set id", "adsetid");
  const adName = h(row, "ad name", "adname");
  const adId = h(row, "ad id", "adid");
  const objective = h(row, "objective");
  const conversionGoal = h(row, "conversion goal", "conversiongoal");
  const resultTypeRaw = h(row, "result type", "resulttype");

  const resultsRaw = h(row, "results");
  const leadsRaw = h(row, "leads", "website leads", "on-facebook leads",
    "messaging leads", "on facebook leads");
  const spendRaw = h(row, "amount spent", "spend", "amountspent");
  const costPerResultRaw = h(row, "cost per result", "costperresult");

  const results = parseNum(resultsRaw);
  const leads = parseNum(leadsRaw);
  const spend = parseNum(spendRaw) ?? 0;

  // Determine if this row represents lead results
  const isLeadResult =
    normalizeMetaResultType(resultTypeRaw) !== null ||
    normalizeMetaResultType(conversionGoal) !== null ||
    normalizeMetaResultType(objective) !== null;

  let metaLeadCount = 0;
  let metaResults = results ?? leads ?? 0;

  if (isLeadResult) {
    // Use Results if available, else Leads column
    metaLeadCount = Math.round(results ?? leads ?? 0);
    metaResults = results ?? leads ?? 0;
  } else if (!resultTypeRaw && leads != null) {
    // No result type column present — treat leads column as meta lead count
    metaLeadCount = Math.round(leads);
    metaResults = leads;
  }

  const clinicRaw = h(row, "clinic location", "clinic", "location");
  const serviceRaw = h(row, "service");
  const clinicNorm = normalizeClinicLocation(clinicRaw || undefined);
  const serviceNorm = normalizeService(serviceRaw || undefined);

  const externalId = [
    "META_AGG", dateVal,
    campaignId || campaignName || "",
    adSetId || adSetName || "",
    adId || adName || "",
    resultTypeRaw || conversionGoal || objective || "",
  ].join("|");

  return {
    sourceSystem: "META",
    recordType: "AGGREGATE_REPORT",
    backendProvider: "META_ADS",
    externalId,
    reportDate,
    createdAtSource: reportDate,
    campaignName: campaignName || undefined,
    metaCampaignId: campaignId || undefined,
    metaAdSetName: adSetName || undefined,
    metaAdSetId: adSetId || undefined,
    metaAdName: adName || undefined,
    metaAdId: adId || undefined,
    metaObjective: objective || undefined,
    metaConversionGoal: conversionGoal || undefined,
    metaResultType: resultTypeRaw || undefined,
    metaResults: metaResults || undefined,
    metaLeadCount,
    spend,
    costPerResult: parseNum(costPerResultRaw) ?? undefined,
    impressions: parseNum(h(row, "impressions")) ? Math.round(parseNum(h(row, "impressions"))!) : undefined,
    reach: parseNum(h(row, "reach")) ? Math.round(parseNum(h(row, "reach"))!) : undefined,
    clicks: parseNum(h(row, "clicks")) ? Math.round(parseNum(h(row, "clicks"))!) : undefined,
    linkClicks: parseNum(h(row, "link clicks", "linkclicks")) ? Math.round(parseNum(h(row, "link clicks", "linkclicks"))!) : undefined,
    landingPageViews: parseNum(h(row, "landing page views", "landingpageviews")) ? Math.round(parseNum(h(row, "landing page views", "landingpageviews"))!) : undefined,
    attributionSetting: h(row, "attribution setting", "attributionsetting") || undefined,
    clinicLocationRaw: clinicRaw || undefined,
    clinicLocationNormalized: clinicNorm,
    serviceRaw: serviceRaw || undefined,
    serviceNormalized: serviceNorm,
    utmCampaign: h(row, "utm campaign", "utmcampaign") || undefined,
    utmSource: h(row, "utm source", "utmsource") || undefined,
    utmMedium: h(row, "utm medium", "utmmedium") || undefined,
    rawPayload: row,
    _unmappedClinic: clinicRaw ? isUnmappedClinic(clinicNorm) : false,
    _unmappedService: serviceRaw ? isUnmappedService(serviceNorm) : false,
    _dateInvalid: !reportDate,
  };
}

// ─── GHL ──────────────────────────────────────────────────────────────────────

function parseGhlRow(row: Record<string, string>): ParsedRecord {
  const dateVal = h(row, "contact created date", "created", "date created",
    "created at", "opportunity created date", "opportunity updated date");
  const createdAtSource = parseDate(dateVal);

  const contactId = h(row, "contact id", "contactid");
  const opportunityId = h(row, "opportunity id", "opportunityid");
  const firstName = h(row, "first name", "firstname");
  const lastName = h(row, "last name", "lastname");
  const fullName = h(row, "full name", "name", "fullname") ||
    `${firstName} ${lastName}`.trim();
  const email = h(row, "email");
  const phone = h(row, "phone", "phone number");
  const clinicRaw = h(row, "location", "clinic", "clinic location", "center");
  const serviceRaw = h(row, "service", "treatment");
  const pipeline = h(row, "pipeline", "pipeline name");
  const pipelineId = h(row, "pipeline id", "pipelineid");
  const stage = h(row, "stage", "stage name", "pipeline stage");
  const stageId = h(row, "stage id", "stageid");
  const source = h(row, "source", "lead source");
  const campaign = h(row, "campaign", "campaign name");

  const clinicNorm = normalizeClinicLocation(clinicRaw || undefined);
  const serviceNorm = normalizeService(serviceRaw || undefined);

  return {
    sourceSystem: "GHL",
    recordType: "INDIVIDUAL_LEAD",
    backendProvider: "GHL",
    externalId: opportunityId || contactId || undefined,
    createdAtSource,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: fullName || undefined,
    email: email || undefined,
    phone: phone || undefined,
    normalizedEmail: normalizeEmail(email),
    normalizedPhone: normalizePhone(phone),
    clinicLocationRaw: clinicRaw || undefined,
    clinicLocationNormalized: clinicNorm,
    serviceRaw: serviceRaw || undefined,
    serviceNormalized: serviceNorm,
    ghlContactId: contactId || undefined,
    ghlOpportunityId: opportunityId || undefined,
    ghlPipelineName: pipeline || undefined,
    ghlPipelineId: pipelineId || undefined,
    ghlStageName: stage || undefined,
    campaignName: campaign || undefined,
    leadSource: source || undefined,
    status: stage || undefined,
    rawPayload: row,
    _unmappedClinic: isUnmappedClinic(clinicNorm),
    _unmappedService: isUnmappedService(serviceNorm),
    _dateInvalid: !createdAtSource,
  };
}

// ─── Zenoti ───────────────────────────────────────────────────────────────────

function parseZenotiRow(row: Record<string, string>): ParsedRecord {
  const leadDateVal = h(row, "lead created date", "leadcreateddate");
  const inquiryDateVal = h(row, "inquiry date", "inquirydate");
  const guestCreatedVal = h(row, "guest created date", "guestcreateddate");
  const createdVal = h(row, "created date", "created", "date");
  const appointmentDateVal = h(row, "appointment date", "appointmentdate", "booking date");

  const leadCreatedDate = parseDate(leadDateVal);
  const inquiryDate = parseDate(inquiryDateVal);
  const guestCreatedDate = parseDate(guestCreatedVal);
  const appointmentDate = parseDate(appointmentDateVal);
  const createdAtSource = leadCreatedDate ?? inquiryDate ?? guestCreatedDate ??
    parseDate(createdVal) ?? appointmentDate;
  const isAppointmentBased = !leadCreatedDate && !inquiryDate && !guestCreatedDate &&
    !parseDate(createdVal) && !!appointmentDate;

  const leadId = h(row, "lead id", "leadid");
  const inquiryId = h(row, "inquiry id", "inquiryid");
  const prospectId = h(row, "prospect id", "prospectid");
  const guestId = h(row, "guest id", "guestid", "client id", "clientid");
  const appointmentId = h(row, "appointment id", "appointmentid");
  const name = h(row, "guest name", "lead name", "full name", "name", "client name") ||
    `${h(row, "first name")} ${h(row, "last name")}`.trim();
  const email = h(row, "email");
  const phone = h(row, "phone", "phone number", "mobile");
  const clinicRaw = h(row, "center", "clinic", "clinic location", "location");
  const serviceRaw = h(row, "service", "interested service", "treatment");
  const status = h(row, "status", "lead status");
  const source = h(row, "source", "lead source");

  const clinicNorm = normalizeClinicLocation(clinicRaw || undefined);
  const serviceNorm = normalizeService(serviceRaw || undefined);
  const externalId = leadId || inquiryId || prospectId ||
    (guestId ? `${guestId}|${leadDateVal || inquiryDateVal || createdVal || appointmentDateVal}` : undefined);

  return {
    sourceSystem: "ZENOTI",
    recordType: "INDIVIDUAL_LEAD",
    backendProvider: "ZENOTI",
    externalId,
    createdAtSource,
    leadCreatedDate: leadCreatedDate || undefined,
    inquiryDate: inquiryDate || undefined,
    guestCreatedDate: guestCreatedDate || undefined,
    appointmentDate: appointmentDate || undefined,
    zenotiAppointmentId: appointmentId || undefined,
    appointmentStatus: h(row, "appointment status") || undefined,
    fullName: name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    normalizedEmail: normalizeEmail(email),
    normalizedPhone: normalizePhone(phone),
    clinicLocationRaw: clinicRaw || undefined,
    clinicLocationNormalized: clinicNorm,
    zenotiCenterName: clinicRaw || undefined,
    serviceRaw: serviceRaw || undefined,
    serviceNormalized: serviceNorm,
    zenotiLeadId: leadId || undefined,
    zenotiInquiryId: inquiryId || undefined,
    zenotiProspectId: prospectId || undefined,
    zenotiGuestId: guestId || undefined,
    leadSource: source || undefined,
    status: status || undefined,
    isAppointmentBased,
    rawPayload: row,
    _unmappedClinic: isUnmappedClinic(clinicNorm),
    _unmappedService: isUnmappedService(serviceNorm),
    _dateInvalid: !createdAtSource,
  };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseCSV(csvText: string, sourceSystem: ParsedSourceSystem): ParseResult {
  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parseErrors.length > 0 && data.length === 0) {
    return { records: [], invalidRows: 0, errors: parseErrors.map((e) => e.message) };
  }

  const records: ParsedRecord[] = [];
  const errors: string[] = [];
  let invalidRows = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    try {
      let record: ParsedRecord;
      if (sourceSystem === "WEBSITE") record = parseWebsiteRow(row);
      else if (sourceSystem === "META") record = parseMetaRow(row);
      else if (sourceSystem === "GHL") record = parseGhlRow(row);
      else record = parseZenotiRow(row);

      if (record._dateInvalid) {
        errors.push(`Row ${i + 2}: Invalid or missing date`);
      }
      records.push(record);
    } catch (e: any) {
      invalidRows++;
      errors.push(`Row ${i + 2}: ${e?.message ?? "Unknown error"}`);
    }
  }

  return { records, invalidRows, errors };
}
