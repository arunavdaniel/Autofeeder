import type {
  Dashboard,
  Folder,
  Pipeline,
  PipelineDefinition,
  RunDetail,
  RunLog,
  RunSummary,
  Snapshot,
  SnapshotArticle,
  SnapshotSchedule,
  SavedMapping,
  ApiConfig,
  PromptTemplate,
  SchemaDef,
  DuckDBDatabase,
  DuckDBTable,
  DuckDBQueryResult,
} from "./types";

const BASE = "/api";

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  dashboard: () => req<Dashboard>("/dashboard"),

  pipelines: () => req<Pipeline[]>("/pipelines"),
  savePipeline: (name: string, definition: PipelineDefinition) =>
    req<{ id: number }>("/pipelines", {
      method: "POST",
      body: JSON.stringify({ name, definition }),
    }),
  deletePipeline: (id: number) => req<void>(`/pipelines/${id}`, { method: "DELETE" }),
  runPipeline: (id: number, preview: boolean) =>
    req<{ run_id: number; preview: boolean }>(`/pipelines/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ preview }),
    }),
  retryPipeline: (id: number) =>
    req<{ run_id: number }>(`/pipelines/${id}/retry`, { method: "POST" }),

  runs: (pipelineId?: number) =>
    req<RunSummary[]>(`/runs${pipelineId ? `?pipeline_id=${pipelineId}` : ""}`),
  runsFiltered: (opts?: {
    pipelineId?: number;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (opts?.pipelineId) q.set("pipeline_id", String(opts.pipelineId));
    if (opts?.status) q.set("status", opts.status);
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.offset) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return req<{ total: number; runs: RunSummary[] }>(`/runs${qs ? `?${qs}` : ""}`);
  },
  run: (id: number) => req<RunDetail>(`/runs/${id}`),
  runLogs: (id: number) =>
    req<{ run: RunDetail; logs: RunLog[] }>(`/runs/${id}/logs`),
  cancelRun: (id: number) => req<{ ok: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),
  retryRunFailed: (id: number) =>
    req<{ run_id: number }>(`/runs/${id}/retry-failed`, { method: "POST" }),
  deleteRun: (id: number) => req<void>(`/runs/${id}`, { method: "DELETE" }),

  folders: () => req<Folder[]>("/folders"),
  savedArticles: (folderId: number) =>
    req<Record<string, unknown>[]>("/folders/" + folderId + "/saved"),
  saveArticle: (folderId: number, payload: Record<string, unknown>) =>
    req<{ ok: true }>("/folders/" + folderId + "/saved", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  addFolder: (name: string) =>
    req<{ id: number; name: string }>("/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameFolder: (id: number, name: string) =>
    req<{ ok: true }>(`/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteFolder: (id: number) => req<void>(`/folders/${id}`, { method: "DELETE" }),
  addFeed: (url: string, folderId: number) =>
    req<{ id: number; title: string }>("/feeds", {
      method: "POST",
      body: JSON.stringify({ url, folder_id: folderId }),
    }),
  renameFeed: (id: number, title: string) =>
    req<{ ok: true }>(`/feeds/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteFeed: (id: number) => req<void>(`/feeds/${id}`, { method: "DELETE" }),
  feedItems: (id: number) =>
    req<{ source: string; items: Record<string, string>[] }>(`/feeds/${id}/items`),

  extractArticle: (
    item: Record<string, string>,
    source: string,
    opts?: { fetch_source?: string; firecrawl_api_key?: string; firecrawl_base_url?: string }
  ) =>
    req<Record<string, unknown>>("/article", {
      method: "POST",
      body: JSON.stringify({
        ...item,
        source,
        fetch_source: opts?.fetch_source ?? "builtin",
        firecrawl_api_key: opts?.firecrawl_api_key,
        firecrawl_base_url: opts?.firecrawl_base_url,
      }),
    }),
  firecrawlExtract: (url: string, apiKey: string, baseUrl?: string) =>
    req<Record<string, unknown>>("/article/firecrawl", {
      method: "POST",
      body: JSON.stringify({ url, api_key: apiKey, base_url: baseUrl }),
    }),
  bulkExtract: (
    articles: Record<string, string>[],
    opts?: { fetch_source?: string; firecrawl_api_key?: string; firecrawl_base_url?: string }
  ) =>
    req<Record<string, unknown>[]>("/articles/bulk", {
      method: "POST",
      body: JSON.stringify({
        articles,
        fetch_source: opts?.fetch_source ?? "builtin",
        firecrawl_api_key: opts?.firecrawl_api_key,
        firecrawl_base_url: opts?.firecrawl_base_url,
      }),
    }),

  exportText: async (text: string, filename = "article.txt") => {
    const res = await fetch(BASE + "/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  llmExtract: (payload: {
    endpoint: string;
    model: string;
    api_key: string;
    prompt: string;
    snapshot: string;
  }) =>
    req<{ result: unknown }>("/llm/extract", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  llmSchema: (payload: {
    endpoint: string;
    model: string;
    api_key: string;
    prompt: string;
  }) =>
    req<{ schema: { type: string; properties: Record<string, unknown>; required?: string[] } }>(
      "/llm/schema",
      { method: "POST", body: JSON.stringify(payload) }
    ),
  llmTest: (payload: {
    endpoint: string;
    model: string;
    api_key: string;
    timeout?: number;
  }) =>
    req<{ ok: boolean; sample?: unknown }>("/llm/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  importOpml: (opml: string, folder?: string) =>
    req<{ folder_id: number; added: number }>("/opml", {
      method: "POST",
      body: JSON.stringify({ opml, folder }),
    }),

  search: (q: string) =>
    req<{ results: Record<string, unknown>[] }>(`/search?q=${encodeURIComponent(q)}`),

  snapshots: () => req<any[]>("/snapshots"),
  snapshot: (id: number) =>
    req<{ snapshot: Snapshot; articles: SnapshotArticle[] }>(`/snapshots/${id}`),
  getSettings: () => req<{ snapshot_retention: number; default_llm_endpoint: string; default_llm_model: string }>("/settings"),
  saveSettings: (payload: { snapshot_retention?: number; default_llm_endpoint?: string; default_llm_model?: string }) =>
    req<{ ok: true }>("/settings", { method: "POST", body: JSON.stringify(payload) }),
  websiteSnapshotDetail: (id: number) => req<{ id: number; clean_text: string; raw_html: string; title: string; fetched_at: string }>(`/websites/snapshots/${id}`),
  apiSnapshotDetail: (id: number) => req<{ id: number; payload: string; fetched_at: string }>(`/api-sources/snapshots/${id}`),
  patchSnapshotArticle: (
    id: number,
    payload: { starred?: boolean; read?: boolean; tags?: string }
  ) =>
    req<{ ok: true }>(`/snapshots/article/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createFeedSnapshot: (payload: {
    name: string;
    feed_ids: number[];
    folder_ids: number[];
    max_articles?: number;
  }) => req<{ id: number; articles: number }>("/snapshots", { method: "POST", body: JSON.stringify(payload) }),
  createArticleSnapshot: (payload: Record<string, unknown>) =>
    req<{ id: number }>("/snapshots/article", { method: "POST", body: JSON.stringify(payload) }),
  renameSnapshot: (id: number, name: string) =>
    req<{ ok: true }>(`/snapshots/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteSnapshot: (id: number) => req<void>(`/snapshots/${id}`, { method: "DELETE" }),

  snapshotSchedules: () => req<SnapshotSchedule[]>("/snapshot-schedules"),
  createSnapshotSchedule: (payload: {
    name: string;
    feed_ids: number[];
    folder_ids: number[];
    max_articles?: number;
    dest?: { database: string; table?: string; mappings?: unknown[]; mode?: string; dedupe_key?: string } | null;
    schedule: { enabled?: boolean; kind?: "interval" | "daily"; minutes?: number; time?: string };
  }) => req<{ id: number }>("/snapshot-schedules", { method: "POST", body: JSON.stringify(payload) }),
  deleteSnapshotSchedule: (id: number) => req<void>(`/snapshot-schedules/${id}`, { method: "DELETE" }),

  mappings: () => req<SavedMapping[]>("/mappings"),
  saveMapping: (payload: { name: string; schema_id?: number | null; database: string; table: string; columns: { source: string; target: string; type: string }[] }) =>
    req<{ id: number }>("/mappings", { method: "POST", body: JSON.stringify(payload) }),
  deleteMapping: (id: number) => req<void>(`/mappings/${id}`, { method: "DELETE" }),

  captureSnapshot: (payload: {
    name?: string;
    feed_ids?: number[];
    folder_ids?: number[];
    website_ids?: number[];
    max_articles?: number;
    dest?: { database: string; table?: string; mappings?: unknown[]; mode?: string; dedupe_key?: string };
  }) => req<{ id: number; articles: number; duckdb: unknown }>("/snapshots/capture", { method: "POST", body: JSON.stringify(payload) }),

  apiConfigs: () => req<ApiConfig[]>("/api-configs"),
  saveApiConfig: (payload: Partial<ApiConfig>) =>
    req<{ id: number }>("/api-configs", { method: "POST", body: JSON.stringify(payload) }),
  deleteApiConfig: (id: number) => req<void>(`/api-configs/${id}`, { method: "DELETE" }),

  prompts: () => req<PromptTemplate[]>("/prompts"),
  savePrompt: (payload: Partial<PromptTemplate>) =>
    req<{ id: number }>("/prompts", { method: "POST", body: JSON.stringify(payload) }),
  deletePrompt: (id: number) => req<void>(`/prompts/${id}`, { method: "DELETE" }),

  schemas: () => req<SchemaDef[]>("/schemas"),
  saveSchema: (payload: Partial<SchemaDef>) =>
    req<{ id: number }>("/schemas", { method: "POST", body: JSON.stringify(payload) }),
  deleteSchema: (id: number) => req<void>(`/schemas/${id}`, { method: "DELETE" }),

  duckdbDatabases: () => req<DuckDBDatabase[]>("/duckdb/databases"),
  saveDuckdbDatabase: (payload: { name: string; path: string; description?: string }) =>
    req<{ id: number }>("/duckdb/databases", { method: "POST", body: JSON.stringify(payload) }),
  deleteDuckdbDatabase: (id: number) => req<void>(`/duckdb/databases/${id}`, { method: "DELETE" }),
  renameDuckdbDatabase: (id: number, payload: { name?: string; path?: string; description?: string }) =>
    req<{ ok: true }>(`/duckdb/databases/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteDuckdbTable: (payload: { db: string; table: string }) =>
    req<{ ok: true; table: string }>("/duckdb/tables", { method: "DELETE", body: JSON.stringify(payload) }),
  renameDuckdbTable: (payload: { db: string; table: string; new_name: string }) =>
    req<{ ok: true; table: string }>("/duckdb/rename-table", { method: "POST", body: JSON.stringify(payload) }),
  duckdbTables: (db: string) =>
    req<{ tables: DuckDBTable[] }>(`/duckdb/tables?db=${encodeURIComponent(db)}`),
  duckdbSchema: (db: string, table: string) =>
    req<{ schema: { column: string; type: string; null: string }[] }>(
      `/duckdb/schema?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`
    ),
  duckdbPreview: (db: string, table: string, limit?: number) =>
    req<DuckDBQueryResult>(
      `/duckdb/preview?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}&limit=${limit ?? 100}`
    ),
  duckdbQuery: (payload: { db: string; sql: string; readonly?: boolean; timeout?: number }) =>
    req<DuckDBQueryResult>("/duckdb/query", { method: "POST", body: JSON.stringify(payload) }),
  duckdbImport: (payload: { db: string; table: string; path: string }) =>
    req<{ table: string; rows: number }>("/duckdb/import", { method: "POST", body: JSON.stringify(payload) }),
  duckdbCreateTable: (payload: { database: string; table: string; columns: { name: string; type: string }[]; include_meta?: boolean }) =>
    req<{ table: string; columns: string[] }>("/duckdb/create-table", { method: "POST", body: JSON.stringify(payload) }),

  extractions: (db: string, table?: string, limit?: number) =>
    req<DuckDBQueryResult>(
      `/extractions?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table ?? "extractions")}&limit=${limit ?? 100}`
    ),
  persistExtractions: (payload: {
    db: string;
    table?: string;
    records: Record<string, unknown>[];
    mappings?: unknown[];
    mode?: string;
    dedupe_key?: string;
  }) => req<{ path: string; table: string; records: number }>("/extractions", { method: "POST", body: JSON.stringify(payload) }),

  websites: () => req<import("./types").Website[]>("/websites"),
  fetchBackends: () => req<Array<{ id: string; label: string; kind: string; available: boolean; hint: string }>>("/fetch-backends"),
  testWebsiteFetch: (payload: Record<string, unknown>) => req<Record<string, unknown>>("/websites/test-fetch", { method: "POST", body: JSON.stringify(payload) }),
  websitePreview: (payload: Record<string, unknown>) => req<Record<string, any>>("/websites/preview", { method: "POST", body: JSON.stringify(payload) }),
  saveWebsite: (payload: Record<string, unknown>, id?: number) =>
    req<{ id?: number; ok?: boolean }>(id ? `/websites/${id}` : "/websites", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) }),
  deleteWebsite: (id: number) => req<void>(`/websites/${id}`, { method: "DELETE" }),
  checkWebsite: (id: number) => req<{ snapshot_id: number; change_id: number | null; changed: boolean; text: string }>(`/websites/${id}/check`, { method: "POST" }),
  websiteSnapshots: (id: number) => req<import("./types").WebsiteSnapshot[]>(`/websites/${id}/snapshots`),
  websiteChanges: (id: number) => req<import("./types").WebsiteChange[]>(`/websites/${id}/changes`),
  updateWebsiteChange: (id: number, status: string) => req<{ ok: true }>(`/websites/changes/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  extractWebsiteChange: (id: number) => req<{ run_ids: number[] }>(`/websites/changes/${id}/extract`, { method: "POST" }),
  openWebsiteSession: (id: number) => req<{ ok: boolean; started: boolean; message: string }>(`/websites/${id}/session/open`, { method: "POST" }),
  clearWebsiteSession: (id: number) => req<void>(`/websites/${id}/session`, { method: "DELETE" }),
  embeddingIndex: (payload: Record<string, unknown>) => req<{ chunks: number }>("/embeddings/index", { method: "POST", body: JSON.stringify(payload) }),
  embeddingSearch: (payload: Record<string, unknown>) => req<{ results: import("./types").SearchResult[] }>("/embeddings/search", { method: "POST", body: JSON.stringify(payload) }),
  exportTable: (db: string, table: string, format: string, path?: string) => req<Record<string, unknown>>(`/exports?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}&format=${format}${path ? `&path=${encodeURIComponent(path)}` : ""}`),
  apiSources: () => req<import("./types").ApiSource[]>("/api-sources"),
  saveApiSource: (payload: Record<string, unknown>, id?: number) =>
    req<{ id?: number; ok?: boolean }>(id ? `/api-sources/${id}` : "/api-sources", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) }),
  deleteApiSource: (id: number) => req<void>(`/api-sources/${id}`, { method: "DELETE" }),
  checkApiSource: (id: number) => req<{ title: string; items: any[] }>(`/api-sources/${id}/check`, { method: "POST" }),
  apiSourceSnapshots: (id: number) => req<Array<{ id: number; fetched_at: string; changed: boolean | number; previous_snapshot_id: number | null }>>(`/api-sources/${id}/snapshots`),
  apiSourceJson: (id: number) => req<{ payload: unknown; arrays: Array<{ path: string; length: number; sample: unknown[] }>; config: any }>(`/api-sources/${id}/json`),
  apiSourceJsonPreview: (id: number, payload: unknown, config: any) => req<{ records: any[]; count: number }>(`/api-sources/${id}/json-preview`, { method: "POST", body: JSON.stringify({ payload, config }) }),
  saveApiExtractionConfig: (id: number, config: any) => req<{ ok: boolean }>(`/api-sources/${id}/extraction-config`, { method: "PATCH", body: JSON.stringify(config) }),

  keywords: () => req<import("./types").Keyword[]>("/keywords"),
  addKeyword: (payload: { word: string; category?: string }) =>
    req<{ id: number }>("/keywords", { method: "POST", body: JSON.stringify(payload) }),
  deleteKeyword: (id: number) => req<void>(`/keywords/${id}`, { method: "DELETE" }),
};
