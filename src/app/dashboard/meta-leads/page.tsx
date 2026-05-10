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
import { Search, ArrowUpDown, Share2, DollarSign, Info, Building2 } from "lucide-react";

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

  const [adAccountId,  setAdAccountId]  = useState(sp.get("adAccountId") || "");
  const [clinicFilter, setClinicFilter] = useState("");
  const [search,       setSearch]       = useState("");
  const [sortField,   setSortField]   = useState("reportDate");
  const [sortDir,     setSortDir]     = useState<"asc" | "desc">("desc");
  const [data, setData]   = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const syncUrl = useCallback((dr: typeof dateRange, acct: string) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "" });
    if (acct) p.set("adAccountId", acct);
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    if (adAccountId) params.set("adAccountId", adAccountId);
    const res = await fetch(`/api/meta-leads?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [dateRange, adAccountId]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleDateChange(v: any) {
    let next: typeof dateRange;
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      next = { preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    } else next = v;
    setDateRange(next);
    syncUrl(next, adAccountId);
  }

  function handleAccountChange(val: string) {
    setAdAccountId(val);
    syncUrl(dateRange, val);
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  const allRows: any[]           = data?.rows ?? [];
  const byCampaign: any[]        = data?.byCampaign ?? [];
  const byAdAccount: any[]       = data?.byAdAccount ?? [];
  const byClinicLocation: any[]  = data?.byClinicLocation ?? [];
  const adAccountCount: number   = data?.adAccountCount ?? byAdAccount.length;

  const filtered = allRows
    .filter((r) => {
      const q = search.toLowerCase();
      return !q || (r.campaignName ?? "").toLowerCase().includes(q) || (r.metaAdSetName ?? "").toLowerCase().includes(q) || (r.metaAdAccountName ?? "").toLowerCase().includes(q);
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

  // Ad account options for filter dropdown
  const accountOptions = byAdAccount.map((a: any) => ({
    value: a.accountId,
    label: a.accountName && a.accountName !== a.accountId ? `${a.accountName} (${a.accountId})` : a.accountId,
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Meta Leads" description="Aggregate Meta Ads reporting — lead result types only" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            {/* Ad account filter */}
            {accountOptions.length > 0 && (
              <select
                value={adAccountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="border rounded px-2 py-1 text-xs text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring h-8"
              >
                <option value="">All Ad Accounts</option>
                {accountOptions.map((o: any) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {/* Clinic location filter */}
            {byClinicLocation.length > 0 && (
              <select
                value={clinicFilter}
                onChange={(e) => setClinicFilter(e.target.value)}
                className="border rounded px-2 py-1 text-xs text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring h-8"
              >
                <option value="">All Clinics</option>
                {byClinicLocation.map((c: any) => (
                  <option key={c.clinic} value={c.clinic}>{c.clinic}</option>
                ))}
              </select>
            )}
          </div>
          <ExportButton endpoint="/api/export" filename="meta-leads.csv"
            params={{ type: "meta-leads", from: dateRange.from || "", to: dateRange.to || "" }} />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide"># Ad Accounts</p>
              <p className="text-2xl font-bold tabular-nums text-purple-700">{adAccountCount}</p>
              <p className="text-xs text-muted-foreground mt-1">in this period</p>
            </CardContent>
          </Card>
        </div>

        {/* Counting note */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>Only <code className="font-mono bg-background px-1 rounded">action_type = lead</code> is counted. Other Meta action types (onsite_conversion.lead_grouped, etc.) are stored in raw data but excluded from totals.</span>
        </div>

        {/* Legacy records note */}
        {byAdAccount.some((a: any) => a.accountId === "unknown") && (
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              <strong>Unknown ad account</strong> means older Meta records do not have account ID/name stored.
              Go to <strong>Data Pulls → Meta Lead Results → Clear Meta Records</strong>, then re-pull to fix.
            </span>
          </div>
        )}

        {/* Meta Leads by Ad Account table */}
        {byAdAccount.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                Meta Leads by Ad Account
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Account ID</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Campaigns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byAdAccount.map((acct: any) => {
                    const acctCpl = acct.leads > 0 ? (acct.spend / acct.leads).toFixed(2) : null;
                    return (
                      <TableRow key={acct.accountId} className="text-sm">
                        <TableCell>
                          <button
                            className="font-mono text-xs text-purple-600 hover:underline"
                            onClick={() => handleAccountChange(adAccountId === acct.accountId ? "" : acct.accountId)}
                          >
                            {acct.accountId}
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {acct.accountName && acct.accountName !== acct.accountId ? acct.accountName : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-purple-600">
                          {acct.leads}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {`$${Number(acct.spend).toFixed(2)}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {acctCpl ? `$${acctCpl}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {acct.campaignCount}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Meta Leads by Clinic Location */}
        {byClinicLocation.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                Meta Leads by Clinic Location
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Clinic Location</TableHead>
                    <TableHead>Ad Accounts</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Campaigns</TableHead>
                    <TableHead className="text-right">Ad Sets</TableHead>
                    <TableHead className="text-right">Ads</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                    <TableHead className="text-right">Reach</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(clinicFilter
                    ? byClinicLocation.filter((c: any) => c.clinic === clinicFilter)
                    : byClinicLocation
                  ).map((c: any) => (
                    <TableRow key={c.clinic} className="text-sm">
                      <TableCell className="font-medium">{c.clinic}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={(c.accountNames ?? []).join(", ")}>
                        {(c.accountNames ?? []).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-purple-600">{c.leads}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">${Number(c.spend).toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.cpl != null ? `$${c.cpl}` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.campaignCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.adSetCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.adCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.impressions?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.reach?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.clicks?.toLocaleString() ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

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
                  className="pl-9 w-52" placeholder="Search campaign, ad set…"
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
                    <TableHead><SortHead field="metaAdAccountName" label="Ad Account" /></TableHead>
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
                      <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground" title={row.metaAdAccountName ?? row.metaAdAccountId}>
                        {row.metaAdAccountName ?? row.metaAdAccountId ?? "—"}
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
