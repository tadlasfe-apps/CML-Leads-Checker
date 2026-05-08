"use client";
import { Badge } from "@/components/ui/badge";
import type { AuditStatus, DiscrepancyLocation } from "@/types";

type BadgeVariant = "success" | "warning" | "destructive" | "info" | "purple" | "outline";

const auditConfig: Record<AuditStatus, { label: string; variant: BadgeVariant }> = {
  PASSED:                { label: "Passed",                 variant: "success" },
  SOURCE_TO_GHL_ISSUE:   { label: "Source → GHL Issue",     variant: "warning" },
  GHL_TO_ZENOTI_ISSUE:   { label: "GHL → Zenoti Issue",     variant: "warning" },
  BOTH_ISSUES:           { label: "Both Issues",            variant: "destructive" },
  NEEDS_MAPPING:         { label: "Needs Mapping",          variant: "info" },
  NEEDS_REVIEW:          { label: "Needs Review",           variant: "purple" },
};

const discrepancyConfig: Record<DiscrepancyLocation, { label: string; variant: BadgeVariant }> = {
  NONE:           { label: "No Discrepancy",       variant: "success" },
  SOURCE_TO_GHL:  { label: "Source → GHL Gap",     variant: "warning" },
  GHL_TO_ZENOTI:  { label: "GHL → Zenoti Gap",     variant: "warning" },
  BOTH:           { label: "Both Gaps",             variant: "destructive" },
  NEEDS_MAPPING:  { label: "Needs Mapping",         variant: "info" },
  NEEDS_REVIEW:   { label: "Needs Review",          variant: "purple" },
};

export function AuditStatusBadge({ status }: { status: AuditStatus | string }) {
  const config = auditConfig[status as AuditStatus] ?? { label: status, variant: "outline" as BadgeVariant };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function DiscrepancyBadge({ location }: { location: DiscrepancyLocation | string }) {
  const config = discrepancyConfig[location as DiscrepancyLocation] ?? { label: location, variant: "outline" as BadgeVariant };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    WEBSITE: "info",
    META: "purple",
    GHL: "success",
    ZENOTI: "warning",
  };
  const labelMap: Record<string, string> = {
    WEBSITE: "Website",
    META: "Meta",
    GHL: "GHL",
    ZENOTI: "Zenoti",
  };
  return <Badge variant={variantMap[source] ?? "outline"}>{labelMap[source] ?? source}</Badge>;
}
