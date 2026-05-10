"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Database, RefreshCw, Loader2, Info, XCircle, CheckCircle2,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryRow {
  category:      string;
  ghlCount:      number;
  matchedSource: string | null;
  sourceCount:   number | null;
  diff:          number | null;
}

interface SourceRow  { raw: string; category: string; count: number; }
interface ClinicRow  { clinic:  string; count: number; }
interface ServiceRow { service: string; count: number; }
interface StageRow   { stage:   string; count: number; }

interface BreakdownData {
  total:               number;
  metaLeads:           number;
  websiteLeads:        number;
  unknownSourceCount:  number;
  categoryComparison:  CategoryRow[];
  bySource:            SourceRow[];
  byClinic:            ClinicRow[];
  byService:           ServiceRow[];
  byStage:             StageRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr()        { return new Date().toISOString().slice(0, 10); }
function sevenDaysAgoStr() { return new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10); }

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (diff === 0)
    return <Badge variant="success" className="text-xs gap-1"><Minus className="w-3 h-3" />Matched</Badge>;
  if (diff > 0)
    return (
      <Badge variant="warning" className="text-xs gap-1">
        <TrendingUp className="w-3 h-3" />+{diff} extra in GHL
      </Badge>
    );
  return (
    <Badge variant="destructive" className="text-xs gap-1">
      <TrendingDown className="w-3 h-3" />{diff} missing in GHL
    </Badge>
  );
}

