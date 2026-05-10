"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Globe, Share2, Database, Activity,
  RefreshCw, CheckCircle2, XCircle, Loader2, Clock,
  Upload, FileText, Info, Search, Copy, Check, ChevronDown, ChevronRight,
  Download,
} from "lucide-react";
import { format } from "date-fns";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function sevenDaysAgoStr() {
  return new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
}

// ─── Source config ────────────────────────────────────────────────────────────

const SOURCE_CONFIG = {
  WEBSITE: {
    label: "Website Leads",
    provider: "Gravity Forms",
    icon: Globe,
    color: "info" as const,
    description:
      "Individual form submissions from your website. Imported via CSV or pulled via Gravity Forms API.",
    csvLabel: "Import Website Leads CSV",
    apiEndpoint: "/api/sync/website-leads",
    apiLabel: "Pull via Gravity Forms API",
    hasApi: true,
  },
  META: {
    label: "Meta Lead Results",
    provider: "Meta Ads Insights",
    icon: Share2,
    color: "purple" as const,
    description:
      "Aggregate lead result counts from Meta Ads Manager. Only lead-type result actions are counted.",
    csvLabel: "Import Meta Ads CSV",
    apiEndpoint: "/api/sync/meta",
    apiLabel: "Pull via Meta Ads API",
    hasApi: true,
  },
  GHL: {
    label: "GHL Lead Inquiry Pipeline",
    provider: "GoHighLevel",
    icon: Database,
    color: "success" as const,
    description:
      "Contacts or opportunities from the Lead Inquiry pipeline only. Read-only — no records are created or updated in GHL.",
    csvLabel: "Import GHL Pipeline CSV",
    apiEndpoint: "/api/sync/ghl",
    apiLabel: "Pull via GHL API",
    hasApi: true,
  },
  ZENOTI: {
    label: "Zenoti Leads",
    provider: "Zenoti",
    icon: Activity,
    color: "warning" as const,
    description:
      "Lead/opportunity counts from Zenoti. CSV import is the primary method. Rows with only appointment dates are excluded from lead counts.",
    csvLabel: "Import Zenoti Leads CSV",
    apiEndpoint: null,
    apiLabel: null,
    hasApi: false,
  },
} as const;

type SourceKey = keyof typeof SOURCE_CONFIG;

const SYNC_STATUS_CONFIG: Record<string, { label: string; variant: any; icon: any }> = {
  COMPLETED: { label: "Completed", variant: "success",     icon: CheckCircle2 },
  FAILED:    { label: "Failed",    variant: "destructive", icon: XCircle },
  RUNNING:   { label: "Running",   variant: "info",        icon: Loader2 },
  IDLE:      { label: "Idle",      variant: "outline",     icon: Clock },
};

// ─── GHL Pipeline lookup types ────────────────────────────────────────────────

interface GhlStage    { id: string; name: string; position: number; }
interface GhlPipeline { id: string; name: string; stages: GhlStage[]; }

