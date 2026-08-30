import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { safeJsonParse } from "@/lib/json";
import type { DuckDBDatabase, SavedMapping, SchemaDef } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, ArrowLeftRight, Loader2, Save, Trash2, Plus, Table2 } from "lucide-react";
import { toast } from "sonner";

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

interface FieldRow {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface ColRow {
  source: string;
  target: string;
  type: string;
}

export function Mapper() {
  const [schemas, setSchemas] = useState<SchemaDef[]>([]);
  const [dbs, setDbs] = useState<{ id: number; name: string; path: string }[]>([]);
  const [saved, setSaved] = useState<SavedMapping[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [db, setDb] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [mappingName, setMappingName] = useState("");
  const [cols, setCols] = useState<ColRow[]>([]);
  const [schemaFields, setSchemaFields] = useState<FieldRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [schemaBusy, setSchemaBusy] = useState(false);

  const load = () => {
    api.schemas().then(setSchemas).catch(() => {});
    api.duckdbDatabases().then((d) => setDbs(d.map((x) => ({ id: x.id, name: x.name, path: x.path })))).catch(() => {});
    api.mappings().then(setSaved).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const loadDbTables = async (database: string) => {
    if (!database) {
      setTables([]);
      return;
    }
    try {
      const res = await api.duckdbTables(database);
      setTables(res.tables.map((t) => t.name));
    } catch {
      setTables([]);
    }
  };

  const onSelectDb = async (path: string) => {
    setDb(path);
    setTable("");
    setCols([]);
    await loadDbTables(path);
  };

  const onSelectSchema = (id: string) => {
    setSchemaId(id);
    const s = schemas.find((x) => String(x.id) === id);
    if (!s) return;
    const fields = safeJsonParse<FieldRow[]>(s.fields, []);
    setSchemaFields(fields);
    if (!table.trim()) setTable(s.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  };

  const addFromSchema = (fieldIdx: number, atIndex?: number) => {
    const f = schemaFields[fieldIdx];
    if (!f) return;
    if (cols.some((c) => c.source === f.name)) {
      toast.info(`"${f.name}" is already in the mapping`);
      return;
    }
    const col: ColRow = { source: f.name, target: f.name, type: duckTypeFromField(f.type) };
    setCols((c) => {
      const next = [...c];
      if (atIndex == null || atIndex >= next.length) next.push(col);
      else next.splice(atIndex, 0, col);
      return next;
    });
  };

  const addAllFromSchema = () => {
    setCols((c) => [
      ...c,
      ...schemaFields
        .filter((f) => !c.some((x) => x.source === f.name))
        .map((f) => ({ source: f.name, target: f.name, type: duckTypeFromField(f.type) })),
    ]);
  };

  const onPickTable = async (name: string) => {
    setTable(name);
    if (!name || !db) return;
    setSchemaBusy(true);
    try {
      const res = await api.duckdbSchema(db, name);
      const loaded = (res.schema || []).map((c) => ({
        source: c.column,
        target: c.column,
        type: c.type || "VARCHAR",
      }));
      if (loaded.length) setCols(loaded);
      else toast.info("Table has no columns yet");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSchemaBusy(false);
    }
  };

  const loadSaved = (m: SavedMapping) => {
    setSchemaId(m.schema_id != null ? String(m.schema_id) : "");
    setDb(m.database);
    setTable(m.table);
    setMappingName(m.name);
    setCols(m.columns.map((c) => ({ ...c })));
    const s = schemas.find((x) => String(x.id) === String(m.schema_id));
    setSchemaFields(s ? safeJsonParse<FieldRow[]>(s.fields, []) : []);
    loadDbTables(m.database);
    toast.info(`Loaded mapping "${m.name}"`);
  };

  const updateCol = (i: number, patch: Partial<ColRow>) =>
    setCols((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const addCol = () => setCols((c) => [...c, { source: "", target: "", type: "VARCHAR" }]);
  const removeCol = (i: number) => setCols((c) => c.filter((_, idx) => idx !== i));

  const create = async () => {
    if (!db || !table.trim()) return toast.error("Database and table are required");
    const clean = cols.filter((c) => c.target.trim());
    if (!clean.length) return toast.error("Mapping has no columns");
    setBusy(true);
    try {
      const res = await api.duckdbCreateTable({ database: db, table: table.trim(), columns: clean.map((c) => ({ name: c.target.trim(), type: c.type })), include_meta: true });
      toast.success(`Table ${res.table} created (${res.columns.length} columns)`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveMapping = async () => {
    if (!mappingName.trim()) return toast.error("Mapping name is required");
    const clean = cols.filter((c) => c.target.trim());
    if (!clean.length) return toast.error("Mapping has no columns");
    setMapBusy(true);
    try {
      await api.saveMapping({
        name: mappingName.trim(),
        schema_id: schemaId ? Number(schemaId) : null,
        database: db,
        table: table.trim(),
        columns: clean,
      });
      toast.success("Mapping saved.");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setMapBusy(false);
    }
  };

  const previewSql = () => {
    const lines = cols
      .filter((c) => c.target.trim())
      .map((c) => `  "${c.target.trim()}" ${c.type}`);
    lines.push(
      '  "article_id" VARCHAR',
      '  "source_url" VARCHAR',
      '  "feed_url" VARCHAR',
      '  "article_url" VARCHAR',
      '  "author" VARCHAR',
      '  "published_at" VARCHAR',
      '  "categories" VARCHAR',
      '  "pipeline_id" BIGINT',
      '  "run_id" BIGINT',
      '  "snapshot_id" VARCHAR',
      '  "source_type" VARCHAR',
      '  "website_id" BIGINT',
      '  "change_id" BIGINT',
      '  "detected_at" TIMESTAMP',
      '  "ingested_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    );
    return `CREATE TABLE "${table.trim() || "table_name"}" (\n${lines.join(",\n")}\n);`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Mapper</h1>
      <p className="text-sm text-muted-foreground">
        Map a Schema Generator schema to a DuckDB table. Pick a schema to seed columns, choose an existing
        DuckDB table (or type a new one), add or delete columns to match the schema, then create the table or
        save the mapping for reuse.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {saved.length === 0 && <p className="text-sm text-muted-foreground">No saved mappings yet. Build one below and save it.</p>}
          {saved.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground">{m.database || "?"} → {m.table || "?"} · {m.columns.length} columns</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => loadSaved(m)}>Load</Button>
              <Button size="icon" variant="ghost" onClick={() => api.deleteMapping(m.id).then(load).catch((e) => toast.error(String(e)))}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 · Choose schema &amp; destination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Schema</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={schemaId} onChange={(e) => onSelectSchema(e.target.value)}>
                <option value="">Select a schema…</option>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>DuckDB database</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={db} onChange={(e) => onSelectDb(e.target.value)}>
                <option value="">Select…</option>
                {dbs.map((d) => (
                  <option key={d.id} value={d.path}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1"><Table2 className="h-3.5 w-3.5" /> Table</Label>
              {db && (
                <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={table} onChange={(e) => onPickTable(e.target.value)}>
                  <option value="">— pick an existing table or type below —</option>
                  {tables.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
              <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="articles" />
              {db && tables.length === 0 && <p className="text-xs text-muted-foreground">No tables in this database yet — type a name to create one.</p>}
            </div>
            <div className="space-y-1">
              <Label>Mapping name (to save)</Label>
              <Input value={mappingName} onChange={(e) => setMappingName(e.target.value)} placeholder="My articles mapping" />
            </div>
            <Button variant="outline" className="w-full" onClick={saveMapping} disabled={mapBusy || !mappingName.trim() || !cols.filter((c) => c.target.trim()).length}>
              {mapBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save mapping
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · Field → column mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {schemaFields.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Schema fields — drag into the mapping ↓</Label>
                  <Button size="sm" variant="outline" onClick={addAllFromSchema}><Plus className="mr-1 h-3.5 w-3.5" /> Add all</Button>
                </div>
                <div className="max-h-44 space-y-1 overflow-auto rounded-lg border p-2">
                  {schemaFields.map((f, i) => {
                    const used = cols.some((c) => c.source === f.name);
                    return (
                      <div
                        key={i}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(i)); setDragging(true); }}
                        onDragEnd={() => setDragging(false)}
                        className={`flex cursor-grab items-center gap-2 rounded px-2 py-1 active:cursor-grabbing ${used ? "bg-accent/40" : "bg-muted/40"}`}
                        title={f.description}
                      >
                        <span className="flex-1 truncate text-sm font-medium">{f.name}</span>
                        <span className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{f.type}</span>
                        {f.required && <span className="text-xs text-amber-600">req</span>}
                        {used && <span className="text-xs text-emerald-600">added</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {schemaBusy && <p className="text-sm text-muted-foreground">Loading table columns…</p>}
            {cols.length === 0 && !schemaBusy && (
              <p className="text-sm text-muted-foreground">
                Pick a schema (its fields appear above — drag them in) or an existing table (to load its columns).
                Add or delete rows to match what you want in DuckDB.
              </p>
            )}
            {cols.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="flex-1">Schema field</span>
                  <span className="w-36 text-center">Column</span>
                  <span className="w-32 text-center">DuckDB type</span>
                  <span className="w-8" />
                </div>
                <div
                  className={`max-h-72 space-y-1 overflow-auto rounded-lg border p-2 ${dragging ? "ring-2 ring-brand/50" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const idx = e.dataTransfer.getData("text/plain"); if (idx !== "") addFromSchema(Number(idx)); setDragging(false); }}
                >
                  {cols.map((c, i) => {
                    const options = Array.from(new Set([...DUCK_TYPES, c.type].filter(Boolean)));
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded bg-background/60"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); const idx = e.dataTransfer.getData("text/plain"); if (idx !== "") addFromSchema(Number(idx), i); setDragging(false); }}
                      >
                        <span className="flex-1 truncate text-sm">{c.source || "—"}</span>
                        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <Input
                          className="h-8 w-36 text-sm"
                          value={c.target}
                          onChange={(e) => updateCol(i, { target: e.target.value })}
                          placeholder="column"
                        />
                        <select
                          className="h-8 w-32 rounded-md border bg-background px-2 text-sm"
                          value={c.type}
                          onChange={(e) => updateCol(i, { type: e.target.value })}
                        >
                          {options.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeCol(i)} title="Delete column">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    );
                  })}
                  <div
                    className="rounded border border-dashed px-2 py-3 text-center text-xs text-muted-foreground"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const idx = e.dataTransfer.getData("text/plain"); if (idx !== "") addFromSchema(Number(idx)); setDragging(false); }}
                  >
                    Drop a schema field here to add a column
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={addCol}><Plus className="mr-1 h-3.5 w-3.5" /> Add column</Button>
                <div className="space-y-1">
                  <Label className="text-xs">What the schema sends to DuckDB</Label>
                  <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">{previewSql()}</pre>
                </div>
                <Button className="w-full" onClick={create} disabled={busy || !db || !table.trim()}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Database className="mr-1 h-4 w-4" />} Create / ensure DuckDB table
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
