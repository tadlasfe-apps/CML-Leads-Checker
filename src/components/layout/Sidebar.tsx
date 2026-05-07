"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, GitCompare, Globe, Share2, MapPin,
  Stethoscope, Upload, Plug, Settings, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard/overview", icon: LayoutDashboard },
  { label: "Source Comparison", href: "/dashboard/source-comparison", icon: GitCompare },
  { label: "Website Leads", href: "/dashboard/website-leads", icon: Globe },
  { label: "Meta Leads", href: "/dashboard/meta-leads", icon: Share2 },
  { label: "Clinic Breakdown", href: "/dashboard/clinic-breakdown", icon: MapPin },
  { label: "Service Breakdown", href: "/dashboard/service-breakdown", icon: Stethoscope },
  { label: "Imports", href: "/dashboard/imports", icon: Upload },
  { label: "API Syncs", href: "/dashboard/api-syncs", icon: Plug },
  { label: "Mapping Settings", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r bg-white flex flex-col">
      <div className="p-5 border-b">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <GitCompare className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Lead Audit</p>
            <p className="text-xs text-muted-foreground">Canada MedLaser</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group",
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")} />
              <span className="flex-1 truncate">{item.label}</span>
              {active && <ChevronRight className="w-3 h-3 text-blue-400" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t">
        <p className="text-xs text-muted-foreground text-center">Lead Count Audit · v2.0</p>
      </div>
    </aside>
  );
}