const LEAD_INQUIRY_NAMES = ["lead inquiry", "lead inquiry pipeline"];
function isLeadInquiryPipeline(name: unknown) {
  if (!name || typeof name !== "string") return false;
  return LEAD_INQUIRY_NAMES.includes(name.toLowerCase().trim());
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-current hover:opacity-80 transition-opacity"
      title={text}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Shared date-range inputs ─────────────────────────────────────────────────

function DateRangeInputs({
  from, to,
  onFrom, onTo,
}: {
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>From</span>
        <input
          type="date" value={from} max={to}
          onChange={(e) => onFrom(e.target.value)}
          className="border rounded px-1.5 py-0.5 text-xs text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>To</span>
        <input
          type="date" value={to} min={from} max={todayStr()}
          onChange={(e) => onTo(e.target.value)}
          className="border rounded px-1.5 py-0.5 text-xs text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </>
  );
}

// ─── Not-configured notice ────────────────────────────────────────────────────

function NotConfigured({ reason }: { reason: string }) {
  return (
    <div className="border-t pt-3 mt-3">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0" />
        {reason}
      </p>
    </div>
  );
}

// ─── Generic API pull section (WEBSITE, META) ─────────────────────────────────

function ApiPullSection({
  apiLabel, endpoint, configured, notConfiguredReason, onComplete, metaAccountCount,
}: {
  apiLabel: string; endpoint: string;
  configured: boolean; notConfiguredReason?: string;
  onComplete: () => void;
  metaAccountCount?: number;
}) {
  const [loading,             setLoading]             = useState(false);
  const [from,                setFrom]                = useState(sevenDaysAgoStr);
  const [to,                  setTo]                  = useState(todayStr);
  const [result,              setResult]              = useState<{
    fetched: number; created: number; skipped: number;
    warning?: string; step?: string; partialSuccess?: boolean;
    byAccount?: Array<{ accountId: string; accountName?: string; rowsFetched: number; leadsFound: number; spend: number }>;
    sampleSaved?: any[];
  } | null>(null);
  const [error,               setError]               = useState<string | null>(null);
  const [clearConfirm,        setClearConfirm]        = useState(false);
  const [clearLoading,        setClearLoading]        = useState(false);
  const [clearResult,         setClearResult]         = useState<{ deleted: number } | null>(null);
  const [fixLoading,          setFixLoading]          = useState(false);
  const [fixResult,           setFixResult]           = useState<{ totalPatched: number; groupsProcessed: number } | null>(null);
  const [fixError,            setFixError]            = useState<string | null>(null);
  const [metaBackfillLoading, setMetaBackfillLoading] = useState(false);
  const [metaBackfillResult,  setMetaBackfillResult]  = useState<{ totalPatched: number; totalProcessed: number } | null>(null);
  const [metaBackfillError,   setMetaBackfillError]   = useState<string | null>(null);

  async function runPull() {
    setLoading(true); setResult(null); setError(null);
    try {
      const res  = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const json = await res.json();
      if (json.error && !json.partialSuccess) {
        setError(json.details ?? json.error ?? "Unknown error");
      } else {
        setResult({
          fetched:        json.fetched ?? json.rowsFetched ?? 0,
          created:        json.created ?? json.recordsCreated ?? 0,
          skipped:        json.skipped ?? json.recordsSkipped ?? 0,
          warning:        json.warning ?? undefined,
          step:           json.step ?? undefined,
          partialSuccess: !!json.partialSuccess,
          byAccount:      json.byAccount ?? undefined,
          sampleSaved:    json.sampleSaved ?? undefined,
        });
        onComplete();
      }
    } catch (err: any) { setError(err?.message ?? "Unexpected error"); }
    setLoading(false);
  }

  async function runFix() {
    setFixLoading(true); setFixResult(null); setFixError(null);
    try {
      const res  = await fetch("/api/debug/fix-website-sources", { method: "POST" });
      const json = await res.json();
      if (json.error) setFixError(json.error);
      else setFixResult({ totalPatched: json.totalPatched ?? 0, groupsProcessed: json.groupsProcessed ?? 0 });
    } catch (err: any) { setFixError(err?.message ?? "Unexpected error"); }
    setFixLoading(false);
  }

  async function runMetaClinicBackfill() {
    setMetaBackfillLoading(true); setMetaBackfillResult(null); setMetaBackfillError(null);
    try {
      const res  = await fetch("/api/debug/backfill-meta-clinic", { method: "POST" });
      const json = await res.json();
      if (json.error) setMetaBackfillError(json.error);
      else setMetaBackfillResult({ totalPatched: json.totalPatched ?? 0, totalProcessed: json.totalProcessed ?? 0 });
    } catch (err: any) { setMetaBackfillError(err?.message ?? "Unexpected error"); }
    setMetaBackfillLoading(false);
  }

  async function runClear() {
    setClearLoading(true);
    setClearResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/sync/meta/clear", { method: "POST" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setClearResult({ deleted: json.deleted ?? 0 });
        setClearConfirm(false);
        onComplete();
      }
    } catch (err: any) { setError(err?.message ?? "Unexpected error"); }
    setClearLoading(false);
  }

  if (!configured) return <NotConfigured reason={notConfiguredReason ?? "Configure credentials in .env to enable API pulls."} />;

  const isPartial = result?.partialSuccess;
  const isMeta = endpoint.includes("/meta");

  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Pull</p>
      {isMeta && metaAccountCount != null && metaAccountCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {metaAccountCount} ad account{metaAccountCount !== 1 ? "s" : ""} configured
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangeInputs from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <Button size="sm" variant="outline" onClick={runPull} disabled={loading} className="flex items-center gap-1.5 text-xs h-7">
          {loading ? <><Loader2 className="w-3 h-3 animate-spin" /> Pulling…</> : <><Download className="w-3 h-3" /> {apiLabel}</>}
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
          <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
      {result && (
        <div className={`rounded-md border ${isPartial ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"} px-3 py-2 flex items-center gap-3 flex-wrap`}>
          <CheckCircle2 className={`w-3.5 h-3.5 ${isPartial ? "text-amber-600" : "text-green-600"} shrink-0`} />
          <span className={`text-xs ${isPartial ? "text-amber-800" : "text-green-800"}`}>
            Pulled <strong>{result.fetched}</strong> records —{" "}
            <strong className={isPartial ? "text-amber-700" : "text-green-700"}>{result.created}</strong> added,{" "}
            <span className="text-muted-foreground">{result.skipped} skipped</span>
            {isPartial && <span className="ml-1 font-medium">— with post-processing warning</span>}
          </span>
        </div>
      )}
      {result?.warning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800 space-y-0.5">
            <p className="font-medium">Post-processing warning{result.step ? ` (step: ${result.step})` : ""}</p>
            <p>{result.warning}</p>
          </div>
        </div>
      )}
      {/* Per-account breakdown (Meta only) */}
      {result?.byAccount && result.byAccount.length > 0 && (
        <div className="rounded-md border bg-muted/20 overflow-hidden">
          <p className="text-xs font-medium text-muted-foreground px-3 py-1.5 border-b uppercase tracking-wide">
            Per-Account Results
          </p>
          <div className="divide-y">
            {result.byAccount.map((acct) => (
              <div key={acct.accountId} className="px-3 py-1.5 grid grid-cols-2 gap-x-4 gap-y-0 text-xs">
                <span className="text-muted-foreground">Account</span>
                <span className="font-mono truncate">{acct.accountName ?? acct.accountId}</span>
                <span className="text-muted-foreground">Rows fetched</span>
                <span className="tabular-nums">{acct.rowsFetched}</span>
                <span className="text-muted-foreground">Leads found</span>
                <span className="tabular-nums font-semibold text-purple-600">{acct.leadsFound}</span>
                <span className="text-muted-foreground">Spend</span>
                <span className="tabular-nums">${acct.spend.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample saved records */}
      {result?.sampleSaved && result.sampleSaved.length > 0 && (
        <div className="rounded-md border bg-muted/20 overflow-hidden">
          <p className="text-xs font-medium text-muted-foreground px-3 py-1.5 border-b uppercase tracking-wide">
            Most Recent Saved Records ({result.sampleSaved.length})
          </p>
          <div className="divide-y">
            {result.sampleSaved.map((r: any, i: number) => (
              <div key={i} className="px-3 py-1.5 text-xs font-mono text-muted-foreground truncate">
                {r.externalId?.slice(0, 20)}… · {r.formName ?? r.campaignName ?? "—"} · {r.createdAtSource?.slice(0, 10) ?? r.reportDate?.slice(0, 10) ?? "no date"} · imported {r.importedAt?.slice(0, 10) ?? "?"}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix Website Form Sources (Website only) */}
      {!isMeta && (
        <div className="border-t pt-3 mt-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Data Repair</p>
          <p className="text-xs text-muted-foreground">
            Re-infers <code className="bg-gray-100 px-1 rounded">websiteFormSource</code> for all records stored as "Unknown" using their saved form name.
            Run once after a pull to fix existing records.
          </p>
          <Button
            size="sm" variant="outline"
            onClick={runFix} disabled={fixLoading}
            className="flex items-center gap-1.5 text-xs h-7"
          >
            {fixLoading
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Fixing…</>
              : <><RefreshCw className="w-3 h-3" /> Fix Website Form Sources</>}
          </Button>
          {fixError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
              <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700">{fixError}</p>
            </div>
          )}
          {fixResult && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
              <span className="text-xs text-green-800">
                Patched <strong>{fixResult.totalPatched}</strong> record{fixResult.totalPatched !== 1 ? "s" : ""} across{" "}
                {fixResult.groupsProcessed} form group{fixResult.groupsProcessed !== 1 ? "s" : ""}.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Backfill Meta Clinic Mapping (Meta only) */}
      {isMeta && (
        <div className="border-t pt-3 mt-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Data Repair</p>
          <p className="text-xs text-muted-foreground">
            Re-infers <code className="bg-gray-100 px-1 rounded">clinicLocationNormalized</code> for all existing Meta records
            using account name and campaign name. Does not call Meta API.
          </p>
          <Button size="sm" variant="outline" onClick={runMetaClinicBackfill} disabled={metaBackfillLoading}
            className="flex items-center gap-1.5 text-xs h-7">
            {metaBackfillLoading
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Backfilling…</>
              : <><RefreshCw className="w-3 h-3" /> Backfill Meta Clinic Mapping</>}
          </Button>
          {metaBackfillError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
            <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{metaBackfillError}</p>
          </div>}
          {metaBackfillResult && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
            <span className="text-xs text-green-800">
              Patched <strong>{metaBackfillResult.totalPatched}</strong> of {metaBackfillResult.totalProcessed} Meta records.
            </span>
          </div>}
        </div>
      )}

      {/* Clear Meta Records (Meta only) */}
      {isMeta && (
        <div className="border-t pt-3 mt-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Data Management</p>
          {!clearConfirm ? (
            <Button
              size="sm" variant="outline"
              onClick={() => { setClearConfirm(true); setClearResult(null); setError(null); }}
              className="flex items-center gap-1.5 text-xs h-7 border-red-300 text-red-600 hover:bg-red-50"
            >
              <XCircle className="w-3 h-3" /> Clear Meta Records
            </Button>
          ) : (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-2">
              <p className="text-xs text-red-800 font-medium">
                This will permanently delete all Meta records from the checker. Website, GHL, and Zenoti records are not affected.
              </p>
              <p className="text-xs text-red-700">
                After clearing, re-pull Meta data to reload with account IDs.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={runClear}
                  disabled={clearLoading}
                  className="flex items-center gap-1.5 text-xs h-7 bg-red-600 hover:bg-red-700 text-white"
                >
                  {clearLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Clearing…</> : "Confirm — Clear Meta Records"}
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={() => setClearConfirm(false)}
                  disabled={clearLoading}
                  className="text-xs h-7"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {clearResult && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
              <span className="text-xs text-green-800">
                Cleared <strong>{clearResult.deleted}</strong> Meta record{clearResult.deleted !== 1 ? "s" : ""}. Re-pull to reload with account IDs.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GHL pull section (with date basis + full diagnostics) ────────────────────

type DateBasis = "opportunityCreatedDate" | "opportunityUpdatedDate" | "contactCreatedDate";

const DATE_BASIS_OPTIONS: { value: DateBasis; label: string }[] = [
  { value: "opportunityCreatedDate", label: "Opportunity created date (default)" },
  { value: "opportunityUpdatedDate", label: "Opportunity updated date" },
  { value: "contactCreatedDate",     label: "Contact created date" },
];

function GhlDiagPanel({ diag }: { diag: any }) {
  const rows: [string, React.ReactNode][] = [
    ["Endpoint",                   <code className="text-xs font-mono break-all">{diag.url || diag.endpoint}</code>],
    ["Method",                     diag.method ?? "GET"],
    ["GHL_LOCATION_ID present",    diag.hasLocationId   ? "✓ yes" : "✗ missing"],
    ["GHL_PIPELINE_ID present",    diag.hasPipelineId   ? "✓ yes" : "✗ missing"],
    ["Query params",               <code className="text-xs font-mono">{JSON.stringify(diag.queryParams ?? {})}</code>],
    ["Date range",                 diag.dateRange ?? "—"],
    ["Date basis",                 diag.dateBasis ?? "—"],
    ["API status code",            diag.apiStatusCode ?? "—"],
    ["API response summary",       diag.responseSummary || "—"],
    ["Records fetched",            <strong>{diag.recordsFetched ?? 0}</strong>],
    ["After date filter",          diag.recordsAfterDateFilter ?? "—"],
    ["Created",                    <strong className="text-green-700">{diag.recordsCreated ?? "—"}</strong>],
    ["Skipped (already exist)",    diag.recordsSkipped ?? "—"],
  ];

  return (
    <div className="space-y-2 mt-2">
      {(diag.warnings ?? []).map((w: string, i: number) => (
        <div key={i} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">{w}</p>
        </div>
      ))}
      <div className="rounded-md border bg-muted/30 overflow-hidden">
        <p className="text-xs font-medium text-muted-foreground px-3 py-1.5 border-b uppercase tracking-wide">
          Diagnostics
        </p>
        <div className="divide-y">
          {rows.map(([label, val]) => (
            <div key={String(label)} className="flex items-start gap-2 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground w-48 shrink-0">{label}</span>
              <span className="flex-1 min-w-0 break-all">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GhlPullSection({
  configured, notConfiguredReason, onComplete,
}: {
  configured: boolean; notConfiguredReason?: string; onComplete: () => void;
}) {
  const [loading,     setLoading]     = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [from,        setFrom]        = useState(sevenDaysAgoStr);
  const [to,          setTo]          = useState(todayStr);
  const [dateBasis,   setDateBasis]   = useState<DateBasis>("opportunityCreatedDate");
  const [diag,         setDiag]         = useState<any | null>(null);
  const [sample,       setSample]       = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callApi(extraBody: Record<string, any>, isTest: boolean) {
    const setter = isTest ? setTestLoading : setLoading;
    setter(true);
    setDiag(null);
    setSample(null);
    setError(null);
    try {
      const res  = await fetch("/api/sync/ghl", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ from, to, dateBasis, ...extraBody }),
      });
      const json = await res.json();
      if (json.diag)   setDiag(json.diag);
      if (json.sample) setSample(json.sample);
      if (json.error)  setError(json.error);
      else if (!isTest) onComplete();
    } catch (err: any) { setError(err?.message ?? "Unexpected error"); }
    setter(false);
  }

  if (!configured) return <NotConfigured reason={notConfiguredReason ?? "Configure GHL credentials in .env."} />;

  const anyLoading = loading || testLoading;

  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Pull</p>

      {/* Date range */}
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangeInputs from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {/* Date basis + action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-muted-foreground shrink-0">Date basis</label>
        <select
          value={dateBasis}
          onChange={(e) => setDateBasis(e.target.value as DateBasis)}
          disabled={anyLoading}
          className="border rounded px-1.5 py-0.5 text-xs text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {DATE_BASIS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Test pull — 20 records, no DB write */}
        <Button
          size="sm" variant="outline"
          onClick={() => callApi({ test: true }, true)}
          disabled={anyLoading}
          className="flex items-center gap-1.5 text-xs h-7 border-amber-400 text-amber-700 hover:bg-amber-50"
        >
          {testLoading
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Testing…</>
            : <><Search className="w-3 h-3" /> Test GHL Pull</>}
        </Button>

        {/* Full pull */}
        <Button
          size="sm" variant="outline"
          onClick={() => callApi({}, false)}
          disabled={anyLoading}
          className="flex items-center gap-1.5 text-xs h-7"
        >
          {loading
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Pulling…</>
            : <><Download className="w-3 h-3" /> Pull via GHL API</>}
        </Button>
      </div>

      {/* Labels */}
      <p className="text-xs text-muted-foreground">
        <span className="text-amber-700 font-medium">Test GHL Pull</span> — fetches up to 20 records, no date filter, nothing saved.{" "}
        <span className="font-medium">Pull via GHL API</span> — full pull with date filter, saves to checker.
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
          <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {diag && <GhlDiagPanel diag={diag} />}

      {/* Sample records from test pull */}
      {sample && sample.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <p className="text-xs font-medium text-muted-foreground px-3 py-1.5 border-b bg-muted/30 uppercase tracking-wide">
            Sample records ({sample.length} shown)
          </p>
          <div className="divide-y">
            {sample.map((s: any, i: number) => (
              <div key={i} className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">ID</span>
                <code className="font-mono truncate">{s.id ?? "—"}</code>
                <span className="text-muted-foreground">Name</span>
                <span>{s.name ?? "—"}</span>
                <span className="text-muted-foreground">Stage</span>
                <span>{s.stageName ?? "—"}</span>
                <span className="text-muted-foreground">Status</span>
                <span>{s.status ?? "—"}</span>
                <span className="text-muted-foreground">Created at</span>
                <span>{s.createdAt ? String(s.createdAt).slice(0, 19).replace("T", " ") : "—"}</span>
                <span className="text-muted-foreground">Pipeline ID</span>
                <code className="font-mono truncate text-xs">{s.pipelineId ?? "—"}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {sample && sample.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">
          Test returned 0 records. The pipeline may be empty, or the API key may lack read access.
        </p>
      )}
    </div>
  );
}

// ─── GHL Pipeline Lookup card ─────────────────────────────────────────────────

function GhlPipelineLookup() {
  const [loading,   setLoading]   = useState(false);
  const [pipelines, setPipelines] = useState<GhlPipeline[] | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [hint,      setHint]      = useState<string | null>(null);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  async function lookup() {
    setLoading(true);
    setError(null);
    setHint(null);
    setPipelines(null);
    try {
      const res  = await fetch("/api/ghl/pipelines");
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        if (json.hint) setHint(json.hint);
      } else {
        setPipelines(json.pipelines ?? []);
        const lip = (json.pipelines ?? []).find((p: GhlPipeline) => isLeadInquiryPipeline(p.name));
        if (lip) setExpanded(lip.id);
      }
    } catch (err: any) {
      setError(err?.message ?? "Unexpected error");
    }
    setLoading(false);
  }

  const leadInquiry = pipelines?.find((p) => isLeadInquiryPipeline(p.name));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              GHL Pipeline Lookup
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Read-only lookup — finds pipeline IDs and stage IDs for your GHL location. Nothing is created or changed in GHL.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={lookup}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up…</>
              : <><Search className="w-3.5 h-3.5" /> Find GHL Pipelines</>}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!loading && !pipelines && !error && (
          <p className="text-xs text-muted-foreground">
            Uses <code className="bg-gray-100 px-1 rounded">GHL_API_KEY</code> and{" "}
            <code className="bg-gray-100 px-1 rounded">GHL_LOCATION_ID</code> from your{" "}
            <code className="bg-gray-100 px-1 rounded">.env</code> file.
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
            {hint && (
              <p className="text-xs text-red-600 ml-6">{hint}</p>
            )}
          </div>
        )}

        {leadInquiry && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-semibold text-green-900">Lead Inquiry Pipeline found</p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded font-mono break-all">
                  {leadInquiry.id}
                </code>
                <CopyButton text={leadInquiry.id} label="Copy Pipeline ID" />
              </div>
              <p className="text-xs text-green-700">
                Set{" "}
                <code className="bg-green-100 px-1 rounded">
                  GHL_LEAD_INQUIRY_PIPELINE_ID={leadInquiry.id}
                </code>{" "}
                in your .env file.
              </p>
            </div>
          </div>
        )}

        {pipelines && pipelines.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No pipelines found for this GHL location.
          </p>
        )}

        {pipelines && pipelines.length > 0 && (
          <div className="space-y-2">
            {pipelines.map((pipeline) => {
              const isTarget = isLeadInquiryPipeline(pipeline.name);
              const open = expanded === pipeline.id;
              return (
                <div
                  key={pipeline.id}
                  className={`rounded-lg border ${isTarget ? "border-green-300 bg-green-50/50" : "border-gray-200"}`}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-black/5 rounded-lg transition-colors"
                    onClick={() => setExpanded(open ? null : pipeline.id)}
                  >
                    {open
                      ? <ChevronDown  className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <span className={`font-medium text-sm flex-1 ${isTarget ? "text-green-800" : ""}`}>
                      {pipeline.name}
                      {isTarget && (
                        <Badge variant="success" className="ml-2 text-xs py-0">Lead Inquiry</Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {pipeline.stages.length} stage{pipeline.stages.length !== 1 ? "s" : ""}
                    </span>
                    <div
                      className="flex items-center gap-1.5 ml-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <code className="text-xs font-mono text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded hidden sm:block max-w-[180px] truncate" title={pipeline.id}>
                        {pipeline.id}
                      </code>
                      <CopyButton text={pipeline.id} label="Copy ID" />
                    </div>
                  </button>

                  {open && pipeline.stages.length > 0 && (
                    <div className="border-t px-3 pb-3 pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        Stages
                      </p>
                      <div className="space-y-1">
                        {pipeline.stages.map((stage) => (
                          <div key={stage.id} className="flex items-center gap-2 py-1">
                            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                              {stage.position}
                            </span>
                            <span className="text-sm flex-1">{stage.name}</span>
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <code className="text-xs font-mono text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded hidden sm:block max-w-[160px] truncate" title={stage.id}>
                                {stage.id}
                              </code>
                              <CopyButton text={stage.id} label="Copy" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {open && pipeline.stages.length === 0 && (
                    <div className="border-t px-3 py-2">
                      <p className="text-xs text-muted-foreground">No stages found in this pipeline.</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Service Mapping Backfill card ────────────────────────────────────────────

function ServiceBackfillCard() {
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<{ metaPatched: number; websitePatched: number } | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  async function run() {
    setLoading(true); setResult(null); setError(null);
    try {
      const res  = await fetch("/api/debug/backfill-service", { method: "POST" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setResult({ metaPatched: json.metaPatched ?? 0, websitePatched: json.websitePatched ?? 0 });
    } catch (err: any) { setError(err?.message ?? "Unexpected error"); }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              Backfill Service Mapping
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Re-infers <code className="bg-gray-100 px-1 rounded text-xs">serviceNormalized</code> for all existing Website and Meta records
              from campaign names, form names, and page URLs. Does not call any external API.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={loading} className="flex items-center gap-1.5">
            {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Backfilling…</> : <><RefreshCw className="w-3.5 h-3.5" /> Backfill Service Mapping</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
            <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
        {result && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
            <span className="text-xs text-green-800">
              Patched <strong>{result.metaPatched}</strong> Meta records and <strong>{result.websitePatched}</strong> Website records.
            </span>
          </div>
        )}
        {!result && !error && !loading && (
          <p className="text-xs text-muted-foreground">
            Run after pulling new Meta or Website data to apply consistent service labels across all records.
            Also run after adding manual Service Mapping overrides in Mapping Settings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DataPullsPage() {
  const router = useRouter();
  const [runs,     setRuns]     = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [apiStatus, setApiStatus] = useState<{
    website: boolean;
    meta: boolean;
    ghl: boolean;
    ghlMissingPipelineId: boolean;
    metaAccountCount: number;
  }>({ website: false, meta: false, ghl: false, ghlMissingPipelineId: false, metaAccountCount: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [histRes, statusRes] = await Promise.all([
        fetch("/api/api-syncs"),
        fetch("/api/sync/status"),
      ]);
      const histJson   = await histRes.json();
      const statusJson = await statusRes.json();
      setRuns(histJson.runs ?? []);
      setSettings(histJson.settings ?? []);
      setApiStatus(statusJson);
    } catch {
      setRuns([]);
      setSettings([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function getLastRun(source: SourceKey, status: "COMPLETED" | "FAILED") {
    return runs.find((r) => r.sourceSystem === source && r.status === status);
  }

  function getSetting(source: SourceKey) {
    return settings.find((s: any) => s.sourceSystem === source);
  }

  function apiConfigured(src: SourceKey): boolean {
    if (src === "WEBSITE") return apiStatus.website;
    if (src === "META")    return apiStatus.meta;
    if (src === "GHL")     return apiStatus.ghl;
    return false;
  }

  function notConfiguredReason(src: SourceKey): string {
    if (src === "WEBSITE")
      return "Set GRAVITY_FORMS_BASE_URL, GRAVITY_FORMS_CONSUMER_KEY, and GRAVITY_FORMS_CONSUMER_SECRET in .env to enable API pulls.";
    if (src === "META")
      return "Set META_ACCESS_TOKEN and META_AD_ACCOUNT_IDS in .env to enable API pulls.";
    if (src === "GHL" && apiStatus.ghlMissingPipelineId)
      return "GHL credentials are set, but GHL_LEAD_INQUIRY_PIPELINE_ID is missing. Use the Pipeline Lookup below to find it, then add it to your .env file.";
    if (src === "GHL")
      return "Set GHL_API_KEY, GHL_LOCATION_ID, and GHL_LEAD_INQUIRY_PIPELINE_ID in .env to enable API pulls.";
    return "Configure credentials in .env to enable API pulls.";
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Data Pulls"
        description="Read-only pulls from each lead source — import CSVs or run API reads to check daily lead counts"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Read-only notice */}
        <Card className="border-blue-100 bg-blue-50">
          <CardContent className="p-4 flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-900">Read-only checker pulls</p>
              <p className="text-xs text-blue-700 mt-0.5">
                This dashboard only reads and imports lead counts for comparison. It never writes back to
                GHL, Zenoti, Meta, or Gravity Forms. Use CSV imports or API reads to pull counts
                so you can verify the daily flow: Website + Meta → GHL → Zenoti.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Source cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.keys(SOURCE_CONFIG) as SourceKey[]).map((src) => {
            const cfg         = SOURCE_CONFIG[src];
            const Icon        = cfg.icon;
            const setting     = getSetting(src);
            const lastSuccess = getLastRun(src, "COMPLETED");
            const lastFailed  = getLastRun(src, "FAILED");
            const isConfigured = !!setting?.enabled;

            return (
              <Card key={src}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-semibold">{cfg.label}</CardTitle>
                    </div>
                    <Badge variant={isConfigured ? "success" : "outline"}>
                      {isConfigured ? "API Configured" : "CSV Import"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">{cfg.description}</p>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Provider</span>
                    <span className="font-medium">{cfg.provider}</span>
                    <span className="text-muted-foreground">Last successful pull</span>
                    <span className={lastSuccess ? "text-green-600 font-medium" : "text-muted-foreground"}>
                      {lastSuccess
                        ? format(new Date(lastSuccess.startedAt), "MMM d, HH:mm")
                        : "No pulls yet"}
                    </span>
                    <span className="text-muted-foreground">Last failed pull</span>
                    <span className={lastFailed ? "text-red-500" : "text-muted-foreground"}>
                      {lastFailed
                        ? format(new Date(lastFailed.startedAt), "MMM d, HH:mm")
                        : "—"}
                    </span>
                    {lastSuccess && (
                      <>
                        <span className="text-muted-foreground">Records pulled</span>
                        <span className="tabular-nums">{lastSuccess.recordsFetched ?? 0}</span>
                        <span className="text-muted-foreground">Added to checker</span>
                        <span className="tabular-nums text-green-600">{lastSuccess.recordsCreated ?? 0}</span>
                      </>
                    )}
                  </div>

                  {/* CSV import button */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full flex items-center gap-2"
                    onClick={() => router.push("/dashboard/imports")}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {cfg.csvLabel}
                  </Button>

                  {/* API pull section */}
                  {src === "GHL" && (
                    <GhlPullSection
                      configured={apiConfigured(src)}
                      notConfiguredReason={notConfiguredReason(src)}
                      onComplete={fetchData}
                    />
                  )}
                  {src !== "GHL" && cfg.hasApi && cfg.apiEndpoint && cfg.apiLabel && (
                    <ApiPullSection
                      apiLabel={cfg.apiLabel}
                      endpoint={cfg.apiEndpoint}
                      configured={apiConfigured(src)}
                      notConfiguredReason={notConfiguredReason(src)}
                      onComplete={fetchData}
                      metaAccountCount={src === "META" ? apiStatus.metaAccountCount : undefined}
                    />
                  )}

                  {/* Zenoti: CSV only note */}
                  {!cfg.hasApi && (
                    <div className="border-t pt-3 mt-3">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        CSV import only — Zenoti API pull is not supported.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Service Mapping Backfill */}
        <ServiceBackfillCard />

        {/* GHL Pipeline Lookup */}
        <GhlPipelineLookup />

        {/* Pull history */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pull History</CardTitle>
              <button
                onClick={fetchData}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : runs.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <p className="text-muted-foreground text-sm font-medium">No pull history yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Import CSVs from the <strong>Imports</strong> page or use the API pull buttons above
                  to start checking lead counts.
                </p>
                <Button size="sm" variant="outline" onClick={() => router.push("/dashboard/imports")}>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Go to Imports
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Source</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Finished</TableHead>
                    <TableHead className="text-right">Pulled</TableHead>
                    <TableHead className="text-right">Added</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead>Date Range Checked</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const sc = SYNC_STATUS_CONFIG[run.status] ?? SYNC_STATUS_CONFIG.IDLE;
                    const StatusIcon = sc.icon;
                    const srcCfg = SOURCE_CONFIG[run.sourceSystem as SourceKey];
                    return (
                      <TableRow key={run.id} className="text-sm">
                        <TableCell>
                          <Badge variant={(srcCfg?.color ?? "outline") as any}>
                            {srcCfg?.label ?? run.sourceSystem}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{run.syncType}</TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">
                          {run.startedAt ? format(new Date(run.startedAt), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">
                          {run.finishedAt ? format(new Date(run.finishedAt), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{run.recordsFetched ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">{run.recordsCreated ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{run.recordsSkipped ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {run.dateRangeStart
                            ? `${String(run.dateRangeStart).slice(0, 10)} → ${String(run.dateRangeEnd ?? "").slice(0, 10)}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={sc.variant} className="flex items-center gap-1 w-fit">
                            <StatusIcon className={`w-3 h-3 ${run.status === "RUNNING" ? "animate-spin" : ""}`} />
                            {sc.label}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-xs text-red-500 max-w-[200px] truncate"
                          title={run.errorMessage}
                        >
                          {run.errorMessage ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
