"use client";
import { useEffect, useState, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileText, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

type SourceType = "WORDPRESS" | "META" | "GHL" | "ZENOTI";

const SOURCE_INFO: Record<SourceType, { label: string; color: string; headers: string[] }> = {
  WORDPRESS: {
    label: "WordPress Forms",
    color: "info",
    headers: ["Form Name", "Date", "Name/Full Name", "Email", "Phone", "Service", "Location/Clinic", "UTM Source", "UTM Campaign", "Page URL"],
  },
  META: {
    label: "Meta Ads Leads",
    color: "purple",
    headers: ["created_time", "full_name", "email", "phone_number", "campaign_name", "form_name", "clinic_location", "service"],
  },
  GHL: {
    label: "GoHighLevel",
    color: "success",
    headers: ["Contact Id", "Opportunity Id", "Created", "First Name", "Last Name", "Email", "Phone", "Location", "Service", "Stage"],
  },
  ZENOTI: {
    label: "Zenoti CRM",
    color: "warning",
    headers: ["Guest Id", "Appointment Id", "Created Date", "Guest Name", "Email", "Phone", "Center", "Service", "Status"],
  },
};

export default function ImportsPage() {
  const [source, setSource] = useState<SourceType>("WORDPRESS");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function fetchHistory() {
    const res = await fetch("/api/import/history");
    setHistory(await res.json());
  }

  useEffect(() => { fetchHistory(); }, []);

  async function upload(file: File) {
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("source", source);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const json = await res.json();
    setResult(json);
    setUploading(false);
    fetchHistory();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }

  const info = SOURCE_INFO[source];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Data Imports" description="Upload CSV files from each lead source" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upload panel */}
          <Card>
            <CardHeader><CardTitle className="text-base">Upload CSV</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Select Data Source</label>
                <Select value={source} onValueChange={(v) => setSource(v as SourceType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SOURCE_INFO) as SourceType[]).map((k) => (
                      <SelectItem key={k} value={k}>{SOURCE_INFO[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium text-sm">Drop CSV file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .csv files</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </div>

              <Button className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading..." : `Upload ${info.label} CSV`}
              </Button>

              {/* Result */}
              {result && !result.error && (
                <div className="rounded-lg border p-4 space-y-2">
                  <p className="font-semibold text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" /> Upload Complete
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted-foreground">Total Rows</div><div className="font-medium">{result.totalRows}</div>
                    <div className="text-muted-foreground">Valid</div><div className="font-medium text-green-600">{result.validRows}</div>
                    <div className="text-muted-foreground">Invalid</div><div className="font-medium text-red-600">{result.invalidRows}</div>
                    <div className="text-muted-foreground">Duplicates Skipped</div><div className="font-medium text-yellow-600">{result.duplicateRows}</div>
                  </div>
                  {result.errors?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-red-600 mb-1">Errors:</p>
                      {result.errors.slice(0, 5).map((e: string, i: number) => (
                        <p key={i} className="text-xs text-red-500">{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {result?.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-600 flex items-center gap-2"><XCircle className="w-4 h-4" />{result.error}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expected headers */}
          <Card>
            <CardHeader><CardTitle className="text-base">Expected CSV Headers — {info.label}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">The importer will attempt to match these headers (case-insensitive):</p>
              <div className="flex flex-wrap gap-2">
                {info.headers.map((h) => (
                  <code key={h} className="text-xs bg-gray-100 rounded px-2 py-1 font-mono">{h}</code>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100">
                <p className="text-xs text-blue-700 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> After upload, run Reconciliation from the top bar to update match scores.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Import History */}
        <Card>
          <CardHeader><CardTitle className="text-base">Import History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Valid</TableHead>
                  <TableHead className="text-right">Invalid</TableHead>
                  <TableHead className="text-right">Duplicates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Imported At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No imports yet</TableCell></TableRow>
                ) : (
                  history.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Badge variant={SOURCE_INFO[b.sourceSystem as SourceType]?.color as any || "outline"}>
                          {b.sourceSystem}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        {b.fileName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.totalRows}</TableCell>
                      <TableCell className="text-right tabular-nums text-green-600">{b.validRows}</TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">{b.invalidRows}</TableCell>
                      <TableCell className="text-right tabular-nums text-yellow-600">{b.duplicateRows}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "COMPLETED" ? "success" : b.status === "FAILED" ? "destructive" : "info"}>
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(b.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
