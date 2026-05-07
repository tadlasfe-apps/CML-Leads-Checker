"use client";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save } from "lucide-react";

interface Mapping {
  id: string;
  rawValue: string;
  normalizedValue: string;
  active: boolean;
}

interface MappingData {
  clinics: Mapping[];
  services: Mapping[];
  sources: Mapping[];
}

export default function SettingsPage() {
  const [data, setData] = useState<MappingData>({ clinics: [], services: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [newRaw, setNewRaw] = useState("");
  const [newNorm, setNewNorm] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchMappings() {
    setLoading(true);
    const res = await fetch("/api/mappings");
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchMappings(); }, []);

  async function addMapping(type: string) {
    if (!newRaw.trim() || !newNorm.trim()) return;
    setSaving(true);
    await fetch("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, rawValue: newRaw.trim(), normalizedValue: newNorm.trim() }),
    });
    setNewRaw(""); setNewNorm("");
    await fetchMappings();
    setSaving(false);
  }

  async function deleteMapping(id: string, type: string) {
    if (!confirm("Delete this mapping?")) return;
    await fetch(`/api/mappings/${id}?type=${type}`, { method: "DELETE" });
    fetchMappings();
  }

  function MappingTable({ items, type }: { items: Mapping[]; type: string }) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Input placeholder="Raw value (e.g. CML Midtown)" value={newRaw} onChange={(e) => setNewRaw(e.target.value)} className="max-w-[220px]" />
          <span className="text-muted-foreground">→</span>
          <Input placeholder="Normalized value (e.g. Toronto Midtown)" value={newNorm} onChange={(e) => setNewNorm(e.target.value)} className="max-w-[220px]" />
          <Button size="sm" onClick={() => addMapping(type)} disabled={saving}>
            <Plus /> Add
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Raw Value</TableHead>
              <TableHead>Normalized Value</TableHead>
              <TableHead>Active</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No mappings defined</TableCell></TableRow>
            ) : items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-sm">{m.rawValue}</TableCell>
                <TableCell className="font-medium">{m.normalizedValue}</TableCell>
                <TableCell>
                  <Badge variant={m.active ? "success" : "secondary"}>{m.active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => deleteMapping(m.id, type)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Mapping Settings" description="Configure normalization rules for clinics, services, and sources" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-4">
          <p className="text-sm text-blue-800">
            <strong>How mappings work:</strong> When leads are imported or normalized, raw values from CSV files are
            mapped to canonical names. For example, "CML Midtown" → "Toronto Midtown". Mappings take precedence
            over the built-in keyword matching. After updating mappings, re-run Reconciliation to apply changes.
          </p>
        </div>

        <Tabs defaultValue="clinics">
          <TabsList>
            <TabsTrigger value="clinics">Clinic Locations ({data.clinics.length})</TabsTrigger>
            <TabsTrigger value="services">Services ({data.services.length})</TabsTrigger>
            <TabsTrigger value="sources">Lead Sources ({data.sources.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="clinics">
            <Card>
              <CardHeader><CardTitle className="text-base">Clinic Location Mappings</CardTitle></CardHeader>
              <CardContent>
                {loading ? <p className="text-muted-foreground text-sm">Loading...</p> : <MappingTable items={data.clinics} type="clinic" />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="services">
            <Card>
              <CardHeader><CardTitle className="text-base">Service Mappings</CardTitle></CardHeader>
              <CardContent>
                {loading ? <p className="text-muted-foreground text-sm">Loading...</p> : <MappingTable items={data.services} type="service" />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sources">
            <Card>
              <CardHeader><CardTitle className="text-base">Lead Source Mappings</CardTitle></CardHeader>
              <CardContent>
                {loading ? <p className="text-muted-foreground text-sm">Loading...</p> : <MappingTable items={data.sources} type="source" />}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
