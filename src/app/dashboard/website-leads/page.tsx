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
import { Search, ArrowUpDown, Copy, Globe } from "lucide-react";
import type { WebsiteFormRow } from "@/types";

function DiffCell({ val }: { val: number }) {
  if (val === 0) return <span className="text-green-600 font-medium">0</span>;
  return <span className={`font-semibold ${val > 0 ? "text-red-600" : "text-emerald-600"}`}>{val > 0 ? `+${val}` : val}</span>;
}

function RateCell({ rate }: { rate: number }) {
  const color = rate >= 95 ? "text-green-600" : rate >= 85 ? "text-yellow-600" : "text-red-600";
  return <span className={`font-semibold ${color}`}>{rate.toFixed(1)}%</span>;
}

function WebsiteLeadsPageInner() {
  const router      = useRouter();
  const sp          = useSearchParams();

  const [dateRange, setDateRange] = useState(() => {
    const from = sp.get("from"); const to = sp.get("to");
    const preset = sp.get("preset") || "last30";
    if (from && to) return { preset, from, to };
    const r = getDateRangeFromPreset(preset);
    return { preset, from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });

  const [search,       setSearch]       = useState(sp.get("q") || "");
  const [sourceFilter, setSourceFilter] = useState(sp.get("source") || "all");
  const [statusFilter, setStatusFilter] = useState(sp.get("status") || "all");
  const [sortField,    setSortField]    = useState("totalSubmissions");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");
  const [rows,         setRows]         = useState<WebsiteFormRow[]>([]);
  const [loading,      setLoading]      = useState(true);

  const syncUrl = useCallback((dr: typeof dateRange, q: string, src: string, status: string) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "", q, source: src, status });
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/website-leads?${params}`);
    setRows(await res.json());
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
    syncUrl(next, search, sourceFilter, statusFilter);
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  const formSources = Array.from(new Set(rows.map((r) => r.websiteFormSource).filter(Boolean)));

  const filtered = rows
    .filter((r) => {
      const q = search.toLowerCase();
      const matchQ = !q || (r.formName ?? "").toLowerCase().includes(q) || (r.websiteFormSource ?? "").toLowerCase().includes(q) || (r.pageUrl ?? "").toLowerCase().includes(q);
      const matchSrc = sourceFilter === "all" || r.websiteFormSource === sourceFilter;
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      return matchQ && matchSrc && matchStatus;
    })
    .sort((a, b) => {
      const av = (a as any)[sortField] ?? 0; const bv = (b as any)[sortField] ?? 0;
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortDir === "asc" ? 1 : -1);
    });

  const totals = filtered.reduce(
    (acc, r) => ({
      total: acc.total + r.totalSubmissions,
      unique: acc.unique + r.uniqueLeads,
      dupes: acc.dupes + r.duplicateCount,
      ghl: acc.ghl + r.ghlCount,
      zenoti: acc.zenoti + r.zenotiCount,
    }),
    { total: 0, unique: 0, dupes: 0, ghl: 0, zenoti: 0 }
  );

  const SortHead = ({ field, label }: { field: string; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground font-medium whitespace-nowrap" onClick={() => toggleSort(field)}>
      {label} <ArrowUpDown className="w-3 h-3 opacity-60" />
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Website Leads" description="Leads from website forms, grouped by form name and source type" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 w-52" placeholder="Search form name, URL…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); syncUrl(dateRange, e.target.value, sourceFilter, statusFilter); }}
              />
            </div>
            <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); syncUrl(dateRange, search, v, statusFilter); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All form sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Form Sources</SelectItem>
                {formSources.map((s) => <SelectItem key={s!} value={s!}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); syncUrl(dateRange, search, sourceFilter, v); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="MATCHED">Matched</SelectItem>
                <SelectItem value="MINOR_MISMATCH">Minor Mismatch</SelectItem>
                <SelectItem value="MAJOR_MISMATCH">Major Mismatch</SelectItem>
                <SelectItem value="MISSING_IN_GHL">Missing in GHL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ExportButton endpoint="/api/export" filename="website-leads.csv"
            params={{ type: "website-leads", from: dateRange.from || "", to: dateRange.to || "" }} />
        </div>

        {/* Totals row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total Submissions",  value: totals.total,  cls: "text-blue-600",   icon: Globe },
            { label: "Unique Leads",        value: totals.unique, cls: "text-indigo-600", icon: Globe },
            { label: "Duplicates",          value: totals.dupes,  cls: "text-yellow-600", icon: Copy },
            { label: "Found in GHL",        value: totals.ghl,    cls: "text-green-600",  icon: Globe },
            { label: "Found in Zenoti",     value: totals.zenoti, cls: "text-amber-600",  icon: Globe },
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
            <CardTitle className="text-base">{filtered.length} forms</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No website lead data. Upload a Website CSV.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead><SortHead field="formName" label="Form Name" /></TableHead>
                    <TableHead>Source Type</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right"><SortHead field="totalSubmissions" label="Submissions" /></TableHead>
                    <TableHead className="text-right"><SortHead field="uniqueLeads" label="Unique" /></TableHead>
                    <TableHead className="text-right"><SortHead field="duplicateCount" label="Dupes" /></TableHead>
                    <TableHead className="text-right"><SortHead field="ghlCount" label="GHL" /></TableHead>
                    <TableHead className="text-right"><SortHead field="zenotiCount" label="Zenoti" /></TableHead>
                    <TableHead className="text-right"><SortHead field="websiteToGhlDiff" label="→GHL Diff" /></TableHead>
                    <TableHead className="text-right"><SortHead field="websiteToZenotiDiff" label="→Zenoti Diff" /></TableHead>
                    <TableHead className="text-right"><SortHead field="websiteToGhlMatchRate" label="GHL %" /></TableHead>
                    <TableHead className="text-right"><SortHead field="websiteToZenotiMatchRate" label="Zenoti %" /></TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Sub</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.id} className="text-sm">
                      <TableCell className="font-medium max-w-[200px] truncate" title={row.formName}>
                        {row.formName}
                        {row.pageUrl && (
                          <a href={row.pageUrl} target="_blank" rel="noreferrer"
                            className="ml-1 text-xs text-muted-foreground hover:text-blue-600 inline-block"
                            onClick={(e) => e.stopPropagation()}>
                            ↗
                          </a>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.websiteFormSource
                          ? <Badge variant="info" className="text-xs">{row.websiteFormSource}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{row.backendProvider ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.totalSubmissions}</TableCell>
                      <TableCell className="text-right tabular-nums text-blue-600">{row.uniqueLeads}</TableCell>
                      <TableCell className="text-right tabular-nums text-yellow-600">
                        {row.duplicateCount > 0 ? row.duplicateCount : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-green-600">{row.ghlCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600">{row.zenotiCount}</TableCell>
                      <TableCell className="text-right"><DiffCell val={row.websiteToGhlDiff} /></TableCell>
                      <TableCell className="text-right"><DiffCell val={row.websiteToZenotiDiff} /></TableCell>
                      <TableCell className="text-right"><RateCell rate={row.websiteToGhlMatchRate} /></TableCell>
                      <TableCell className="text-right"><RateCell rate={row.websiteToZenotiMatchRate} /></TableCell>
                      <TableCell><AuditStatusBadge status={row.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.lastSubmissionAt ? row.lastSubmissionAt.slice(0, 10) : "—"}
                      </TableCell>
                    </TableRow>
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

export default function WebsiteLeadsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <WebsiteLeadsPageInner />
    </Suspense>
  );
}
