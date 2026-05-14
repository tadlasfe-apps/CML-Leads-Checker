"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { AuditStatusBadge, DiscrepancyBadge } from "@/components/dashboard/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ArrowUpDown, ChevronDown, ChevronRight, Info, XCircle } from "lucide-react";
import type {
  SourceComparisonRow, DateGrouping, ReportingTimezone, ComparisonDimension,
  SourceComparisonDiagnostics,
} from "@/types";
import {
  DATE_GROUPINGS, REPORTING_TIMEZONES,
  COMPARISON_DIMENSIONS, COMPARISON_DIMENSION_LABELS,
  CANONICAL_CLINICS, CANONICAL_SERVICES,
} from "@/types";
import { getDateRangeFromPreset as gdr } from "@/components/dashboard/DateRangeFilter";

function DiffCell({ val }: { val: number }) {
  if (val === 0) return <span className="text-green-600 font-medium">0</span>;
  return <span className={`font-semibold ${val > 0 ? "text-red-600" : "text-emerald-600"}`}>{val > 0 ? `+${val}` : val}</span>;
}

function RateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  const color = rate >= 95 ? "text-green-600" : rate >= 85 ? "text-yellow-600" : "text-red-600";
  return <span className={`font-semibold ${color}`}>{rate}%</span>;
}

