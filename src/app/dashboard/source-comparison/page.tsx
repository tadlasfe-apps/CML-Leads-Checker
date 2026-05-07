"use client";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { ReconciliationBadge } from "@/components/dashboard/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, subDays } from "date-fns";
import { Search, ArrowUpDown } from "lucide-react";
import type { ReconciliationStatus } from "@/types";

export default function SourceComparisonPage() {
  const [dateRange, setDateRange] = useState({ preset: "last30", from: format(subDays(new Date(), 30), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") });
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("wordpressCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/source-comparison?${params}`);
    setRows(await res.json());
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

  const filtered = rows
    .filter((r) => {
      const q = search.toLowerCase();
      return (!q || r.clinicLocation?.toLowerCase().includes(q) || r.service?.toLowerCase().includes(q)) &&
        (statusFilter === "all" || r.status === statusFilter);
    })
    .sort((a, b) => {
      const v = sortDir === "asc" ? 1 : -1;
      return (a[sortField] > b[sortField] ? 1 : -1) * v;
    });

  const totals = filtered.reduce((acc, r) => ({
    wordpress: acc.wordpress + r.wordpressCount,
    meta: acc.meta + r.metaCount,
    ghl: acc.ghl + r.ghlCount,
    zenoti: acc.zenoti + r.zenotiCount,
  }), { wordpress: 0, meta: 0, ghl: 0, zenoti: 0 });

  const SortHeader = ({ field, label }: { field: string; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground font-medium" onClick={() => toggleSort(field)}>
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Source Comparison" description="Compare lead counts across WordPress, Meta, GHL, and Zenoti" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 w-48" placeholder="Search clinic/service..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Filter status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="HEALTHY">Healthy</SelectItem>
                <SelectItem value="MINOR_DISCREPANCY">Minor Discrepancy</SelectItem>
                <SelectItem value="MAJOR_DISCREPANCY">Major Discrepancy</SelectItem>
                <SelectItem value="MISSING_GHL">Missing in GHL</SelectItem>
                <SelectItem value="MISSING_ZENOTI">Missing in Zenoti</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ExportButton endpoint="/api/export" filename="source-comparison.csv" params={{ type: "source-comparison", from: dateRange.from, to: dateRange.to }} />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "WordPress", value: totals.wordpress, color: "text-blue-600 bg-blue-50" },
            { label: "Meta", value: totals.meta, color: "text-purple-600 bg-purple-50" },
            { label: "GHL", value: totals.ghl, color: "text-green-600 bg-green-50" },
            { label: "Zenoti", value: totals.zenoti, color: "text-yellow-600 bg-yellow-50" },
          ].map((s) => (
            <Card key={s.label}><CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color.split(" ")[0]}`}>{s.value}</p>
            </CardContent></Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Comparison by Clinic × Service ({filtered.length} rows)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No data found</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><SortHeader field="clinicLocation" label="Clinic" /></TableHead>
                    <TableHead><SortHeader field="service" label="Service" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="wordpressCount" label="WordPress" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="metaCount" label="Meta" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="ghlCount" label="GHL" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="zenotiCount" label="Zenoti" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="sourcesToGhlDiff" label="Src↔GHL Diff" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="ghlToZenotoDiff" label="GHL↔Zenoti Diff" /></TableHead>
                    <TableHead className="text-right"><SortHeader field="discrepancyPct" label="Discrepancy%" /></TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.clinicLocation || "—"}</TableCell>
                      <TableCell>{row.service || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.wordpressCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.metaCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.ghlCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.zenotiCount}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${row.sourcesToGhlDiff > 0 ? "text-red-600" : "text-green-600"}`}>
                        {row.sourcesToGhlDiff > 0 ? `+${row.sourcesToGhlDiff}` : row.sourcesToGhlDiff}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${row.ghlToZenotoDiff > 0 ? "text-yellow-600" : "text-green-600"}`}>
                        {row.ghlToZenotoDiff > 0 ? `+${row.ghlToZenotoDiff}` : row.ghlToZenotoDiff}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.discrepancyPct}%</TableCell>
                      <TableCell><ReconciliationBadge status={row.status as ReconciliationStatus} /></TableCell>
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
