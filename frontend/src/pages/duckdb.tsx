import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { safeJsonParse } from "@/lib/json";
import type { DuckDBDatabase, DuckDBQueryResult, DuckDBTable, SchemaDef } from "@/lib/types";
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
import { Plus, Trash2, Play, Database as DbIcon, Loader2, Pencil } from "lucide-react";
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

export function DuckDB() {
  const [dbs, setDbs] = useState<DuckDBDatabase[]>([]);
  const [selected, setSelected] = useState<DuckDBDatabase | null>(null);
  const [tables, setTables] = useState<DuckDBTable[]>([]);
  const [activeTable, setActiveTable] = useState<string>("");
  const [preview, setPreview] = useState<DuckDBQueryResult | null>(null);
  const [sql, setSql] = useState("SELECT * FROM extractions LIMIT 100;");
  const [readonly, setReadonly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [regName, setRegName] = useState("");
  const [regPath, setRegPath] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DuckDBDatabase | null>(null);
  const [renameTable, setRenameTable] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = () => api.duckdbDatabases().then(setDbs).catch(() => {});
  useEffect(() => { load(); }, []);

  const selectDb = async (db: DuckDBDatabase) => {
    setSelected(db);
    setActiveTable("");
    setPreview(null);
    try {
      const res = await api.duckdbTables(db.path);
      setTables(res.tables);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const openTable = async (name: string) => {
    if (!selected) return;
    setActiveTable(name);
    try {
      const res = await api.duckdbPreview(selected.path, name);
      setPreview(res);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const runQuery = async () => {
    if (!selected || !sql.trim()) return;
    setBusy(true);
    try {
      const res = await api.duckdbQuery({ db: selected.path, sql, readonly });
      setPreview(res);
      setHistory((h) => [sql, ...h].slice(0, 10));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!regName.trim()) return;
    try {
      await api.saveDuckdbDatabase({ name: regName, path: regPath || `${regName}.duckdb`, description: "" });
      setRegName("");
      setRegPath("");
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
      await api.renameDuckdbTable({ db: selected.path, table: renameTable, new_name: renameValue.trim() });
      toast.success(`Renamed to ${renameValue.trim()}`);
      if (activeTable === renameTable) setActiveTable(renameValue.trim());
      setRenameTable(null);
      selectDb(selected);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex w-72 flex-col gap-3 overflow-auto border-r p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Databases</h2>
        </div>
        <div className="space-y-2">
          {dbs.map((d) => (
            <button
              key={d.id}
              className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left hover:bg-accent/50 ${selected?.id === d.id ? "border-brand bg-accent/60" : ""}`}
              onClick={() => selectDb(d)}
            >
              <DbIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="truncate text-xs text-muted-foreground">{d.path}</div>
              </div>
              <div className="flex items-center">
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(d); }} title="Rename / edit">
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); api.deleteDuckdbDatabase(d.id).then(load).catch((err) => toast.error(String(err))); }}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </button>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <Label className="text-xs">Register database</Label>
          <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="News" />
          <Input value={regPath} onChange={(e) => setRegPath(e.target.value)} placeholder="news.duckdb" />
          <Button variant="outline" size="sm" onClick={register}><Plus className="mr-1 h-4 w-4" /> Register</Button>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => setNewOpen(true)} disabled={!dbs.length}>
            <Plus className="mr-1 h-4 w-4" /> New table
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-6">
        {!selected ? (
          <p className="text-sm text-muted-foreground">Select or register a DuckDB database.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{selected.name}</span>
              <span>·</span>
              <span>{selected.path}</span>
            </div>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">SQL editor</CardTitle>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={readonly} onChange={(e) => setReadonly(e.target.checked)} /> read-only
                  </label>
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
                />
                {history.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {history.map((h, i) => (
                      <button
                        key={i}
                        className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                        onClick={() => setSql(h)}
                        title={h}
                      >
                        {h.slice(0, 32)}…
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tables</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {tables.length === 0 && <p className="text-sm text-muted-foreground">No tables yet.</p>}
                  {tables.map((t) => (
                    <div
                      key={t.name}
                      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 ${activeTable === t.name ? "bg-accent/60" : ""}`}
                    >
                      <button
                        className="min-w-0 flex-1 text-left text-sm"
                        onClick={() => openTable(t.name)}
                      >
                        <span className="font-medium">{t.name}</span>
                        {t.rows != null && <span className="ml-2 text-xs text-muted-foreground">{t.rows} rows</span>}
                      </button>
                      <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" title="Rename table" onClick={() => startRename(t.name)}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" title="Delete table" onClick={() => dropTable(t.name)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">{activeTable || "Result"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResultTable result={preview} />
                </CardContent>
              </Card>
            </div>
          </>
        )}
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
        onOpenChange={(v) => { setEditOpen(v); if (!v) setEditTarget(null); }}
        target={editTarget}
        onSaved={() => { load(); if (editTarget && selected?.id === editTarget.id) setSelected(null); }}
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

function EditDatabaseDialog({ open, onOpenChange, target, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; target: DuckDBDatabase | null; onSaved: () => void }) {
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

function NewTableDialog({ open, onOpenChange, databases, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; databases: DuckDBDatabase[]; onCreated: () => void }) {
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
    let fields: { name: string; type: string }[] = safeJsonParse<{ name: string; type: string }[]>(s.fields, []);
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
              {databases.map((d) => <option key={d.id} value={d.path}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Table name</Label>
            <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="articles" />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Load columns from a Schema (mapper)</Label>
          <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && loadFromSchema(e.target.value)}>
            <option value="">— choose a schema to map its fields → columns —</option>
            {schemas.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">This maps each schema field to a DuckDB column (with the right type) and pre-fills the table below.</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Columns</Label>
            <Button variant="outline" size="sm" onClick={addCol}><Plus className="mr-1 h-3.5 w-3.5" /> Add column</Button>
          </div>
          {cols.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_150px_auto] items-end gap-2">
              <Input value={c.name} onChange={(e) => updateCol(i, { name: e.target.value })} placeholder="column name" />
              <select className="rounded-md border bg-background px-2 py-2 text-sm" value={c.type} onChange={(e) => updateCol(i, { type: e.target.value })}>
                {DUCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button size="icon" variant="ghost" onClick={() => removeCol(i)}>
                <Trash2 className="h-4 w-4 text-red-500" />
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

function ResultTable({ result }: { result: DuckDBQueryResult | null }) {
  if (!result) return <p className="text-sm text-muted-foreground">Run a query to see results.</p>;
  if (result.error) return <p className="text-sm text-red-500">{result.error}</p>;
  if (!result.columns?.length) return <p className="text-sm text-muted-foreground">No columns returned.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="border-b px-2 py-1 text-left font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="odd:bg-background even:bg-muted/30">
              {row.map((cell, j) => (
                <td key={j} className="max-w-[20rem] truncate border-b px-2 py-1">{cell == null ? "" : String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 text-xs text-muted-foreground">{result.row_count} rows</div>
    </div>
  );
}
