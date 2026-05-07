"use client";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  endpoint: string;
  filename?: string;
  params?: Record<string, string>;
  label?: string;
}

export function ExportButton({ endpoint, filename = "export.csv", params = {}, label = "Export CSV" }: ExportButtonProps) {
  async function handleExport() {
    const query = new URLSearchParams(params).toString();
    const url = `${endpoint}${query ? "?" + query : ""}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download />
      {label}
    </Button>
  );
}
