"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";

export interface DateRangeValue {
  preset?: string;
  from?: string;
  to?: string;
}

interface DateRangeFilterProps {
  value?: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
}

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom range" },
  { value: "all", label: "All time" },
];

export function getDateRangeFromPreset(preset: string): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case "today": return { from: new Date(now.setHours(0,0,0,0)), to: new Date() };
    case "yesterday": { const y = subDays(new Date(), 1); return { from: new Date(y.setHours(0,0,0,0)), to: new Date(y.setHours(23,59,59,999)) }; }
    case "last7": return { from: subDays(new Date(), 7), to: new Date() };
    case "last30": return { from: subDays(new Date(), 30), to: new Date() };
    case "thisMonth": return { from: startOfMonth(new Date()), to: new Date() };
    case "lastMonth": { const lm = subMonths(new Date(), 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
    default: return { from: subDays(new Date(), 90), to: new Date() };
  }
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [showCustom, setShowCustom] = useState(value?.preset === "custom");

  function handlePresetChange(preset: string) {
    setShowCustom(preset === "custom");
    if (preset !== "custom") {
      const { from, to } = getDateRangeFromPreset(preset);
      onChange({ preset, from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") });
    } else {
      onChange({ preset: "custom" });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={value?.preset || "last30"} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Date range" />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {showCustom && (
        <>
          <Input
            type="date" className="w-[140px]" value={value?.from || ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date" className="w-[140px]" value={value?.to || ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
}
