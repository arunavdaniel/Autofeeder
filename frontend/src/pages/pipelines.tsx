import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { DEFAULT_DB } from "@/lib/onboarding";
import { loadLLM, saveLLM, configLlmReady } from "@/lib/llm-settings";
import { safeJsonParse } from "@/lib/json";
import type { Folder, Pipeline, PipelineDefinition, Snapshot, ApiConfig, PromptTemplate, SchemaDef, DuckDBDatabase, Website, ApiSource, Keyword, RunSummary, PublishChannel, SyncTarget } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Play,
  Eye,
  Pencil,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Loader2,
  RefreshCw,
  Database,
  Workflow,
  Camera,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { EmbeddingModelFields } from "@/components/embedding-model-fields";
import { outputLabel, sourceCount, hasSources, scheduleLabel, reviewWarnings, usesLlm, pickDatabaseWithRows, pickTableWithRows } from "@/lib/pipeline-utils";

const STEPS = ["Source", "Fetch", "Process", "Schema", "Output", "Review"];
const TYPES = ["string", "number", "integer", "boolean", "array", "object"];

const DUCK_TYPES = ["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP", "JSON"];

function duckTypeFromField(t: string): string {
  switch ((t || "").toLowerCase()) {
    case "number":
    case "float":
    case "double":
      return "DOUBLE";
    case "integer":
    case "int":
      return "BIGINT";
    case "boolean":
    case "bool":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "timestamp":
    case "datetime":
      return "TIMESTAMP";
    case "array":
    case "object":
    case "json":
      return "JSON";
    default:
      return "VARCHAR";
  }
}

function CreateTableButton({ database, table, mappings }: { database: string; table: string; mappings: { source: string; target: string; type?: string }[] }) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || !database.trim() || !table.trim() || mappings.length === 0 || mappings.some((m) => !m.target.trim());
  const onClick = async () => {
    setBusy(true);
    try {
      const res = await api.duckdbCreateTable({
        database,
        table,
        include_meta: true,
        columns: mappings
          .filter((m) => m.target.trim())
          .map((m) => ({ name: m.target.trim(), type: m.type || "VARCHAR" })),
      });
      toast.success(`Table ensured: ${res.table} (${res.columns.length} columns)`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled}>
      {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Database className="mr-1 h-4 w-4" />} Create / ensure table
    </Button>
  );
}

function llmFromDef(def: PipelineDefinition, configs: ApiConfig[] = []) {
  const local = loadLLM();
  const cfg = configs.find((c) => c.id === def.api_config_id && configLlmReady(c)) || configs.find(configLlmReady);
  return {
    enabled: def.llm?.enabled !== false,
    endpoint: def.llm?.endpoint || local.endpoint || cfg?.endpoint || "",
    model: def.llm?.model || local.model || cfg?.model || "",
    api_key: def.llm?.api_key || local.api_key || "",
  };
}

function applySavedLlm(def: PipelineDefinition, configs: ApiConfig[]): PipelineDefinition {
  const llm = llmFromDef(def, configs);
  const cfg = configs.find((c) => c.id === def.api_config_id) || configs.find(configLlmReady);
  const api_config_id = def.api_config_id ?? cfg?.id;
  const transforms = (def.transforms || []).map((t: any) => {
    if (t.type === "extract" && t.role === "fetch") return t;
    if (t.type === "extract" || t.type === "synthesize" || t.type === "enrich_llm") {
      return {
        ...t,
        api_config_id: t.api_config_id ?? api_config_id,
        llm: { ...llm, ...(t.llm || {}), endpoint: t.llm?.endpoint || llm.endpoint, model: t.llm?.model || llm.model, api_key: t.llm?.api_key || llm.api_key },
      };
    }
    return t;
  });
  return { ...def, llm, api_config_id, transforms };
}

function applyDuckOutput(def: PipelineDefinition, duckDbs: DuckDBDatabase[]): PipelineDefinition {
  const cur = def.output?.database || "";
  if (cur && cur !== DEFAULT_DB) return def;
  const picked = pickDatabaseWithRows(duckDbs);
  if (!picked) return def;
  const table = pickTableWithRows(picked.stats?.tables || []) || def.output?.table || "articles";
  return {
    ...def,
    output: {
      type: def.output?.type || "duckdb",
      database: picked.path,
      table,
      mode: def.output?.mode ?? "append",
      mappings: def.output?.mappings || [],
      dedupe_key: def.output?.dedupe_key ?? "article_url",
    },
  };
}

function longDocumentTransforms(def: PipelineDefinition) {
  const llm = llmFromDef(def);
  return [
    { type: "extract", role: "fetch", mode: "raw", label: "Fetch full article" },
    {
      type: "chunk",
      chunk_size: def.embeddings?.chunk_size ?? 800,
      chunk_overlap: def.embeddings?.chunk_overlap ?? 120,
      strategy: def.embeddings?.strategy ?? "paragraph",
      min_words: 0,
      generate_vectors: false,
      split_pipeline_stream: true,
      filter_by_keywords: false,
    },
    { type: "keyword_filter", keywords_str: "", use_saved_keywords: true, match_all: false },
    {
      type: "extract",
      role: "chunk",
      mode: "llm",
      label: "Per-chunk extract",
      llm,
      prompt:
        def.prompt ||
        "Extract facts, entities, and claims from this passage only. Return JSON. If the passage is not relevant, return {\"relevant\": false}.",
    },
    {
      type: "synthesize",
      label: "Article output",
      llm,
      prompt:
        "Combine the passage extracts into one structured record for the full article. Ignore passages marked not relevant. Return a single JSON object matching the output schema.",
    },
  ];
}

function simpleArticleTransforms(def: PipelineDefinition) {
  return [
    {
      type: "extract",
      role: "article",
      mode: "auto",
      label: "Extract article",
      hybrid_llm_fill: false,
      llm: llmFromDef(def),
      prompt: def.prompt || "Extract structured fields from this article.",
    },
  ];
}

function emptyDef(configs: ApiConfig[] = [], duckDbs: DuckDBDatabase[] = []): PipelineDefinition {
  const s = loadLLM();
  const cfg = configs.find(configLlmReady);
  const def: PipelineDefinition = {
    sources: [],
    transforms: [],
    date_filter: { enabled: false, from: "", to: "" },
    max_articles: 20,
    use_browser: false,
    extraction_mode: "auto",
    hybrid_llm_fill: false,
    api_config_id: cfg?.id,
    llm: {
      enabled: true,
      endpoint: s.endpoint || cfg?.endpoint || "",
      model: s.model || cfg?.model || "",
      api_key: s.api_key,
    },
    prompt: s.prompt,
    fields: [],
    output: { type: "duckdb", database: DEFAULT_DB, table: "articles", mode: "append", mappings: [], dedupe_key: "article_url" },
    run_on_change: false,
    retries: 0,
    concurrency: 1,
    timeout: 60,
    dedup: true,
    change_detection: false,
    embeddings: { enabled: false, provider: "local", model: "all-MiniLM-L6-v2", chunk_size: 800, chunk_overlap: 120, strategy: "paragraph", top_k: 5, min_words: 0, filter_by_keywords: false, generate_vectors: false },
    schedule: { enabled: false, kind: "interval", minutes: 60 },
    snapshot: { enabled: false, kind: "interval", minutes: 60, dest: { database: DEFAULT_DB, table: "snapshot_articles", dedupe_key: "url" } },
  };
  def.transforms = longDocumentTransforms(def);
  return applyDuckOutput(applySavedLlm(def, configs), duckDbs);
}

