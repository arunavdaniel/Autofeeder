import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { SAMPLE_FEEDS } from "@/lib/onboarding";
import { localLlmReady, configLlmReady } from "@/lib/llm-settings";
import type { ApiConfig, Dashboard, Pipeline, RunSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Play,
  Eye,
  Pencil,
  RefreshCw,
  Activity,
  Database,
  Rss,
  AlertCircle,
  Workflow,
  ArrowRight,
  Globe,
  Clock,
  Loader2,
  Zap,
  Settings,
  Library,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { outputLabel, sourceCount } from "@/lib/pipeline-utils";
import { toast } from "sonner";

const QUICK_ACTIONS = [
  {
    title: "1. Add a source",
    description: "Catalog, RSS, website, or API",
    icon: Library,
    to: "/discover",
  },
  {
    title: "2. New pipeline",
    description: "Fetch → extract → DuckDB",
    icon: Workflow,
    to: "/pipelines",
    action: "new",
  },
  {
    title: "3. Run history",
    description: "Logs, rows, failures",
    icon: Activity,
    to: "/runs",
  },
  {
    title: "4. Publish",
    description: "Files, RSS/JSON, upsert",
    icon: Database,
    to: "/exports",
  },
];

export function Overview() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedUrl, setFeedUrl] = useState("");
  const [addingFeed, setAddingFeed] = useState(false);
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);

  const refresh = async () => {
    try {
      const [d, p, runs, configs] = await Promise.all([
        api.dashboard(),
        api.pipelines(),
        api.runsFiltered({ limit: 6 }),
        api.apiConfigs().catch(() => [] as ApiConfig[]),
      ]);
      setDash(d);
      setPipelines(p);
      setRecentRuns(Array.isArray(runs?.runs) ? runs.runs : []);
      setApiConfigs(Array.isArray(configs) ? configs : []);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = (id: number, preview: boolean) =>
    api
      .runPipeline(id, preview)
      .then((r) => navigate(`/runs?id=${r.run_id}`))
      .catch((e) => toast.error(String(e)));

  const addFeed = async (url?: string) => {
    const target = (url ?? feedUrl).trim();
    if (!target) return toast.error("Enter a feed URL");
    setAddingFeed(true);
    try {
      let folders = await api.folders();
      let folder = folders[0];
      if (!folder) {
        const created = await api.addFolder("Feeds");
        folder = { id: created.id, name: created.name, feeds: [], saved_count: 0 };
      }
      const feed = await api.addFeed(target, folder.id);
      toast.success(`Added ${feed.title}`, {
        action: {
          label: "Create pipeline",
          onClick: () => navigate(`/pipelines?folder=${folder.id}`),
        },
      });
      setFeedUrl("");
      refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAddingFeed(false);
    }
  };

  const llmReady = localLlmReady() || apiConfigs.some(configLlmReady);
  const stats = [
    { label: "Pipelines", value: dash?.pipelines, sub: `${dash?.active_pipelines ?? 0} active`, icon: Activity },
    { label: "Feeds", value: dash?.feeds, sub: `${dash?.saved_articles ?? 0} articles saved`, icon: Rss },
    { label: "Records", value: dash?.total_records, sub: `${dash?.total_runs ?? 0} total runs`, icon: Database },
    { label: "Errors", value: dash?.total_errors, sub: `${dash?.active_runs ?? 0} running now`, icon: AlertCircle },
  ];
  const scheduled = pipelines.filter((p) => p.definition.schedule?.enabled || p.definition.snapshot?.enabled);
  const showAddFeed = !loading && (dash?.feeds ?? 0) === 0 && pipelines.length === 0;

  return (
    <PageShell
      title="Overview"
      description="Add a source, create a pipeline, run it, then publish from DuckDB."
      actions={
        <>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => navigate("/pipelines?new=1")}>
            <Plus className="mr-1.5 h-4 w-4" /> New pipeline
          </Button>
        </>
      }
    >
      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.title}
            type="button"
            className="action-tile"
            onClick={() => {
              if (action.action === "new") {
                navigate("/pipelines?new=1");
              } else {
                navigate(action.to);
              }
            }}
          >
            <div className="mb-4 inline-flex rounded-xl border border-border/80 bg-muted/40 p-2.5">
              <action.icon className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="text-[15px] font-semibold tracking-tight">{action.title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
            <span className="mt-4 inline-flex items-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Open <ArrowRight className="ml-1 h-3 w-3" />
            </span>
          </button>
        ))}
      </div>

      {showAddFeed && (
        <div className="glass-panel p-6 sm:p-8">
          <div className="mx-auto max-w-xl space-y-5 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border bg-background">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Start with a source</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Paste an RSS URL, or open Discover. Next you will create a pipeline that writes DuckDB and can publish.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
                className="h-11 rounded-xl bg-background"
                onKeyDown={(e) => e.key === "Enter" && addFeed()}
              />
              <Button className="h-11 shrink-0 rounded-xl px-6" onClick={() => addFeed()} disabled={addingFeed}>
                {addingFeed ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add feed"}
              </Button>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLE_FEEDS.map((sample) => (
                <button
                  key={sample.url}
                  type="button"
                  className="rounded-full border border-border/80 bg-background px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  onClick={() => addFeed(sample.url)}
                  disabled={addingFeed}
                >
                  {sample.label}
                </button>
              ))}
              <button
                type="button"
                className="rounded-full border border-foreground/20 bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                onClick={() => navigate("/discover")}
              >
                Browse catalog
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
              <s.icon className="h-4 w-4 text-muted-foreground/60" strokeWidth={1.5} />
            </div>
            {dash ? (
              <>
                <div className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{s.value ?? 0}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.sub}</div>
              </>
            ) : (
              <Skeleton className="mt-3 h-9 w-16" />
            )}
          </div>
        ))}
      </div>

      {!llmReady && !loading && (
        <Card className="border-dashed bg-muted/10">
          <CardContent className="flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border bg-background p-2">
                <Settings className="h-4 w-4" />
              </div>
              <div>
                <div className="font-medium">LLM not configured</div>
                <p className="text-sm text-muted-foreground">Pipelines that extract with an LLM need an endpoint and model. Set them before you run.</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate("/settings")}>
              Open settings
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between pb-4">
            <CardTitle>Pipelines</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/pipelines")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {pipelines.length === 0 && (
              <EmptyState
                icon={Workflow}
                title="No pipelines yet"
                description="A pipeline is the product: pick sources, extract, write DuckDB, optionally publish."
                actionLabel="New pipeline"
                onAction={() => navigate("/pipelines?new=1")}
                secondaryLabel="Add a source"
                onSecondary={() => navigate("/discover")}
              />
            )}
            {pipelines.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/15 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {sourceCount(p.definition)} sources · {outputLabel(p.definition)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="rounded-lg" onClick={() => run(p.id, false)}>
                    <Play className="mr-1 h-3.5 w-3.5" /> Run
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={() => run(p.id, true)}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => navigate(`/pipelines?edit=${p.id}`)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-4">
            <CardTitle>Recent runs</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/runs")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentRuns.length === 0 && (
              <EmptyState
                icon={Activity}
                title="No runs yet"
                description="Run a pipeline from the list. This is where you inspect rows and failures."
                actionLabel="New pipeline"
                onAction={() => navigate("/pipelines?new=1")}
              />
            )}
            {recentRuns.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/runs?id=${r.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted/30"
              >
                <StatusBadge status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.pipeline_name || `Pipeline #${r.pipeline_id}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.records_count} records · {r.error_count} errors
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {scheduled.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Scheduled
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/pipelines")}>
              Manage
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {scheduled.map((p) => {
              const s = p.definition.schedule?.enabled ? p.definition.schedule : p.definition.snapshot;
              const kind = s?.kind === "daily" ? `Daily at ${s.time || "09:00"}` : `Every ${s?.minutes || 60} min`;
              const label = p.definition.snapshot?.enabled && !p.definition.schedule?.enabled ? `Snapshots · ${kind}` : kind;
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 truncate font-medium">{p.name}</div>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
