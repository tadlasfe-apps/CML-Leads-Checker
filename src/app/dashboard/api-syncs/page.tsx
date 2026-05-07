"use client";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plug, RefreshCw, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG: Record<string, { label: string; variant: any; icon: any }> = {
  COMPLETED: { label: "Completed", variant: "success",     icon: CheckCircle2 },
  FAILED:    { label: "Failed",    variant: "destructive", icon: XCircle },
  RUNNING:   { label: "Running",   variant: "info",        icon: Loader2 },
  IDLE:      { label: "Idle",      variant: "outline",     icon: Clock },
};

const SOURCE_COLORS: Record<string, string> = {
  WEBSITE: "info",
  META:    "purple",
  GHL:     "success",
  ZENOTI:  "warning",
};

export default function ApiSyncsPage() {
  const [runs, setRuns]         = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  async function fetchData() {
    setLoading(true);
    const res = await fetch("/api/api-syncs");
    const json = await res.json();
    setRuns(json.runs ?? []);
    setSettings(json.settings ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="API Syncs" description="History of automated API sync runs and integration status" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Integration status cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["GHL", "ZENOTI", "META", "WEBSITE"] as const).map((src) => {
            const s = settings.find((x: any) => x.sourceSystem === src);
            return (
              <Card key={src}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant={SOURCE_COLORS[src] as any}>{src}</Badge>
                    <Badge variant={s?.config?.enabled ? "success" : "outline"}>
                      {s?.config?.enabled ? "Enabled" : "Manual"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s?.config?.lastSyncedAt
                      ? `Last sync: ${String(s.config.lastSyncedAt).slice(0, 10)}`
                      : "Not configured — use CSV import"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Sync run history */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Sync Run History</CardTitle>
              <button
                onClick={fetchData}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : runs.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <Plug className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <p className="text-muted-foreground text-sm font-medium">No API syncs recorded yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  API sync history will appear here once integrations are configured and triggered.
                  For now, use CSV imports on the Imports page.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Source</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Finished</TableHead>
                    <TableHead className="text-right">Fetched</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead>Date Range</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const sc = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.IDLE;
                    const StatusIcon = sc.icon;
                    return (
                      <TableRow key={run.id} className="text-sm">
                        <TableCell>
                          <Badge variant={(SOURCE_COLORS[run.sourceSystem] ?? "outline") as any}>
                            {run.sourceSystem}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{run.syncType}</TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">
                          {run.startedAt ? format(new Date(run.startedAt), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">
                          {run.finishedAt ? format(new Date(run.finishedAt), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{run.recordsFetched ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">{run.recordsCreated ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums text-blue-600">{run.recordsUpdated ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{run.recordsSkipped ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {run.dateRangeStart
                            ? `${String(run.dateRangeStart).slice(0, 10)} → ${String(run.dateRangeEnd ?? "").slice(0, 10)}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={sc.variant} className="flex items-center gap-1 w-fit">
                            <StatusIcon className={`w-3 h-3 ${run.status === "RUNNING" ? "animate-spin" : ""}`} />
                            {sc.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[200px] truncate" title={run.errorMessage}>
                          {run.errorMessage ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Info note */}
        <Card className="border-blue-100 bg-blue-50">
          <CardContent className="p-4">
            <p className="text-sm text-blue-800 font-medium">About API Integrations</p>
            <p className="text-xs text-blue-700 mt-1">
              Automated API sync for GHL, Zenoti, and Meta Ads is not yet configured. All data should
              be imported via the <strong>CSV Import</strong> page. Once API credentials are set up,
              sync runs will be logged here with fetch counts and error details.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
