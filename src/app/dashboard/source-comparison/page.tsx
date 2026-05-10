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
import { format } from "date-fns";
import { ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import type { SourceComparisonRow, DateGrouping, ReportingTimezone } from "@/types";
import { DATE_GROUPINGS, REPORTING_TIMEZONES } from "@/types";
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
  const router      = useRouter();
  const sp          = useSearchParams();

  const [dateRange, setDateRange] = useState(() => {
    const from = sp.get("from"); const to = sp.get("to");
    const preset = sp.get("preset") || "last30";
    if (from && to) return { preset, from, to };
    const r = gdr(preset);
    return { preset, from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });

  const [groupBy,      setGroupBy]      = useState<DateGrouping>((sp.get("groupBy") as DateGrouping) || "daily");
  const [timezone,     setTimezone]     = useState<ReportingTimezone>((sp.get("timezone") as ReportingTimezone) || "America/Toronto");
  const [statusFilter, setStatusFilter] = useState(sp.get("status") || "all");
  const [adAccountId,  setAdAccountId]  = useState(sp.get("adAccountId") || "");
  const [metaAccounts, setMetaAccounts] = useState<Array<{ accountId: string; accountName: string }>>([]);
  const [sortField, setSortField] = useState("periodStart");
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("desc");
  const [rows, setRows]         = useState<SourceComparisonRow[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<any[] | null>(null);

  const syncUrl = useCallback((dr: typeof dateRange, gb: DateGrouping, tz: ReportingTimezone, status: string, acct: string) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "", groupBy: gb, timezone: tz, status });
    if (acct) p.set("adAccountId", acct);
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to, groupBy, timezone });
    if (adAccountId) params.set("adAccountId", adAccountId);
    const [res, metaRes] = await Promise.all([
      fetch(`/api/source-comparison?${params}`),
      metaAccounts.length === 0
        ? fetch(`/api/meta-leads?from=${dateRange.from}&to=${dateRange.to}`)
        : Promise.resolve(null),
    ]);
    const json = await res.json();
    // Handle both legacy array response and new { rows, _error? } shape.
    if (Array.isArray(json)) {
      setRows(json);
      setQueryError(null);
    } else {
      setRows(json.rows ?? []);
      setQueryError(json._error ?? null);
    }
    if (metaRes) {
      const metaData = await metaRes.json();
      if (metaData?.byAdAccount?.length > 0) {
        setMetaAccounts(metaData.byAdAccount.map((a: any) => ({ accountId: a.accountId, accountName: a.accountName ?? a.accountId })));
      }
    }
    setLoading(false);
  }, [dateRange, groupBy, timezone, adAccountId, metaAccounts.length]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleDateChange(v: any) {
    let next: typeof dateRange;
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      next = { preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    } else next = v;
    setDateRange(next);
    syncUrl(next, groupBy, timezone, statusFilter, adAccountId);
  }

  function handleGroupBy(val: string) {
    const gb = val as DateGrouping;
    setGroupBy(gb); syncUrl(dateRange, gb, timezone, statusFilter, adAccountId);
  }

  function handleTimezone(val: string) {
    const tz = val as ReportingTimezone;
    setTimezone(tz); syncUrl(dateRange, groupBy, tz, statusFilter, adAccountId);
  }

  function handleAdAccount(val: string) {
    setAdAccountId(val);
    syncUrl(dateRange, groupBy, timezone, statusFilter, val);
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Source Comparison" description="Date-based lead count: Website + Meta → GHL → Zenoti" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <Select value={groupBy} onValueChange={handleGroupBy}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_GROUPINGS.map((g) => (
                  <SelectItem key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={timezone} onValueChange={handleTimezone}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORTING_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); syncUrl(dateRange, groupBy, timezone, v, adAccountId); }}>
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
          <ExportButton endpoint="/api/export" filename="source-comparison.csv"
            params={{ type: "source-comparison", from: dateRange.from || "", to: dateRange.to || "" }} />
        </div>

        {/* Query error banner */}
        {queryError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 font-mono break-all">
            <strong>Query error:</strong> {queryError}
          </div>
        )}

        {/* Summary totals */}
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
                <p className={`text-2xl font-bold tabular-nums ${s.cls}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{filtered.length} periods · Click a row to drill down by clinic</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No data for this period. Upload CSVs or adjust filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-6" />
                    <TableHead><SortHead field="periodStart" label="Period" /></TableHead>
                    <TableHead className="text-right"><SortHead field="websiteLeads" label="Website" /></TableHead>
                    <TableHead className="text-right"><SortHead field="metaLeads" label="Meta" /></TableHead>
                    <TableHead className="text-right bg-indigo-50/40"><SortHead field="totalSourceLeads" label="Total Source" /></TableHead>
                    <TableHead className="text-right"><SortHead field="ghlLeads" label="GHL" /></TableHead>
                    <TableHead className="text-right"><SortHead field="zenotiLeads" label="Zenoti" /></TableHead>
                    <TableHead className="text-right"><SortHead field="srcToGhlDiff" label="Src↔GHL" /></TableHead>
                    <TableHead className="text-right"><SortHead field="ghlToZenotiDiff" label="GHL↔Zenoti" /></TableHead>
                    <TableHead className="text-right"><SortHead field="srcToGhlMatchRate" label="Src→GHL %" /></TableHead>
                    <TableHead className="text-right"><SortHead field="ghlToZenotiMatchRate" label="GHL→Zenoti %" /></TableHead>
                    <TableHead>Discrepancy</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <>
                      <TableRow
                        key={row.periodStart}
                        className="text-sm cursor-pointer hover:bg-muted/40"
                        onClick={() => toggleDrilldown(row)}
                      >
                        <TableCell className="py-2 px-2">
                          {expanded === row.periodStart
                            ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                            : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">{row.period}</TableCell>
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
                      {expanded === row.periodStart && drillData && (
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
                                {drillData.map((d) => (
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
