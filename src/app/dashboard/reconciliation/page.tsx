"use client";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { MatchStatusBadge, SourceBadge } from "@/components/dashboard/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export default function ReconciliationPage() {
  const [dateRange, setDateRange] = useState({ preset: "last30", from: format(subDays(new Date(), 30), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") });
  const [data, setData] = useState<any>({ leads: [], total: 0, page: 1, pageSize: 50, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      from: dateRange.from, to: dateRange.to, page: String(page),
      ...(sourceFilter !== "all" ? { source: sourceFilter } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    });
    const res = await fetch(`/api/reconciliation?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [dateRange, page, sourceFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleDateChange(v: any) {
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      setDateRange({ preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") });
    } else setDateRange(v);
    setPage(1);
  }

  const filteredLeads = data.leads.filter((l: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.fullName?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) ||
      l.phone?.includes(q) || l.clinicLocationNormalized?.toLowerCase().includes(q);
  });

  const bestMatch = (lead: any) => lead.primaryMatches?.[0];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Lead Reconciliation" description="Individual lead match status across all systems" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 w-48" placeholder="Search leads..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="WORDPRESS">WordPress</SelectItem>
                <SelectItem value="META">Meta</SelectItem>
                <SelectItem value="GHL">GHL</SelectItem>
                <SelectItem value="ZENOTI">Zenoti</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="duplicate">Duplicates Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <ExportButton endpoint="/api/export" filename="unmatched-leads.csv" params={{ type: "unmatched", from: dateRange.from, to: dateRange.to }} label="Export Unmatched" />
            <ExportButton endpoint="/api/export" filename="duplicates.csv" params={{ type: "duplicates", from: dateRange.from, to: dateRange.to }} label="Export Dupes" />
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base">{data.total} Lead Records</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft />
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {data.totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages}>
                <ChevronRight />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Form / Campaign</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLeads.map((lead: any) => {
                    const match = bestMatch(lead);
                    const score = match?.matchScore ?? 0;
                    const matchStatus = match?.matchStatus ?? "UNMATCHED";
                    return (
                      <TableRow key={lead.id}>
                        <TableCell><SourceBadge source={lead.sourceSystem} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {lead.createdAtSource ? format(new Date(lead.createdAtSource), "MMM d, yy") : "—"}
                        </TableCell>
                        <TableCell className="font-medium max-w-[120px] truncate">{lead.fullName || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate">{lead.email || "—"}</TableCell>
                        <TableCell className="text-xs">{lead.phone || "—"}</TableCell>
                        <TableCell className="text-xs">{lead.clinicLocationNormalized || "—"}</TableCell>
                        <TableCell className="text-xs">{lead.serviceNormalized || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground">
                          {lead.formName || lead.campaignName || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-bold tabular-nums ${score >= 70 ? "text-green-600" : score >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                            {score > 0 ? score : "—"}
                          </span>
                        </TableCell>
                        <TableCell><MatchStatusBadge status={matchStatus} /></TableCell>
                        <TableCell>
                          {lead.isDuplicate && <Badge variant="purple" className="text-[10px]">Dup</Badge>}
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
