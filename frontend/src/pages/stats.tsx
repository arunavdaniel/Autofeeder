import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Folder, RunSummary, Snapshot } from "@/lib/types";
import { BarChart, ChartCard, LineChart, StatCard } from "@/components/charts";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";

type Point = { label: string; value: number };

function snapshotLabel(s: Snapshot): string {
  return (s.name || s.source || s.source_label || `Snapshot ${s.id}`).trim();
}

function shortLabel(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function bucketByDate(items: { created_at: string; value: number }[]): Point[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const d = (it.created_at || "").slice(0, 10);
    if (!d) continue;
    map.set(d, (map.get(d) || 0) + it.value);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
}

export function Stats() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [dbCount, setDbCount] = useState(0);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      api.folders().catch(() => []),
      api.snapshots().catch(() => []),
      api.runsFiltered({ limit: 1000, offset: 0 }).catch(() => ({ total: 0, runs: [] })),
      api.duckdbDatabases().catch(() => []),
    ])
      .then(([f, s, r, d]) => {
        setFolders(Array.isArray(f) ? f : []);
        setSnapshots(Array.isArray(s) ? s : []);
        setRuns(Array.isArray((r as { runs?: RunSummary[] }).runs) ? (r as { runs: RunSummary[] }).runs : []);
        setDbCount(Array.isArray(d) ? d.length : 0);
      })
      .finally(() => setBusy(false));
  }, []);

  const totalFeeds = folders.reduce((n, f) => n + (f.feeds?.length || 0), 0);
  const totalSnapshots = snapshots.length;
  const totalCaptured = snapshots.reduce((n, snap) => n + (snap.article_count || 0), 0);
  const totalRuns = runs.length;
  const totalRecords = runs.reduce((n, run) => n + (run.records_count || 0), 0);

  const feedsPerFolder: Point[] = folders
    .map((f) => ({ label: shortLabel(f.name || "Folder"), value: f.feeds?.length || 0 }))
    .filter((p) => p.value > 0);

  const capturedOverTime = bucketByDate(
    snapshots.map((snap) => ({ created_at: snap.created_at || "", value: snap.article_count || 0 })),
  );
  const recordsOverTime = bucketByDate(
    runs.map((run) => ({ created_at: run.created_at || "", value: run.records_count || 0 })),
  );

  return (
    <PageShell title="Stats" description="Overview of your feeds, captures and extractions." width="6xl">
      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading stats…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Feeds" value={totalFeeds} hint={`${folders.length} folders`} />
            <StatCard label="Snapshots" value={totalSnapshots} hint={`${totalCaptured} articles captured`} />
            <StatCard label="Pipeline runs" value={totalRuns} hint={`${totalRecords} records extracted`} />
            <StatCard label="DuckDB databases" value={dbCount} hint="analytical stores" />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Articles captured over time">
              {capturedOverTime.length ? <LineChart data={capturedOverTime} /> : <p className="text-sm text-muted-foreground">No snapshots yet.</p>}
            </ChartCard>
            <ChartCard title="Records extracted over time">
              {recordsOverTime.length ? <LineChart data={recordsOverTime} /> : <p className="text-sm text-muted-foreground">No pipeline runs yet.</p>}
            </ChartCard>
            <ChartCard title="Feeds per folder">
              {feedsPerFolder.length ? <BarChart data={feedsPerFolder} /> : <p className="text-sm text-muted-foreground">No feeds yet.</p>}
            </ChartCard>
            <ChartCard title="Captured articles per snapshot">
              {snapshots.length ? (
                <BarChart
                  data={snapshots.slice(-12).map((snap) => ({
                    label: shortLabel(snapshotLabel(snap)),
                    value: snap.article_count || 0,
                  }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No snapshots yet.</p>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </PageShell>
  );
}
