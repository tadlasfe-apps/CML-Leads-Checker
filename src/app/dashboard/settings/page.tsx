"use client";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { WEBSITE_FORM_SOURCES } from "@/types";

interface Mapping {
  id: string;
  rawValue: string;
  normalizedValue: string;
  active?: boolean;
}

interface FormNameMapping extends Mapping {
  formId: string | null;
  backendProvider: string | null;
}

interface MetaLocationMappingItem {
  id: string;
  matchType: string;
  matchValue: string;
  mappedClinicLocation: string;
  priority: number;
  active: boolean;
}

interface MappingData {
  clinics: Mapping[];
  services: Mapping[];
  websiteFormSources: Mapping[];
  websiteFormNames: FormNameMapping[];
  metaLocations: MetaLocationMappingItem[];
}

const BACKEND_PROVIDERS = ["Gravity Forms", "WPForms", "Contact Form 7", "Elementor Forms", "Fluent Forms", "Formidable Forms", "Other"];

const META_MATCH_TYPES = [
  { value: "accountName",  label: "Account Name" },
  { value: "campaignName", label: "Campaign Name" },
  { value: "adSetName",    label: "Ad Set Name" },
  { value: "adName",       label: "Ad Name" },
];

export default function SettingsPage() {
  const [data, setData] = useState<MappingData>({ clinics: [], services: [], websiteFormSources: [], websiteFormNames: [], metaLocations: [] });
  const [loading, setLoading]   = useState(true);
  const [newRaw,  setNewRaw]    = useState("");
  const [newNorm, setNewNorm]   = useState("");
  const [newFormId, setNewFormId] = useState("");
  const [newProvider, setNewProvider] = useState("");
  const [saving, setSaving]     = useState(false);

  // Meta Location Mapping state
  const [mlMatchType,  setMlMatchType]  = useState("accountName");
  const [mlMatchValue, setMlMatchValue] = useState("");
  const [mlMappedLoc,  setMlMappedLoc]  = useState("");
  const [mlPriority,   setMlPriority]   = useState(0);
  const [mlSaving,     setMlSaving]     = useState(false);

  async function fetchMappings() {
    setLoading(true);
    const res  = await fetch("/api/mappings");
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { fetchMappings(); }, []);

  async function addMapping(type: string) {
    if (!newRaw.trim() || !newNorm.trim()) return;
    setSaving(true);
    const body: Record<string, any> = { type, rawValue: newRaw.trim(), normalizedValue: newNorm.trim() };
    if (type === "websiteFormName") {
      if (newFormId.trim()) body.formId = newFormId.trim();
      if (newProvider)      body.backendProvider = newProvider;
    }
    await fetch("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setNewRaw(""); setNewNorm(""); setNewFormId(""); setNewProvider("");
    await fetchMappings();
    setSaving(false);
  }

  async function addMetaLocationMapping() {
    if (!mlMatchValue.trim() || !mlMappedLoc.trim()) return;
    setMlSaving(true);
    await fetch("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "metaLocation",
        matchType: mlMatchType,
        matchValue: mlMatchValue.trim(),
        normalizedValue: mlMappedLoc.trim(),
        priority: mlPriority,
      }),
    });
    setMlMatchValue(""); setMlMappedLoc(""); setMlPriority(0);
    await fetchMappings();
    setMlSaving(false);
  }

  async function deleteMapping(id: string, type: string) {
    if (!confirm("Delete this mapping?")) return;
    await fetch(`/api/mappings/${id}?type=${type}`, { method: "DELETE" });
    fetchMappings();
  }

  function MappingTable({ items, type, extra }: { items: Mapping[]; type: string; extra?: React.ReactNode }) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Raw value (from CSV)"
            value={newRaw}
            onChange={(e) => setNewRaw(e.target.value)}
            className="max-w-[220px]"
          />
          <span className="text-muted-foreground">→</span>
          <Input
            placeholder="Normalized value"
            value={newNorm}
            onChange={(e) => setNewNorm(e.target.value)}
            className="max-w-[220px]"
          />
          {extra}
          <Button size="sm" onClick={() => addMapping(type)} disabled={saving || !newRaw.trim() || !newNorm.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead>Raw Value (CSV)</TableHead>
              <TableHead>Normalized Value</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-6">No mappings defined</TableCell>
              </TableRow>
            ) : items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-sm">{m.rawValue}</TableCell>
                <TableCell className="font-medium">{m.normalizedValue}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={() => deleteMapping(m.id, type)}
                  >
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

  function FormNameMappingTable({ items }: { items: FormNameMapping[] }) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input placeholder="Raw form name (CSV)" value={newRaw} onChange={(e) => setNewRaw(e.target.value)} className="max-w-[200px]" />
          <span className="text-muted-foreground">→</span>
          <Input placeholder="Normalized name" value={newNorm} onChange={(e) => setNewNorm(e.target.value)} className="max-w-[200px]" />
          <Input placeholder="Form ID (optional)" value={newFormId} onChange={(e) => setNewFormId(e.target.value)} className="max-w-[120px]" />
          <Select value={newProvider} onValueChange={setNewProvider}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Plugin (optional)" /></SelectTrigger>
            <SelectContent>
              {BACKEND_PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => addMapping("websiteFormName")} disabled={saving || !newRaw.trim() || !newNorm.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead>Raw Form Name</TableHead>
              <TableHead>Normalized Name</TableHead>
              <TableHead>Form ID</TableHead>
              <TableHead>Backend Provider</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">No form name mappings defined</TableCell>
              </TableRow>
            ) : items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-sm">{m.rawValue}</TableCell>
                <TableCell className="font-medium">{m.normalizedValue}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{m.formId ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{m.backendProvider ?? "—"}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={() => deleteMapping(m.id, "websiteFormName")}
                  >
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
      <TopBar title="Mapping Settings" description="Configure normalization rules for clinics, services, and website form sources" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <div className="rounded-lg bg-blue-50 border border-blue-100 p-4">
          <p className="text-sm text-blue-800">
            <strong>How mappings work:</strong> When leads are imported, raw CSV values are mapped to canonical names.
            For example, "CML Midtown" → "Toronto Midtown" or "Free Consult Popup" → "Popup". Mappings
            take precedence over built-in keyword matching. After adding mappings, re-run Reconciliation
            from the top bar to apply changes retroactively to all imported records.
          </p>
        </div>

        <Tabs defaultValue="clinics">
          <TabsList>
            <TabsTrigger value="clinics">Clinic Locations ({data.clinics.length})</TabsTrigger>
            <TabsTrigger value="services">Services ({data.services.length})</TabsTrigger>
            <TabsTrigger value="formSources">Form Sources ({data.websiteFormSources.length})</TabsTrigger>
            <TabsTrigger value="formNames">Form Names ({data.websiteFormNames.length})</TabsTrigger>
            <TabsTrigger value="metaLocation">Meta Clinic Mapping ({data.metaLocations.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="clinics">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Clinic Location Mappings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Map raw clinic names from CSV to canonical clinic names used in reporting.
                </p>
                {loading ? <p className="text-muted-foreground text-sm">Loading…</p>
                  : <MappingTable items={data.clinics} type="clinic" />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="services">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Service Mappings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Map raw service names to canonical service names. Unmapped services appear as "Other".
                </p>
                {loading ? <p className="text-muted-foreground text-sm">Loading…</p>
                  : <MappingTable items={data.services} type="service" />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="formSources">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Website Form Source Mappings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Map raw form source values to canonical types. Built-in canonical values:
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {WEBSITE_FORM_SOURCES.map((s) => (
                    <Badge key={s} variant="info" className="text-xs">{s}</Badge>
                  ))}
                </div>
                {loading ? <p className="text-muted-foreground text-sm">Loading…</p>
                  : <MappingTable items={data.websiteFormSources} type="websiteFormSource" />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="formNames">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Website Form Name Mappings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Map raw form names to canonical names and optionally associate a backend plugin
                  (Gravity Forms, WPForms, etc.) for accurate form-level attribution.
                </p>
                {loading ? <p className="text-muted-foreground text-sm">Loading…</p>
                  : <FormNameMappingTable items={data.websiteFormNames} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metaLocation">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Meta Clinic Location Mappings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Override automatic clinic inference for Meta ads. Match on account name, campaign name,
                  ad set name, or ad name (case-insensitive substring). Higher priority = checked first.
                  After adding mappings, run <strong>Backfill Meta Clinic Mapping</strong> from Data Pulls to apply to existing records.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={mlMatchType} onValueChange={setMlMatchType}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Match type" /></SelectTrigger>
                    <SelectContent>
                      {META_MATCH_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Match value (substring)"
                    value={mlMatchValue}
                    onChange={(e) => setMlMatchValue(e.target.value)}
                    className="max-w-[220px]"
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    placeholder="Clinic location"
                    value={mlMappedLoc}
                    onChange={(e) => setMlMappedLoc(e.target.value)}
                    className="max-w-[200px]"
                  />
                  <Input
                    type="number"
                    placeholder="Priority"
                    value={mlPriority}
                    onChange={(e) => setMlPriority(parseInt(e.target.value, 10) || 0)}
                    className="w-20"
                  />
                  <Button size="sm" onClick={addMetaLocationMapping} disabled={mlSaving || !mlMatchValue.trim() || !mlMappedLoc.trim()}>
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Match Type</TableHead>
                      <TableHead>Match Value</TableHead>
                      <TableHead>Mapped Clinic</TableHead>
                      <TableHead className="text-right">Priority</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                    ) : data.metaLocations.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No mappings defined</TableCell></TableRow>
                    ) : data.metaLocations.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm font-medium">{META_MATCH_TYPES.find((t) => t.value === m.matchType)?.label ?? m.matchType}</TableCell>
                        <TableCell className="font-mono text-sm">{m.matchValue}</TableCell>
                        <TableCell className="font-medium">{m.mappedClinicLocation}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{m.priority}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => deleteMapping(m.id, "metaLocation")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
