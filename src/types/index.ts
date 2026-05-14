export type SourceSystem = "WEBSITE" | "META" | "GHL" | "ZENOTI";

export type RecordType = "INDIVIDUAL_LEAD" | "AGGREGATE_REPORT";

export type AuditStatus =
  | "PASSED"
  | "SOURCE_TO_GHL_ISSUE"
  | "GHL_TO_ZENOTI_ISSUE"
  | "BOTH_ISSUES"
  | "NEEDS_MAPPING"
  | "NEEDS_REVIEW"
  | "EXCLUDED";

export type DiscrepancyLocation =
  | "NONE"
  | "SOURCE_TO_GHL"
  | "GHL_TO_ZENOTI"
  | "BOTH"
  | "NEEDS_MAPPING"
  | "NEEDS_REVIEW";

export type DateGrouping = "daily" | "weekly" | "monthly" | "quarterly";

// Dimension grouping for Source Comparison — determines which dimensions appear as columns
export type ComparisonDimension = "date" | "date+clinic" | "date+service" | "date+clinic+service";
export const COMPARISON_DIMENSIONS: ComparisonDimension[] = [
  "date",
  "date+clinic",
  "date+service",
  "date+clinic+service",
];
export const COMPARISON_DIMENSION_LABELS: Record<ComparisonDimension, string> = {
  "date":                "Date only",
  "date+clinic":         "Date + Clinic",
  "date+service":        "Date + Service",
  "date+clinic+service": "Date + Clinic + Service",
};

export type ReportingTimezone =
  | "America/Toronto"
  | "America/Vancouver"
  | "UTC";

export type GhlDateBasis =
  | "contact_created"
  | "opportunity_created"
  | "opportunity_updated";

export type ZenotiDateBasis =
  | "lead_created"
  | "inquiry_date"
  | "guest_created"
  | "created_date";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DateRangeFilter {
  preset: string;
  from: string; // yyyy-MM-dd
  to: string;   // yyyy-MM-dd
}

// ─── Overview ───────────────────────────────────────────────────────────────

export interface OverviewKPIs {
  websiteLeads: number;
  metaLeads: number;
  totalSourceLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  srcToGhlDiff: number;
  ghlToZenotiDiff: number;
  srcToGhlMatchRate: number | null;
  ghlToZenotiMatchRate: number | null;
  datesWithSrcGhlDiscrepancy: number;
  datesWithGhlZenotiDiscrepancy: number;
  biggestDiscrepancyDate: string | null;
  biggestDiscrepancyValue: number;
  duplicateWebsiteLeads: number;
  unmappedClinicCount: number;
  unmappedServiceCount: number;
}

export interface TimelineEntry {
  date: string;
  websiteLeads: number;
  metaLeads: number;
  totalSource: number;
  ghlLeads: number;
  zenotiLeads: number;
  srcToGhlDiff: number;
  ghlToZenotiDiff: number;
}

// ─── Source Comparison ───────────────────────────────────────────────────────

export interface SourceComparisonRow {
  period: string;         // date or week/month label
  periodStart: string;    // iso date
  periodEnd: string;
  // Optional dimension fields — populated when ComparisonDimension includes clinic/service
  clinic?: string;
  service?: string;
  websiteLeads: number;
  metaLeads: number;
  totalSourceLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  srcToGhlDiff: number;
  ghlToZenotiDiff: number;
  srcToGhlMatchRate: number | null;
  ghlToZenotiMatchRate: number | null;
  discrepancyLocation: DiscrepancyLocation;
  status: AuditStatus;
}

export interface SourceComparisonDiagnostics {
  websiteTotal: number;
  metaTotal: number;
  ghlTotal: number;
  zenotiTotal: number;
  websiteUnknownClinic: number;
  websiteUnknownService: number;
  metaUnknownClinic: number;
  metaUnknownService: number;
  ghlUnknownClinic: number;
  ghlUnknownService: number;
  zenotiUnknownClinic: number;
  zenotiUnknownService: number;
  groupCount: number;
  dateRange: string;
  dimensionGroupBy: string;
  serviceFilter: string;
  clinicFilter: string;
}

export interface DrilldownRow {
  label: string;
  websiteLeads: number;
  metaLeads: number;
  totalSourceLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  srcToGhlDiff: number;
  ghlToZenotiDiff: number;
  status: AuditStatus;
}

// ─── Website Leads ───────────────────────────────────────────────────────────

export interface WebsiteFormRow {
  id: string;
  formName: string;
  formId: string | null;
  websiteFormSource: string | null;
  backendProvider: string | null;
  pageUrl: string | null;
  totalSubmissions: number;
  uniqueLeads: number;
  duplicateCount: number;
  ghlCount: number;
  zenotiCount: number;
  websiteToGhlDiff: number;
  websiteToZenotiDiff: number;
  websiteToGhlMatchRate: number;
  websiteToZenotiMatchRate: number;
  status: AuditStatus;
  lastSubmissionAt: string | null;
  excludedFromLeadCount: boolean;
}

