import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Pipeline, RunDetail, RunLog, RunSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = ["", "queued", "running", "success", "failed", "cancelled"];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    queued: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return <Badge className={map[status] || "bg-muted"}>{status}</Badge>;
}

export function RunHistory() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);

  const LIMIT = 20;

  const load = (reset = true) => {
    const next = reset ? 0 : offset;
    api
      .runsFiltered({ pipelineId: pipelineId ?? undefined, status: status || undefined, limit: LIMIT, offset: next })
      .then((res) => {
        setTotal(res.total);
        setRuns((prev) => (reset ? res.runs : [...prev, ...res.runs]));
        setOffset(next + LIMIT);
      })
      .catch(() => {});
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
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const [d, l] = await Promise.all([
          api.run(Number(id)),
          api.runLogs(Number(id)),
        ]);
        if (!alive) return;
        setDetail(d);
        setLogs(l.logs);
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
  }, [id]);

  const open = (rid: number) => {
    setParams({ id: String(rid) });
    load(true);
  };

  if (id && detail) {
    const result = JSON.parse(detail.result || "{}");
    const pct =
      detail.progress_total > 0
        ? Math.round((detail.progress_current / detail.progress_total) * 100)
        : 0;
    const errors: { title: string; error: string }[] = result.errors || [];
    const running = detail.status === "running" || detail.status === "queued";
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-8">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setParams({})}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <div className="flex flex-wrap items-center gap-2">
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
            {result.records?.length > 0 && (
              <span className="inline-flex h-8 items-center rounded-md border border-border bg-transparent px-3 text-xs font-medium text-muted-foreground">
                Stored in DuckDB
              </span>
            )}
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
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Run #{detail.id}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{detail.articles_seen} articles</span>
              <span>·</span>
              <span>{detail.records_count} records</span>
              <span>·</span>
              <span>{detail.error_count} errors</span>
              <span>·</span>
              <span>phase: {detail.phase || "—"}</span>
            </div>
            {(detail.status === "running" || detail.status === "queued") && (
              <div className="space-y-1">
                <Progress value={pct} />
                <p className="text-xs text-muted-foreground">
                  {detail.progress_current} / {detail.progress_total} ({pct}%)
                </p>
              </div>
            )}
            {detail.error && <p className="text-sm text-red-600">{detail.error}</p>}
          </CardContent>
        </Card>

        <Tabs defaultValue="log">
          <TabsList>
            <TabsTrigger value="log">Live log ({logs.length})</TabsTrigger>
            <TabsTrigger value="records">Records ({result.records?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="errors">Errors ({result.errors?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
          </TabsList>
          <TabsContent value="log">
            <Card>
              <CardContent className="py-4">
                <ScrollArea className="h-80">
                  <div className="space-y-1 font-mono text-xs">
                    {logs.map((l) => (
                      <div key={l.id} className={l.level === "error" ? "text-red-500" : ""}>
                        <span className="mr-2 font-semibold text-brand">{l.step}</span>
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
                {(result.records || []).map((rec: any, i: number) => (
                  <div key={i} className="rounded-lg border p-3 text-sm">
                    {Object.entries(rec).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-3 gap-2">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="col-span-2 break-words">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {(result.records || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No records produced.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="errors">
            <Card>
              <CardContent className="space-y-2 py-4">
                {errors.map((e, i) => (
                  <div key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:bg-red-950/30">
                    <div className="font-medium">{e.title}</div>
                    <div className="text-red-600">{e.error}</div>
                  </div>
                ))}
                {errors.length === 0 && <p className="text-sm text-muted-foreground">No errors.</p>}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="output">
            <Card>
              <CardContent className="py-4">
                {result.output?.path ? (
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="col-span-2">{result.output.type}</dd>
                    <dt className="text-muted-foreground">Path</dt>
                    <dd className="col-span-2 break-all">{result.output.path}</dd>
                    {result.output.table && (
                      <>
                        <dt className="text-muted-foreground">Table</dt>
                        <dd className="col-span-2">{result.output.table}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Records</dt>
                    <dd className="col-span-2">{result.output.records}</dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">No output written (preview or no records).</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Run history</h1>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s || "all"} value={s}>
                  {s === "" ? "All" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Pipeline</Label>
          <Select
            value={pipelineId ? String(pipelineId) : ""}
            onValueChange={(v) => setPipelineId(v ? Number(v) : null)}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card>
        <CardContent className="py-4">
          <div className="space-y-2">
            {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
            {runs.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border p-3"
                onClick={() => open(r.id)}
                role="button"
              >
                <span className="text-xs text-muted-foreground">#{r.id}</span>
                <StatusBadge status={r.status} />
                <div className="min-w-0 flex-1 text-sm">
                  {r.preview ? "preview · " : ""}
                  {r.articles_seen} articles · {r.records_count} records · {r.error_count} errors
                </div>
                <span className="text-xs text-muted-foreground">{r.created_at}</span>
              </div>
            ))}
          </div>
          {total > runs.length && (
            <Button variant="outline" className="mt-3" onClick={() => load(false)}>
              Load more
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
