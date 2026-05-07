"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { KPICard } from "@/components/dashboard/KPICard";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  Globe, Share2, Database, Activity, TrendingUp, TrendingDown,
  Copy, MapPin, Stethoscope, CalendarDays, AlertTriangle,
} from "lucide-react";
import { format, subDays } from "date-fns";
import type { OverviewKPIs, DateGrouping, ReportingTimezone } from "@/types";
import { DATE_GROUPINGS, REPORTING_TIMEZONES } from "@/types";

const COLORS = {
  website: "#3b82f6",
  meta:    "#8b5cf6",
  ghl:     "#10b981",
  zenoti:  "#f59e0b",
  source:  "#6366f1",
};

export default function OverviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [dateRange, setDateRange] = useState(() => {
    const from = searchParams.get("from");
    const to   = searchParams.get("to");
    const preset = searchParams.get("preset") || "last30";
    if (from && to) return { preset, from, to };
    const r = getDateRangeFromPreset(preset);
    return { preset, from: format(r.from, "yyyy-MM-dd"), to: format(r.to, "yyyy-MM-dd") };
  });

  const [groupBy, setGroupBy]   = useState<DateGrouping>((searchParams.get("groupBy") as DateGrouping) || "daily");
  const [timezone, setTimezone] = useState<ReportingTimezone>((searchParams.get("timezone") as ReportingTimezone) || "America/Toronto");
  const [data, setData]         = useState<{ kpis: OverviewKPIs; timeline: any[] } | null>(null);
  const [loading, setLoading]   = useState(true);

  const syncUrl = useCallback((dr: typeof dateRange, gb: DateGrouping, tz: ReportingTimezone) => {
    const p = new URLSearchParams({ preset: dr.preset || "custom", from: dr.from || "", to: dr.to || "", groupBy: gb, timezone: tz });
    router.replace(`?${p}`, { scroll: false });
  }, [router]);

  const loadData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to, groupBy, timezone });
    const res = await fetch(`/api/overview?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [dateRange, groupBy, timezone]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleDateChange(v: any) {
    let next: typeof dateRange;
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      next = { preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    } else {
      next = v;
    }
    setDateRange(next);
    syncUrl(next, groupBy, timezone);
  }

  function handleGroupBy(val: string) {
    const gb = val as DateGrouping;
    setGroupBy(gb);
    syncUrl(dateRange, gb, timezone);
  }

  function handleTimezone(val: string) {
    const tz = val as ReportingTimezone;
    setTimezone(tz);
    syncUrl(dateRange, groupBy, tz);
  }

  const kpis = data?.kpis;
  const timeline = data?.timeline || [];

  const matchRateColor = (rate: number | null) =>
    rate === null ? "gray" : rate >= 95 ? "green" : rate >= 85 ? "yellow" : "red";

  const pieData = kpis ? [
    { name: "Website", value: kpis.websiteLeads },
    { name: "Meta",    value: kpis.metaLeads },
    { name: "GHL",     value: kpis.ghlLeads },
    { name: "Zenoti",  value: kpis.zenotiLeads },
  ].filter((d) => d.value > 0) : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Overview" description="Lead count reconciliation across all sources" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Filters bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter value={dateRange} onChange={handleDateChange} />
            <Select value={groupBy} onValueChange={handleGroupBy}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_GROUPINGS.map((g) => (
                  <SelectItem key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={timezone} onValueChange={handleTimezone}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORTING_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ExportButton
            endpoint="/api/export"
            filename="source-comparison.csv"
            params={{ type: "source-comparison", from: dateRange.from || "", to: dateRange.to || "" }}
          />
        </div>

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <KPICard title="Website Leads" value={kpis?.websiteLeads ?? 0} icon={Globe} color="blue"
                subtitle="Unique, deduped" />
              <KPICard title="Meta Leads" value={kpis?.metaLeads ?? 0} icon={Share2} color="purple"
                subtitle="Lead result type only" />
              <KPICard title="Total Source Leads" value={kpis?.totalSourceLeads ?? 0} icon={Activity} color="blue"
                subtitle="Website + Meta" />
              <KPICard title="GHL Leads" value={kpis?.ghlLeads ?? 0} icon={Database} color="green"
                subtitle="Lead Inquiry pipeline" />
              <KPICard title="Zenoti Leads" value={kpis?.zenotiLeads ?? 0} icon={Activity} color="yellow"
                subtitle="Non-appointment leads" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <KPICard
                title="Source → GHL Diff"
                value={kpis?.srcToGhlDiff ?? 0}
                icon={kpis?.srcToGhlDiff! > 0 ? TrendingDown : TrendingUp}
                color={kpis?.srcToGhlDiff !== 0 ? "red" : "green"}
                subtitle="Total Source − GHL"
              />
              <KPICard
                title="GHL → Zenoti Diff"
                value={kpis?.ghlToZenotiDiff ?? 0}
                icon={kpis?.ghlToZenotiDiff! > 0 ? TrendingDown : TrendingUp}
                color={kpis?.ghlToZenotiDiff !== 0 ? "yellow" : "green"}
                subtitle="GHL − Zenoti"
              />
              <KPICard
                title="Source→GHL Match"
                value={kpis?.srcToGhlMatchRate != null ? `${kpis.srcToGhlMatchRate}%` : "—"}
                icon={TrendingUp}
                color={matchRateColor(kpis?.srcToGhlMatchRate ?? null)}
              />
              <KPICard
                title="GHL→Zenoti Match"
                value={kpis?.ghlToZenotiMatchRate != null ? `${kpis.ghlToZenotiMatchRate}%` : "—"}
                icon={TrendingUp}
                color={matchRateColor(kpis?.ghlToZenotiMatchRate ?? null)}
              />
              <KPICard
                title="Duplicate Website Leads"
                value={kpis?.duplicateWebsiteLeads ?? 0}
                icon={Copy}
                color={kpis?.duplicateWebsiteLeads! > 0 ? "yellow" : "gray"}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KPICard
                title="Days with Src→GHL Gap"
                value={kpis?.datesWithSrcGhlDiscrepancy ?? 0}
                icon={CalendarDays}
                color={kpis?.datesWithSrcGhlDiscrepancy! > 0 ? "red" : "green"}
              />
              <KPICard
                title="Days with GHL→Zenoti Gap"
                value={kpis?.datesWithGhlZenotiDiscrepancy ?? 0}
                icon={CalendarDays}
                color={kpis?.datesWithGhlZenotiDiscrepancy! > 0 ? "yellow" : "green"}
              />
              <KPICard
                title="Unmapped Clinics"
                value={kpis?.unmappedClinicCount ?? 0}
                icon={MapPin}
                color={kpis?.unmappedClinicCount! > 0 ? "red" : "gray"}
              />
              <KPICard
                title="Unmapped Services"
                value={kpis?.unmappedServiceCount ?? 0}
                icon={Stethoscope}
                color={kpis?.unmappedServiceCount! > 0 ? "yellow" : "gray"}
              />
            </div>
          </>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Lead Volume Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="websiteLeads" stroke={COLORS.website} dot={false} name="Website" strokeWidth={2} />
                  <Line type="monotone" dataKey="metaLeads"    stroke={COLORS.meta}    dot={false} name="Meta"    strokeWidth={2} />
                  <Line type="monotone" dataKey="ghlLeads"     stroke={COLORS.ghl}     dot={false} name="GHL"     strokeWidth={2} />
                  <Line type="monotone" dataKey="zenotiLeads"  stroke={COLORS.zenoti}  dot={false} name="Zenoti"  strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Source Distribution</CardTitle></CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pieData} cx="50%" cy="50%" outerRadius={90}
                      dataKey="value" nameKey="name"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={[COLORS.website, COLORS.meta, COLORS.ghl, COLORS.zenoti][i % 4]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                  No data
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Lead Funnel Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Funnel — Source → GHL → Zenoti</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={timeline.slice(-20)} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="totalSource" fill={COLORS.source} name="Total Source" radius={[2, 2, 0, 0]} />
                <Bar dataKey="ghlLeads"    fill={COLORS.ghl}    name="GHL"          radius={[2, 2, 0, 0]} />
                <Bar dataKey="zenotiLeads" fill={COLORS.zenoti} name="Zenoti"       radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Discrepancy trend */}
        {kpis?.biggestDiscrepancyDate && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
              <p className="text-sm text-yellow-800">
                Biggest single-day discrepancy: <strong>{kpis.biggestDiscrepancyValue} leads</strong> on{" "}
                <strong>{kpis.biggestDiscrepancyDate}</strong>
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
