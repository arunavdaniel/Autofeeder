import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value?: number;
  indeterminate?: boolean;
}

export function Progress({ className, value = 0, indeterminate = false, ...props }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <div
        className={cn(
          "h-full bg-brand transition-[width] duration-300 ease-out",
          indeterminate && "w-1/3 animate-pulse"
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
