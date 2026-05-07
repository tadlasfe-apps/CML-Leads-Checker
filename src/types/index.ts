export type SourceSystem = "WORDPRESS" | "META" | "GHL" | "ZENOTI";
export type MatchStatus = "MATCHED" | "POSSIBLE_MATCH" | "UNMATCHED" | "DUPLICATE" | "NEEDS_REVIEW";
export type ReconciliationStatus =
  | "HEALTHY"
  | "MINOR_DISCREPANCY"
  | "MAJOR_DISCREPANCY"
  | "MISSING_GHL"
  | "MISSING_ZENOTI"
  | "DUPLICATE_ISSUE"
  | "NEEDS_REVIEW";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DashboardFilters {
  dateRange?: DateRange;
  clinicLocation?: string;
  service?: string;
  source?: SourceSystem;
  campaign?: string;
  status?: string;
  formName?: string;
  pageUrl?: string;
  utmSource?: string;
  utmCampaign?: string;
  reconciliationStatus?: ReconciliationStatus;
}

export interface KPIData {
  totalSourceLeads: number;
  wordpressLeads: number;
  metaLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  matchedLeads: number;
  missingInGhl: number;
  missingInZenoti: number;
  duplicateLeads: number;
  reconciliationRate: number;
}

export interface SourceComparisonRow {
  date?: string;
  clinicLocation?: string;
  service?: string;
  wordpressCount: number;
  metaCount: number;
  ghlCount: number;
  zenotiCount: number;
  sourcesToGhlDiff: number;
  ghlToZenotoDiff: number;
  discrepancyPct: number;
  status: ReconciliationStatus;
}

export interface ClinicBreakdown {
  clinicLocation: string;
  totalLeads: number;
  wordpressLeads: number;
  metaLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  matchedLeads: number;
  mismatchCount: number;
  duplicateCount: number;
  missingLeads: number;
  byService: ServiceBreakdown[];
}

export interface ServiceBreakdown {
  service: string;
  totalLeads: number;
  wordpressLeads: number;
  metaLeads: number;
  ghlLeads: number;
  zenotiLeads: number;
  matchedLeads: number;
  missingLeads: number;
  byClinc: { clinic: string; count: number }[];
}

export interface LeadRecord {
  id: string;
  sourceSystem: SourceSystem;
  externalId?: string | null;
  createdAtSource?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  clinicLocationRaw?: string | null;
  clinicLocationNormalized?: string | null;
  serviceRaw?: string | null;
  serviceNormalized?: string | null;
  campaignName?: string | null;
  formName?: string | null;
  pageUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  wordpressFormPlugin?: string | null;
  ghlContactId?: string | null;
  ghlOpportunityId?: string | null;
  zenotiGuestId?: string | null;
  zenotiAppointmentId?: string | null;
  matchScore?: number;
  matchStatus?: MatchStatus;
  isDuplicate?: boolean;
  notes?: string;
}

export interface WordPressFormRow {
  formName: string;
  pageUrl?: string;
  totalSubmissions: number;
  uniqueLeads: number;
  duplicateSubmissions: number;
  clinicLocation?: string;
  service?: string;
  utmSource?: string;
  utmCampaign?: string;
  ghlMatchedCount: number;
  zenotiMatchedCount: number;
  missingInGhl: number;
  missingInZenoti: number;
  ghlReconciliationRate: number;
  zenotiReconciliationRate: number;
  lastSubmissionDate?: string;
  reconciliationStatus: ReconciliationStatus;
}

export interface UploadResult {
  batchId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  errors: string[];
}

export interface ChartDataPoint {
  name: string;
  wordpress?: number;
  meta?: number;
  ghl?: number;
  zenoti?: number;
  matched?: number;
  unmatched?: number;
  value?: number;
}
