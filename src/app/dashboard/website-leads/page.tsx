"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { AuditStatusBadge } from "@/components/dashboard/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Search, ArrowUpDown, Copy, Globe, ChevronDown, ChevronRight, Info, Tag } from "lucide-react";
import type { WebsiteFormRow } from "@/types";

function WebsiteLeadsPageInner() {
  const router = useRouter();
  const sp     = useSearchParams();

  const [dateRange, setDateRange] = useState(() => {
    const from = sp.get("from"); const to = sp.get("to");
    const preset = sp.get("preset") || "last30";
    if (from && to) return { preset, from, to };
    const r = getDateRangeFromPreset(preset);
    return { preset, from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });

  const [search,       setSearch]       = useState(sp.get("q") || "");
  const [sourceFilter, setSourceFilter] = useState(sp.get("source") || "all");
  const [sortField,    setSortField]    = useState("uniqueLeads");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");
  const [rows,         setRows]         = useState<WebsiteFormRow[]>([]);
  const [byService,    setByService]    = useState<any[]>([]);
  const [diagnostics,  setDiagnostics]  = useState<any | null>(null);
  const [queryError,   setQueryError]   = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [diagExpanded, setDiagExpanded] = useState(false);

  const syncUrl = useCallback((dr: typeof dateRange, q: string, src: string) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "", q, source: src });
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/website-leads?${params}`);
    const json = await res.json();
    // Handle both old array response and new { rows, diagnostics, _error? } shape
    if (Array.isArray(json)) {
      setRows(json);
      setByService([]);
      setDiagnostics(null);
      setQueryError(null);
    } else {
      setRows(json.rows ?? []);
      setByService(json.byService ?? []);
      setDiagnostics(json.diagnostics ?? null);
      setQueryError(json._error ?? null);
    }
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleDateChange(v: any) {
    let next: typeof dateRange;
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      next = { preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    } else next = v;
    setDateRange(next);
    syncUrl(next, search, sourceFilter);
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  const formSources = Array.from(new Set(rows.map((r) => r.websiteFormSource).filter(Boolean)));

  const filtered = rows
    .filter((r) => {
      const q = search.toLowerCase();
      const matchQ = !q ||
        (r.formName ?? "").toLowerCase().includes(q) ||
        (r.websiteFormSource ?? "").toLowerCase().includes(q) ||
        (r.backendProvider ?? "").toLowerCase().includes(q) ||
        (r.pageUrl ?? "").toLowerCase().includes(q);
      const matchSrc = sourceFilter === "all" || r.websiteFormSource === sourceFilter;
      return matchQ && matchSrc;
    })
    .sort((a, b) => {
      const av = (a as any)[sortField] ?? 0; const bv = (b as any)[sortField] ?? 0;
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortDir === "asc" ? 1 : -1);
    });

  // Exclude franchise / non-lead forms from KPI totals
  const totals = filtered.reduce(
    (acc, r) => {
      if (r.excludedFromLeadCount) return acc;
      return {
        total:  acc.total  + r.totalSubmissions,
        unique: acc.unique + r.uniqueLeads,
        dupes:  acc.dupes  + r.duplicateCount,
      };
    },
    { total: 0, unique: 0, dupes: 0 }
  );

  const SortHead = ({ field, label }: { field: string; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground font-medium whitespace-nowrap" onClick={() => toggleSort(field)}>
      {label} <ArrowUpDown className="w-3 h-3 opacity-60" />
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Website Leads" description="Leads from website forms — Gravity Forms API pulls and CSV imports" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* Filters */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 w-52" placeholder="Search form name, URL…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); syncUrl(dateRange, e.target.value, sourceFilter); }}
              />
            </div>
            <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); syncUrl(dateRange, search, v); }}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="All form sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Form Sources</SelectItem>
                {formSources.map((s) => <SelectItem key={s!} value={s!}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ExportButton endpoint="/api/export" filename="website-leads.csv"
            params={{ type: "website-leads", from: dateRange.from || "", to: dateRange.to || "" }} />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Leads</p>
              <p className="text-2xl font-bold tabular-nums text-blue-600">{totals.unique}</p>
              <p className="text-xs text-muted-foreground mt-1">unique submissions only</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Submissions</p>
              <p className="text-2xl font-bold tabular-nums text-muted-foreground">{totals.total}</p>
              <p className="text-xs text-muted-foreground mt-1">incl. duplicates</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Duplicates</p>
              <p className="text-2xl font-bold tabular-nums text-yellow-600">{totals.dupes}</p>
              <p className="text-xs text-muted-foreground mt-1">Total − Unique</p>
            </CardContent>
          </Card>
        </div>

        {/* Query error banner */}
        {queryError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 font-mono break-all">
            <strong>Query error:</strong> {queryError}
          </div>
        )}

        {/* Diagnostics panel */}
        {diagnostics && (
          <div className="border rounded-md overflow-hidden text-xs">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:bg-muted/30 transition-colors"
              onClick={() => setDiagExpanded((v) => !v)}
            >
              {diagExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium uppercase tracking-wide">Query Diagnostics</span>
              <span className="ml-2 text-muted-foreground">
                {diagnostics.websiteRecords} WEBSITE records total · {diagnostics.websiteInDateRange} in date range
                {diagnostics.missingCreatedAtSource > 0 && ` · ${diagnostics.missingCreatedAtSource} missing createdAtSource`}
              </span>
            </button>
            {diagExpanded && (
              <div className="border-t bg-muted/10">
                <div className="grid grid-cols-2 gap-0 divide-y">
                  {[
                    ["Total records (all systems)", diagnostics.totalRecords],
                    ["WEBSITE records (all time)", diagnostics.websiteRecords],
                    ["WEBSITE records in date range", diagnostics.websiteInDateRange],
                    ["Missing createdAtSource", diagnostics.missingCreatedAtSource],
                    ["Earliest createdAtSource", diagnostics.earliestCreatedAtSource?.slice(0, 10) ?? "—"],
                    ["Latest createdAtSource", diagnostics.latestCreatedAtSource?.slice(0, 10) ?? "—"],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="flex gap-4 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground w-52 shrink-0">{label}</span>
                      <span className="font-mono">{String(val)}</span>
                    </div>
                  ))}
                </div>
                {diagnostics.sampleRecords?.length > 0 && (
                  <div className="border-t px-3 py-2 space-y-1">
                    <p className="font-medium text-muted-foreground uppercase tracking-wide text-xs">
                      Most recent 5 WEBSITE records
                    </p>
                    {diagnostics.sampleRecords.map((r: any, i: number) => (
                      <div key={i} className="font-mono text-xs text-muted-foreground">
                        {r.id?.slice(0, 12)}… · {r.backendProvider ?? "—"} · {r.formName ?? "(no form)"} · {r.websiteFormSource ?? "Unknown"} · {r.createdAtSource?.slice(0, 10) ?? "no date"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Form breakdown table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{filtered.length} form{filtered.length !== 1 ? "s" : ""}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Globe className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <p className="text-muted-foreground text-sm font-medium">No website lead data yet.</p>
                <p className="text-xs text-muted-foreground">
                  Pull via Gravity Forms API from <strong>Data Pulls</strong>, or upload a Website Leads CSV from <strong>Imports</strong>.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead><SortHead field="formName" label="Form Name" /></TableHead>
                    <TableHead><SortHead field="websiteFormSource" label="Website Form Source" /></TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right"><SortHead field="totalSubmissions" label="Submissions" /></TableHead>
                    <TableHead className="text-right"><SortHead field="uniqueLeads" label="Unique Leads" /></TableHead>
                    <TableHead className="text-right"><SortHead field="duplicateCount" label="Duplicates" /></TableHead>
                    <TableHead><SortHead field="lastSubmissionAt" label="Last Submission" /></TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row, i) => (
                    <TableRow key={`${row.id}-${i}`} className={`text-sm ${row.excludedFromLeadCount ? "opacity-50" : ""}`}>
                      <TableCell className="font-medium max-w-[220px] truncate" title={row.formName}>
                        {row.formName}
                        {row.pageUrl && (
                          <a href={row.pageUrl} target="_blank" rel="noreferrer"
                            className="ml-1 text-xs text-muted-foreground hover:text-blue-600 inline-block"
                            onClick={(e) => e.stopPropagation()}>↗</a>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.websiteFormSource
                          ? <Badge variant="info" className="text-xs">{row.websiteFormSource}</Badge>
                          : <span className="text-muted-foreground text-xs">Unknown</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{row.backendProvider ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{row.totalSubmissions}</TableCell>
                      <TableCell className="text-right tabular-nums text-blue-600 font-semibold">{row.uniqueLeads}</TableCell>
                      <TableCell className="text-right tabular-nums text-yellow-600">
                        {row.duplicateCount > 0 ? row.duplicateCount : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.lastSubmissionAt ? row.lastSubmissionAt.slice(0, 10) : "—"}
                      </TableCell>
                      <TableCell><AuditStatusBadge status={row.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {/* Website Leads by Service */}
        {byService.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="w-4 h-4 text-muted-foreground" />
                Website Leads by Service
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Unique Leads</TableHead>
                    <TableHead className="text-right">Submissions</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead className="text-right">Forms</TableHead>
                    <TableHead>Last Submission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byService.map((s: any) => (
                    <TableRow key={s.service} className="text-sm">
                      <TableCell className="font-medium">{s.service}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-blue-600">{s.unique}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.total}</TableCell>
                      <TableCell className="text-right tabular-nums text-yellow-600">
                        {s.dupes > 0 ? s.dupes : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.formCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {s.lastSubmissionAt ? s.lastSubmissionAt.slice(0, 10) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}

export default function WebsiteLeadsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <WebsiteLeadsPageInner />
    </Suspense>
  );
}