function CategoryBadge({ category }: { category: string }) {
  if (category === "Facebook Ads")  return <Badge variant="purple"  className="text-xs">{category}</Badge>;
  if (category === "Website Forms") return <Badge variant="info"    className="text-xs">{category}</Badge>;
  return                                   <Badge variant="outline"  className="text-xs">{category}</Badge>;
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {title}
          {count != null && (
            <Badge variant="outline" className="text-xs tabular-nums">{count.toLocaleString()}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GhlBreakdownPage() {
  const [from, setFrom] = useState(sevenDaysAgoStr);
  const [to,   setTo]   = useState(todayStr);
  const [data,    setData]    = useState<BreakdownData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Backfill GHL source
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult,  setBackfillResult]  = useState<{ patched: number; total: number; noSource: number } | null>(null);
  const [backfillError,   setBackfillError]   = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/ghl/breakdown?from=${from}&to=${to}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function runBackfill() {
    setBackfillLoading(true);
    setBackfillResult(null);
    setBackfillError(null);
    try {
      const res  = await fetch("/api/debug/backfill-ghl-source", { method: "POST" });
      const json = await res.json();
      if (json.error) setBackfillError(json.error);
      else { setBackfillResult(json); fetchData(); }
    } catch (e: any) { setBackfillError(e?.message ?? "Failed"); }
    setBackfillLoading(false);
  }

  const unknownPct = data ? Math.round((data.unknownSourceCount / Math.max(data.total, 1)) * 100) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="GHL Breakdown"
        description="GHL Lead Inquiry Pipeline — broken down by source attribution, clinic, service, and stage"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>From</span>
            <input
              type="date" value={from} max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded px-2 py-1 text-sm text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>To</span>
            <input
              type="date" value={to} min={from} max={todayStr()}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button size="sm" variant="outline" onClick={fetchData} disabled={loading} className="flex items-center gap-1.5 h-8">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {/* Source backfill notice */}
        {data && unknownPct > 20 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">
                  {unknownPct}% of GHL records have no source attribution ({data.unknownSourceCount.toLocaleString()} of {data.total.toLocaleString()})
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Run the backfill below to extract the lead source from saved GHL payloads. Only needed once for existing records — new pulls automatically save the source.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <Button
                  size="sm" variant="outline"
                  onClick={runBackfill} disabled={backfillLoading}
                  className="text-xs h-7 border-amber-400 text-amber-700 hover:bg-amber-100"
                >
                  {backfillLoading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Backfilling…</> : "Backfill GHL Source"}
                </Button>
                {backfillResult && (
                  <p className="text-xs text-amber-800">
                    Patched {backfillResult.patched} / {backfillResult.total} records
                    {backfillResult.noSource > 0 ? ` (${backfillResult.noSource} still unknown)` : ""}
                  </p>
                )}
                {backfillError && <p className="text-xs text-red-600">{backfillError}</p>}
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading GHL breakdown…</span>
          </div>
        )}

        {data && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total GHL Leads",  value: data.total,              color: "text-emerald-700" },
                { label: "Meta Leads",        value: data.metaLeads,          color: "text-purple-700"  },
                { label: "Website Leads",     value: data.websiteLeads,       color: "text-blue-700"    },
                { label: "Unknown Source",    value: data.unknownSourceCount, color: unknownPct > 20 ? "text-amber-700" : "text-muted-foreground" },
              ].map((k) => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${k.color}`}>
                      {k.value.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Source Attribution Matching ─────────────────────────────────────── */}
            <Section title="Source Attribution — GHL vs Lead Sources" count={data.total}>
              <div className="p-4 pb-2">
                <p className="text-xs text-muted-foreground">
                  GHL leads classified by their attribution source and matched against the corresponding lead source count.
                  <span className="font-medium text-purple-700"> Facebook Ads</span> → Meta Leads.{" "}
                  <span className="font-medium text-blue-700">Website Forms</span> (Website, Popup Form, Pop Up Form, Website Quiz, Location Form) → Website Leads.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">GHL Leads</TableHead>
                    <TableHead>Matched Source</TableHead>
                    <TableHead className="text-right">Source Count</TableHead>
                    <TableHead className="text-right">% of GHL</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.categoryComparison.map((row) => (
                    <TableRow key={row.category} className="text-sm">
                      <TableCell>
                        <CategoryBadge category={row.category} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {row.ghlCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.matchedSource ?? <span className="italic text-muted-foreground/60">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.sourceCount != null ? row.sourceCount.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                        {pct(row.ghlCount, data.total)}
                      </TableCell>
                      <TableCell>
                        <DiffBadge diff={row.diff} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Total row */}
                  <TableRow className="bg-muted/20 font-semibold text-sm">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{data.total.toLocaleString()}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {(data.metaLeads + data.websiteLeads).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">100%</TableCell>
                    <TableCell>
                      <DiffBadge diff={data.total - (data.metaLeads + data.websiteLeads)} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Section>

            {/* ── By raw GHL source value ─────────────────────────────────────────── */}
            <Section title="GHL Leads by Raw Source Value" count={data.bySource.length}>
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Source (as stored in GHL)</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">GHL Count</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.bySource.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">
                        No source data. Pull GHL records or run the backfill above.
                      </TableCell>
                    </TableRow>
                  ) : data.bySource.map((row) => (
                    <TableRow key={row.raw} className="text-sm">
                      <TableCell className="font-medium">
                        {row.raw === "Unknown"
                          ? <span className="italic text-muted-foreground">Unknown / not set in GHL</span>
                          : row.raw}
                      </TableCell>
                      <TableCell><CategoryBadge category={row.category} /></TableCell>
                      <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                        {pct(row.count, data.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {/* ── Bottom row: Clinic + Service + Stage ───────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* By Clinic */}
              <Section title="By Clinic Location" count={data.byClinic.length}>
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Clinic</TableHead>
                      <TableHead className="text-right">GHL</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byClinic.map((row) => (
                      <TableRow key={row.clinic} className="text-sm">
                        <TableCell className={row.clinic === "Unknown" ? "italic text-muted-foreground" : ""}>
                          {row.clinic}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{row.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{pct(row.count, data.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>

              {/* By Service */}
              <Section title="By Service" count={data.byService.length}>
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">GHL</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byService.map((row) => (
                      <TableRow key={row.service} className="text-sm">
                        <TableCell>{row.service}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{row.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{pct(row.count, data.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>

              {/* By Pipeline Stage */}
              <Section title="By Pipeline Stage" count={data.byStage.length}>
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">GHL</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byStage.map((row) => (
                      <TableRow key={row.stage} className="text-sm">
                        <TableCell className={row.stage === "Unknown Stage" ? "italic text-muted-foreground" : ""}>
                          {row.stage}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{row.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{pct(row.count, data.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            </div>

            {/* Info note */}
            <Card className="border-blue-100 bg-blue-50">
              <CardContent className="p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-800 space-y-1">
                  <p className="font-medium">About source attribution in GHL</p>
                  <p>
                    The <strong>Source</strong> field comes from the GHL contact record's attribution source (e.g. "Facebook Ads", "Website").
                    If most records show <span className="italic">Unknown</span>, run <strong>Backfill GHL Source</strong> above to re-extract from
                    stored payloads. For new pulls, the source is saved automatically.
                  </p>
                  <p>
                    GHL may capture leads from sources beyond just Meta and Website (e.g. Google Ads, Manual Entry, SMS).
                    Those appear as <strong>Other / Unknown</strong> and explain why GHL total often exceeds Website + Meta combined.
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
