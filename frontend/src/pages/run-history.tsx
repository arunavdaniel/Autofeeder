import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { safeJsonParse } from "@/lib/json";
import type { Pipeline, RunDetail, RunLog, RunSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, ArrowLeft, Download, Database, RefreshCw, Filter, History } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";

const STATUS_OPTIONS = ["all", "queued", "running", "success", "failed", "cancelled"];

function normalizeErrors(raw: unknown): { title: string; error: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const item = entry as { title?: string; error?: string };
      return { title: item.title || "Error", error: item.error || "" };
    }
    if (Array.isArray(entry) && entry.length >= 2) {
      return { title: String(entry[0]), error: String(entry[1]) };
    }
    return { title: "Error", error: String(entry) };
  });
}

export function RunHistory() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const LIMIT = 20;

  const load = (reset = true) => {
    const next = reset ? 0 : offset;
    setLoading(reset);
    api
      .runsFiltered({ pipelineId: pipelineId ?? undefined, status: status === "all" ? undefined : status, limit: LIMIT, offset: next })
      .then((res) => {
        setTotal(res.total);
        setRuns((prev) => (reset ? res.runs : [...prev, ...res.runs]));
        setOffset(next + LIMIT);
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.pipelines().then(setPipelines).catch(() => {});
  }, []);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pipelineId]);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let alive = true;
    setDetailError(null);
    const tick = async () => {
      try {
        const [d, l] = await Promise.all([api.run(Number(id)), api.runLogs(Number(id))]);
        if (!alive) return;
        setDetail(d);
        setLogs(l.logs);
        setDetailError(null);
      } catch (e) {
        if (!alive) return;
        setDetailError(String(e));
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  const open = (rid: number) => setParams({ id: String(rid) });

  if (id && !detail) {
    return (
      <PageShell
        width="4xl"
        title={detailError ? "Run not found" : "Loading run"}
        description={detailError || "Fetching logs and records…"}
        actions={
          <Button variant="ghost" onClick={() => setParams({})}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        }
      >
        {!detailError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading run #{id}
          </div>
        )}
        {detailError && (
          <EmptyState
            icon={History}
            title="Could not load this run"
            description={detailError}
            actionLabel="Back to run history"
            onAction={() => setParams({})}
          />
        )}
      </PageShell>
    );
  }

  if (id && detail) {
    const parsed = safeJsonParse<Record<string, unknown>>(detail.result || "{}", {});
    const result =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const pct =
      detail.progress_total > 0
        ? Math.round((detail.progress_current / detail.progress_total) * 100)
        : 0;
    const errors = normalizeErrors(result.errors);
    const pipelineName =
      detail.pipeline_name ||
      pipelines.find((p) => p.id === detail.pipeline_id)?.name ||
      `Pipeline #${detail.pipeline_id}`;
    const outputInfo =
      result.output ||
      (detail.output_info ? safeJsonParse(detail.output_info, null) : null);
    const running = detail.status === "running" || detail.status === "queued";

    return (
      <PageShell
        width="4xl"
        title={`Run #${detail.id}`}
        description={pipelineName}
        actions={
          <>
            <Button variant="ghost" onClick={() => setParams({})}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <StatusBadge status={detail.status} />
            {running && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  api
                    .cancelRun(detail.id)
                    .then(() => toast.success("Cancelling…"))
                    .catch((e) => toast.error(String(e)))
                }
              >
                Cancel
              </Button>
            )}
            {errors.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  api
                    .retryRunFailed(detail.id)
                    .then((r) => navigate(`/runs?id=${r.run_id}`))
                    .catch((e) => toast.error(String(e)))
                }
              >
                Retry failed
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/pipelines?edit=${detail.pipeline_id}`)}
            >
              Edit pipeline
            </Button>
            {result.records?.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(`/api/runs/${detail.id}/download?format=csv`, "_blank")}
              >
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            )}
            {outputInfo?.database && outputInfo?.table ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate(
                    `/duckdb?db=${encodeURIComponent(outputInfo.database)}&table=${encodeURIComponent(outputInfo.table)}`,
                  )
                }
              >
                <Database className="mr-1 h-4 w-4" /> Open table
              </Button>
            ) : outputInfo?.path ? (
              <Button size="sm" variant="outline" onClick={() => navigate("/duckdb")}>
                <Database className="mr-1 h-4 w-4" /> DuckDB
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                api
                  .deleteRun(detail.id)
                  .then(() => setParams({}))
                  .catch((e) => toast.error(String(e)))
              }
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        }
      >
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Articles</div>
                <div className="text-xl font-semibold tabular-nums">{detail.articles_seen}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Records</div>
                <div className="text-xl font-semibold tabular-nums">{detail.records_count}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Errors</div>
                <div className="text-xl font-semibold tabular-nums text-destructive">{detail.error_count}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Phase</div>
                <div className="truncate font-medium">{detail.phase || "—"}</div>
              </div>
            </div>
            {running && (
              <div className="space-y-1">
                <Progress value={pct} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {detail.progress_current} / {detail.progress_total} ({pct}%)
                </p>
              </div>
            )}
            {detail.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{detail.error}</p>}
            {!running && detail.status === "failed" && (
              <p className="text-sm text-muted-foreground">
                Fix the error above, then{" "}
                <button type="button" className="underline" onClick={() => navigate(`/pipelines?edit=${detail.pipeline_id}`)}>
                  edit the pipeline
                </button>
                {errors.length > 0 ? " or retry failed items." : "."} Common causes: missing LLM settings, no sources, or a bad output table.
              </p>
            )}
            {!running && detail.status === "success" && (result.records || []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                {detail.preview
                  ? "Preview does not write DuckDB. Run without preview to persist rows."
                  : "No rows written. Check source selection, keyword filters, max articles, and the process recipe."}{" "}
                <button type="button" className="underline" onClick={() => navigate(`/pipelines?edit=${detail.pipeline_id}`)}>
                  Edit pipeline
                </button>
              </p>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="log">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="log">Log ({logs.length})</TabsTrigger>
            <TabsTrigger value="records">Records ({result.records?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="errors">Errors ({errors.length})</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
          </TabsList>
          <TabsContent value="log">
            <Card>
              <CardContent className="py-4">
                <ScrollArea className="h-80 rounded-lg border bg-muted/20 p-3">
                  <div className="space-y-1 font-mono text-xs">
                    {logs.map((l) => (
                      <div key={l.id} className={l.level === "error" ? "text-destructive" : ""}>
                        <span className="mr-2 font-semibold text-foreground">{l.step}</span>
                        {l.message}
                      </div>
                    ))}
                    {logs.length === 0 && <p className="text-muted-foreground">No log entries yet.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="records">
            <Card>
              <CardContent className="space-y-3 py-4">
                {(result.records || []).map((rec: Record<string, unknown>, i: number) => (
                  <div key={i} className="rounded-xl border bg-muted/10 p-4 text-sm">
                    {Object.entries(rec)
                      .filter(([k]) => !k.startsWith("_"))
                      .map(([k, v]) => (
                        <div key={k} className="grid grid-cols-3 gap-2 border-b border-border/50 py-1.5 last:border-0">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="col-span-2 break-words font-mono text-xs">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                  </div>
                ))}
                {(result.records || []).length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No records produced. If this was a full run, check filters, sources, and LLM settings.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="errors">
            <Card>
              <CardContent className="space-y-2 py-4">
                {errors.map((e, i) => (
                  <div key={i} className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
                    <div className="font-medium">{e.title}</div>
                    <div className="mt-1 text-destructive">{e.error}</div>
                  </div>
                ))}
                {errors.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No errors.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="output">
            <Card>
              <CardContent className="py-4">
                {outputInfo?.path ? (
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="col-span-2">{outputInfo.type}</dd>
                    <dt className="text-muted-foreground">Path</dt>
                    <dd className="col-span-2 break-all font-mono text-xs">{outputInfo.path}</dd>
                    {outputInfo.table && (
                      <>
                        <dt className="text-muted-foreground">Table</dt>
                        <dd className="col-span-2">{outputInfo.table}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Records</dt>
                    <dd className="col-span-2">{outputInfo.records}</dd>
                  </dl>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No output written (preview or no records).
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Run history"
      description="Every pipeline execution with live logs, records, and downloadable output."
      actions={
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-muted-foreground" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All statuses" : s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Pipeline</Label>
            <Select
              value={pipelineId ? String(pipelineId) : "all"}
              onValueChange={(v) => setPipelineId(v === "all" ? null : Number(v))}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All pipelines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pipelines</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {runs.length === 0 && !loading && (
          <EmptyState
            icon={History}
            title="No runs yet"
            description="Run a pipeline to produce this list. Failed runs explain what to fix on the detail page."
            actionLabel="New pipeline"
            onAction={() => navigate("/pipelines?new=1")}
          />
        )}
        {runs.map((r) => {
          const pipelineName =
            r.pipeline_name ||
            pipelines.find((p) => p.id === r.pipeline_id)?.name ||
            `Pipeline #${r.pipeline_id}`;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => open(r.id)}
              className="flex w-full items-center gap-4 rounded-xl border border-border/80 bg-card px-4 py-3 text-left transition-all hover:border-foreground/20 hover:shadow-sm"
            >
              <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">#{r.id}</span>
              <StatusBadge status={r.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{pipelineName}</div>
                <div className="text-xs text-muted-foreground">
                  {r.preview ? "preview · " : ""}
                  {r.articles_seen} articles · {r.records_count} records · {r.error_count} errors
                </div>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">{r.created_at}</span>
            </button>
          );
        })}
      </div>
      {total > runs.length && (
        <Button variant="outline" onClick={() => load(false)} disabled={loading}>
          Load more
        </Button>
      )}
    </PageShell>
  );
}