function SourceComparisonPageInner() {
  const router = useRouter();
  const sp     = useSearchParams();

  const [dateRange, setDateRange] = useState(() => {
    const from = sp.get("from"); const to = sp.get("to");
    const preset = sp.get("preset") || "last30";
    if (from && to) return { preset, from, to };
    const r = gdr(preset);
    return { preset, from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });

  const [groupBy,         setGroupBy]         = useState<DateGrouping>((sp.get("groupBy") as DateGrouping) || "daily");
  const [timezone,        setTimezone]         = useState<ReportingTimezone>((sp.get("timezone") as ReportingTimezone) || "America/Toronto");
  const [dimensionGroupBy,setDimensionGroupBy] = useState<ComparisonDimension>((sp.get("dimensionGroupBy") as ComparisonDimension) || "date+clinic+service");
  const [clinicFilter,    setClinicFilter]     = useState(sp.get("clinic")   || "");
  const [serviceFilter,   setServiceFilter]    = useState(sp.get("service")  || "");
  const [statusFilter,    setStatusFilter]     = useState(sp.get("status")   || "all");
  const [adAccountId,     setAdAccountId]      = useState(sp.get("adAccountId") || "");
  const [metaAccounts,    setMetaAccounts]     = useState<Array<{ accountId: string; accountName: string }>>([]);
  const [sortField,       setSortField]        = useState("periodStart");
  const [sortDir,         setSortDir]          = useState<"asc" | "desc">("desc");
  const [rows,            setRows]             = useState<SourceComparisonRow[]>([]);
  const [diagnostics,     setDiagnostics]      = useState<SourceComparisonDiagnostics | null>(null);
  const [queryError,      setQueryError]       = useState<string | null>(null);
  const [loading,         setLoading]          = useState(true);
  const [expanded,        setExpanded]         = useState<string | null>(null);
  const [drillData,       setDrillData]        = useState<any[] | null>(null);
  const [showDiag,        setShowDiag]         = useState(false);

  const includeClinic  = dimensionGroupBy.includes("clinic");
  const includeService = dimensionGroupBy.includes("service");

  const syncUrl = useCallback((dr: typeof dateRange, gb: DateGrouping, tz: ReportingTimezone, dim: ComparisonDimension, status: string, acct: string, clinic: string, service: string) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "", groupBy: gb, timezone: tz, dimensionGroupBy: dim, status });
    if (acct)    p.set("adAccountId", acct);
    if (clinic)  p.set("clinic", clinic);
    if (service) p.set("service", service);
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    setQueryError(null);
    const params = new URLSearchParams({
      from: dateRange.from, to: dateRange.to,
      groupBy, timezone,
      dimensionGroupBy,
    });
    if (adAccountId)   params.set("adAccountId", adAccountId);
    if (clinicFilter)  params.set("clinic",  clinicFilter);
    if (serviceFilter) params.set("service", serviceFilter);

    const [res, metaRes] = await Promise.all([
      fetch(`/api/source-comparison?${params}`),
      metaAccounts.length === 0
        ? fetch(`/api/meta-leads?from=${dateRange.from}&to=${dateRange.to}`)
        : Promise.resolve(null),
    ]);
    const json = await res.json();
    if (Array.isArray(json)) {
      setRows(json); setQueryError(null); setDiagnostics(null);
    } else {
      setRows(json.rows ?? []);
      setQueryError(json._error ?? null);
      setDiagnostics(json.diagnostics ?? null);
    }
    if (metaRes) {
      const metaData = await metaRes.json();
      if (metaData?.byAdAccount?.length > 0) {
        setMetaAccounts(metaData.byAdAccount.map((a: any) => ({ accountId: a.accountId, accountName: a.accountName ?? a.accountId })));
      }
    }
    setLoading(false);
  }, [dateRange, groupBy, timezone, dimensionGroupBy, clinicFilter, serviceFilter, adAccountId, metaAccounts.length]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleDateChange(v: any) {
    let next: typeof dateRange;
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      next = { preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    } else next = v;
    setDateRange(next);
    syncUrl(next, groupBy, timezone, dimensionGroupBy, statusFilter, adAccountId, clinicFilter, serviceFilter);
  }

  function handleGroupBy(val: string) {
    const gb = val as DateGrouping;
    setGroupBy(gb); syncUrl(dateRange, gb, timezone, dimensionGroupBy, statusFilter, adAccountId, clinicFilter, serviceFilter);
  }

  function handleTimezone(val: string) {
    const tz = val as ReportingTimezone;
    setTimezone(tz); syncUrl(dateRange, groupBy, tz, dimensionGroupBy, statusFilter, adAccountId, clinicFilter, serviceFilter);
  }

  function handleDimensionGroupBy(val: string) {
    const dim = val as ComparisonDimension;
    setDimensionGroupBy(dim); syncUrl(dateRange, groupBy, timezone, dim, statusFilter, adAccountId, clinicFilter, serviceFilter);
  }

  function handleClinicFilter(val: string) {
    const c = val === "__all__" ? "" : val;
    setClinicFilter(c); syncUrl(dateRange, groupBy, timezone, dimensionGroupBy, statusFilter, adAccountId, c, serviceFilter);
  }

  function handleServiceFilter(val: string) {
    const s = val === "__all__" ? "" : val;
    setServiceFilter(s); syncUrl(dateRange, groupBy, timezone, dimensionGroupBy, statusFilter, adAccountId, clinicFilter, s);
  }

  function handleAdAccount(val: string) {
    setAdAccountId(val); syncUrl(dateRange, groupBy, timezone, dimensionGroupBy, statusFilter, val, clinicFilter, serviceFilter);
  }

  async function toggleDrilldown(row: SourceComparisonRow) {
    if (expanded === row.periodStart) { setExpanded(null); setDrillData(null); return; }
    setExpanded(row.periodStart);
    const p = new URLSearchParams({ drilldown: "true", periodStart: row.periodStart, periodEnd: row.periodEnd, by: "clinic" });
    const res = await fetch(`/api/source-comparison?${p}`);
    setDrillData(await res.json());
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  // In multi-dim mode, drilldown is less useful — disable it
  const isDimMode = dimensionGroupBy !== "date";

  const filtered = rows
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .sort((a, b) => {
      const av = (a as any)[sortField] ?? ""; const bv = (b as any)[sortField] ?? "";
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortDir === "asc" ? 1 : -1);
    });

  const totals = filtered.reduce(
    (acc, r) => ({
      website: acc.website + r.websiteLeads,
      meta:    acc.meta    + r.metaLeads,
      src:     acc.src     + r.totalSourceLeads,
      ghl:     acc.ghl     + r.ghlLeads,
      zenoti:  acc.zenoti  + r.zenotiLeads,
    }),
    { website: 0, meta: 0, src: 0, ghl: 0, zenoti: 0 }
  );

  const SortHead = ({ field, label }: { field: string; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground font-medium whitespace-nowrap" onClick={() => toggleSort(field)}>
      {label} <ArrowUpDown className="w-3 h-3 opacity-60" />
    </button>
  );

  // Row key for multi-dim rows
  function rowKey(row: SourceComparisonRow): string {
    return [row.periodStart, row.clinic ?? "", row.service ?? ""].join("|");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Source Comparison" description="Date-based lead count: Website + Meta → GHL → Zenoti" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── Filters row ── */}
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={handleDateChange} />

          {/* Date grouping */}
          <Select value={groupBy} onValueChange={handleGroupBy}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_GROUPINGS.map((g) => (
                <SelectItem key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Timezone */}
          <Select value={timezone} onValueChange={handleTimezone}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORTING_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Group By dimension */}
          <Select value={dimensionGroupBy} onValueChange={handleDimensionGroupBy}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Group By" />
            </SelectTrigger>
            <SelectContent>
              {COMPARISON_DIMENSIONS.map((d) => (
                <SelectItem key={d} value={d}>{COMPARISON_DIMENSION_LABELS[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clinic filter */}
          <Select value={clinicFilter || "__all__"} onValueChange={handleClinicFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="All Clinics" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Clinics</SelectItem>
              {CANONICAL_CLINICS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              <SelectItem value="Unknown / Needs Mapping">Unknown / Needs Mapping</SelectItem>
            </SelectContent>
          </Select>

          {/* Service filter */}
          <Select value={serviceFilter || "__all__"} onValueChange={handleServiceFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Services" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Services</SelectItem>
              {CANONICAL_SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              <SelectItem value="Unknown / Needs Mapping">Unknown / Needs Mapping</SelectItem>
            </SelectContent>
          </Select>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); syncUrl(dateRange, groupBy, timezone, dimensionGroupBy, v, adAccountId, clinicFilter, serviceFilter); }}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="PASSED">Passed</SelectItem>
              <SelectItem value="SOURCE_TO_GHL_ISSUE">Source → GHL Issue</SelectItem>
              <SelectItem value="GHL_TO_ZENOTI_ISSUE">GHL → Zenoti Issue</SelectItem>
              <SelectItem value="BOTH_ISSUES">Both Issues</SelectItem>
              <SelectItem value="NEEDS_MAPPING">Needs Mapping</SelectItem>
              <SelectItem value="NEEDS_REVIEW">Needs Review</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Meta account filter */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          {metaAccounts.length > 0 && (
            <select
              value={adAccountId}
              onChange={(e) => handleAdAccount(e.target.value)}
              className="border rounded px-2 py-1 text-xs text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring h-9"
            >
              <option value="">All Meta Accounts</option>
              {metaAccounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountName !== a.accountId ? `${a.accountName} (${a.accountId})` : a.accountId}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-2">
            {diagnostics && (
              <button
                onClick={() => setShowDiag((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1"
              >
                <Info className="w-3 h-3" />
                {showDiag ? "Hide Diagnostics" : "Show Diagnostics"}
              </button>
            )}
            <ExportButton endpoint="/api/export" filename="source-comparison.csv"
              params={{ type: "source-comparison", from: dateRange.from || "", to: dateRange.to || "" }} />
          </div>
        </div>

        {/* Query error banner */}
        {queryError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 font-mono break-all flex items-start gap-2">
            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <span><strong>Query error:</strong> {queryError}</span>
          </div>
        )}

        {/* Diagnostics panel */}
        {showDiag && diagnostics && (
          <Card className="border-blue-100 bg-blue-50/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-blue-800 flex items-center gap-2">
                <Info className="w-4 h-4" />
                Source Comparison Diagnostics
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                {[
                  { label: "Website Records", val: diagnostics.websiteTotal, unkC: diagnostics.websiteUnknownClinic, unkS: diagnostics.websiteUnknownService },
                  { label: "Meta Records (leads)", val: diagnostics.metaTotal, unkC: diagnostics.metaUnknownClinic, unkS: diagnostics.metaUnknownService },
                  { label: "GHL Records", val: diagnostics.ghlTotal, unkC: diagnostics.ghlUnknownClinic, unkS: diagnostics.ghlUnknownService },
                  { label: "Zenoti Records", val: diagnostics.zenotiTotal, unkC: diagnostics.zenotiUnknownClinic, unkS: diagnostics.zenotiUnknownService },
                ].map((d) => (
                  <div key={d.label} className="bg-white border rounded p-2 space-y-0.5">
                    <p className="font-medium text-blue-900">{d.label}</p>
                    <p className="text-blue-700 font-semibold">{d.val.toLocaleString()}</p>
                    {d.unkC > 0 && <p className="text-amber-600">Unknown clinic: {d.unkC}</p>}
                    {d.unkS > 0 && <p className="text-amber-600">Unknown service: {d.unkS}</p>}
                  </div>
                ))}
              </div>
              <div className="text-xs text-blue-700 space-y-0.5">
                <p><span className="font-medium">Groups created:</span> {diagnostics.groupCount.toLocaleString()}</p>
                <p><span className="font-medium">Date range:</span> {diagnostics.dateRange}</p>
                <p><span className="font-medium">Group by:</span> {diagnostics.dimensionGroupBy}</p>
                {diagnostics.clinicFilter !== "all"  && <p><span className="font-medium">Clinic filter:</span> {diagnostics.clinicFilter}</p>}
                {diagnostics.serviceFilter !== "all" && <p><span className="font-medium">Service filter:</span> {diagnostics.serviceFilter}</p>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Website Leads", value: totals.website, cls: "text-blue-600" },
            { label: "Meta Leads",    value: totals.meta,    cls: "text-purple-600" },
            { label: "Total Source",  value: totals.src,     cls: "text-indigo-600" },
            { label: "GHL",           value: totals.ghl,     cls: "text-green-600" },
            { label: "Zenoti",        value: totals.zenoti,  cls: "text-yellow-600" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold tabular-nums ${s.cls}`}>{s.value.toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span>{filtered.length.toLocaleString()} {isDimMode ? "groups" : "periods"}</span>
              {isDimMode && (
                <Badge variant="outline" className="text-xs font-normal">
                  {COMPARISON_DIMENSION_LABELS[dimensionGroupBy]}
                </Badge>
              )}
              {!isDimMode && <span className="text-muted-foreground font-normal text-sm">· Click a row to drill down by clinic</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No data for this period. Upload CSVs or adjust filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      {!isDimMode && <TableHead className="w-6" />}
                      <TableHead><SortHead field="periodStart" label="Date" /></TableHead>
                      {includeClinic  && <TableHead><SortHead field="clinic"  label="Clinic" /></TableHead>}
                      {includeService && <TableHead><SortHead field="service" label="Service" /></TableHead>}
                      <TableHead className="text-right"><SortHead field="websiteLeads"    label="Website" /></TableHead>
                      <TableHead className="text-right"><SortHead field="metaLeads"       label="Meta" /></TableHead>
                      <TableHead className="text-right bg-indigo-50/40"><SortHead field="totalSourceLeads" label="Total Source" /></TableHead>
                      <TableHead className="text-right"><SortHead field="ghlLeads"        label="GHL" /></TableHead>
                      <TableHead className="text-right"><SortHead field="zenotiLeads"     label="Zenoti" /></TableHead>
                      <TableHead className="text-right"><SortHead field="srcToGhlDiff"    label="Src↔GHL" /></TableHead>
                      <TableHead className="text-right"><SortHead field="ghlToZenotiDiff" label="GHL↔Zenoti" /></TableHead>
                      <TableHead className="text-right"><SortHead field="srcToGhlMatchRate"    label="Src→GHL %" /></TableHead>
                      <TableHead className="text-right"><SortHead field="ghlToZenotiMatchRate" label="GHL→Zenoti %" /></TableHead>
                      <TableHead>Discrepancy</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => (
                      <>
                        <TableRow
                          key={rowKey(row)}
                          className={`text-sm ${!isDimMode ? "cursor-pointer hover:bg-muted/40" : ""}`}
                          onClick={() => !isDimMode && toggleDrilldown(row)}
                        >
                          {!isDimMode && (
                            <TableCell className="py-2 px-2">
                              {expanded === row.periodStart
                                ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                            </TableCell>
                          )}
                          <TableCell className="font-medium whitespace-nowrap">{row.period}</TableCell>
                          {includeClinic && (
                            <TableCell className={`whitespace-nowrap ${row.clinic === "Unknown / Needs Mapping" ? "italic text-amber-600" : ""}`}>
                              {row.clinic ?? "—"}
                            </TableCell>
                          )}
                          {includeService && (
                            <TableCell className={`whitespace-nowrap ${row.service === "Unknown / Needs Mapping" ? "italic text-amber-600" : ""}`}>
                              {row.service ?? "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-right tabular-nums text-blue-600">{row.websiteLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-purple-600">{row.metaLeads}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold bg-indigo-50/40">{row.totalSourceLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-green-600">{row.ghlLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-yellow-600">{row.zenotiLeads}</TableCell>
                          <TableCell className="text-right"><DiffCell val={row.srcToGhlDiff} /></TableCell>
                          <TableCell className="text-right"><DiffCell val={row.ghlToZenotiDiff} /></TableCell>
                          <TableCell className="text-right"><RateCell rate={row.srcToGhlMatchRate} /></TableCell>
                          <TableCell className="text-right"><RateCell rate={row.ghlToZenotiMatchRate} /></TableCell>
                          <TableCell><DiscrepancyBadge location={row.discrepancyLocation} /></TableCell>
                          <TableCell><AuditStatusBadge status={row.status} /></TableCell>
                        </TableRow>

                        {/* Date-only drilldown */}
                        {!isDimMode && expanded === row.periodStart && drillData && (
                          <TableRow>
                            <TableCell colSpan={13} className="p-0 bg-muted/30">
                              <Table>
                                <TableHeader>
                                  <TableRow className="text-xs bg-muted/50">
                                    <TableHead className="pl-8">Clinic</TableHead>
                                    <TableHead className="text-right">Website</TableHead>
                                    <TableHead className="text-right">Meta</TableHead>
                                    <TableHead className="text-right">Total Source</TableHead>
                                    <TableHead className="text-right">GHL</TableHead>
                                    <TableHead className="text-right">Zenoti</TableHead>
                                    <TableHead className="text-right">Src↔GHL</TableHead>
                                    <TableHead className="text-right">GHL↔Zenoti</TableHead>
                                    <TableHead>Status</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {drillData.map((d: any) => (
                                    <TableRow key={d.label} className="text-sm">
                                      <TableCell className="pl-8 font-medium">{d.label}</TableCell>
                                      <TableCell className="text-right tabular-nums text-blue-600">{d.websiteLeads}</TableCell>
                                      <TableCell className="text-right tabular-nums text-purple-600">{d.metaLeads}</TableCell>
                                      <TableCell className="text-right tabular-nums font-semibold">{d.totalSourceLeads}</TableCell>
                                      <TableCell className="text-right tabular-nums text-green-600">{d.ghlLeads}</TableCell>
                                      <TableCell className="text-right tabular-nums text-yellow-600">{d.zenotiLeads}</TableCell>
                                      <TableCell className="text-right"><DiffCell val={d.srcToGhlDiff} /></TableCell>
                                      <TableCell className="text-right"><DiffCell val={d.ghlToZenotiDiff} /></TableCell>
                                      <TableCell><AuditStatusBadge status={d.status} /></TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SourceComparisonPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <SourceComparisonPageInner />
    </Suspense>
  );
}
