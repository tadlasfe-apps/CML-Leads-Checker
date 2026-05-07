import Papa from "papaparse";
import { normalizeEmail, normalizePhone, normalizeClinicLocation, normalizeService } from "./normalization";
import type { SourceSystem } from "@/types";

type RawRow = Record<string, string>;

export interface ParsedLead {
  sourceSystem: SourceSystem;
  externalId?: string;
  createdAtSource?: Date;
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
  adSetName?: string;
  adName?: string;
  formName?: string;
  formId?: string;
  leadSource?: string;
  pageUrl?: string;
  landingPageUrl?: string;
  referrerUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  wordpressSubmissionId?: string;
  wordpressFormPlugin?: string;
  ghlContactId?: string;
  ghlOpportunityId?: string;
  zenotiGuestId?: string;
  zenotiAppointmentId?: string;
  status?: string;
  rawPayload?: Record<string, string>;
  errors: string[];
}

function pick(row: RawRow, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (val?.trim()) return val.trim();
  }
  return undefined;
}

function parseDate(val?: string): Date | undefined {
  if (!val) return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

export function parseWordPressCSV(csvText: string): ParsedLead[] {
  const { data } = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });
  return data.map((row) => {
    const errors: string[] = [];
    const firstName = pick(row, "First Name", "first_name", "firstname");
    const lastName = pick(row, "Last Name", "last_name", "lastname");
    const fullNameRaw =
      pick(row, "Full Name", "full_name", "Name", "name") ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      undefined;
    const email = pick(row, "Email", "email");
    const phone = pick(row, "Phone", "phone", "Phone Number", "phone_number");

    if (!email && !phone) errors.push("Missing email and phone");

    const clinicRaw = pick(row, "Location", "Clinic", "Clinic Location", "clinic_location", "location");
    const serviceRaw = pick(row, "Service", "Treatment", "service", "treatment");

    return {
      sourceSystem: "WORDPRESS" as SourceSystem,
      wordpressSubmissionId: pick(row, "Submission ID", "submission_id", "Entry ID", "entry_id"),
      formId: pick(row, "Form ID", "form_id"),
      wordpressFormPlugin: pick(row, "Form Plugin", "form_plugin"),
      createdAtSource: parseDate(
        pick(row, "Date", "Submitted At", "Created At", "submitted_at", "created_at", "date")
      ),
      firstName,
      lastName,
      fullName: fullNameRaw,
      email,
      phone,
      normalizedEmail: normalizeEmail(email),
      normalizedPhone: normalizePhone(phone),
      clinicLocationRaw: clinicRaw,
      clinicLocationNormalized: normalizeClinicLocation(clinicRaw),
      serviceRaw,
      serviceNormalized: normalizeService(serviceRaw),
      campaignName: pick(row, "UTM Campaign", "utm_campaign"),
      formName: pick(row, "Form Name", "form_name"),
      pageUrl: pick(row, "Page URL", "page_url", "Source URL", "source_url"),
      landingPageUrl: pick(row, "Landing Page URL", "landing_page_url"),
      referrerUrl: pick(row, "Referrer URL", "referrer_url"),
      utmSource: pick(row, "UTM Source", "utm_source"),
      utmMedium: pick(row, "UTM Medium", "utm_medium"),
      utmCampaign: pick(row, "UTM Campaign", "utm_campaign"),
      utmContent: pick(row, "UTM Content", "utm_content"),
      utmTerm: pick(row, "UTM Term", "utm_term"),
      rawPayload: row,
      errors,
    };
  });
}

