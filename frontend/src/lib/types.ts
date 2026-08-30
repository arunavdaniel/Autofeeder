export interface Field {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface PipelineSchedule {
  enabled?: boolean;
  kind?: "interval" | "daily";
  minutes?: number;
  time?: string;
}

export interface Mapping {
  source: string;
  target: string;
  type?: string;
  required?: boolean;
  default?: string;
}

export interface PipelineDefinition {
  name?: string;
  source?: { type: "feeds" | "snapshot" | "websites" | "api" | "api_sources"; feed_ids?: number[]; website_ids?: number[]; snapshot_id?: number; url?: string; api_source_ids?: number[] };
  sources?: { type: "feeds" | "snapshot" | "websites" | "api" | "api_sources"; feed_ids?: number[]; website_ids?: number[]; snapshot_id?: number; url?: string; api_source_ids?: number[] }[];
  feed_ids?: number[];
  folder_ids?: number[];
  date_filter?: { enabled: boolean; from: string; to: string };
  max_articles?: number;
  use_browser?: boolean;
  fetch_source?: string;
  firecrawl_api_key?: string;
  firecrawl_base_url?: string;
  extraction_mode?: string;
  hybrid_llm_fill?: boolean;
  llm?: { enabled: boolean; endpoint: string; model: string; api_key: string };
  prompt?: string;
  fields?: Field[];
  api_config_id?: number;
  prompt_id?: number;
  schema_id?: number;
  output?: {
    type: string;
    path?: string;
    database?: string;
    table?: string;
    mode?: string;
    mappings?: Mapping[];
    dedupe_key?: string;
  };
  run_on_change?: boolean;
  retries?: number;
  concurrency?: number;
  transforms?: any[];
  timeout?: number;
  dedup?: boolean;
  embeddings?: { enabled?: boolean; provider?: string; endpoint?: string; model?: string; chunk_size?: number; chunk_overlap?: number; strategy?: string; top_k?: number; api_key?: string; min_words?: number; filter_by_keywords?: boolean; generate_vectors?: boolean };
  change_detection?: boolean;
  schedule?: PipelineSchedule;
  snapshot?: { enabled?: boolean; kind?: "interval" | "daily"; minutes?: number; time?: string; dest?: { database: string; table?: string; mappings?: Mapping[]; mode?: string; dedupe_key?: string } };
}

export interface ApiConfig {
  id: number;
  name: string;
  provider: string;
  endpoint: string;
  model: string;
  temperature: number | null;
  timeout: number;
  extra: string;
}

export interface PromptTemplate {
  id: number;
  name: string;
  system_prompt: string;
  extraction_prompt: string;
  variables: string[];
  schema_id: number | null;
  version: number;
}

export interface SchemaDef {
  id: number;
  name: string;
  json_schema: string;
  fields: string;
}

export interface DuckDBDatabase {
  id: number;
  name: string;
  path: string;
  description: string;
  created_at: string;
  last_opened_at: string | null;
}

export interface DuckDBTable {
  name: string;
  rows: number | null;
}

export interface DuckDBQueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  error?: string;
}

export interface Website {
  id: number;
  name: string;
  url: string;
  fetch_method: string;
  frequency: string;
  schema_id: number | null;
  prompt: string;
  destination: Record<string, unknown>;
  fetch_options?: Record<string, unknown>;
  pending_changes?: number;
  snapshot_count?: number;
  enabled: boolean | number;
  last_checked: string | null;
  last_changed: string | null;
}

export interface WebsiteSnapshot {
  id: number;
  source_id: number;
  fetched_at: string;
  content_hash: string;
  raw_html: string;
  clean_text: string;
  previous_snapshot_id: number | null;
  changed: boolean | number;
}

export interface WebsiteChange {
  id: number;
  source_id: number;
  snapshot_id: number;
  previous_snapshot_id: number | null;
  diff: string;
  status: string;
  detected_at: string;
  processed_at: string | null;
}

export interface SearchResult {
  chunk_id: string;
  source_url: string;
  article_url: string;
  article_title: string;
  source: string;
  published: string;
  chunk_text: string;
  relevance: number;
  duckdb_record?: Record<string, any>;
}

export interface Pipeline {
  id: number;
  name: string;
  definition: PipelineDefinition;
  enabled: boolean;
}

export interface RunSummary {
  id: number;
  pipeline_id: number;
  preview: boolean;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  phase: string;
  last_message: string;
  progress_current: number;
  progress_total: number;
  articles_seen: number;
  records_count: number;
  error_count: number;
  created_at: string;
  finished_at: string | null;
}

export interface RunLog {
  id: number;
  run_id: number;
  step: string;
  message: string;
  level: string;
  article_title: string;
  created_at: string;
}

export interface RunDetail extends RunSummary {
  result: string;
  output_info: string;
  error: string;
}

export interface Folder {
  id: number;
  name: string;
  feeds: { id: number; title: string; url: string; site_url: string }[];
  saved_count: number;
}

export interface Snapshot {
  id: number;
  name: string;
  kind: string;
  source_label: string;
  created_at: string;
  article_count: number;
}

export interface SnapshotSchedule {
  id: number;
  name: string;
  feed_ids: number[];
  folder_ids: number[];
  max_articles: number;
  dest: { database: string; table?: string; mappings?: unknown[]; mode?: string; dedupe_key?: string } | null;
  schedule: { enabled?: boolean; kind?: "interval" | "daily"; minutes?: number; time?: string };
  enabled: boolean;
  last_run: string | null;
  created_at: string;
}

export interface SavedMapping {
  id: number;
  name: string;
  schema_id: number | null;
  database: string;
  table: string;
  columns: { source: string; target: string; type: string }[];
  created_at: string;
}

export interface SnapshotArticle {
  id: number;
  title: string;
  url: string;
  source: string;
  published: string;
  text: string;
  links: { text: string; url: string }[];
  starred?: number;
  read?: number;
  tags?: string;
}

export interface Dashboard {
  folders: number;
  feeds: number;
  pipelines: number;
  active_pipelines: number;
  saved_articles: number;
  total_runs: number;
  active_runs: number;
  total_records: number;
  total_errors: number;
  last_run: RunSummary | null;
}

export interface Keyword {
  id: number;
  word: string;
  category: string;
  created_at: string;
}

export interface ApiSource {
  id: number;
  name: string;
  url: string;
  frequency: string;
  enabled: number;
  last_checked?: string;
  created_at: string;
  extraction_config?: string;
}
