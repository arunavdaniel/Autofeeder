import type { Field } from "./types";

export interface SchemaTemplate {
  id: string;
  label: string;
  description: string;
  fields: Field[];
}

export const SCHEMA_TEMPLATES: SchemaTemplate[] = [
  {
    id: "news",
    label: "News article",
    description: "Headlines, summaries, and topics from blogs or news feeds",
    fields: [
      { name: "title", type: "string", description: "Article headline", required: true },
      { name: "summary", type: "string", description: "2–3 sentence summary", required: true },
      { name: "author", type: "string", description: "Author name if mentioned", required: false },
      { name: "published_date", type: "string", description: "Publication date (ISO if possible)", required: false },
      { name: "topics", type: "array", description: "Key topics or tags", required: false },
    ],
  },
  {
    id: "product",
    label: "Product launch",
    description: "Companies, products, and pricing from tech press",
    fields: [
      { name: "company", type: "string", description: "Company name", required: true },
      { name: "product_name", type: "string", description: "Product or feature name", required: true },
      { name: "price", type: "string", description: "Price if mentioned", required: false },
      { name: "launch_date", type: "string", description: "Launch or announcement date", required: false },
      { name: "summary", type: "string", description: "What was announced", required: true },
    ],
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Just title and summary — good for a first test",
    fields: [
      { name: "title", type: "string", description: "Article title", required: true },
      { name: "summary", type: "string", description: "Brief summary", required: true },
    ],
  },
];

export const DEFAULT_EXTRACTION_PROMPT =
  "Extract structured information from the article text. Return valid JSON matching the schema fields only. Use null for missing values.";

export const DEFAULT_DB = "pipeline-output.duckdb";
export const DEFAULT_TABLE = "articles";

export const SAMPLE_FEEDS = [
  { label: "Hacker News", url: "https://hnrss.org/frontpage" },
  { label: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { label: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { label: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
];

export function duckTypeFromField(t: string): string {
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

export function buildPipelineDefinition(opts: {
  feedId: number;
  name: string;
  llm: { endpoint: string; model: string; api_key: string };
  prompt: string;
  fields: Field[];
  database: string;
  table: string;
}) {
  const mappings = opts.fields
    .filter((f) => f.name.trim())
    .map((f) => ({
      source: f.name,
      target: f.name,
      type: duckTypeFromField(f.type),
    }));
  return {
    sources: [{ type: "feeds" as const, feed_ids: [opts.feedId] }],
    max_articles: 20,
    use_browser: false,
    extraction_mode: "auto",
    llm: { enabled: true, ...opts.llm },
    prompt: opts.prompt,
    fields: opts.fields,
    output: {
      type: "duckdb",
      database: opts.database,
      table: opts.table,
      mode: "append",
      dedupe_key: "article_url",
      mappings,
    },
    retries: 1,
    concurrency: 2,
    timeout: 120,
    dedup: true,
    schedule: { enabled: false, kind: "interval" as const, minutes: 60 },
  };
}