export function parseMetaCSV(csvText: string): ParsedLead[] {
  const { data } = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });
  return data.map((row) => {
    const errors: string[] = [];
    const email = pick(row, "email", "Email");
    const phone = pick(row, "phone_number", "phone", "Phone");
    if (!email && !phone) errors.push("Missing email and phone");

    const clinicRaw = pick(row, "clinic_location", "location", "Clinic Location");
    const serviceRaw = pick(row, "service", "Service", "treatment");

    return {
      sourceSystem: "META" as SourceSystem,
      externalId: pick(row, "id", "lead_id"),
      createdAtSource: parseDate(pick(row, "created_time", "date", "Date")),
      fullName: pick(row, "full_name", "name", "Name"),
      email,
      phone,
      normalizedEmail: normalizeEmail(email),
      normalizedPhone: normalizePhone(phone),
      clinicLocationRaw: clinicRaw,
      clinicLocationNormalized: normalizeClinicLocation(clinicRaw),
      serviceRaw,
      serviceNormalized: normalizeService(serviceRaw),
      campaignName: pick(row, "campaign_name", "Campaign Name"),
      adSetName: pick(row, "adset_name", "Ad Set Name"),
      adName: pick(row, "ad_name", "Ad Name"),
      formName: pick(row, "form_name", "Form Name"),
      leadSource: "Meta",
      rawPayload: row,
      errors,
    };
  });
}

export function parseGHLCSV(csvText: string): ParsedLead[] {
  const { data } = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });
  return data.map((row) => {
    const errors: string[] = [];
    const email = pick(row, "Email", "email");
    const phone = pick(row, "Phone", "phone");
    if (!email && !phone) errors.push("Missing email and phone");

    const firstName = pick(row, "First Name", "first_name");
    const lastName = pick(row, "Last Name", "last_name");
    const fullName = pick(row, "Full Name") || [firstName, lastName].filter(Boolean).join(" ") || undefined;

    const clinicRaw = pick(row, "Location", "location", "Clinic");
    const serviceRaw = pick(row, "Service", "service", "Pipeline");

    return {
      sourceSystem: "GHL" as SourceSystem,
      ghlContactId: pick(row, "Contact Id", "contact_id"),
      ghlOpportunityId: pick(row, "Opportunity Id", "opportunity_id"),
      createdAtSource: parseDate(pick(row, "Created", "created_at", "Date")),
      firstName,
      lastName,
      fullName,
      email,
      phone,
      normalizedEmail: normalizeEmail(email),
      normalizedPhone: normalizePhone(phone),
      clinicLocationRaw: clinicRaw,
      clinicLocationNormalized: normalizeClinicLocation(clinicRaw),
      serviceRaw,
      serviceNormalized: normalizeService(serviceRaw),
      campaignName: pick(row, "Campaign", "campaign", "Campaign Name"),
      status: pick(row, "Stage", "Status", "stage"),
      leadSource: pick(row, "Source", "source"),
      rawPayload: row,
      errors,
    };
  });
}

export function parseZenotiCSV(csvText: string): ParsedLead[] {
  const { data } = Papa.parse<RawRow>(csvText, { header: true, skipEmptyLines: true });
  return data.map((row) => {
    const errors: string[] = [];
    const email = pick(row, "Email", "email");
    const phone = pick(row, "Phone", "phone");
    if (!email && !phone) errors.push("Missing email and phone");

    const clinicRaw = pick(row, "Center", "center", "Clinic", "Location");
    const serviceRaw = pick(row, "Service", "service");

    return {
      sourceSystem: "ZENOTI" as SourceSystem,
      zenotiGuestId: pick(row, "Guest Id", "guest_id"),
      zenotiAppointmentId: pick(row, "Appointment Id", "appointment_id"),
      createdAtSource: parseDate(pick(row, "Created Date", "Appointment Date", "Date", "created_date")),
      fullName: pick(row, "Guest Name", "guest_name", "Name"),
      email,
      phone,
      normalizedEmail: normalizeEmail(email),
      normalizedPhone: normalizePhone(phone),
      clinicLocationRaw: clinicRaw,
      clinicLocationNormalized: normalizeClinicLocation(clinicRaw),
      serviceRaw,
      serviceNormalized: normalizeService(serviceRaw),
      status: pick(row, "Status", "status"),
      leadSource: pick(row, "Source", "source"),
      rawPayload: row,
      errors,
    };
  });
}
