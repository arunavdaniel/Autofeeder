import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { loadLLM, saveLLM } from "@/lib/llm-settings";
import { safeJsonParse } from "@/lib/json";
import type { Folder, Pipeline, PipelineDefinition, Snapshot, ApiConfig, PromptTemplate, SchemaDef, DuckDBDatabase, Website, ApiSource, SavedMapping } from "@/lib/types";
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
} from "lucide-react";
import { toast } from "sonner";

const STEPS = ["Source", "Fetch Settings", "Transforms", "Schema", "Output", "Review"];
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

function emptyDef(): PipelineDefinition {
  const s = loadLLM();
  return {
    sources: [],
    transforms: [],
    date_filter: { enabled: false, from: "", to: "" },
    max_articles: 20,
    use_browser: true,
    extraction_mode: "auto",
    hybrid_llm_fill: false,
    llm: {
      enabled: true,
      endpoint: s.endpoint || "https://api.openai.com/v1/chat/completions",
      model: s.model,
      api_key: s.api_key,
    },
    prompt: s.prompt,
    fields: [],
    output: { type: "duckdb", database: "", table: "extracted_records", mode: "append", mappings: [] },
    run_on_change: false,
    retries: 0,
    concurrency: 1,
    timeout: 60,
    dedup: true,
    change_detection: false,
    embeddings: { enabled: false, provider: "local", model: "local-hash", chunk_size: 800, chunk_overlap: 120, strategy: "paragraph", top_k: 5, min_words: 0, filter_by_keywords: false, generate_vectors: false },
    schedule: { enabled: false, kind: "interval", minutes: 60 },
  };
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
  const [mappings, setMappings] = useState<SavedMapping[]>([]);
  const [busy, setBusy] = useState(false);

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
    api.mappings().then(setMappings).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const def = editing || emptyDef();
  const set = (patch: Partial<PipelineDefinition>) => setEditing({ ...def, ...patch });

  const startNew = () => {
    setEditing(emptyDef());
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
  useEffect(() => {
    if (!editing && (folderParam || snapshotParam) && folders.length) {
      const d = emptyDef();
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
        d.name = s ? `Pipeline on ${s.name}` : "Pipeline on snapshot";
      }
      setEditing(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, snapshots, folderParam, snapshotParam]);

  const [activeSourceTab, setActiveSourceTab] = useState<"feeds" | "websites" | "api_sources">("feeds");

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
      updated = [...currentSources, { type: "feeds", feed_ids: [id] }];
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
      updated = [...currentSources, { type: "websites", website_ids: [id] }];
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
      updated = [...currentSources, { type: "api_sources", api_source_ids: [id] }];
    }
    set({ sources: updated });
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

  const addTransform = (type: "keyword_filter" | "extract" | "enrich_llm" | "chunk") => {
    const list = def.transforms || [];
    let newStep: any = { type };
    if (type === "extract") {
      newStep = {
        type,
        mode: "auto",
        hybrid_llm_fill: false,
        llm: { enabled: true, endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
        prompt: "Extract structured fields from this content.",
      };
    } else if (type === "enrich_llm") {
      newStep = {
        type,
        output_field: "summary",
        llm: { enabled: true, endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
        prompt: "Summarize this article in 2 sentences.",
      };
    } else if (type === "chunk") {
      newStep = {
        type,
        chunk_size: 800,
        chunk_overlap: 120,
        min_words: 0,
        generate_vectors: false,
        provider: "local",
        model: "local-hash",
      };
    } else if (type === "keyword_filter") {
      newStep = {
        type,
        keywords_str: "",
        match_all: false,
      };
    }
    set({ transforms: [...list, newStep] });
  };

  const save = async (): Promise<number | null> => {
    if (!def.name?.trim()) {
      toast.error("Set a pipeline name in the Review step.");
      setStep(5);
      return null;
    }
    setBusy(true);
    try {
      const res = await api.savePipeline(def.name.trim(), def);
      saveLLM({
        endpoint: def.llm?.endpoint ?? "",
        model: def.llm?.model ?? "",
        api_key: def.llm?.api_key ?? "",
        prompt: def.prompt ?? "",
        firecrawl_api_key: loadLLM().firecrawl_api_key,
        firecrawl_base_url: def.firecrawl_base_url ?? loadLLM().firecrawl_base_url,
      });
      toast.success("Pipeline saved.");
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
        mappings={mappings}
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
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipelines</h1>
          <p className="text-sm text-muted-foreground">Build workflows that turn feed articles into records.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={startNew}>
            <Plus className="mr-1 h-4 w-4" /> New pipeline
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {pipelines.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No pipelines yet. Create one to get started.
            </CardContent>
          </Card>
        )}
        {pipelines.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(p.definition.feed_ids?.length ?? 0)} sources · DuckDB output
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => api.runPipeline(p.id, false).then((r) => navigate(`/runs?id=${r.run_id}`)).catch((e) => toast.error(String(e)))}>
                <Play className="mr-1 h-3.5 w-3.5" /> Run
              </Button>
              <Button size="sm" variant="outline" onClick={() => api.runPipeline(p.id, true).then((r) => navigate(`/runs?id=${r.run_id}`)).catch((e) => toast.error(String(e)))}>
                <Eye className="mr-1 h-3.5 w-3.5" /> Preview
              </Button>
              <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => del(p.id)}>
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
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
  mappings: SavedMapping[];
  busy: boolean;
  onBack: () => void;
  onSave: () => Promise<number | null>;
  onRun: (preview: boolean) => void;
}) {
  const { def, set, step, setStep, folders, snapshots, apiConfigs, prompts, schemas, duckDbs, websites, apiSources, mappings, busy, onBack, onSave, onRun } = props;
  const sourceType = def.source?.type ?? "feeds";
  const [suggesting, setSuggesting] = useState(false);

  const toggleFeed = (id: number, on: boolean) => {
    const cur = def.source?.feed_ids ?? [];
    const next = on ? [...cur, id] : cur.filter((x) => x !== id);
    set({ source: { ...def.source!, feed_ids: next }, feed_ids: next });
  };

  const setSourceType = (t: "feeds" | "snapshot" | "websites" | "api" | "api_sources") =>
    set({ source: { ...def.source!, type: t } });

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

  const applySavedMapping = (id: string) => {
    const m = mappings.find((x) => String(x.id) === id);
    if (!m) return;
    set({
      schema_id: m.schema_id ?? def.schema_id,
      output: {
        type: "duckdb",
        database: m.database ?? def.output?.database ?? "",
        table: m.table ?? def.output?.table ?? "extracted_records",
        mode: def.output?.mode ?? "append",
        mappings: m.columns.map((c) => ({ source: c.source, target: c.target, type: c.type || "VARCHAR" })),
      },
    });
    toast.success(`Loaded mapping "${m.name}" into output`);
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
    if (!def.llm?.endpoint || !def.llm?.model || !def.prompt) {
      toast.error("Set endpoint, model and prompt first.");
      return;
    }
    setSuggesting(true);
    try {
      const res = await api.llmSchema({
        endpoint: def.llm.endpoint,
        model: def.llm.model,
        api_key: def.llm.api_key || "",
        prompt: def.prompt,
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
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
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
              <div className="space-y-2">
                <Label>Source type</Label>
                <div className="flex gap-1 rounded-lg border bg-muted p-1">
                  {[
                    { type: "feeds", label: "Live RSS Feeds" },
                    { type: "websites", label: "Website Monitors" },
                    { type: "api_sources", label: "API Sources" },
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
                            No mapping &rarr; LLM
                          </Badge>
                        </label>
                      ))
                    )}
                  </div>
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
                  {websites.length === 0 && <p className="text-xs text-muted-foreground">Add a website monitor first.</p>}
                </div>
              ) : (
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
                  {apiSources.length === 0 && <p className="text-xs text-muted-foreground">Add an API source first.</p>}
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
                  {getSelectedApiSourceIds().length} API Source{getSelectedApiSourceIds().length !== 1 ? "s" : ""}
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
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Autofeeder renders each article with a headless browser (Playwright) and falls back to a fast HTTP fetch when a browser engine is unavailable.</p>
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer">
                <Checkbox checked={!!def.use_browser} onCheckedChange={(c) => set({ use_browser: c === true })} />
                Use headless browser for JavaScript-heavy pages
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
              <div>
                <Label className="text-base font-bold text-foreground">Sequential Transformations</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure chainable transform steps that process your fetched data sequentially before writing to the database.
                </p>
              </div>

              <div className="space-y-4">
                {(def.transforms || []).map((t: any, i: number) => (
                  <div key={i} className="rounded-lg border bg-card p-4 shadow-sm relative space-y-4 border-l-4 border-l-primary">
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="text-[10px] font-semibold uppercase">
                          Step {i + 1}
                        </Badge>
                        <span className="font-semibold text-sm capitalize">
                          {t.type === "keyword_filter"
                            ? "🔍 Keyword Filter"
                            : t.type === "extract"
                            ? "✨ Schema Extraction"
                            : t.type === "enrich_llm"
                            ? "🤖 AI Enrichment"
                            : "📦 Vector Chunking"}
                        </span>
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => removeTransform(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Step Fields configurations */}
                    {t.type === "keyword_filter" && (
                      <div className="space-y-3 text-sm">
                        <div className="space-y-1">
                          <Label className="text-xs">Keywords (comma-separated)</Label>
                          <Input
                            placeholder="e.g. acquisitions, AI, deal"
                            value={t.keywords_str ?? ""}
                            onChange={(e) => updateTransform(i, { keywords_str: e.target.value })}
                          />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground mt-1">
                          <Checkbox
                            checked={!!t.match_all}
                            onCheckedChange={(c) => updateTransform(i, { match_all: c === true })}
                          />
                          Match ALL keywords (AND logic) instead of ANY (OR logic)
                        </label>
                      </div>
                    )}

                    {t.type === "extract" && (
                      <div className="space-y-3">
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
                              <Label className="text-xs font-semibold">LLM Extraction Settings</Label>
                              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                                <Checkbox
                                  checked={!!t.llm?.enabled}
                                  onCheckedChange={(c) => updateTransform(i, { llm: { ...t.llm, enabled: c === true } })}
                                />
                                Enable LLM Stage
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
                                  <Label className="text-[10px]">Prompt</Label>
                                  <Textarea rows={3} className="text-xs" value={t.prompt ?? ""} onChange={(e) => updateTransform(i, { prompt: e.target.value })} placeholder="Extract structured fields." />
                                </div>
                              </div>
                            )}
                          </div>
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

                    {t.type === "chunk" && (
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                          <Checkbox
                            checked={!!t.generate_vectors}
                            onCheckedChange={(c) => updateTransform(i, { generate_vectors: c === true })}
                          />
                          Generate vector embeddings (enables semantic searches)
                        </label>

                        <div className="grid gap-2 sm:grid-cols-3">
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
                            <Label className="text-[10px] text-muted-foreground">Filter by keywords</Label>
                          </div>
                        </div>

                        {t.generate_vectors && (
                          <div className="grid gap-2 sm:grid-cols-2 bg-muted/20 p-2.5 rounded border">
                            <div className="space-y-1">
                              <Label className="text-[10px]">Embedding provider</Label>
                              <select
                                className="w-full rounded-md border bg-background px-2 py-1 text-xs h-8"
                                value={t.provider ?? "local"}
                                onChange={(e) => updateTransform(i, { provider: e.target.value })}
                              >
                                <option value="local">Local hash</option>
                                <option value="openai">OpenAI-compatible</option>
                                <option value="ollama">Ollama</option>
                                <option value="lmstudio">LM Studio</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Model</Label>
                              <Input
                                className="h-8 text-xs"
                                value={t.model ?? "local-hash"}
                                onChange={(e) => updateTransform(i, { model: e.target.value })}
                              />
                            </div>
                          </div>
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
                    <option value="keyword_filter">🔍 Keyword Filter</option>
                    <option value="extract">✨ Schema Extraction</option>
                    <option value="enrich_llm">🤖 AI Enrichment</option>
                    <option value="chunk">📦 Vector Chunking</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                The schema is the hard contract every record must satisfy.
              </p>
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
                <Label>Output</Label>
                <p className="text-xs text-muted-foreground">Records are written to a DuckDB database.</p>
              </div>

              {mappings.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <Label className="text-xs">Use a saved Mapper mapping</Label>
                  <div className="mt-2 flex gap-2">
                    <select className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" defaultValue="" onChange={(e) => e.target.value && applySavedMapping(e.target.value)}>
                      <option value="">Select a saved mapping…</option>
                      {mappings.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} · {m.table} ({m.columns.length} cols)</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

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
                          <Trash2 className="h-4 w-4 text-red-500" />
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
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Pipeline name</Label>
                <Input value={def.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="My pipeline" />
              </div>
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
                  Also capture periodic snapshots
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

              <dl className="grid grid-cols-3 gap-2 rounded-lg border p-4 text-sm">
                <dt className="text-muted-foreground">Sources</dt>
                <dd className="col-span-2">
                  {getSelectedFeedIds().length ? `${getSelectedFeedIds().length} Feeds ` : ""}
                  {getSelectedWebsiteIds().length ? `${getSelectedWebsiteIds().length} Websites ` : ""}
                  {getSelectedApiSourceIds().length ? `${getSelectedApiSourceIds().length} APIs` : ""}
                  {!getSelectedFeedIds().length && !getSelectedWebsiteIds().length && !getSelectedApiSourceIds().length ? "None selected" : ""}
                </dd>
                <dt className="text-muted-foreground">Transforms</dt>
                <dd className="col-span-2">{(def.transforms || []).length} step(s) configured</dd>
                <dt className="text-muted-foreground">Fields</dt>
                <dd className="col-span-2">{(def.fields || []).length}</dd>
                <dt className="text-muted-foreground">Output</dt>
                <dd className="col-span-2">{def.output?.type}{def.output?.database ? ` · ${def.output.database}` : def.output?.path ? ` · ${def.output.path}` : ""}</dd>
              </dl>
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
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {step < 5 ? (
          <Button onClick={() => setStep(Math.min(5, step + 1))}>
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
