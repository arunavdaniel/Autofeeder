import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { safeJsonParse } from "@/lib/json";
import { DEFAULT_DB } from "@/lib/onboarding";
import { pickDatabaseWithRows, pickTableWithRows } from "@/lib/pipeline-utils";
import {
  QUERY_TEMPLATES,
  applyTemplate,
  downloadQueryCsv,
  loadSavedQueries,
  saveQuery,
} from "@/lib/duckdb-queries";
import type {
  DuckDBColumnSchema,
  DuckDBDatabase,
  DuckDBDatabaseStats,
  DuckDBQueryResult,
  DuckDBTable,
  SchemaDef,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Trash2,
  Play,
  Database as DbIcon,
  Loader2,
  Pencil,
  Download,
  Bookmark,
  Search,
  Table2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

const DUCK_TYPES = ["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP", "JSON"];
const PAGE_SIZES = [50, 100, 250, 500];

function formatDt(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatBytes(bytes?: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

export function DuckDB() {
  const [searchParams] = useSearchParams();
  const [dbs, setDbs] = useState<DuckDBDatabase[]>([]);
  const [selected, setSelected] = useState<DuckDBDatabase | null>(null);
  const [tables, setTables] = useState<DuckDBTable[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [activeTable, setActiveTable] = useState("");
  const [tableSchema, setTableSchema] = useState<DuckDBColumnSchema[]>([]);
  const [preview, setPreview] = useState<DuckDBQueryResult | null>(null);
  const [sql, setSql] = useState('SELECT * FROM articles LIMIT 100;');
  const [readonly, setReadonly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [savedQueries, setSavedQueries] = useState<string[]>(() => loadSavedQueries());
  const [searchText, setSearchText] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[] | null>(null);
  const [regName, setRegName] = useState("");
  const [regPath, setRegPath] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DuckDBDatabase | null>(null);
  const [renameTable, setRenameTable] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dbStats, setDbStats] = useState<DuckDBDatabaseStats | null>(null);
  const [viewMode, setViewMode] = useState<"query" | "browse">("query");
  const [pageSize, setPageSize] = useState(100);
  const [pageOffset, setPageOffset] = useState(0);
  const [expandedTables, setExpandedTables] = useState<Record<string, DuckDBQueryResult | "loading" | null>>({});
  const appliedDbLink = useRef("");
  const didAutoSelect = useRef(false);

  const load = () => api.duckdbDatabases().then(setDbs).catch(() => {});
  useEffect(() => {
    load();
    setSavedQueries(loadSavedQueries());
  }, []);

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, tableFilter]);

  const hasDefaultDb = dbs.some(
    (d) => d.path === DEFAULT_DB || d.path.endsWith(`/${DEFAULT_DB}`) || d.name === "Pipeline output"
  );

  const selectDb = async (db: DuckDBDatabase): Promise<DuckDBTable[]> => {
    didAutoSelect.current = true;
    setSelected(db);
    setActiveTable("");
    setTableSchema([]);
    setPreview(null);
    setSearchResults(null);
    setPageOffset(0);
    setExpandedTables({});
    try {
      const [tablesRes, statsRes] = await Promise.all([
        api.duckdbTables(db.path),
        api.duckdbInfo(db.path),
      ]);
      setTables(tablesRes.tables);
      setDbStats(statsRes);
      return tablesRes.tables;
    } catch (e) {
      toast.error(String(e));
      return [];
    }
  };

  useEffect(() => {
    const dbParam = searchParams.get("db");
    const tableParam = searchParams.get("table") || "";
    if (dbs.length === 0) return;

    if (dbParam) {
      const match =
        dbs.find((d) => d.path === dbParam) ||
        dbs.find((d) => d.path.endsWith(dbParam)) ||
        dbs.find((d) => d.name === dbParam.replace(/\.duckdb$/, ""));
      if (!match) return;
      const table = tableParam || pickTableWithRows(match.stats?.tables || []);
      const key = `${match.path}|${table}`;
      if (appliedDbLink.current === key) return;
      appliedDbLink.current = key;
      didAutoSelect.current = true;
      void (async () => {
        const loaded = await selectDb(match);
        const name = tableParam || pickTableWithRows(loaded);
        if (name) await openTable(name, match);
      })();
      return;
    }

    if (didAutoSelect.current) return;
    const picked = pickDatabaseWithRows(dbs);
    if (!picked) return;
    appliedDbLink.current = picked.path;
    didAutoSelect.current = true;
    void (async () => {
      const loaded = await selectDb(picked);
      const name = pickTableWithRows(loaded);
      if (name) await openTable(name, picked);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, dbs]);

  const openTable = async (name: string, db = selected, offset = 0) => {
    if (!db) return;
    setActiveTable(name);
    setSearchResults(null);
    setPageOffset(offset);
    setSql(`SELECT * FROM "${name}" LIMIT ${pageSize};`);
    try {
      const tableMeta = tables.find((t) => t.name === name);
      const schema = tableMeta?.schema?.length
        ? tableMeta.schema
        : (await api.duckdbSchema(db.path, name)).schema || [];
      const previewRes = await api.duckdbPreview(db.path, name, pageSize, offset);
      setPreview(previewRes);
      setTableSchema(schema);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const loadBrowseTable = async (name: string, offset = 0) => {
    if (!selected) return;
    setExpandedTables((prev) => ({ ...prev, [name]: "loading" }));
    try {
      const res = await api.duckdbPreview(selected.path, name, pageSize, offset);
      setExpandedTables((prev) => ({ ...prev, [name]: res }));
    } catch (e) {
      toast.error(String(e));
      setExpandedTables((prev) => ({ ...prev, [name]: null }));
    }
  };

  const toggleBrowseTable = async (name: string) => {
    if (expandedTables[name]) {
      setExpandedTables((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return;
    }
    await loadBrowseTable(name, 0);
  };

  const runQuery = async () => {
    if (!selected || !sql.trim()) return;
    setBusy(true);
    setSearchResults(null);
    try {
      const res = await api.duckdbQuery({ db: selected.path, sql, readonly });
      setPreview(res);
      setHistory((h) => [sql, ...h.filter((item) => item !== sql)].slice(0, 10));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    if (!selected || !searchText.trim()) return;
    setSearchBusy(true);
    try {
      const res = await api.duckdbSearch({
        db: selected.path,
        query: searchText,
        table: activeTable || undefined,
      });
      setSearchResults(res.results);
      if (!res.count) toast.message("No matches found");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSearchBusy(false);
    }
  };

  const bookmarkQuery = () => {
    if (!sql.trim()) return;
    setSavedQueries(saveQuery(sql));
    toast.success("Query saved");
  };

  const register = async () => {
    if (!regName.trim()) return;
    try {
      await api.saveDuckdbDatabase({
        name: regName,
        path: regPath || `${regName}.duckdb`,
        description: "",
      });
      setRegName("");
      setRegPath("");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const registerDefault = async () => {
    try {
      await api.saveDuckdbDatabase({
        name: "Pipeline output",
        path: DEFAULT_DB,
        description: "Default pipeline extraction database",
      });
      toast.success(`Registered ${DEFAULT_DB}`);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const openEdit = (db: DuckDBDatabase) => {
    setEditTarget(db);
    setEditOpen(true);
  };

  const dropTable = async (name: string) => {
    if (!selected) return;
    try {
      await api.deleteDuckdbTable({ db: selected.path, table: name });
      toast.success(`Table ${name} deleted`);
      if (activeTable === name) {
        setActiveTable("");
        setPreview(null);
        setTableSchema([]);
      }
      selectDb(selected);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const startRename = (name: string) => {
    setRenameTable(name);
    setRenameValue(name);
  };

  const commitRename = async () => {
    if (!selected || !renameTable || !renameValue.trim()) return;
    try {
      await api.renameDuckdbTable({
        db: selected.path,
        table: renameTable,
        new_name: renameValue.trim(),
      });
      toast.success(`Renamed to ${renameValue.trim()}`);
      if (activeTable === renameTable) setActiveTable(renameValue.trim());
      setRenameTable(null);
      selectDb(selected);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">DuckDB</h1>
          <p className="text-sm text-muted-foreground">
            Query pipeline output, inspect schemas, and export results locally.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hasDefaultDb && (
            <Button variant="outline" size="sm" onClick={registerDefault}>
              <Plus className="mr-1 h-4 w-4" /> Register {DEFAULT_DB}
            </Button>
          )}
          <Link
            to="/exports"
            className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            Exports
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-auto border-r p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Databases</h2>
          </div>
          <div className="space-y-2">
            {dbs.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-accent/50 ${
                  selected?.id === d.id ? "border-foreground bg-accent/60" : "border-border"
                }`}
                onClick={() => selectDb(d)}
              >
                <DbIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{d.path}</div>
                  {d.description && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{d.description}</div>
                  )}
                  <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                    <div>Created {formatDt(d.created_at)}</div>
                    <div>Updated {formatDt(d.updated_at || d.last_opened_at)}</div>
                    {d.stats && (
                      <div>
                        {d.stats.table_count} tables · {d.stats.total_rows} rows · {formatBytes(d.stats.file_size_bytes)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(d);
                    }}
                    title="Rename / edit"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      api.deleteDuckdbDatabase(d.id).then(load).catch((err) => toast.error(String(err)));
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </button>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <Label className="text-xs">Register database</Label>
            <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="News" />
            <Input value={regPath} onChange={(e) => setRegPath(e.target.value)} placeholder="news.duckdb" />
            <Button variant="outline" size="sm" onClick={register}>
              <Plus className="mr-1 h-4 w-4" /> Register
            </Button>
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setNewOpen(true)} disabled={!dbs.length}>
              <Plus className="mr-1 h-4 w-4" /> New table
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select or register a DuckDB database.</p>
          ) : (
            <>
              <Card>
                <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <MetaItem label="Name" value={selected.name} />
                  <MetaItem label="Path" value={selected.path} mono />
                  <MetaItem label="Created" value={formatDt(selected.created_at)} />
                  <MetaItem label="Updated" value={formatDt(selected.updated_at || selected.last_opened_at)} />
                  <MetaItem label="File modified" value={formatDt(dbStats?.file_modified_at)} />
                  <MetaItem label="File size" value={formatBytes(dbStats?.file_size_bytes)} />
                  <MetaItem label="Tables" value={String(dbStats?.table_count ?? tables.length)} />
                  <MetaItem label="Total rows" value={String(dbStats?.total_rows ?? 0)} />
                  {selected.description && (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <MetaItem label="Description" value={selected.description} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "query" | "browse")}>
                <TabsList>
                  <TabsTrigger value="query">SQL query</TabsTrigger>
                  <TabsTrigger value="browse">Browse all tables</TabsTrigger>
                </TabsList>

                <TabsContent value="query" className="space-y-4">
              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">SQL editor</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={readonly} onChange={(e) => setReadonly(e.target.checked)} />{" "}
                      read-only
                    </label>
                    <Button size="sm" variant="outline" onClick={bookmarkQuery} disabled={!sql.trim()}>
                      <Bookmark className="mr-1 h-4 w-4" /> Save
                    </Button>
                    <Button size="sm" onClick={runQuery} disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />} Run
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    className="font-mono text-xs"
                    rows={6}
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        runQuery();
                      }
                    }}
                    placeholder="SELECT * FROM articles LIMIT 100;"
                  />
                  <p className="text-xs text-muted-foreground">⌘/Ctrl + Enter to run</p>
                  <div className="flex flex-wrap gap-1">
                    {QUERY_TEMPLATES.map((template) => (
                      <button
                        key={template.label}
                        type="button"
                        className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => setSql(applyTemplate(template.sql, activeTable || "articles"))}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                  {(history.length > 0 || savedQueries.length > 0) && (
                    <div className="space-y-2">
                      {savedQueries.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Saved</div>
                          <div className="flex flex-wrap gap-1">
                            {savedQueries.slice(0, 8).map((h) => (
                              <button
                                key={h}
                                type="button"
                                className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                                onClick={() => setSql(h)}
                                title={h}
                              >
                                {h.slice(0, 36)}
                                {h.length > 36 ? "…" : ""}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {history.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Recent</div>
                          <div className="flex flex-wrap gap-1">
                            {history.map((h) => (
                              <button
                                key={h}
                                type="button"
                                className="rounded bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                                onClick={() => setSql(h)}
                                title={h}
                              >
                                {h.slice(0, 36)}
                                {h.length > 36 ? "…" : ""}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Full-text search</CardTitle>
                  <Button size="sm" variant="outline" onClick={runSearch} disabled={searchBusy || !searchText.trim()}>
                    {searchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}{" "}
                    Search
                  </Button>
                </CardHeader>
                <CardContent>
                  <Input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder={activeTable ? `Search in ${activeTable}…` : "Search all text columns…"}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  />
                  {searchResults && <SearchResults results={searchResults} />}
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-4">
                <Card className="xl:col-span-1">
                  <CardHeader>
                    <CardTitle className="text-base">Tables</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Input
                      value={tableFilter}
                      onChange={(e) => setTableFilter(e.target.value)}
                      placeholder="Filter tables…"
                      className="h-8 text-xs"
                    />
                    {filteredTables.length === 0 && (
                      <p className="text-sm text-muted-foreground">No tables yet.</p>
                    )}
                    {filteredTables.map((t) => (
                      <div
                        key={t.name}
                        className={`group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 ${
                          activeTable === t.name ? "bg-accent/60 ring-1 ring-foreground/20" : ""
                        }`}
                      >
                        <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => openTable(t.name)}>
                          <span className="font-medium">{t.name}</span>
                          {t.rows != null && <span className="ml-2 text-xs text-muted-foreground">{t.rows} rows</span>}
                          {t.columns != null && <span className="ml-2 text-xs text-muted-foreground">{t.columns} cols</span>}
                        </button>
                        <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" title="Rename table" onClick={() => startRename(t.name)}>
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" title="Delete table" onClick={() => dropTable(t.name)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {activeTable && tableSchema.length > 0 && (
                  <Card className="xl:col-span-1">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Table2 className="h-4 w-4" /> Schema
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-64 overflow-auto rounded border">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted">
                            <tr>
                              <th className="border-b px-2 py-1 text-left">Column</th>
                              <th className="border-b px-2 py-1 text-left">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableSchema.map((col) => (
                              <tr key={col.column} className="odd:bg-background even:bg-muted/20">
                                <td className="border-b px-2 py-1 font-mono">{col.column}</td>
                                <td className="border-b px-2 py-1 text-muted-foreground">{col.type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className={activeTable && tableSchema.length > 0 ? "xl:col-span-2" : "xl:col-span-3"}>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="text-base">{activeTable || "Result"}</CardTitle>
                    {preview && !preview.error && preview.columns?.length ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          downloadQueryCsv(preview, activeTable ? `${activeTable}-export` : `${selected.name}-query`)
                        }
                      >
                        <Download className="mr-1 h-4 w-4" /> CSV
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <ResultTable
                      result={preview}
                      pageSize={pageSize}
                      pageOffset={pageOffset}
                      onPageSizeChange={(size) => {
                        setPageSize(size);
                        if (activeTable && selected) openTable(activeTable, selected, 0);
                      }}
                      onPageChange={(offset) => {
                        if (activeTable && selected) openTable(activeTable, selected, offset);
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
                </TabsContent>

                <TabsContent value="browse" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Rows per page</span>
                    {PAGE_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`rounded border px-2 py-0.5 ${pageSize === size ? "border-foreground text-foreground" : ""}`}
                        onClick={() => setPageSize(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                  {tables.length === 0 && (
                    <p className="text-sm text-muted-foreground">No tables in this database.</p>
                  )}
                  {tables.map((table) => {
                    const expanded = expandedTables[table.name];
                    const isOpen = expanded != null;
                    return (
                      <Card key={table.name}>
                        <CardHeader className="flex-row items-center justify-between py-3">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => toggleBrowseTable(table.name)}
                          >
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <div>
                              <CardTitle className="text-base">{table.name}</CardTitle>
                              <p className="text-xs text-muted-foreground">
                                {table.rows ?? 0} rows · {table.columns ?? table.schema?.length ?? 0} columns
                              </p>
                            </div>
                          </button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setViewMode("query");
                              openTable(table.name);
                            }}
                          >
                            Open in SQL
                          </Button>
                        </CardHeader>
                        {isOpen && (
                          <CardContent className="space-y-3">
                            {table.schema && table.schema.length > 0 && (
                              <div className="overflow-auto rounded border">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted">
                                    <tr>
                                      <th className="border-b px-2 py-1 text-left">Column</th>
                                      <th className="border-b px-2 py-1 text-left">Type</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {table.schema.map((col) => (
                                      <tr key={col.column}>
                                        <td className="border-b px-2 py-1 font-mono">{col.column}</td>
                                        <td className="border-b px-2 py-1 text-muted-foreground">{col.type}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {expanded === "loading" ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading rows…
                              </div>
                            ) : expanded ? (
                              <ResultTable
                                result={expanded}
                                pageSize={pageSize}
                                pageOffset={expanded.offset ?? 0}
                                onPageSizeChange={(size) => {
                                  setPageSize(size);
                                  loadBrowseTable(table.name, 0);
                                }}
                                onPageChange={(offset) => loadBrowseTable(table.name, offset)}
                                onExport={() =>
                                  downloadQueryCsv(expanded as DuckDBQueryResult, `${table.name}-export`)
                                }
                              />
                            ) : null}
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      <NewTableDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        databases={dbs}
        onCreated={() => {
          if (selected) selectDb(selected);
        }}
      />
      <EditDatabaseDialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditTarget(null);
        }}
        target={editTarget}
        onSaved={() => {
          load();
          if (editTarget && selected?.id === editTarget.id) setSelected(null);
        }}
      />
      <Dialog open={renameTable !== null} onOpenChange={(v) => { if (!v) setRenameTable(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rename table</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>New table name</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="table_name" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTable(null)}>Cancel</Button>
            <Button onClick={commitRename} disabled={!renameValue.trim() || renameValue.trim() === renameTable}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchResults({ results }: { results: Record<string, unknown>[] }) {
  if (!results.length) {
    return <p className="mt-3 text-sm text-muted-foreground">No matches.</p>;
  }
  const keys = Object.keys(results[0] || {});
  return (
    <div className="mt-3 max-h-48 overflow-auto rounded border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {keys.map((key) => (
              <th key={key} className="border-b px-2 py-1 text-left font-medium">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.slice(0, 50).map((row, i) => (
            <tr key={i} className="odd:bg-background even:bg-muted/30">
              {keys.map((key) => (
                <td key={key} className="max-w-[14rem] truncate border-b px-2 py-1">
                  {row[key] == null ? "" : String(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 text-xs text-muted-foreground">{results.length} match(es)</div>
    </div>
  );
}

function EditDatabaseDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: DuckDBDatabase | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && target) {
      setName(target.name);
      setPath(target.path);
      setDescription(target.description || "");
    }
  }, [open, target]);

  const save = async () => {
    if (!target) return;
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      await api.renameDuckdbDatabase(target.id, {
        name: name.trim(),
        path: path.trim() || `${name.trim()}.duckdb`,
        description: description.trim(),
      });
      toast.success("Database updated");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Rename / edit database</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="News" />
          </div>
          <div className="space-y-1">
            <Label>File path</Label>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="news.duckdb" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewTableDialog({
  open,
  onOpenChange,
  databases,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  databases: DuckDBDatabase[];
  onCreated: () => void;
}) {
  const [db, setDb] = useState("");
  const [table, setTable] = useState("");
  const [cols, setCols] = useState<{ name: string; type: string }[]>([{ name: "", type: "VARCHAR" }]);
  const [schemas, setSchemas] = useState<SchemaDef[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDb(databases[0]?.path ?? "");
      setTable("");
      setCols([{ name: "", type: "VARCHAR" }]);
      api.schemas().then(setSchemas).catch(() => {});
    }
  }, [open, databases]);

  const loadFromSchema = (id: string) => {
    const s = schemas.find((x) => String(x.id) === id);
    if (!s) return;
    const fields: { name: string; type: string }[] = safeJsonParse(s.fields, []);
    setCols(
      fields.length
        ? fields.map((f) => ({ name: f.name, type: duckTypeFromField(f.type) }))
        : [{ name: "", type: "VARCHAR" }]
    );
    if (s.name && !table.trim()) setTable(s.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  };
  const addCol = () => setCols((c) => [...c, { name: "", type: "VARCHAR" }]);
  const updateCol = (i: number, patch: Partial<{ name: string; type: string }>) =>
    setCols((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeCol = (i: number) => setCols((c) => c.filter((_, idx) => idx !== i));
  const create = async () => {
    if (!db.trim() || !table.trim()) return toast.error("Database and table name are required");
    const clean = cols.filter((c) => c.name.trim());
    if (!clean.length) return toast.error("Add at least one column");
    setBusy(true);
    try {
      const res = await api.duckdbCreateTable({ database: db, table: table.trim(), columns: clean, include_meta: false });
      toast.success(`Table ${res.table} created (${res.columns.length} columns)`);
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New DuckDB table (schema designer)</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Database</Label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={db} onChange={(e) => setDb(e.target.value)}>
              {databases.map((d) => (
                <option key={d.id} value={d.path}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Table name</Label>
            <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="articles" />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Load columns from a Schema</Label>
          <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && loadFromSchema(e.target.value)}>
            <option value="">— choose a schema to map its fields → columns —</option>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Columns</Label>
            <Button variant="outline" size="sm" onClick={addCol}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add column
            </Button>
          </div>
          {cols.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_150px_auto] items-end gap-2">
              <Input value={c.name} onChange={(e) => updateCol(i, { name: e.target.value })} placeholder="column name" />
              <select className="rounded-md border bg-background px-2 py-2 text-sm" value={c.type} onChange={(e) => updateCol(i, { type: e.target.value })}>
                {DUCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Button size="icon" variant="ghost" onClick={() => removeCol(i)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={busy || !db || !table.trim()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Create table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</div>
    </div>
  );
}

function ResultTable({
  result,
  pageSize,
  pageOffset = 0,
  onPageSizeChange,
  onPageChange,
  onExport,
}: {
  result: DuckDBQueryResult | null;
  pageSize?: number;
  pageOffset?: number;
  onPageSizeChange?: (size: number) => void;
  onPageChange?: (offset: number) => void;
  onExport?: () => void;
}) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  if (!result) return <p className="text-sm text-muted-foreground">Run a query or select a table to see results.</p>;
  if (result.error) return <p className="text-sm text-destructive">{result.error}</p>;
  if (!result.columns?.length) return <p className="text-sm text-muted-foreground">No columns returned.</p>;

  const total = result.total_rows ?? result.row_count;
  const offset = result.offset ?? pageOffset;
  const limit = result.limit ?? pageSize ?? result.row_count;
  const canPaginate = total > (limit || 0) && onPageChange;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + result.row_count, total);

  return (
    <div className="space-y-2">
      <div className="max-h-[32rem] overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {result.columns.map((c) => (
                <th key={c} className="border-b px-2 py-1 text-left font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="odd:bg-background even:bg-muted/30">
                {row.map((cell, j) => {
                  const text = cell == null ? "" : String(cell);
                  const key = `${i}-${j}`;
                  const isLong = text.length > 120;
                  return (
                    <td key={j} className="max-w-[20rem] border-b px-2 py-1 align-top">
                      {isLong ? (
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => setExpandedCell(expandedCell === key ? null : key)}
                        >
                          {expandedCell === key ? text : `${text.slice(0, 120)}…`}
                        </button>
                      ) : (
                        <span className="break-words">{text}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Showing {pageStart}-{pageEnd} of {total} rows
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {onPageSizeChange &&
            PAGE_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`rounded border px-2 py-0.5 ${(pageSize ?? limit) === size ? "border-foreground text-foreground" : ""}`}
                onClick={() => onPageSizeChange(size)}
              >
                {size}
              </button>
            ))}
          {onExport && (
            <Button size="sm" variant="outline" onClick={onExport}>
              <Download className="mr-1 h-3 w-3" /> CSV
            </Button>
          )}
          {canPaginate && (
            <>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                disabled={offset <= 0}
                onClick={() => onPageChange(Math.max(0, offset - (limit || pageSize || 100)))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                disabled={offset + result.row_count >= total}
                onClick={() => onPageChange(offset + (limit || pageSize || 100))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
