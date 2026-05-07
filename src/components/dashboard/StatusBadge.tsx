import { Badge } from "@/components/ui/badge";
import type { ReconciliationStatus, MatchStatus } from "@/types";

const reconciliationConfig: Record<ReconciliationStatus, { label: string; variant: "success" | "warning" | "destructive" | "info" | "purple" | "outline" }> = {
  HEALTHY: { label: "Healthy", variant: "success" },
  MINOR_DISCREPANCY: { label: "Minor Discrepancy", variant: "warning" },
  MAJOR_DISCREPANCY: { label: "Major Discrepancy", variant: "destructive" },
  MISSING_GHL: { label: "Missing in GHL", variant: "destructive" },
  MISSING_ZENOTI: { label: "Missing in Zenoti", variant: "warning" },
  DUPLICATE_ISSUE: { label: "Duplicate Issue", variant: "purple" },
  NEEDS_REVIEW: { label: "Needs Review", variant: "info" },
};

const matchConfig: Record<MatchStatus, { label: string; variant: "success" | "warning" | "destructive" | "info" | "purple" | "outline" }> = {
  MATCHED: { label: "Matched", variant: "success" },
  POSSIBLE_MATCH: { label: "Possible Match", variant: "warning" },
  UNMATCHED: { label: "Unmatched", variant: "destructive" },
  DUPLICATE: { label: "Duplicate", variant: "purple" },
  NEEDS_REVIEW: { label: "Needs Review", variant: "info" },
};

export function ReconciliationBadge({ status }: { status: ReconciliationStatus }) {
  const config = reconciliationConfig[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const config = matchConfig[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  const variantMap: Record<string, "info" | "purple" | "success" | "warning"> = {
    WORDPRESS: "info",
    META: "purple",
    GHL: "success",
    ZENOTI: "warning",
  };
  return <Badge variant={variantMap[source] ?? "outline"}>{source}</Badge>;
}
