import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Folder, RunSummary, Snapshot } from "@/lib/types";
import { BarChart, ChartCard, LineChart, StatCard } from "@/components/charts";
import { Loader2 } from "lucide-react";

type Point = { label: string; value: number };

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
        setFolders(f as Folder[]);
        setSnapshots(s as Snapshot[]);
        setRuns((r as { runs: RunSummary[] }).runs);
        setDbCount((d as unknown[]).length);
      })
      .finally(() => setBusy(false));
  }, []);

  const totalFeeds = folders.reduce((n, f) => n + f.feeds.length, 0);
  const totalSnapshots = snapshots.length;
  const totalCaptured = snapshots.reduce((n, s) => n + (s.article_count || 0), 0);
  const totalRuns = runs.length;
  const totalRecords = runs.reduce((n, r) => n + (r.records_count || 0), 0);

  const feedsPerFolder: Point[] = folders
    .map((f) => ({ label: f.name.length > 8 ? f.name.slice(0, 8) : f.name, value: f.feeds.length }))
    .filter((p) => p.value > 0);

  const capturedOverTime = bucketByDate(snapshots.map((s) => ({ created_at: s.created_at, value: s.article_count || 0 })));
  const recordsOverTime = bucketByDate(runs.map((r) => ({ created_at: r.created_at, value: r.records_count || 0 })));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <p className="text-sm text-muted-foreground">Overview of your feeds, captures and extractions.</p>
      </div>

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
                  data={snapshots
                    .slice(-12)
                    .map((s) => ({ label: s.name.length > 8 ? s.name.slice(0, 8) : s.name, value: s.article_count || 0 }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No snapshots yet.</p>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
