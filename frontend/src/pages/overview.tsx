import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Dashboard, Pipeline, Snapshot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Play, Eye, Pencil, RefreshCw, Activity, Database, Rss, AlertCircle, Brain, Workflow } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    queued: "bg-muted text-muted-foreground",
  };
  return <Badge className={map[status] || "bg-muted"}>{status}</Badge>;
}

export function Overview() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    api.dashboard().then(setDash).catch(() => {});
    api.pipelines().then(setPipelines).catch(() => {});
    api.snapshots().then(setSnapshots).catch(() => {});
  }, []);

  const run = (id: number, preview: boolean) =>
    api.runPipeline(id, preview).then((r) => navigate(`/runs?id=${r.run_id}`)).catch(() => {});

  const refresh = () => {
    api.dashboard().then(setDash).catch(() => {});
    api.pipelines().then(setPipelines).catch(() => {});
    api.snapshots().then(setSnapshots).catch(() => {});
  };

  const stats = [
    { label: "Active pipelines", value: dash?.active_pipelines, sub: `${dash?.pipelines ?? 0} total`, icon: Activity, borderClass: "border-l-4 border-l-emerald-500" },
    { label: "Feeds connected", value: dash?.feeds, sub: `${dash?.saved_articles ?? 0} saved articles`, icon: Rss, borderClass: "border-l-4 border-l-blue-500" },
    { label: "Records written", value: dash?.total_records, sub: `${dash?.total_runs ?? 0} runs`, icon: Database, borderClass: "border-l-4 border-l-violet-500" },
    { label: "Failed records", value: dash?.total_errors, sub: `${dash?.active_runs ?? 0} in progress`, icon: AlertCircle, borderClass: "border-l-4 border-l-amber-500" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Turn feeds, webpages, and APIs into structured records on your local machine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => navigate("/pipelines")}>
            <Plus className="mr-1 h-4 w-4" /> New pipeline
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className={`relative overflow-hidden transition-all hover:shadow-sm ${s.borderClass}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground/60" />
            </CardHeader>
            <CardContent>
              {dash ? (
                <>
                  <div className="text-3xl font-bold tracking-tight tabular-nums">{s.value ?? 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
                </>
              ) : (
                <Skeleton className="h-9 w-16" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">Product Workflow Guide</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-card hover:bg-accent/20 transition-all flex flex-col justify-between border-t-2 border-t-emerald-500">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-500">
                <Rss className="h-4 w-4" />
                <span>1. Connect Sources</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Add RSS feeds or monitor website URLs for content changes.
              </p>
            </CardHeader>
            <CardContent className="pt-0 mt-auto">
              <Button variant="link" className="p-0 h-auto text-xs text-emerald-500 hover:underline font-medium" onClick={() => navigate("/sources")}>
                Configure Sources →
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-card hover:bg-accent/20 transition-all flex flex-col justify-between border-t-2 border-t-blue-500">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-500">
                <Brain className="h-4 w-4" />
                <span>2. Setup AI / API</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Configure LLM endpoints (OpenAI, Ollama) and prompt templates.
              </p>
            </CardHeader>
            <CardContent className="pt-0 mt-auto">
              <Button variant="link" className="p-0 h-auto text-xs text-blue-500 hover:underline font-medium" onClick={() => navigate("/settings")}>
                Configure Keys/Prompts →
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-card hover:bg-accent/20 transition-all flex flex-col justify-between border-t-2 border-t-violet-500">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-500">
                <Workflow className="h-4 w-4" />
                <span>3. Build Pipeline</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Design automated workflows to map extracted data fields to schemas.
              </p>
            </CardHeader>
            <CardContent className="pt-0 mt-auto">
              <Button variant="link" className="p-0 h-auto text-xs text-violet-500 hover:underline font-medium" onClick={() => navigate("/pipelines")}>
                Create Pipeline →
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-card hover:bg-accent/20 transition-all flex flex-col justify-between border-t-2 border-t-amber-500">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
                <Database className="h-4 w-4" />
                <span>4. Query DuckDB</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Browse your local data tables, run SQL, or run semantic vector searches.
              </p>
            </CardHeader>
            <CardContent className="pt-0 mt-auto">
              <Button variant="link" className="p-0 h-auto text-xs text-amber-500 hover:underline font-medium" onClick={() => navigate("/duckdb")}>
                View Local Data →
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Your pipelines</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/pipelines")}>
              Manage
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {pipelines.length === 0 && (
              <p className="text-sm text-muted-foreground">No pipelines yet.</p>
            )}
            {pipelines.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(p.definition.feed_ids?.length ?? 0)} sources ·{" "}
                    DuckDB output
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => run(p.id, false)}>
                  <Play className="mr-1 h-3.5 w-3.5" /> Run
                </Button>
                <Button size="sm" variant="outline" onClick={() => run(p.id, true)}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/pipelines?id=${p.id}`)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent runs</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/runs")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {!dash?.last_run && <p className="text-sm text-muted-foreground">No runs yet.</p>}
            {dash?.last_run && (
              <div
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                onClick={() => navigate(`/runs?id=${dash.last_run!.id}`)}
              >
                <StatusBadge status={dash.last_run.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    #{dash.last_run.id} · {dash.last_run.records_count} records ·{" "}
                    {dash.last_run.error_count} errors
                  </div>
                </div>
              </div>
            )}
            {snapshots.slice(0, 3).map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{s.kind}</Badge>
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.article_count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Schedules</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate("/pipelines")}>
            Manage
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {pipelines.filter((p) => p.definition.schedule?.enabled).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No scheduled pipelines. Enable scheduling in a pipeline&apos;s Review step.
            </p>
          )}
          {pipelines
            .filter((p) => p.definition.schedule?.enabled)
            .map((p) => {
              const s = p.definition.schedule!;
              const label =
                s.kind === "daily"
                  ? `Daily at ${s.time || "09:00"}`
                  : `Every ${s.minutes || 60} min`;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {label}
                  </Badge>
                  <div className="min-w-0 flex-1 truncate font-medium">{p.name}</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/pipelines?id=${p.id}`)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
