"use client";
import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeFilter, getDateRangeFromPreset } from "@/components/dashboard/DateRangeFilter";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subDays } from "date-fns";

const COLORS = { wordpress: "#3b82f6", meta: "#8b5cf6", ghl: "#10b981", zenoti: "#f59e0b" };

export default function ClinicBreakdownPage() {
  const [dateRange, setDateRange] = useState({ preset: "last30", from: format(subDays(new Date(), 30), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") });
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    const res = await fetch(`/api/clinic-breakdown?${params}`);
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Clinic Breakdown" description="Lead performance per clinic location" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <DateRangeFilter value={dateRange} onChange={handleDateChange} />
          <ExportButton endpoint="/api/export" filename="clinic-breakdown.csv" params={{ type: "source-comparison", from: dateRange.from, to: dateRange.to }} />
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading...</div>
        ) : (
          <>
            {/* Bar chart */}
            <Card>
              <CardHeader><CardTitle className="text-base">Leads by Source per Clinic</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data} margin={{ bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="clinicLocation" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="wordpressLeads" fill={COLORS.wordpress} name="WordPress" />
                    <Bar dataKey="metaLeads" fill={COLORS.meta} name="Meta" />
                    <Bar dataKey="ghlLeads" fill={COLORS.ghl} name="GHL" />
                    <Bar dataKey="zenotiLeads" fill={COLORS.zenoti} name="Zenoti" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Table */}
            <Card>
              <CardHeader><CardTitle className="text-base">Clinic Reconciliation Table</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clinic Location</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">WordPress</TableHead>
                      <TableHead className="text-right">Meta</TableHead>
                      <TableHead className="text-right">GHL</TableHead>
                      <TableHead className="text-right">Zenoti</TableHead>
                      <TableHead className="text-right">Duplicates</TableHead>
                      <TableHead className="text-right">Source→GHL Gap</TableHead>
                      <TableHead className="text-right">GHL→Zenoti Gap</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row) => {
                      const srcTotal = row.wordpressLeads + row.metaLeads;
                      const ghlGap = srcTotal - row.ghlLeads;
                      const zenotiGap = row.ghlLeads - row.zenotiLeads;
                      return (
                        <TableRow key={row.clinicLocation}>
                          <TableCell className="font-medium">{row.clinicLocation}</TableCell>
                          <TableCell className="text-right font-bold">{row.totalLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-blue-600">{row.wordpressLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-purple-600">{row.metaLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-green-600">{row.ghlLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-yellow-600">{row.zenotiLeads}</TableCell>
                          <TableCell className="text-right tabular-nums text-red-600">{row.duplicateCount}</TableCell>
                          <TableCell className={`text-right tabular-nums font-medium ${ghlGap > 0 ? "text-red-600" : "text-green-600"}`}>
                            {ghlGap > 0 ? `+${ghlGap}` : ghlGap}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-medium ${zenotiGap > 0 ? "text-yellow-600" : "text-green-600"}`}>
                            {zenotiGap > 0 ? `+${zenotiGap}` : zenotiGap}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
