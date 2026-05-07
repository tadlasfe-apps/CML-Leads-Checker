"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, GitCompare, MapPin, Stethoscope, GitMerge,
  Upload, Settings, FileCode2, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard/overview", icon: LayoutDashboard },
  { label: "Source Comparison", href: "/dashboard/source-comparison", icon: GitCompare },
  { label: "Clinic Breakdown", href: "/dashboard/clinic-breakdown", icon: MapPin },
  { label: "Service Breakdown", href: "/dashboard/service-breakdown", icon: Stethoscope },
  { label: "Lead Reconciliation", href: "/dashboard/reconciliation", icon: GitMerge },
  { label: "WordPress Forms", href: "/dashboard/wordpress-forms", icon: FileCode2 },
  { label: "Imports", href: "/dashboard/imports", icon: Upload },
  { label: "Mapping Settings", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r bg-white flex flex-col">
      <div className="p-6 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <GitMerge className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Leads Checker</p>
            <p className="text-xs text-muted-foreground">Canada MedLaser</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")} />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight className="w-3 h-3 text-blue-400" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t">
        <p className="text-xs text-muted-foreground text-center">v1.0.0 · Multi-source reconciliation</p>
      </div>
    </aside>
  );
}
