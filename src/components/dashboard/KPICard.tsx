import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: "blue" | "green" | "red" | "yellow" | "purple" | "gray";
  className?: string;
}

const colorMap = {
  blue: { bg: "bg-blue-50", icon: "text-blue-600", value: "text-blue-700" },
  green: { bg: "bg-green-50", icon: "text-green-600", value: "text-green-700" },
  red: { bg: "bg-red-50", icon: "text-red-600", value: "text-red-700" },
  yellow: { bg: "bg-yellow-50", icon: "text-yellow-600", value: "text-yellow-700" },
  purple: { bg: "bg-purple-50", icon: "text-purple-600", value: "text-purple-700" },
  gray: { bg: "bg-gray-50", icon: "text-gray-600", value: "text-gray-700" },
};

export function KPICard({ title, value, subtitle, icon: Icon, trend, color = "blue", className }: KPICardProps) {
  const colors = colorMap[color];
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{title}</p>
            <p className={cn("text-2xl font-bold mt-1 tabular-nums", colors.value)}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            {trend && (
              <p className={cn("text-xs font-medium mt-1", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
                {trend.value >= 0 ? "+" : ""}{trend.value}% {trend.label}
              </p>
            )}
          </div>
          <div className={cn("p-2.5 rounded-lg shrink-0 ml-3", colors.bg)}>
            <Icon className={cn("w-5 h-5", colors.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
