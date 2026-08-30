import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";
import type { RunSummary } from "@/lib/types";
import { useStatus } from "@/lib/status";

export function StatusBar() {
  const op = useStatus();
  const [last, setLast] = useState<RunSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const runs = await api.runs();
        if (!alive) return;
        setLast(runs[0] || null);
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const busy = !!op;
  const pct =
    op?.progress && op.progress.total > 0
      ? Math.round((op.progress.current / op.progress.total) * 100)
      : 0;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 border-t px-4 py-2 text-sm ${
        busy ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      }`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      )}
      <span className="font-semibold capitalize">{busy ? "working" : "idle"}</span>
      <span className="min-w-0 flex-1 truncate">
        {busy ? op!.label : last ? `Last run: ${last.status} · ${last.records_count} records · ${last.error_count} errors` : "Engine ready"}
      </span>
      {busy && (
        <div className="flex items-center gap-2">
          {op!.indeterminate || !op!.progress ? (
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-primary-foreground/25">
              <div className="h-full w-1/3 animate-pulse bg-brand" />
            </div>
          ) : (
            <>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-primary-foreground/25">
                <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="tabular-nums">
                {op!.progress!.current}/{op!.progress!.total}
              </span>
            </>
          )}
        </div>
      )}
      {last && (
        <span className="hidden text-xs tabular-nums opacity-70 sm:block">
          {last.finished_at || last.created_at}
        </span>
      )}
    </div>
  );
}
