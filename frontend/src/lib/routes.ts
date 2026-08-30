export interface RouteMeta {
  title: string;
  description?: string;
  group?: string;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "Overview",
    description: "Add a source, run a pipeline, inspect rows, publish",
    group: "Home",
  },
  "/runs": {
    title: "Run history",
    description: "Every extraction run — logs, rows, and output",
    group: "Home",
  },
  "/stats": {
    title: "Stats",
    description: "Runs, records, and errors over time",
    group: "Home",
  },
  "/sources": {
    title: "Feeds",
    description: "RSS and Atom subscriptions",
    group: "Sources",
  },
  "/discover": {
    title: "Discover",
    description: "Add a catalog source, then put it on a pipeline",
    group: "Sources",
  },
  "/websites": {
    title: "Websites",
    description: "Monitor pages for meaningful changes",
    group: "Sources",
  },
  "/api-sources": {
    title: "API sources",
    description: "Poll JSON APIs on a schedule",
    group: "Sources",
  },
  "/pipelines": {
    title: "Pipelines",
    description: "Fetch, extract, write DuckDB, then publish",
    group: "Processing",
  },
  "/settings": {
    title: "Settings",
    description: "API configs and data backup",
    group: "Config",
  },
  "/prompts": {
    title: "Prompts",
    description: "Reusable extraction prompt templates",
    group: "Config",
  },
  "/schemas": {
    title: "Schemas",
    description: "Structured field definitions for extraction",
    group: "Config",
  },
  "/keywords": {
    title: "Keywords",
    description: "Filter and boost indexed content",
    group: "Config",
  },
  "/duckdb": {
    title: "DuckDB",
    description: "Tables written by pipeline runs",
    group: "Data",
  },
  "/snapshots": {
    title: "Snapshots",
    description: "Point-in-time article captures",
    group: "Data",
  },
  "/exports": {
    title: "Exports",
    description: "Download files, serve RSS/JSON, upsert — attach on a pipeline",
    group: "Data",
  },
};

export function routeMeta(pathname: string): RouteMeta {
  const base = pathname.split("?")[0];
  return ROUTE_META[base] || { title: "Autofeeder", description: "Local extraction engine" };
}
