import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Loader2, ChevronRight } from "lucide-react";
import type { RunSummary } from "@/lib/types";
import { useStatus } from "@/lib/status";

export function StatusBar() {
  const navigate = useNavigate();
  const op = useStatus();
  const [last, setLast] = useState<RunSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.runsFiltered({ limit: 1 });
        if (!alive) return;
        setLast(res.runs[0] || null);
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 3000);
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
    <button
      type="button"
      onClick={() => navigate(last ? `/runs?id=${last.id}` : "/runs")}
      className={`fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 border-t px-4 py-2.5 text-left text-sm transition-colors ${
        busy
          ? "border-primary/30 bg-primary text-primary-foreground hover:opacity-95"
          : "border-border/80 bg-background/90 text-muted-foreground backdrop-blur-xl hover:bg-muted/40"
      }`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/70" />
      )}
      <span className="shrink-0 font-medium capitalize tracking-wide">{busy ? "Working" : "Ready"}</span>
      <span className="min-w-0 flex-1 truncate font-light">
        {busy
          ? op!.label
          : last
            ? `${last.pipeline_name || `Pipeline #${last.pipeline_id}`} · ${last.status} · ${last.records_count} records`
            : "No runs yet — New pipeline"}
      </span>
      {busy && (
        <div className="hidden items-center gap-2 sm:flex">
          {op!.indeterminate || !op!.progress ? (
            <div className="h-px w-28 overflow-hidden bg-background/20">
              <div className="h-full w-1/3 animate-pulse bg-background/80" />
            </div>
          ) : (
            <>
              <div className="h-px w-28 overflow-hidden bg-background/20">
                <div className="h-full bg-background transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="tabular-nums text-xs opacity-80">
                {op!.progress!.current}/{op!.progress!.total}
              </span>
            </>
          )}
        </div>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
    </button>
  );
}
