"use client";
import { Bell, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface TopBarProps {
  title: string;
  description?: string;
}

export function TopBar({ title, description }: TopBarProps) {
  const router = useRouter();
  const [reconciling, setReconciling] = useState(false);

  async function handleReconcile() {
    setReconciling(true);
    try {
      await fetch("/api/reconcile", { method: "POST" });
      router.refresh();
    } finally {
      setReconciling(false);
    }
  }

  return (
    <div className="border-b bg-white px-6 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={handleReconcile} disabled={reconciling}>
          <RefreshCw className={reconciling ? "animate-spin" : ""} />
          {reconciling ? "Running..." : "Run Reconciliation"}
        </Button>
        <Button variant="ghost" size="icon">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
