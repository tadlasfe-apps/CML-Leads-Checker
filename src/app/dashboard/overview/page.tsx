"use client";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { KPICard } from "@/components/dashboard/KPICard";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  Globe, Share2, Database, Activity, CheckCircle2, XCircle,
  Copy, TrendingUp, AlertTriangle, FileText,
} from "lucide-react";
import { format, subDays } from "date-fns";

const COLORS = { wordpress: "#3b82f6", meta: "#8b5cf6", ghl: "#10b981", zenoti: "#f59e0b" };
const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b"];

export default function OverviewPage() {
  const [dateRange, setDateRange] = useState({ preset: "last30", from: format(subDays(new Date(), 30), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await window.fetch(`/api/overview?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { fetch(); }, [fetch]);

  function handleDateChange(v: any) {
    if (v.preset && v.preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(v.preset);
      setDateRange({ preset: v.preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") });
    } else {
      setDateRange(v);
    }
  }

  const kpis = data?.kpis;
  const timeline = data?.timeline || [];

  const pieData = kpis ? [
    { name: "WordPress", value: kpis.wordpressLeads },
    { name: "Meta", value: kpis.metaLeads },
    { name: "GHL", value: kpis.ghlLeads },
    { name: "Zenoti", value: kpis.zenotiLeads },
  ] : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Overview" description="Lead reconciliation summary across all sources" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Filters */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <DateRangeFilter value={dateRange} onChange={handleDateChange} />
          <ExportButton endpoint="/api/export" filename="source-comparison.csv" params={{ from: dateRange.from, to: dateRange.to }} />
        </div>

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPICard title="Total Source Leads" value={kpis?.totalSourceLeads ?? 0} icon={Globe} color="blue" />
            <KPICard title="WordPress Leads" value={kpis?.wordpressLeads ?? 0} icon={FileText} color="blue" />
            <KPICard title="Meta Leads" value={kpis?.metaLeads ?? 0} icon={Share2} color="purple" />
            <KPICard title="GHL Leads" value={kpis?.ghlLeads ?? 0} icon={Database} color="green" />
            <KPICard title="Zenoti Leads" value={kpis?.zenotiLeads ?? 0} icon={Activity} color="yellow" />
            <KPICard title="Matched Leads" value={kpis?.matchedLeads ?? 0} icon={CheckCircle2} color="green" />
            <KPICard title="Missing in GHL" value={kpis?.missingInGhl ?? 0} icon={XCircle} color="red" />
            <KPICard title="Missing in Zenoti" value={kpis?.missingInZenoti ?? 0} icon={AlertTriangle} color="yellow" />
            <KPICard title="Duplicate Leads" value={kpis?.duplicateLeads ?? 0} icon={Copy} color="purple" />
            <KPICard
              title="Reconciliation Rate"
              value={`${kpis?.reconciliationRate ?? 0}%`}
              icon={TrendingUp}
              color={kpis?.reconciliationRate >= 95 ? "green" : kpis?.reconciliationRate >= 85 ? "yellow" : "red"}
            />
          </div>
        )}

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lead Volume Over Time */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Lead Volume Over Time</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="wordpress" stroke={COLORS.wordpress} dot={false} name="WordPress" strokeWidth={2} />
                  <Line type="monotone" dataKey="meta" stroke={COLORS.meta} dot={false} name="Meta" strokeWidth={2} />
                  <Line type="monotone" dataKey="ghl" stroke={COLORS.ghl} dot={false} name="GHL" strokeWidth={2} />
                  <Line type="monotone" dataKey="zenoti" stroke={COLORS.zenoti} dot={false} name="Zenoti" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Source Distribution Pie */}
          <Card>
            <CardHeader><CardTitle className="text-base">Source Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Bar chart - leads by source stacked */}
        <Card>
          <CardHeader><CardTitle className="text-base">Leads by Source (Weekly)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={groupByWeek(timeline)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="wordpress" stackId="a" fill={COLORS.wordpress} name="WordPress" />
                <Bar dataKey="meta" stackId="a" fill={COLORS.meta} name="Meta" />
                <Bar dataKey="ghl" stackId="a" fill={COLORS.ghl} name="GHL" />
                <Bar dataKey="zenoti" stackId="a" fill={COLORS.zenoti} name="Zenoti" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function groupByWeek(timeline: any[]) {
  const map = new Map<string, any>();
  for (const d of timeline) {
    const date = new Date(d.date);
    const weekStart = format(subDays(date, date.getDay()), "MM/dd");
    const existing = map.get(weekStart) || { week: weekStart, wordpress: 0, meta: 0, ghl: 0, zenoti: 0 };
    existing.wordpress += d.wordpress;
    existing.meta += d.meta;
    existing.ghl += d.ghl;
    existing.zenoti += d.zenoti;
    map.set(weekStart, existing);
  }
  return Array.from(map.values()).slice(-12);
}
