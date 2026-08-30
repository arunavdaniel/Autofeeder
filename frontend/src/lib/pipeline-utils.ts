import type { DuckDBDatabase, DuckDBTable, PipelineDefinition } from "./types";

export function sourceCount(def: PipelineDefinition): number {
  if (def.sources?.length) {
    return def.sources.reduce((acc, source) => {
      if (source.type === "feeds") return acc + (source.feed_ids?.length ?? 0);
      if (source.type === "websites") return acc + (source.website_ids?.length ?? 0);
      if (source.type === "api_sources") return acc + (source.api_source_ids?.length ?? 0);
      if (source.type === "snapshot") return acc + 1;
      if (source.type === "api") return acc + 1;
      return acc;
    }, 0);
  }
  return def.feed_ids?.length ?? 0;
}

export function outputLabel(def: PipelineDefinition): string {
  const table = def.output?.table;
  const database = def.output?.database;
  if (table && database) return `${database} → ${table}`;
  if (table) return table;
  return "DuckDB output";
}

export function hasSources(def: PipelineDefinition): boolean {
  return sourceCount(def) > 0;
}

export function scheduleLabel(def: PipelineDefinition): string | null {
  if (def.schedule?.enabled) {
    const s = def.schedule;
    return s.kind === "daily" ? `Daily ${s.time || "09:00"}` : `Every ${s.minutes || 60} min`;
  }
  if (def.snapshot?.enabled) {
    const s = def.snapshot;
    const when = s.kind === "daily" ? `daily ${s.time || "09:00"}` : `every ${s.minutes || 60} min`;
    return `Snapshots ${when}`;
  }
  return null;
}

export function usesLlm(def: PipelineDefinition): boolean {
  if (def.llm?.enabled === false) {
    const steps = def.transforms || [];
    return steps.some(
      (t) =>
        t.mode === "llm" ||
        t.type === "synthesize" ||
        t.type === "enrich_llm" ||
        t.hybrid_llm_fill,
    );
  }
  return true;
}

export function reviewWarnings(def: PipelineDefinition, llmReady: boolean): string[] {
  const warnings: string[] = [];
  if (!def.name?.trim()) warnings.push("Name this pipeline before saving.");
  if (!hasSources(def)) warnings.push("No sources selected.");
  if (usesLlm(def) && !llmReady) warnings.push("LLM endpoint and model are not set. Extraction will fail until you configure Settings.");
  if (!(def.fields || []).some((f) => f.name?.trim())) warnings.push("No schema fields — add fields on Schema, or runs will have little structure.");
  if (def.output?.type === "duckdb" && !(def.output.table || "").trim()) warnings.push("No DuckDB table name on Output.");
  if (def.output?.type === "duckdb" && !(def.output.database || "").trim()) warnings.push("No DuckDB file on Output.");
  return warnings;
}

export function pickTableWithRows(tables: DuckDBTable[], preferred?: string): string {
  if (preferred && tables.some((t) => t.name === preferred)) return preferred;
  const ranked = [...tables].sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
  return ranked[0]?.name || tables[0]?.name || "";
}

export function pickDatabaseWithRows(list: DuckDBDatabase[], current?: string): DuckDBDatabase | undefined {
  if (current && list.some((x) => x.path === current)) return list.find((x) => x.path === current);
  const withRows = list.filter((x) => (x.stats?.total_rows ?? 0) > 0 || (x.stats?.table_count ?? 0) > 0);
  const pool = withRows.length ? withRows : list;
  return [...pool].sort((a, b) => (b.stats?.total_rows ?? 0) - (a.stats?.total_rows ?? 0))[0];
}