// ─── Meta Leads ──────────────────────────────────────────────────────────────

export interface MetaAggregateRow {
  id: string;
  reportDate: string;
  campaignName: string | null;
  campaignId: string | null;
  adSetName: string | null;
  adSetId: string | null;
  adName: string | null;
  adId: string | null;
  objective: string | null;
  conversionGoal: string | null;
  resultType: string | null;
  results: number;
  metaLeadCount: number;
  spend: number;
  costPerResult: number | null;
  impressions: number;
  clinicLocation: string | null;
  service: string | null;
}

export interface MetaSummaryRow {
  period: string;
  metaLeadResults: number;
  totalResults: number;
  spend: number;
  costPerLead: number | null;
  campaignCount: number;
  byCampaign: { campaign: string; leads: number; spend: number }[];
  byResultType: { resultType: string; leads: number }[];
}

// ─── Clinic / Service ────────────────────────────────────────────────────────

export interface ClinicBreakdownRow {
  clinicLocation: string;
  websiteLeads: number;
  metaLeads: number;
  totalSourceLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  duplicateCount: number;
  srcToGhlDiff: number;
  ghlToZenotiDiff: number;
  srcToGhlMatchRate: number | null;
  ghlToZenotiMatchRate: number | null;
  unmappedServiceCount: number;
  discrepancyLocation: DiscrepancyLocation;
  status: AuditStatus;
}

export interface ServiceBreakdownRow {
  service: string;
  websiteLeads: number;
  metaLeads: number;
  totalSourceLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  srcToGhlDiff: number;
  ghlToZenotiDiff: number;
  srcToGhlMatchRate: number | null;
  ghlToZenotiMatchRate: number | null;
  discrepancyLocation: DiscrepancyLocation;
  status: AuditStatus;
}

// ─── API Syncs ───────────────────────────────────────────────────────────────

export interface SyncRunRow {
  id: string;
  sourceSystem: SourceSystem;
  syncType: "API" | "CSV";
  startedAt: string;
  finishedAt: string | null;
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errorMessage: string | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
}

export interface IntegrationSettingsRow {
  id: string;
  sourceSystem: SourceSystem;
  provider: string | null;
  enabled: boolean;
  lastSyncedAt: string | null;
}

// ─── Mappings ────────────────────────────────────────────────────────────────

export interface MappingRow {
  id: string;
  rawValue: string;
  normalizedValue: string;
  active: boolean;
}

export interface WebsiteFormNameMappingRow extends MappingRow {
  formId: string | null;
  backendProvider: string | null;
}

// ─── Import ──────────────────────────────────────────────────────────────────

export interface ImportResult {
  batchId: string;
  fileName: string;
  sourceSystem: SourceSystem;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  unmappedClinicRows: number;
  unmappedServiceRows: number;
  unmappedFormSourceRows: number;
  importedDateRangeStart: string | null;
  importedDateRangeEnd: string | null;
  errors: string[];
  status: "COMPLETED" | "FAILED";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const META_LEAD_RESULT_TYPES = [
  "Lead",
  "Leads",
  "On-Facebook Leads",
  "Website Leads",
  "Messaging Leads",
  "Conversion Leads",
  "Instant Form Leads",
] as const;

export const WEBSITE_FORM_SOURCES = [
  "Popup",
  "Website Quiz",
  "Landing Page Form",
  "Contact Form",
  "Free Consultation Form",
  "Service Page Form",
  "Exit Intent Popup",
  "Promo Page Form",
  "Other",
  "Unknown",
] as const;

export const DATE_GROUPINGS: DateGrouping[] = ["daily", "weekly", "monthly", "quarterly"];

// Canonical clinic locations (current website location names)
export const CANONICAL_CLINICS: string[] = [
  "Toronto", "Newmarket", "Mississauga", "Vaughan", "Thornhill",
  "Maple", "Barrie", "Oakville", "Etobicoke", "Whitby",
  "Midtown", "Scarborough", "Yorkville", "Burlington", "Queen West",
];

// Canonical service names
export const CANONICAL_SERVICES: string[] = [
  "Laser Hair Removal", "Morpheus8", "Botox", "Microneedling",
  "Salmon DNA", "Microneedling & Salmon DNA", "PRP", "Hair Restoration",
  "CoolSculpting", "Venus Viva", "Vaginal Rejuvenation", "Intimate Peel",
  "Express Facial", "Consultation",
];

export const REPORTING_TIMEZONES: ReportingTimezone[] = [
  "America/Toronto",
  "America/Vancouver",
  "UTC",
];
