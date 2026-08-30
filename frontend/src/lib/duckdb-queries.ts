import type { DuckDBQueryResult } from "./types";

export interface QueryTemplate {
  label: string;
  sql: string;
}

export const QUERY_TEMPLATES: QueryTemplate[] = [
  { label: "Preview table", sql: 'SELECT * FROM "{table}" LIMIT 100;' },
  { label: "Row count", sql: 'SELECT COUNT(*) AS rows FROM "{table}";' },
  {
    label: "Recent rows",
    sql: 'SELECT * FROM "{table}" ORDER BY ingested_at DESC NULLS LAST LIMIT 50;',
  },
  {
    label: "By source",
    sql: 'SELECT source, COUNT(*) AS rows FROM "{table}" GROUP BY 1 ORDER BY 2 DESC;',
  },
  {
    label: "Today's ingestions",
    sql: "SELECT * FROM \"{table}\" WHERE CAST(ingested_at AS DATE) = CURRENT_DATE LIMIT 100;",
  },
];

const STORAGE_KEY = "autofeeder.duckdb.saved-queries";

export function loadSavedQueries(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function persistSavedQueries(queries: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries.slice(0, 30)));
}

export function saveQuery(sql: string): string[] {
  const trimmed = sql.trim();
  if (!trimmed) return loadSavedQueries();
  const next = [trimmed, ...loadSavedQueries().filter((item) => item !== trimmed)].slice(0, 30);
  persistSavedQueries(next);
  return next;
}

export function applyTemplate(template: string, table: string): string {
  const safeTable = table || "articles";
  return template.replaceAll("{table}", safeTable);
}

function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function resultToCsv(result: DuckDBQueryResult): string {
  const header = (result.columns || []).map(escapeCsvCell).join(",");
  const lines = (result.rows || []).map((row) =>
    row.map((cell) => escapeCsvCell(cell)).join(",")
  );
  return [header, ...lines].join("\n");
}

export function downloadQueryCsv(result: DuckDBQueryResult, filename: string): void {
  const blob = new Blob([resultToCsv(result)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