export function Pipelines() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [editing, setEditing] = useState<PipelineDefinition | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [schemas, setSchemas] = useState<SchemaDef[]>([]);
  const [duckDbs, setDuckDbs] = useState<DuckDBDatabase[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [apiSources, setApiSources] = useState<ApiSource[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastRuns, setLastRuns] = useState<Record<number, RunSummary>>({});

  const load = () => {
    api.pipelines().then(setPipelines).catch(() => {});
    api.folders().then(setFolders).catch(() => {});
    api.snapshots().then(setSnapshots).catch(() => {});
    api.apiConfigs().then(setApiConfigs).catch(() => {});
    api.prompts().then(setPrompts).catch(() => {});
    api.schemas().then(setSchemas).catch(() => {});
    api.duckdbDatabases().then(setDuckDbs).catch(() => {});
    api.websites().then(setWebsites).catch(() => {});
    api.apiSources().then(setApiSources).catch(() => {});
    api.keywords().then(setKeywords).catch(() => {});
    api
      .runsFiltered({ limit: 80, offset: 0 })
      .then((res) => {
        const map: Record<number, RunSummary> = {};
        for (const run of res.runs || []) {
          if (run.pipeline_id != null && map[run.pipeline_id] == null) map[run.pipeline_id] = run;
        }
        setLastRuns(map);
      })
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const def = editing || emptyDef(apiConfigs, duckDbs);
  const set = (patch: Partial<PipelineDefinition>) => setEditing({ ...def, ...patch });

  const startNew = () => {
    setEditing(emptyDef(apiConfigs, duckDbs));
    setEditingId(null);
    setStep(0);
  };
  const startEdit = (p: Pipeline) => {
    const pd = { ...p.definition };
    if (!pd.sources && pd.source) {
      pd.sources = [pd.source];
    }
    setEditing({ ...pd, name: p.name });
    setEditingId(p.id);
    setStep(0);
  };

  // deep-link presets
  const folderParam = params.get("folder");
  const snapshotParam = params.get("snapshot");
  const modeParam = params.get("mode");
  const newParam = params.get("new");
  const editParam = params.get("edit") || params.get("id");
  const feedsParam = params.get("feeds");
  const websiteParam = params.get("website");
  const apiParam = params.get("api");
  const dbParam = params.get("db");
  const tableParam = params.get("table");
  const deepLinkKey = [
    editParam,
    newParam,
    modeParam,
    folderParam,
    snapshotParam,
    feedsParam,
    websiteParam,
    apiParam,
    dbParam,
    tableParam,
  ].join("|");
  const appliedDeepLink = useRef("");
  useEffect(() => {
    if (editing && appliedDeepLink.current === deepLinkKey) return;
    if (editParam && pipelines.length) {
      const p = pipelines.find((x) => String(x.id) === editParam);
      if (p) {
        startEdit(p);
        appliedDeepLink.current = deepLinkKey;
      }
      return;
    }
    if (newParam === "1") {
      const d = emptyDef(apiConfigs, duckDbs);
      if (feedsParam) {
        const ids = feedsParam.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (ids.length) d.sources = [{ type: "feeds", feed_ids: ids }];
      }
      if (websiteParam) d.sources = [{ type: "websites", website_ids: [Number(websiteParam)] }];
      if (apiParam) d.sources = [{ type: "api_sources", api_source_ids: [Number(apiParam)] }];
      if (dbParam) d.output = { ...d.output!, database: dbParam };
      if (tableParam) d.output = { ...d.output!, table: tableParam };
      setEditing(d);
      setEditingId(null);
      setStep(0);
      appliedDeepLink.current = deepLinkKey;
      return;
    }
    if (modeParam === "snapshot") {
      const d = emptyDef(apiConfigs, duckDbs);
      d.name = "Scheduled snapshot";
      d.llm = { ...d.llm!, enabled: false };
      d.extraction_mode = "raw";
      d.transforms = [{ type: "extract", role: "fetch", mode: "raw", label: "Fetch full article" }];
      d.snapshot = { enabled: true, kind: "interval", minutes: 60, dest: { database: DEFAULT_DB, table: "snapshot_articles", dedupe_key: "url" } };
      setEditing(d);
      setEditingId(null);
      setStep(0);
      appliedDeepLink.current = deepLinkKey;
      return;
    }
    if ((folderParam || snapshotParam) && folders.length) {
      const d = emptyDef(apiConfigs, duckDbs);
      if (folderParam) {
        const f = folders.find((x) => String(x.id) === folderParam);
        if (f) {
          d.sources = [{ type: "feeds", feed_ids: f.feeds.map((x) => x.id) }];
          d.name = `Pipeline from ${f.name}`;
        }
      }
      if (snapshotParam) {
        d.sources = [{ type: "snapshot", snapshot_id: Number(snapshotParam) }];
        const s = snapshots.find((x) => String(x.id) === snapshotParam);
        d.name = s ? `Pipeline on ${s.name || s.source || "snapshot"}` : "Pipeline on snapshot";
      }
      setEditing(d);
      appliedDeepLink.current = deepLinkKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, snapshots, pipelines, deepLinkKey]);

  useEffect(() => {
    if (editingId != null) return;
    setEditing((cur) => {
      if (!cur) return cur;
      const next = applyDuckOutput(applySavedLlm(cur, apiConfigs), duckDbs);
      if (
        next.llm?.model === cur.llm?.model &&
        next.llm?.endpoint === cur.llm?.endpoint &&
        next.api_config_id === cur.api_config_id &&
        next.output?.database === cur.output?.database &&
        next.output?.table === cur.output?.table
      ) {
        return cur;
      }
      return next;
    });
  }, [apiConfigs, duckDbs, editingId]);



  const save = async (): Promise<number | null> => {
    if (!def.name?.trim()) {
      toast.error("Name this pipeline on the first step before saving.");
      setStep(0);
      return null;
    }
    setBusy(true);
    try {
      const res = await api.savePipeline(def.name.trim(), def, editingId);
      setEditingId(res.id);
      saveLLM({
        endpoint: def.llm?.endpoint ?? "",
        model: def.llm?.model ?? "",
        api_key: def.llm?.api_key ?? "",
        prompt: def.prompt ?? "",
        firecrawl_api_key: loadLLM().firecrawl_api_key,
        firecrawl_base_url: def.firecrawl_base_url ?? loadLLM().firecrawl_base_url,
      });
      toast.success("Pipeline saved.");
      load();
      return res.id;
    } catch (e) {
      toast.error(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const run = async (preview: boolean) => {
    const id = await save();
    if (!id) return;
    try {
      const r = await api.runPipeline(id, preview);
      navigate(`/runs?id=${r.run_id}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const del = (id: number) =>
    api.deletePipeline(id).then(load).catch((e) => toast.error(String(e)));

  if (editing) {
    return (
      <Builder
        def={def}
        set={set}
        step={step}
        setStep={setStep}
        folders={folders}
        snapshots={snapshots}
        apiConfigs={apiConfigs}
        prompts={prompts}
        schemas={schemas}
        duckDbs={duckDbs}
        websites={websites}
        apiSources={apiSources}
        keywords={keywords}
        busy={busy}
        onBack={() => {
          setEditing(null);
          setParams({});
        }}
        onSave={save}
        onRun={run}
      />
    );
  }

  return (
    <PageShell
      title="Pipelines"
      description="The core loop: sources in, structured rows out, optional publish/sync."
      width="4xl"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={load} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const d = emptyDef(apiConfigs, duckDbs);
              d.name = "Scheduled snapshot";
              d.llm = { ...d.llm!, enabled: false };
              d.extraction_mode = "raw";
              d.transforms = [{ type: "extract", role: "fetch", mode: "raw", label: "Fetch full article" }];
              d.snapshot = {
                enabled: true,
                kind: "interval",
                minutes: 60,
                dest: { database: DEFAULT_DB, table: "snapshot_articles", dedupe_key: "url" },
              };
              setEditing(d);
              setEditingId(null);
              setStep(0);
            }}
          >
            <Camera className="mr-1 h-4 w-4" /> Snapshot job
          </Button>
          <Button onClick={startNew}>
            <Plus className="mr-1 h-4 w-4" /> New pipeline
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {pipelines.length === 0 && (
          <EmptyState
            icon={Workflow}
            title="No pipelines yet"
            description="Pick sources, map fields to a DuckDB table, then Run. Attach publish/sync on Output after you create them on Exports."
            actionLabel="New pipeline"
            onAction={startNew}
            secondaryLabel="Add a source"
            onSecondary={() => navigate("/discover")}
          />
        )}
        {pipelines.map((p) => {
          const last = lastRuns[p.id];
          const db = p.definition.output?.database;
          const table = p.definition.output?.table;
          const sched = scheduleLabel(p.definition);
          return (
          <Card key={p.id} className="transition-all hover:shadow-md">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{p.name}</div>
                  {last && <StatusBadge status={last.status} />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {sourceCount(p.definition)} sources · {outputLabel(p.definition)}
                  {sched ? ` · ${sched}` : ""}
                </div>
                {last && (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => navigate(`/runs?id=${last.id}`)}
                  >
                    Last run #{last.id}
                    {last.records_count != null ? ` · ${last.records_count} rows` : ""}
                    {last.error_count ? ` · ${last.error_count} errors` : ""}
                    {last.created_at ? ` · ${last.created_at.slice(0, 16).replace("T", " ")}` : ""}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    api
                      .runPipeline(p.id, false)
                      .then((r) => navigate(`/runs?id=${r.run_id}`))
                      .catch((e) => toast.error(String(e)))
                  }
                >
                  <Play className="mr-1 h-3.5 w-3.5" /> Run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    api
                      .runPipeline(p.id, true)
                      .then((r) => navigate(`/runs?id=${r.run_id}`))
                      .catch((e) => toast.error(String(e)))
                  }
                >
                  <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                </Button>
                {db && table && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/duckdb?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`)}>
                    <Database className="mr-1 h-3.5 w-3.5" /> Open data
                  </Button>
                )}
                {last && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/runs?id=${last.id}`)}>
                    Last run
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => del(p.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>
    </PageShell>
  );
}

function Builder(props: {
  def: PipelineDefinition;
  set: (p: Partial<PipelineDefinition>) => void;
  step: number;
  setStep: (n: number) => void;
  folders: Folder[];
  snapshots: Snapshot[];
  apiConfigs: ApiConfig[];
  prompts: PromptTemplate[];
  schemas: SchemaDef[];
  duckDbs: DuckDBDatabase[];
  websites: Website[];
  apiSources: ApiSource[];
  keywords: Keyword[];
  busy: boolean;
  onBack: () => void;
  onSave: () => Promise<number | null>;
  onRun: (preview: boolean) => void;
}) {
  const { def, set, step, setStep, folders, snapshots, apiConfigs, prompts, schemas, duckDbs, websites, apiSources, keywords, busy, onBack, onSave, onRun } = props;
  const [suggesting, setSuggesting] = useState(false);
  const [activeSourceTab, setActiveSourceTab] = useState<"feeds" | "websites" | "api_sources" | "snapshots">("feeds");
  const [channels, setChannels] = useState<PublishChannel[]>([]);
  const [syncTargets, setSyncTargets] = useState<SyncTarget[]>([]);
  useEffect(() => {
    api.publishChannels().then(setChannels).catch(() => {});
    api.syncTargets().then(setSyncTargets).catch(() => {});
  }, []);

  const llmReady = Boolean(
    (def.llm?.endpoint || loadLLM().endpoint)?.trim() && (def.llm?.model || loadLLM().model)?.trim(),
  ) || apiConfigs.some(configLlmReady);
  const showLlmGap = usesLlm(def) && !llmReady;
  const issues = reviewWarnings(def, llmReady);
  const goNext = () => {
    if (step === 0 && !hasSources(def)) {
      toast.error("Select at least one source before continuing.");
      return;
    }
    setStep(Math.min(5, step + 1));
  };

  const getSelectedFeedIds = (): number[] => {
    const src = def.sources?.find((s) => s.type === "feeds");
    return src?.feed_ids ?? [];
  };

  const toggleFeedId = (id: number) => {
    const currentSources = def.sources ?? [];
    const feedsSource = currentSources.find((s) => s.type === "feeds");
    let updated;
    if (feedsSource) {
      const feed_ids = feedsSource.feed_ids ?? [];
      const updatedIds = feed_ids.includes(id) ? feed_ids.filter((x) => x !== id) : [...feed_ids, id];
      updated = currentSources.map((s) => s.type === "feeds" ? { ...s, feed_ids: updatedIds } : s);
    } else {
      updated = [...currentSources, { type: "feeds" as const, feed_ids: [id] }];
    }
    set({ sources: updated });
  };

  const getSelectedWebsiteIds = (): number[] => {
    const src = def.sources?.find((s) => s.type === "websites");
    return src?.website_ids ?? [];
  };

  const toggleWebsiteId = (id: number) => {
    const currentSources = def.sources ?? [];
    const webSource = currentSources.find((s) => s.type === "websites");
    let updated;
    if (webSource) {
      const website_ids = webSource.website_ids ?? [];
      const updatedIds = website_ids.includes(id) ? website_ids.filter((x) => x !== id) : [...website_ids, id];
      updated = currentSources.map((s) => s.type === "websites" ? { ...s, website_ids: updatedIds } : s);
    } else {
      updated = [...currentSources, { type: "websites" as const, website_ids: [id] }];
    }
    set({ sources: updated });
  };

  const getSelectedApiSourceIds = (): number[] => {
    const src = def.sources?.find((s) => s.type === "api_sources");
    return src?.api_source_ids ?? [];
  };

  const toggleApiSourceId = (id: number) => {
    const currentSources = def.sources ?? [];
    const apiSource = currentSources.find((s) => s.type === "api_sources");
    let updated;
    if (apiSource) {
      const api_source_ids = apiSource.api_source_ids ?? [];
      const updatedIds = api_source_ids.includes(id) ? api_source_ids.filter((x) => x !== id) : [...api_source_ids, id];
      updated = currentSources.map((s) => s.type === "api_sources" ? { ...s, api_source_ids: updatedIds } : s);
    } else {
      updated = [...currentSources, { type: "api_sources" as const, api_source_ids: [id] }];
    }
    set({ sources: updated });
  };

  const getSelectedSnapshotId = (): number | undefined => {
    return def.sources?.find((s) => s.type === "snapshot")?.snapshot_id;
  };

  const toggleSnapshotId = (id: number) => {
    const currentSources = def.sources ?? [];
    const current = currentSources.find((s) => s.type === "snapshot");
    const rest = currentSources.filter((s) => s.type !== "snapshot");
    if (current?.snapshot_id === id) {
      set({ sources: rest });
    } else {
      set({ sources: [...rest, { type: "snapshot" as const, snapshot_id: id }] });
    }
  };

  const updateTransform = (i: number, patch: any) => {
    const list = def.transforms || [];
    set({
      transforms: list.map((t, idx) => (idx === i ? { ...t, ...patch } : t))
    });
  };

  const removeTransform = (i: number) => {
    set({
      transforms: (def.transforms || []).filter((_, idx) => idx !== i)
    });
  };

  const addTransform = (type: "keyword_filter" | "extract" | "enrich_llm" | "chunk" | "synthesize") => {
    const list = def.transforms || [];
    let newStep: any = { type };
    if (type === "extract") {
      newStep = {
        type,
        role: "article",
        mode: "auto",
        hybrid_llm_fill: false,
        llm: llmFromDef(def),
        prompt: "Extract structured fields from this content.",
      };
    } else if (type === "enrich_llm") {
      newStep = {
        type,
        output_field: "summary",
        llm: llmFromDef(def),
        prompt: "Summarize this article in 2 sentences.",
      };
    } else if (type === "chunk") {
      newStep = {
        type,
        chunk_size: 800,
        chunk_overlap: 120,
        min_words: 0,
        generate_vectors: false,
        split_pipeline_stream: true,
        filter_by_keywords: false,
        provider: "local",
        model: "all-MiniLM-L6-v2",
        endpoint: "",
        api_key: "",
      };
    } else if (type === "keyword_filter") {
      newStep = {
        type,
        keywords_str: "",
        use_saved_keywords: true,
        match_all: false,
      };
    } else if (type === "synthesize") {
      newStep = {
        type,
        llm: llmFromDef(def),
        prompt: "Combine the passage extracts into one structured record for the full article.",
      };
    }
    set({ transforms: [...list, newStep] });
  };

  const chooseSchema = (id: string) => {
    const schema = schemas.find((x) => String(x.id) === id);
    const patch: Partial<PipelineDefinition> = {
      schema_id: id ? Number(id) : undefined,
    };
    if (schema) {
      const fieldsVals = safeJsonParse<Array<{ name: string; type: string; description?: string; required?: boolean }>>(schema.fields, []).map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description || "",
        required: Boolean(f.required),
      }));
      patch.fields = fieldsVals;
      if (!def.output?.mappings?.length) {
        patch.output = {
          type: "duckdb",
          database: def.output?.database ?? "",
          table: def.output?.table ?? "extracted_records",
          mode: def.output?.mode ?? "append",
          mappings: fieldsVals
            .filter((f) => f.name)
            .map((f) => ({ source: f.name, target: f.name, type: duckTypeFromField(f.type) })),
        };
      }
    }
    set(patch);
  };



  const [testing, setTesting] = useState(false);
  const test = async () => {
    if (!def.llm?.endpoint || !def.llm?.model) {
      toast.error("Set endpoint and model first.");
      return;
    }
    setTesting(true);
    try {
      await api.llmTest({
        endpoint: def.llm.endpoint,
        model: def.llm.model,
        api_key: def.llm.api_key || "",
      });
      toast.success("Connection OK.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTesting(false);
    }
  };

  const suggest = async () => {
    const promptFromSteps =
      [...(def.transforms || [])].reverse().find((t: any) => t.type === "synthesize" && t.prompt)?.prompt ||
      [...(def.transforms || [])].reverse().find((t: any) => t.type === "extract" && t.prompt)?.prompt ||
      def.prompt;
    if (!def.llm?.endpoint || !def.llm?.model || !promptFromSteps) {
      toast.error("Set an LLM endpoint/model and a prompt on an extract or article-output step first.");
      return;
    }
    setSuggesting(true);
    try {
      const res = await api.llmSchema({
        endpoint: def.llm.endpoint,
        model: def.llm.model,
        api_key: def.llm.api_key || "",
        prompt: promptFromSteps,
      });
      const propsObj = res.schema.properties || {};
      const fields = Object.entries(propsObj).map(([name, v]: [string, any]) => ({
        name,
        type: v.type || "string",
        description: v.description || "",
        required: (res.schema.required || []).includes(name),
      }));
      set({ fields });
      toast.success(`Added ${fields.length} field(s).`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const addField = () =>
    set({ fields: [...(def.fields || []), { name: "", type: "string", description: "", required: false }] });
  const updateField = (i: number, patch: any) =>
    set({ fields: (def.fields || []).map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const removeField = (i: number) =>
    set({ fields: (def.fields || []).filter((_, idx) => idx !== i) });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8 pb-24">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> All pipelines
        </Button>
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Pipeline name</Label>
                <Input value={def.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. News → DuckDB" />
              </div>
              <div className="space-y-2">
                <Label>Source type</Label>
                <div className="flex flex-wrap gap-1 rounded-lg border bg-muted p-1">
                  {[
                    { type: "feeds", label: "Feeds" },
                    { type: "websites", label: "Websites" },
                    { type: "api_sources", label: "APIs" },
                    { type: "snapshots", label: "Snapshots" },
                  ].map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setActiveSourceTab(opt.type as any)}
                      className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                        activeSourceTab === opt.type
                          ? "bg-background text-foreground shadow-sm animate-fade-in"
                          : "text-muted-foreground hover:bg-background/20 hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {activeSourceTab === "feeds" ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {folders.flatMap((f) =>
                      f.feeds.map((feed) => (
                        <label key={feed.id} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent/40 transition-colors">
                          <Checkbox
                            checked={getSelectedFeedIds().includes(feed.id)}
                            onCheckedChange={() => toggleFeedId(feed.id)}
                          />
                          <span className="flex-1 truncate">{feed.title}</span>
                          <Badge variant="secondary" className="text-[10px] font-normal text-muted-foreground whitespace-nowrap">
                            RSS
                          </Badge>
                        </label>
                      ))
                    )}
                  </div>
                  {folders.every((f) => !f.feeds.length) && (
                    <p className="text-xs text-muted-foreground">
                      No feeds yet.{" "}
                      <Link className="underline" to="/discover">Discover</Link>
                      {" · "}
                      <Link className="underline" to="/sources">Add a feed</Link>
                    </p>
                  )}
                  <div className="space-y-1">
                    <Label>Max articles per feed</Label>
                    <Input
                      type="number"
                      value={def.max_articles ?? 20}
                      onChange={(e) => set({ max_articles: Number(e.target.value) })}
                    />
                  </div>
                </>
              ) : activeSourceTab === "websites" ? (
                <div className="space-y-2">
                  <Label>Website monitors</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {websites.map((site) => {
                      const hasSchema = site.schema_id !== null && site.schema_id !== undefined;
                      const hasPrompt = !!site.prompt;
                      const isTable = site.fetch_options && String(site.fetch_options).includes('"selector"'); // structural
                      const badgeText = hasSchema ? "Design \u2192 rows (no LLM)" : isTable ? "Table \u2192 rows" : "No mapping \u2192 LLM";
                      const badgeVariant = hasSchema ? "default" : "secondary";
                      return (
                        <label key={site.id} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent/40 transition-colors">
                          <Checkbox checked={getSelectedWebsiteIds().includes(site.id)} onCheckedChange={() => toggleWebsiteId(site.id)} />
                          <span className="flex-1 truncate">{site.name}</span>
                          <Badge variant={badgeVariant} className="text-[10px] font-normal whitespace-nowrap">
                            {badgeText}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                  {websites.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No website monitors yet. <Link className="underline" to="/websites">Add a website</Link>
                    </p>
                  )}
                </div>
              ) : activeSourceTab === "api_sources" ? (
                <div className="space-y-2">
                  <Label>API sources</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {apiSources.map((site) => {
                      let hasMapping = false;
                      try {
                        const cfg = JSON.parse(site.extraction_config || "{}");
                        hasMapping = !!(cfg.item_pointer && cfg.fields);
                      } catch {}
                      const badgeText = hasMapping ? "Table \u2192 rows" : "No mapping \u2192 LLM";
                      const badgeVariant = hasMapping ? "default" : "secondary";
                      return (
                        <label key={site.id} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent/40 transition-colors">
                          <Checkbox checked={getSelectedApiSourceIds().includes(site.id)} onCheckedChange={() => toggleApiSourceId(site.id)} />
                          <span className="flex-1 truncate">{site.name}</span>
                          <Badge variant={badgeVariant} className="text-[10px] font-normal whitespace-nowrap">
                            {badgeText}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                  {apiSources.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No API sources yet. <Link className="underline" to="/api-sources">Add an API</Link>
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Captured snapshots</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {snapshots.map((snap) => {
                      const label = (snap.name || snap.source || snap.source_label || `Snapshot ${snap.id}`).trim();
                      return (
                        <label key={snap.id} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-accent/40 transition-colors">
                          <Checkbox
                            checked={getSelectedSnapshotId() === snap.id}
                            onCheckedChange={() => toggleSnapshotId(snap.id)}
                          />
                          <span className="flex-1 truncate">{label}</span>
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {snap.article_count ?? 0}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                  {snapshots.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No snapshots yet. <Link className="underline" to="/snapshots">Capture one</Link>
                      {" or "}
                      <Link className="underline" to="/pipelines?mode=snapshot">create a snapshot job</Link>
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground items-center">
                <span className="font-medium text-foreground">Current Selection:</span>
                <Badge variant={getSelectedFeedIds().length ? "default" : "outline"}>
                  {getSelectedFeedIds().length} Feed{getSelectedFeedIds().length !== 1 ? "s" : ""}
                </Badge>
                <Badge variant={getSelectedWebsiteIds().length ? "default" : "outline"}>
                  {getSelectedWebsiteIds().length} Website{getSelectedWebsiteIds().length !== 1 ? "s" : ""}
                </Badge>
                <Badge variant={getSelectedApiSourceIds().length ? "default" : "outline"}>
                  {getSelectedApiSourceIds().length} API{getSelectedApiSourceIds().length !== 1 ? "s" : ""}
                </Badge>
                <Badge variant={getSelectedSnapshotId() ? "default" : "outline"}>
                  {getSelectedSnapshotId() ? "1 Snapshot" : "0 Snapshots"}
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Published from</Label>
                  <Input type="date" value={def.date_filter?.from ?? ""} onChange={(e) => set({ date_filter: { ...def.date_filter!, from: e.target.value, enabled: !!(e.target.value || def.date_filter?.to) } })} />
                </div>
                <div className="space-y-1">
                  <Label>Published to</Label>
                  <Input type="date" value={def.date_filter?.to ?? ""} onChange={(e) => set({ date_filter: { ...def.date_filter!, to: e.target.value, enabled: !!(def.date_filter?.from || e.target.value) } })} />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 text-sm">
              <div>
                <Label className="text-base font-semibold text-foreground">How to download each page</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  HTTP fetch is the default. Turn on the browser only for pages that need JavaScript. Firecrawl is optional if you already use it.
                </p>
              </div>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                <Checkbox className="mt-0.5" checked={!!def.use_browser} onCheckedChange={(c) => set({ use_browser: c === true })} />
                <span>
                  <span className="block text-foreground">Use headless browser (Playwright)</span>
                  <span className="text-xs text-muted-foreground">Slower. Use for JS-heavy sites. Falls back to HTTP if Playwright is unavailable.</span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Fetch source</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={def.fetch_source ?? "builtin"}
                    onChange={(e) => set({ fetch_source: e.target.value })}
                  >
                    <option value="builtin">Built-in (Trafilatura)</option>
                    <option value="firecrawl">Firecrawl</option>
                  </select>
                </div>
                {def.fetch_source === "firecrawl" && (
                  <>
                    <div className="space-y-1">
                      <Label>Firecrawl API key</Label>
                      <Input
                        value={def.firecrawl_api_key ?? ""}
                        onChange={(e) => set({ firecrawl_api_key: e.target.value })}
                        placeholder="fc-…"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Base URL (self-hosted)</Label>
                      <Input
                        value={def.firecrawl_base_url ?? "https://api.firecrawl.dev"}
                        onChange={(e) => set({ firecrawl_base_url: e.target.value })}
                        placeholder="https://api.firecrawl.dev"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Max retries</Label>
                  <Input type="number" min={0} value={def.retries ?? 0} onChange={(e) => set({ retries: Math.max(0, Number(e.target.value)) })} />
                </div>
                <div className="space-y-1">
                  <Label>Concurrency</Label>
                  <Input type="number" min={1} value={def.concurrency ?? 1} onChange={(e) => set({ concurrency: Math.max(1, Number(e.target.value)) })} />
                </div>
                <div className="space-y-1">
                  <Label>Timeout (s)</Label>
                  <Input type="number" min={1} value={def.timeout ?? 60} onChange={(e) => set({ timeout: Math.max(1, Number(e.target.value)) })} />
                </div>
              </div>
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer">
                <Checkbox checked={!!def.dedup} onCheckedChange={(c) => set({ dedup: c === true })} />
                Deduplicate articles (skip repeats by URL/content)
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              {showLlmGap && (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm">LLM endpoint and model are not set. Extraction steps that call the model will fail.</p>
                  <Link to="/settings" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
                    <Settings className="h-3.5 w-3.5" /> Open Settings
                  </Link>
                </div>
              )}
              <div>
                <Label className="text-base font-bold text-foreground">How the article is processed</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Long pages are fetched, split into chunks, filtered by keywords, extracted with a per-chunk prompt, then combined with a different article prompt.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => set({ transforms: longDocumentTransforms(def) })}>
                    Long document recipe
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => set({ transforms: simpleArticleTransforms(def) })}>
                    One LLM call per article
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                {(def.transforms || []).map((t: any, i: number) => (
                  <div key={i} className="rounded-lg border bg-card p-4 shadow-sm relative space-y-4 border-l-4 border-l-primary">
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="text-[10px] font-semibold uppercase">
                          Step {i + 1}
                        </Badge>
                        <span className="font-semibold text-sm">
                          {t.label
                            || (t.type === "keyword_filter"
                            ? "Keyword filter"
                            : t.type === "extract" && t.role === "chunk"
                            ? "Per-chunk extract"
                            : t.type === "extract" && t.role === "fetch"
                            ? "Fetch full article"
                            : t.type === "extract"
                            ? "Extract"
                            : t.type === "enrich_llm"
                            ? "AI enrichment"
                            : t.type === "synthesize"
                            ? "Article output"
                            : "Chunk")}
                        </span>
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeTransform(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Step Fields configurations */}
                    {t.type === "keyword_filter" && (
                      <div className="space-y-3 text-sm">
                        <p className="text-xs text-muted-foreground">
                          Keep only chunks (or articles) that mention these terms. Saved keywords from the Keywords page can be included automatically.
                        </p>
                        <div className="space-y-1">
                          <Label className="text-xs">Extra keywords (comma-separated)</Label>
                          <Input
                            placeholder="e.g. acquisitions, AI, deal"
                            value={t.keywords_str ?? ""}
                            onChange={(e) => updateTransform(i, { keywords_str: e.target.value })}
                          />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                          <Checkbox
                            checked={t.use_saved_keywords !== false}
                            onCheckedChange={(c) => updateTransform(i, { use_saved_keywords: c === true })}
                          />
                          Use saved keywords{keywords.length ? ` (${keywords.length})` : ""}
                        </label>
                        {keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {keywords.slice(0, 12).map((kw) => (
                              <Badge key={kw.id} variant="secondary" className="text-[10px] font-normal">{kw.word}</Badge>
                            ))}
                          </div>
                        )}
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                          <Checkbox
                            checked={!!t.match_all}
                            onCheckedChange={(c) => updateTransform(i, { match_all: c === true })}
                          />
                          Match ALL keywords (AND) instead of ANY (OR)
                        </label>
                      </div>
                    )}

                    {t.type === "extract" && (
                      <div className="space-y-3">
                        {t.role === "fetch" ? (
                          <p className="text-xs text-muted-foreground">
                            Download and clean the full article or page. No LLM yet — chunking and prompts run after this.
                          </p>
                        ) : t.role === "chunk" ? (
                          <p className="text-xs text-muted-foreground">
                            This prompt runs once per remaining chunk. Use a different prompt in the Article output step.
                          </p>
                        ) : null}
                        {t.role !== "fetch" && (
                          <>
                        <div className="space-y-1">
                          <Label className="text-xs">Extraction Mode</Label>
                          <select
                            className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-medium"
                            value={t.mode ?? "auto"}
                            onChange={(e) => updateTransform(i, { mode: e.target.value })}
                          >
                            <option value="auto">Auto (mapped if exists, else LLM/raw)</option>
                            <option value="mapped">Mapped (strict, LLM-free)</option>
                            <option value="llm">LLM (force LLM extraction)</option>
                            <option value="raw">Raw (clean body text)</option>
                          </select>
                        </div>

                        {t.mode === "auto" && (
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                            <Checkbox
                              checked={!!t.hybrid_llm_fill}
                              onCheckedChange={(c) => updateTransform(i, { hybrid_llm_fill: c === true })}
                            />
                            Hybrid mode: Fill missing required fields with LLM
                          </label>
                        )}

                        {(t.mode === "llm" || t.mode === "auto") && (
                          <div className="rounded border bg-muted/30 p-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-semibold">{t.role === "chunk" ? "Per-chunk prompt" : "LLM extraction"}</Label>
                              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                                <Checkbox
                                  checked={!!t.llm?.enabled}
                                  onCheckedChange={(c) => updateTransform(i, { llm: { ...t.llm, enabled: c === true } })}
                                />
                                Enable LLM
                              </label>
                            </div>

                            {t.llm?.enabled && (
                              <div className="space-y-2">
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">API configuration</Label>
                                    <select
                                      className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                                      value={t.api_config_id ?? ""}
                                      onChange={(e) => {
                                        const id = e.target.value ? Number(e.target.value) : undefined;
                                        const cfg = apiConfigs.find((c) => c.id === id);
                                        updateTransform(i, {
                                          api_config_id: id,
                                          llm: cfg
                                            ? { ...t.llm, endpoint: cfg.endpoint, model: cfg.model }
                                            : t.llm,
                                        });
                                      }}
                                    >
                                      <option value="">Custom / inline</option>
                                      {apiConfigs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Prompt template</Label>
                                    <select
                                      className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                                      value={t.prompt_id ?? ""}
                                      onChange={(e) => {
                                        const id = e.target.value ? Number(e.target.value) : undefined;
                                        const p = prompts.find((x) => x.id === id);
                                        updateTransform(i, { prompt_id: id, prompt: p ? p.extraction_prompt : t.prompt });
                                      }}
                                    >
                                      <option value="">None</option>
                                      {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px]">Endpoint</Label>
                                  <Input className="h-8 text-xs" value={t.llm?.endpoint ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, endpoint: e.target.value } })} placeholder="https://api.openai.com/v1/chat/completions" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px]">Model</Label>
                                  <Input className="h-8 text-xs" value={t.llm?.model ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, model: e.target.value } })} placeholder="gpt-4o-mini" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px]">API key (never stored)</Label>
                                  <Input type="password" className="h-8 text-xs" value={t.llm?.api_key ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, api_key: e.target.value } })} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px]">{t.role === "chunk" ? "Per-chunk prompt" : "Prompt"}</Label>
                                  <Textarea rows={3} className="text-xs" value={t.prompt ?? ""} onChange={(e) => updateTransform(i, { prompt: e.target.value })} placeholder="Extract structured fields." />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                          </>
                        )}
                      </div>
                    )}

                    {t.type === "enrich_llm" && (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Output field name</Label>
                            <Input
                              placeholder="e.g. sentiment, summary"
                              value={t.output_field ?? ""}
                              onChange={(e) => updateTransform(i, { output_field: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">API configuration</Label>
                            <select
                              className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-medium"
                              value={t.api_config_id ?? ""}
                              onChange={(e) => {
                                const id = e.target.value ? Number(e.target.value) : undefined;
                                const cfg = apiConfigs.find((c) => c.id === id);
                                updateTransform(i, {
                                  api_config_id: id,
                                  llm: cfg
                                    ? { ...t.llm, endpoint: cfg.endpoint, model: cfg.model }
                                    : t.llm,
                                });
                              }}
                            >
                              <option value="">Custom / inline</option>
                              {apiConfigs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Endpoint</Label>
                          <Input className="h-8 text-xs" value={t.llm?.endpoint ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, endpoint: e.target.value } })} placeholder="https://api.openai.com/v1/chat/completions" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Model</Label>
                          <Input className="h-8 text-xs" value={t.llm?.model ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, model: e.target.value } })} placeholder="gpt-4o-mini" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">API key (never stored)</Label>
                          <Input type="password" className="h-8 text-xs" value={t.llm?.api_key ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, api_key: e.target.value } })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Prompt instructions</Label>
                          <Textarea rows={3} className="text-xs" value={t.prompt ?? ""} onChange={(e) => updateTransform(i, { prompt: e.target.value })} placeholder="Analyze and output sentiment." />
                        </div>
                      </div>
                    )}

                    {t.type === "synthesize" && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          After every chunk has been extracted, this prompt sees all passage JSON for one article and writes the final record. It is a different prompt from the per-chunk step.
                        </p>
                        <div className="space-y-1">
                          <Label className="text-xs">API configuration</Label>
                          <select
                            className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-medium"
                            value={t.api_config_id ?? ""}
                            onChange={(e) => {
                              const id = e.target.value ? Number(e.target.value) : undefined;
                              const cfg = apiConfigs.find((c) => c.id === id);
                              updateTransform(i, {
                                api_config_id: id,
                                llm: cfg ? { ...t.llm, enabled: true, endpoint: cfg.endpoint, model: cfg.model } : t.llm,
                              });
                            }}
                          >
                            <option value="">Custom / inline</option>
                            {apiConfigs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Endpoint</Label>
                          <Input className="h-8 text-xs" value={t.llm?.endpoint ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, enabled: true, endpoint: e.target.value } })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Model</Label>
                          <Input className="h-8 text-xs" value={t.llm?.model ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, enabled: true, model: e.target.value } })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">API key (never stored)</Label>
                          <Input type="password" className="h-8 text-xs" value={t.llm?.api_key ?? ""} onChange={(e) => updateTransform(i, { llm: { ...t.llm, enabled: true, api_key: e.target.value } })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Article output prompt</Label>
                          <Textarea rows={4} className="text-xs" value={t.prompt ?? ""} onChange={(e) => updateTransform(i, { prompt: e.target.value })} placeholder="Combine passage extracts into one record." />
                        </div>
                      </div>
                    )}

                    {t.type === "chunk" && (
                      <div className="space-y-3">
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                            <Checkbox
                              checked={!!t.generate_vectors}
                              onCheckedChange={(c) => updateTransform(i, { generate_vectors: c === true })}
                            />
                            Generate vector embeddings (enables semantic search). Pick a real model — hash vectors are only a fallback.
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                            <Checkbox
                              checked={t.split_pipeline_stream !== false}
                              onCheckedChange={(c) => updateTransform(i, { split_pipeline_stream: c === true })}
                            />
                            Split into chunks for the next steps (required for keyword filter + per-chunk extract)
                          </label>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-4">
                          <div className="space-y-1">
                            <Label className="text-[10px]">Chunk size</Label>
                            <Input
                              type="number"
                              className="h-8 text-xs"
                              value={t.chunk_size ?? 800}
                              onChange={(e) => updateTransform(i, { chunk_size: Number(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">Overlap</Label>
                            <Input
                              type="number"
                              className="h-8 text-xs"
                              value={t.chunk_overlap ?? 120}
                              onChange={(e) => updateTransform(i, { chunk_overlap: Number(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">Min words</Label>
                            <Input
                              type="number"
                              className="h-8 text-xs"
                              value={t.min_words ?? 0}
                              onChange={(e) => updateTransform(i, { min_words: Number(e.target.value) })}
                            />
                          </div>
                          <div className="flex items-center gap-2 pt-4">
                            <Checkbox
                              checked={!!t.filter_by_keywords}
                              onCheckedChange={(c) => updateTransform(i, { filter_by_keywords: c === true })}
                            />
                            <Label className="text-[10px] text-muted-foreground">Drop chunks that miss saved keywords</Label>
                          </div>
                        </div>

                        {t.generate_vectors && (
                          <EmbeddingModelFields
                            compact
                            provider={t.provider ?? "local"}
                            model={t.model ?? "local-hash"}
                            endpoint={t.endpoint ?? ""}
                            apiKey={t.api_key ?? ""}
                            onChange={(patch) => updateTransform(i, patch)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Transform selector */}
              <div className="flex gap-2 items-center bg-muted/30 p-4 rounded-lg border">
                <Label className="text-xs font-semibold whitespace-nowrap">Add new transformation:</Label>
                <div className="flex gap-2 w-full max-w-sm">
                  <select
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs font-semibold"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        addTransform(e.target.value as any);
                        e.target.value = "";
                      }
                    }}
                  >
                    <option value="" disabled>Select transform type...</option>
                    <option value="extract">Fetch or extract</option>
                    <option value="chunk">Chunk long article</option>
                    <option value="keyword_filter">Keyword filter</option>
                    <option value="synthesize">Article output (combine chunks)</option>
                    <option value="enrich_llm">AI enrichment</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                This schema is the final article record (after synthesis). Per-chunk extracts can be looser JSON; the article prompt should fill these fields.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Saved schema</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={def.schema_id ?? ""}
                    onChange={(e) => chooseSchema(e.target.value)}
                  >
                    <option value="">Custom fields</option>
                    {schemas.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {schemas.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      None yet. <Link className="underline" to="/schemas">Create a schema</Link>
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Saved prompt (fills extract steps)</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={def.prompt_id ?? ""}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : undefined;
                      const p = prompts.find((x) => x.id === id);
                      const list = (def.transforms || []).map((t: any) => {
                        if (t.type === "extract" && t.role !== "fetch") {
                          return { ...t, prompt_id: id, prompt: p ? p.extraction_prompt : t.prompt };
                        }
                        if (t.type === "synthesize" && p) {
                          return { ...t, prompt: p.extraction_prompt };
                        }
                        return t;
                      });
                      set({ prompt_id: id, prompt: p?.extraction_prompt ?? def.prompt, transforms: list });
                    }}
                  >
                    <option value="">None</option>
                    {prompts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {prompts.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Optional. <Link className="underline" to="/prompts">Save a prompt</Link>
                    </p>
                  )}
                </div>
              </div>
              {(def.fields || []).map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_1fr_1fr_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={f.type} onValueChange={(v) => updateField(i, { type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Input value={f.description} onChange={(e) => updateField(i, { description: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Default</Label>
                    <Input value={f.default ?? ""} onChange={(e) => updateField(i, { default: e.target.value })} placeholder="Used if missing" />
                  </div>
                  <div className="flex items-center gap-2 pb-1">
                    <Checkbox checked={f.required} onCheckedChange={(c) => updateField(i, { required: c === true })} />
                    <Label className="text-xs">req</Label>
                    <Button size="icon" variant="ghost" onClick={() => removeField(i)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={addField}><Plus className="mr-1 h-4 w-4" /> Add field</Button>
                <Button variant="outline" onClick={suggest} disabled={suggesting}>
                  {suggesting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />} Suggest from prompt
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Where records go</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={def.output?.type ?? "duckdb"}
                  onChange={(e) => set({ output: { ...def.output!, type: e.target.value } })}
                >
                  <option value="duckdb">DuckDB table</option>
                  <option value="csv">CSV file</option>
                  <option value="sqlite">SQLite file</option>
                </select>
              </div>

              {(def.output?.type === "csv" || def.output?.type === "sqlite") && (
                <div className="space-y-1">
                  <Label>File path</Label>
                  <Input
                    value={def.output?.path ?? ""}
                    onChange={(e) => set({ output: { ...def.output!, path: e.target.value } })}
                    placeholder={def.output?.type === "csv" ? "~/autofeeder-output.csv" : "~/autofeeder-output.sqlite3"}
                  />
                </div>
              )}

              {(def.output?.type ?? "duckdb") === "duckdb" && (
              <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>DuckDB database</Label>
                    <Input
                      list="duckdb-list"
                      value={def.output?.database ?? ""}
                      onChange={(e) => set({ output: { ...def.output!, database: e.target.value } })}
                      placeholder="news.duckdb"
                    />
                    <datalist id="duckdb-list">
                      {duckDbs.map((d) => <option key={d.id} value={d.path} />)}
                    </datalist>
                  </div>
                  <div className="space-y-1">
                    <Label>Table name</Label>
                    <Input value={def.output?.table ?? "extracted_records"} onChange={(e) => set({ output: { ...def.output!, table: e.target.value } })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Write mode</Label>
                      <Select value={def.output?.mode ?? "append"} onValueChange={(v) => set({ output: { ...def.output!, mode: v } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="append">Append</SelectItem>
                          <SelectItem value="overwrite">Overwrite</SelectItem>
                          <SelectItem value="upsert">Upsert (dedupe)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Dedupe key (source field)</Label>
                      <Input value={def.output?.dedupe_key ?? ""} onChange={(e) => set({ output: { ...def.output!, dedupe_key: e.target.value } })} placeholder="url" />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label>DuckDB column schema (source field → column + type)</Label>
                      <Button variant="outline" size="sm" onClick={() => set({ output: { ...def.output!, mappings: (def.fields || []).filter((f) => f.name.trim()).map((f) => ({ source: f.name, target: f.name, type: duckTypeFromField(f.type) })) } })}>
                        Generate from schema
                      </Button>
                    </div>
                    {(def.output?.mappings || []).map((m, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_140px_auto] items-end gap-2">
                        <Input value={m.source} onChange={(e) => { const n = [...(def.output?.mappings || [])]; n[i] = { ...n[i], source: e.target.value }; set({ output: { ...def.output!, mappings: n } }); }} placeholder="source field" />
                        <Input value={m.target} onChange={(e) => { const n = [...(def.output?.mappings || [])]; n[i] = { ...n[i], target: e.target.value }; set({ output: { ...def.output!, mappings: n } }); }} placeholder="column" />
                        <select className="rounded-md border bg-background px-2 py-2 text-sm" value={m.type ?? "VARCHAR"} onChange={(e) => { const n = [...(def.output?.mappings || [])]; n[i] = { ...n[i], type: e.target.value }; set({ output: { ...def.output!, mappings: n } }); }}>
                          {DUCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Button size="icon" variant="ghost" onClick={() => set({ output: { ...def.output!, mappings: (def.output?.mappings || []).filter((_, idx) => idx !== i) } })}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => set({ output: { ...def.output!, mappings: [...(def.output?.mappings || []), { source: "", target: "", type: "VARCHAR" }] } })}>
                      <Plus className="mr-1 h-4 w-4" /> Add column
                    </Button>
                    <CreateTableButton
                      database={def.output?.database ?? ""}
                      table={def.output?.table ?? ""}
                      mappings={def.output?.mappings || []}
                    />
                    <p className="text-xs text-muted-foreground">RSS metadata (url, source, author, published, categories) and run info are stored automatically as extra columns.</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label>Publish after this run</Label>
                      <Link className="text-xs underline text-muted-foreground" to="/exports">Manage on Exports</Link>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Live RSS/JSON from this DuckDB table. Create endpoints on Exports, then attach them here.</p>
                    {channels.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        None yet.{" "}
                        <Link className="underline" to="/exports?tab=publish">
                          Create a publish endpoint
                        </Link>
                        , then attach it here.
                      </p>
                    )}
                    {channels.map((ch) => {
                      const ids = def.output?.publish_channel_ids || [];
                      const on = ids.includes(ch.id);
                      return (
                        <label key={ch.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={on}
                            onCheckedChange={() =>
                              set({
                                output: {
                                  ...def.output!,
                                  publish_channel_ids: on ? ids.filter((x) => x !== ch.id) : [...ids, ch.id],
                                },
                              })
                            }
                          />
                          <span className="truncate">{ch.name} · {ch.kind} · {ch.table}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label>Upsert sync after this run</Label>
                      <Link className="text-xs underline text-muted-foreground" to="/exports">Manage on Exports</Link>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Runs selected sync targets after rows are written.</p>
                    {syncTargets.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        None yet.{" "}
                        <Link className="underline" to="/exports?tab=sync">
                          Create a sync target
                        </Link>
                        , then attach it here.
                      </p>
                    )}
                    {syncTargets.map((t) => {
                      const ids = def.output?.sync_target_ids || [];
                      const on = ids.includes(t.id);
                      return (
                        <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={on}
                            onCheckedChange={() =>
                              set({
                                output: {
                                  ...def.output!,
                                  sync_target_ids: on ? ids.filter((x) => x !== t.id) : [...ids, t.id],
                                },
                              })
                            }
                          />
                          <span className="truncate">{t.name} · {t.kind}</span>
                        </label>
                      );
                    })}
                  </div>
              </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Pipeline name</Label>
                <Input value={def.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="My pipeline" />
              </div>
              {issues.length > 0 && (
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <div className="text-sm font-medium">Before you run</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {issues.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  {showLlmGap && (
                    <Link to="/settings" className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
                      <Settings className="h-3.5 w-3.5" /> Open Settings
                    </Link>
                  )}
                </div>
              )}
              <dl className="grid grid-cols-3 gap-2 rounded-lg border p-4 text-sm">
                <dt className="text-muted-foreground">Sources</dt>
                <dd className="col-span-2">
                  {getSelectedFeedIds().length ? `${getSelectedFeedIds().length} feeds` : ""}
                  {getSelectedFeedIds().length && (getSelectedWebsiteIds().length || getSelectedApiSourceIds().length || getSelectedSnapshotId()) ? " · " : ""}
                  {getSelectedWebsiteIds().length ? `${getSelectedWebsiteIds().length} websites` : ""}
                  {getSelectedWebsiteIds().length && (getSelectedApiSourceIds().length || getSelectedSnapshotId()) ? " · " : ""}
                  {getSelectedApiSourceIds().length ? `${getSelectedApiSourceIds().length} APIs` : ""}
                  {getSelectedApiSourceIds().length && getSelectedSnapshotId() ? " · " : ""}
                  {getSelectedSnapshotId() ? "1 snapshot" : ""}
                  {!hasSources(def) ? "None selected" : ""}
                </dd>
                <dt className="text-muted-foreground">Process</dt>
                <dd className="col-span-2">{(def.transforms || []).length} step(s){usesLlm(def) ? (llmReady ? " · LLM ready" : " · LLM missing") : " · no LLM"}</dd>
                <dt className="text-muted-foreground">Fields</dt>
                <dd className="col-span-2">{(def.fields || []).filter((f) => f.name?.trim()).length || "None"}</dd>
                <dt className="text-muted-foreground">Output</dt>
                <dd className="col-span-2">{outputLabel(def)}</dd>
                <dt className="text-muted-foreground">Publish</dt>
                <dd className="col-span-2">
                  {(def.output?.publish_channel_ids || []).length
                    ? `${(def.output?.publish_channel_ids || []).length} channel(s)`
                    : "None attached — create on Exports, then attach on Output"}
                </dd>
                <dt className="text-muted-foreground">Sync</dt>
                <dd className="col-span-2">
                  {(def.output?.sync_target_ids || []).length
                    ? `${(def.output?.sync_target_ids || []).length} target(s)`
                    : "None attached"}
                </dd>
                <dt className="text-muted-foreground">Schedule</dt>
                <dd className="col-span-2">{scheduleLabel(def) || "Manual only"}</dd>
              </dl>
              <div className="rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={!!def.schedule?.enabled} onCheckedChange={(c) => set({ schedule: { ...def.schedule!, enabled: c === true } })} />
                  Schedule automatic runs
                </label>
                {def.schedule?.enabled && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Schedule type</Label>
                      <Select value={def.schedule?.kind ?? "interval"} onValueChange={(v) => set({ schedule: { ...def.schedule!, kind: v as "interval" | "daily" } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="interval">Every N minutes</SelectItem>
                          <SelectItem value="daily">Daily at time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {def.schedule?.kind === "daily" ? (
                      <div className="space-y-1">
                        <Label>Time (HH:MM)</Label>
                        <Input type="time" value={def.schedule?.time ?? "09:00"} onChange={(e) => set({ schedule: { ...def.schedule!, time: e.target.value } })} />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label>Every (minutes)</Label>
                        <Input type="number" min={1} value={def.schedule?.minutes ?? 60} onChange={(e) => set({ schedule: { ...def.schedule!, minutes: Math.max(1, Number(e.target.value)) } })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={!!def.snapshot?.enabled} onCheckedChange={(c) => set({ snapshot: { ...def.snapshot!, enabled: c === true } })} />
                  Also capture periodic snapshots (no LLM required)
                </label>
                {def.snapshot?.enabled && (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Snapshot schedule</Label>
                        <Select value={def.snapshot?.kind ?? "interval"} onValueChange={(v) => set({ snapshot: { ...def.snapshot!, kind: v as "interval" | "daily" } })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="interval">Every N minutes</SelectItem>
                            <SelectItem value="daily">Daily at time</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {def.snapshot?.kind === "daily" ? (
                        <div className="space-y-1">
                          <Label>Time (HH:MM)</Label>
                          <Input type="time" value={def.snapshot?.time ?? "09:00"} onChange={(e) => set({ snapshot: { ...def.snapshot!, time: e.target.value } })} />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Label>Every (minutes)</Label>
                          <Input type="number" min={1} value={def.snapshot?.minutes ?? 60} onChange={(e) => set({ snapshot: { ...def.snapshot!, minutes: Math.max(1, Number(e.target.value)) } })} />
                        </div>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Store snapshot in DuckDB</Label>
                        <Input list="duckdb-list" value={def.snapshot?.dest?.database ?? ""} onChange={(e) => set({ snapshot: { ...def.snapshot!, dest: { database: e.target.value, table: def.snapshot?.dest?.table ?? "snapshot_articles", dedupe_key: "url" } } })} placeholder="news.duckdb" />
                      </div>
                      <div className="space-y-1">
                        <Label>Snapshot table</Label>
                        <Input value={def.snapshot?.dest?.table ?? "snapshot_articles"} onChange={(e) => set({ snapshot: { ...def.snapshot!, dest: { database: def.snapshot?.dest?.database ?? "", table: e.target.value, dedupe_key: def.snapshot?.dest?.dedupe_key ?? "url" } } })} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!def.run_on_change} onCheckedChange={(c) => set({ run_on_change: c === true })} />
                Run immediately after saving
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Previous
        </Button>
        {step < 5 ? (
          <Button onClick={goNext}>
            Next <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onSave()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Save
            </Button>
            <Button variant="outline" onClick={() => onRun(true)} disabled={busy}>
              <Eye className="mr-1 h-4 w-4" /> Preview
            </Button>
            <Button onClick={() => onRun(false)} disabled={busy}>
              <Play className="mr-1 h-4 w-4" /> Run
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
