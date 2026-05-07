"use client";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { KPICard } from "@/components/dashboard/KPICard";
import { ReconciliationBadge } from "@/components/dashboard/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subDays } from "date-fns";
import { Search, FileCode2, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Copy, Activity, ChevronDown, ChevronRight, Eye } from "lucide-react";
import type { ReconciliationStatus } from "@/types";

export default function WordPressFormsPage() {
  const [dateRange, setDateRange] = useState({ preset: "last30", from: format(subDays(new Date(), 30), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") });
  const [forms, setForms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [formLeads, setFormLeads] = useState<any[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const fetchForms = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/wordpress-forms?${params}`);
    setForms(await res.json());
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { fetchForms(); }, [fetchForms]);

  async function openFormDetail(form: any) {
    setSelectedForm(form);
    setLoadingLeads(true);
    const res = await fetch(`/api/wordpress-forms/${encodeURIComponent(form.formName)}`);
    setFormLeads(await res.json());
    setLoadingLeads(false);
  }

  function handleDateChange(v: any) {
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      setDateRange({ preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") });
    } else setDateRange(v);
  }

  const filtered = forms.filter((f) => {
    const q = search.toLowerCase();
    return (!q || f.formName?.toLowerCase().includes(q) || f.pageUrl?.toLowerCase().includes(q)) &&
      (statusFilter === "all" || f.reconciliationStatus === statusFilter);
  });

  // KPI aggregates
  const totals = forms.reduce((a, f) => ({
    total: a.total + f.totalSubmissions,
    unique: a.unique + f.uniqueLeads,
    dupes: a.dupes + f.duplicateSubmissions,
    missingGhl: a.missingGhl + f.missingInGhlCount,
    missingZenoti: a.missingZenoti + f.missingInZenotiCount,
  }), { total: 0, unique: 0, dupes: 0, missingGhl: 0, missingZenoti: 0 });

  const activeForms = forms.length;
  const highestForm = forms.reduce((a, b) => (b.totalSubmissions > (a?.totalSubmissions ?? 0) ? b : a), null as any);
  const lowestForm = forms.filter((f) => f.totalSubmissions > 0).reduce((a, b) => (b.totalSubmissions < (a?.totalSubmissions ?? Infinity) ? b : a), null as any);
  const avgRate = forms.length > 0 ? Math.round(forms.reduce((a, f) => a + f.formToGhlReconciliationRate, 0) / forms.length) : 0;

  // Chart data
  const barData = filtered.slice(0, 15).map((f) => ({
    name: f.formName.replace(" Form", "").replace(" Consultation", "").slice(0, 25),
    submissions: f.totalSubmissions, unique: f.uniqueLeads,
    ghlMatched: f.ghlMatchedCount, zenotiMatched: f.zenotiMatchedCount,
  }));

  // Timeline from leads grouped by form
  const formLeadsTimeline = formLeads.reduce((acc: Record<string, number>, l: any) => {
    if (!l.createdAtSource) return acc;
    const day = l.createdAtSource.slice(0, 10);
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {});
  const timelineData = Object.entries(formLeadsTimeline).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="WordPress Forms Breakdown" description="Lead performance per WordPress form" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Filters */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <DateRangeFilter value={dateRange} onChange={handleDateChange} />
          <ExportButton endpoint="/api/export" filename="wordpress-forms.csv" params={{ type: "wordpress-forms" }} />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KPICard title="Total WP Leads" value={totals.total} icon={FileCode2} color="blue" className="col-span-2 md:col-span-1 lg:col-span-1" />
          <KPICard title="Active Forms" value={activeForms} icon={Activity} color="blue" />
          <KPICard title="Highest Volume" value={highestForm?.totalSubmissions ?? 0} subtitle={highestForm?.formName?.split(" ").slice(0, 2).join(" ")} icon={TrendingUp} color="green" />
          <KPICard title="Lowest Volume" value={lowestForm?.totalSubmissions ?? 0} subtitle={lowestForm?.formName?.split(" ").slice(0, 2).join(" ")} icon={TrendingUp} color="gray" />
          <KPICard title="Missing in GHL" value={totals.missingGhl} icon={XCircle} color="red" />
          <KPICard title="Missing in Zenoti" value={totals.missingZenoti} icon={AlertTriangle} color="yellow" />
          <KPICard title="Duplicate Leads" value={totals.dupes} icon={Copy} color="purple" />
          <KPICard title="Avg Recon Rate" value={`${avgRate}%`} icon={CheckCircle2} color={avgRate >= 90 ? "green" : avgRate >= 75 ? "yellow" : "red"} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Leads by WordPress Form</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={160} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="submissions" fill="#3b82f6" name="Submissions" />
                  <Bar dataKey="ghlMatched" fill="#10b981" name="GHL Matched" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Reconciliation Rates by Form</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {filtered.map((f) => (
                  <div key={f.formName} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-[140px] truncate" title={f.formName}>
                      {f.formName.split(" ").slice(0, 3).join(" ")}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${f.formToGhlReconciliationRate >= 95 ? "bg-green-500" : f.formToGhlReconciliationRate >= 85 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(100, f.formToGhlReconciliationRate)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium tabular-nums w-10 text-right">{f.formToGhlReconciliationRate.toFixed(0)}%</span>
                    <ReconciliationBadge status={f.reconciliationStatus as ReconciliationStatus} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base">WordPress Form Reconciliation Summary ({filtered.length} forms)</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9 w-48" placeholder="Search forms..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                    <SelectItem value="DUPLICATE_ISSUE">Duplicate Issue</SelectItem>
                    <SelectItem value="NEEDS_REVIEW">Needs Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Form Name</TableHead>
                    <TableHead>Plugin</TableHead>
                    <TableHead className="max-w-[140px]">Page URL</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Unique</TableHead>
                    <TableHead className="text-right">Dupes</TableHead>
                    <TableHead className="text-right">GHL Matched</TableHead>
                    <TableHead className="text-right">Missing GHL</TableHead>
                    <TableHead className="text-right">GHL Rate</TableHead>
                    <TableHead className="text-right">Zenoti Rate</TableHead>
                    <TableHead>Last Submission</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((form) => (
                    <TableRow key={form.formName} className="cursor-pointer hover:bg-gray-50">
                      <TableCell>
                        <button onClick={() => setExpandedRows((s) => { const n = new Set(s); n.has(form.formName) ? n.delete(form.formName) : n.add(form.formName); return n; })}>
                          {expandedRows.has(form.formName) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{form.formName}</TableCell>
                      <TableCell>
                        {form.wordpressFormPlugin && <Badge variant="info" className="text-[10px]">{form.wordpressFormPlugin}</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{form.pageUrl || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold">{form.totalSubmissions}</TableCell>
                      <TableCell className="text-right tabular-nums">{form.uniqueLeads}</TableCell>
                      <TableCell className={`text-right tabular-nums ${form.duplicateSubmissions > 0 ? "text-red-600 font-semibold" : ""}`}>{form.duplicateSubmissions}</TableCell>
                      <TableCell className="text-right tabular-nums text-green-600">{form.ghlMatchedCount}</TableCell>
                      <TableCell className={`text-right tabular-nums ${form.missingInGhlCount > 0 ? "text-red-600 font-semibold" : ""}`}>{form.missingInGhlCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={`font-medium ${form.formToGhlReconciliationRate >= 95 ? "text-green-600" : form.formToGhlReconciliationRate >= 85 ? "text-yellow-600" : "text-red-600"}`}>
                          {form.formToGhlReconciliationRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={`font-medium ${form.formToZenotiReconciliationRate >= 95 ? "text-green-600" : form.formToZenotiReconciliationRate >= 75 ? "text-yellow-600" : "text-red-600"}`}>
                          {form.formToZenotiReconciliationRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {form.lastSubmissionAt ? format(new Date(form.lastSubmissionAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell><ReconciliationBadge status={form.reconciliationStatus as ReconciliationStatus} /></TableCell>
                      <TableCell>
                        <button onClick={() => openFormDetail(form)} className="p-1 hover:bg-gray-100 rounded">
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Form Detail Dialog */}
      <Dialog open={!!selectedForm} onOpenChange={(o) => !o && setSelectedForm(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedForm?.formName}</DialogTitle>
          </DialogHeader>
          {selectedForm && (
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="submissions">Submissions</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Total Submissions", value: selectedForm.totalSubmissions },
                    { label: "Unique Leads", value: selectedForm.uniqueLeads },
                    { label: "Duplicates", value: selectedForm.duplicateSubmissions },
                    { label: "GHL Rate", value: `${selectedForm.formToGhlReconciliationRate.toFixed(1)}%` },
                    { label: "GHL Matched", value: selectedForm.ghlMatchedCount },
                    { label: "Missing GHL", value: selectedForm.missingInGhlCount },
                    { label: "Zenoti Matched", value: selectedForm.zenotiMatchedCount },
                    { label: "Missing Zenoti", value: selectedForm.missingInZenotiCount },
                  ].map((s) => (
                    <div key={s.label} className="p-3 rounded-lg bg-gray-50">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-xl font-bold mt-0.5">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Plugin:</span>
                  <Badge variant="info">{selectedForm.wordpressFormPlugin || "Unknown"}</Badge>
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <ReconciliationBadge status={selectedForm.reconciliationStatus} />
                </div>
                {selectedForm.pageUrl && (
                  <p className="text-sm text-muted-foreground">Page: <span className="font-mono text-xs">{selectedForm.pageUrl}</span></p>
                )}
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={timelineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#3b82f6" dot={false} name="Submissions" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>

              <TabsContent value="submissions" className="mt-4">
                {loadingLeads ? (
                  <p className="text-center text-muted-foreground">Loading submissions...</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Clinic</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>UTM Source</TableHead>
                          <TableHead>UTM Campaign</TableHead>
                          <TableHead>Duplicate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formLeads.map((l: any) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-xs">{l.createdAtSource ? format(new Date(l.createdAtSource), "MMM d, yy HH:mm") : "—"}</TableCell>
                            <TableCell className="text-sm font-medium">{l.fullName || "—"}</TableCell>
                            <TableCell className="text-xs">{l.email || "—"}</TableCell>
                            <TableCell className="text-xs">{l.phone || "—"}</TableCell>
                            <TableCell className="text-xs">{l.clinicLocationNormalized || "—"}</TableCell>
                            <TableCell className="text-xs">{l.serviceNormalized || "—"}</TableCell>
                            <TableCell className="text-xs">{l.utmSource || "—"}</TableCell>
                            <TableCell className="text-xs">{l.utmCampaign || "—"}</TableCell>
                            <TableCell>{l.isDuplicate && <Badge variant="destructive" className="text-[10px]">Dup</Badge>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
