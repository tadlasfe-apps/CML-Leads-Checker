"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { Search, ArrowUpDown, Share2, DollarSign } from "lucide-react";

function MetaLeadsPageInner() {
  const router      = useRouter();
  const sp          = useSearchParams();

  const [dateRange, setDateRange] = useState(() => {
    const from = sp.get("from"); const to = sp.get("to");
    const preset = sp.get("preset") || "last30";
    if (from && to) return { preset, from, to };
    const r = getDateRangeFromPreset(preset);
    return { preset, from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });

  const [search,    setSearch]    = useState("");
  const [sortField, setSortField] = useState("reportDate");
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("desc");
  const [data, setData]   = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const syncUrl = useCallback((dr: typeof dateRange) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "" });
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/meta-leads?${params}`);
    setData(await res.json());
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
    syncUrl(next);
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  const allRows: any[] = data?.rows ?? [];
  const byCampaign: any[] = data?.byCampaign ?? [];

  const filtered = allRows
    .filter((r) => {
      const q = search.toLowerCase();
      return !q || (r.campaignName ?? "").toLowerCase().includes(q) || (r.metaAdSetName ?? "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = (a as any)[sortField] ?? ""; const bv = (b as any)[sortField] ?? "";
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortDir === "asc" ? 1 : -1);
    });

  const SortHead = ({ field, label }: { field: string; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground font-medium whitespace-nowrap" onClick={() => toggleSort(field)}>
      {label} <ArrowUpDown className="w-3 h-3 opacity-60" />
    </button>
  );

  const totalLeads = data?.totalLeads ?? 0;
  const totalSpend = data?.totalSpend ?? 0;
  const cpl = totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Meta Leads" description="Aggregate Meta Ads reporting — lead result types only" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <DateRangeFilter value={dateRange} onChange={handleDateChange} />
          <ExportButton endpoint="/api/export" filename="meta-leads.csv"
            params={{ type: "meta-leads", from: dateRange.from || "", to: dateRange.to || "" }} />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Meta Leads</p>
              <p className="text-2xl font-bold tabular-nums text-purple-700">{totalLeads}</p>
              <p className="text-xs text-muted-foreground mt-1">Lead result types only</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Spend</p>
              <p className="text-2xl font-bold tabular-nums text-gray-700">${totalSpend.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Cost per Lead</p>
              <p className="text-2xl font-bold tabular-nums text-gray-700">{cpl ? `$${cpl}` : "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Campaigns</p>
              <p className="text-2xl font-bold tabular-nums text-purple-700">{byCampaign.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Campaign bar chart */}
        {byCampaign.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leads by Campaign</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byCampaign.slice(0, 15)} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="campaign" width={160} tick={{ fontSize: 11 }}
                    tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + "…" : v} />
                  <Tooltip />
                  <Bar dataKey="leads" fill="#8b5cf6" name="Leads" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Row-level table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{filtered.length} rows</CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9 w-52" placeholder="Search campaign…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No Meta lead data. Upload a Meta CSV with lead result types.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead><SortHead field="reportDate" label="Date" /></TableHead>
                    <TableHead><SortHead field="campaignName" label="Campaign" /></TableHead>
                    <TableHead><SortHead field="metaAdSetName" label="Ad Set" /></TableHead>
                    <TableHead>Result Type</TableHead>
                    <TableHead className="text-right"><SortHead field="metaLeadCount" label="Leads" /></TableHead>
                    <TableHead className="text-right"><SortHead field="spend" label="Spend" /></TableHead>
                    <TableHead className="text-right"><SortHead field="costPerResult" label="CPR" /></TableHead>
                    <TableHead className="text-right"><SortHead field="impressions" label="Impressions" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 500).map((row, i) => (
                    <TableRow key={i} className="text-sm">
                      <TableCell className="tabular-nums whitespace-nowrap">
                        {row.reportDate ? String(row.reportDate).slice(0, 10) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate" title={row.campaignName}>
                        {row.campaignName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-muted-foreground" title={row.metaAdSetName}>
                        {row.metaAdSetName ?? "—"}
                      </TableCell>
                      <TableCell>
                        {row.metaResultType
                          ? <Badge variant="purple" className="text-xs">{row.metaResultType}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-purple-600">
                        {row.metaLeadCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.spend != null ? `$${Number(row.spend).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.costPerResult != null ? `$${Number(row.costPerResult).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.impressions?.toLocaleString() ?? "—"}
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

export default function MetaLeadsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <MetaLeadsPageInner />
    </Suspense>
  );
}
