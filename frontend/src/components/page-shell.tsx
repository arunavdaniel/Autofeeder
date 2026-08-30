import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageShell({
  title,
  description,
  actions,
  children,
  width = "6xl",
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  width?: "4xl" | "5xl" | "6xl" | "7xl" | "full";
  className?: string;
}) {
  const max =
    width === "full"
      ? "max-w-none"
      : width === "4xl"
        ? "max-w-4xl"
        : width === "5xl"
          ? "max-w-5xl"
          : width === "7xl"
            ? "max-w-7xl"
            : "max-w-6xl";

  return (
    <div className={cn("mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8", max, className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          {description && (
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
