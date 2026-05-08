"use client";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { AuditStatusBadge, DiscrepancyBadge } from "@/components/dashboard/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Search, ArrowUpDown } from "lucide-react";
import type { ServiceBreakdownRow } from "@/types";

const COLORS = { website: "#3b82f6", meta: "#8b5cf6", ghl: "#10b981", zenoti: "#f59e0b" };

function DiffCell({ val }: { val: number }) {
  if (val === 0) return <span className="text-green-600 font-medium">0</span>;
  return <span className={`font-semibold ${val > 0 ? "text-red-600" : "text-emerald-600"}`}>{val > 0 ? `+${val}` : val}</span>;
}

function RateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  const color = rate >= 95 ? "text-green-600" : rate >= 85 ? "text-yellow-600" : "text-red-600";
  return <span className={`font-semibold ${color}`}>{rate}%</span>;
}

export default function ServiceBreakdownPage() {
  const [dateRange, setDateRange] = useState(() => {
    const r = getDateRangeFromPreset("last30");
    return { preset: "last30", from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });
  const [data, setData] = useState<ServiceBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("totalSourceLeads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/service-breakdown?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleDateChange(v: any) {
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      setDateRange({ preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") });
    } else setDateRange(v);
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  const filtered = data
    .filter((r) => !search || (r.service ?? "").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = (a as any)[sortField] ?? 0; const bv = (b as any)[sortField] ?? 0;
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortDir === "asc" ? 1 : -1);
    });

  const SortHead = ({ field, label }: { field: string; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground font-medium whitespace-nowrap" onClick={() => toggleSort(field)}>
      {label} <ArrowUpDown className="w-3 h-3 opacity-60" />
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Service Breakdown" description="Lead count reconciliation per service" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 w-48" placeholder="Search service…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <ExportButton endpoint="/api/export" filename="service-breakdown.csv"
            params={{ type: "source-comparison", from: dateRange.from, to: dateRange.to }} />
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base">Leads by Source per Service (top 15)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={filtered.slice(0, 15)} margin={{ bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="service" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="websiteLeads" fill={COLORS.website} name="Website" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="metaLeads"    fill={COLORS.meta}    name="Meta"    radius={[2, 2, 0, 0]} />
                    <Bar dataKey="ghlLeads"     fill={COLORS.ghl}     name="GHL"     radius={[2, 2, 0, 0]} />
                    <Bar dataKey="zenotiLeads"  fill={COLORS.zenoti}  name="Zenoti"  radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">{filtered.length} Services</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead><SortHead field="service" label="Service" /></TableHead>
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
                      <TableRow key={row.service} className="text-sm">
                        <TableCell className="font-medium">{row.service}</TableCell>
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
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
