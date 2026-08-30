import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { safeJsonParse } from "@/lib/json";
import type { SchemaDef } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Database } from "lucide-react";
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

export function Schemas() {
  const [items, setItems] = useState<SchemaDef[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([
    { name: "title", type: "string", description: "Article title", required: true },
  ]);
  const [dbs, setDbs] = useState<{ id: number; name: string; path: string }[]>([]);
  const [mapSchema, setMapSchema] = useState<SchemaDef | null>(null);
  const [mapDb, setMapDb] = useState("");
  const [mapTable, setMapTable] = useState("");
  const [mapBusy, setMapBusy] = useState(false);

  const load = () => {
    api.schemas().then(setItems).catch(() => {});
    api.duckdbDatabases().then((d) => setDbs(d.map((x) => ({ id: x.id, name: x.name, path: x.path })))).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const addField = () => setFields((f) => [...f, { name: "", type: "string", description: "", required: false }]);
  const updateField = (i: number, patch: Partial<FieldRow>) =>
    setFields((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeField = (i: number) => setFields((f) => f.filter((_, idx) => idx !== i));

  const buildSchema = () => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of fields) {
      if (!f.name.trim()) continue;
      properties[f.name] = { type: f.type, description: f.description };
      if (f.required) required.push(f.name);
    }
    const schema = { type: "object", properties, ...(required.length ? { required } : {}) };
    return { schema, mappings: fields.filter((f) => f.name.trim()).map((f) => ({ source: f.name, target: f.name, type: f.type })) };
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    const { schema } = buildSchema();
    setBusy(true);
    try {
      await api.saveSchema({ name, json_schema: JSON.stringify(schema), fields: JSON.stringify(fields) });
      setName("");
      setFields([{ name: "title", type: "string", description: "Article title", required: true }]);
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Schema Generator</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved schemas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.length === 0 && <p className="text-sm text-muted-foreground">No schemas yet.</p>}
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{safeJsonParse<FieldRow[]>(s.fields, []).length} fields</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMapTable(s.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
                      setMapDb(dbs[0]?.path ?? "");
                      setMapSchema(s);
                    }}
                  >
                    <Database className="mr-1 h-3.5 w-3.5" /> Map to DuckDB
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => api.deleteSchema(s.id).then(load).catch((e) => toast.error(String(e)))}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schema generator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_110px_1fr_auto] items-end gap-2 rounded-lg border p-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Field</Label>
                    <Input value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="title" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <select className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={f.type} onChange={(e) => updateField(i, { type: e.target.value })}>
                      {["string", "number", "integer", "boolean", "date", "timestamp", "array", "object"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Input value={f.description} onChange={(e) => updateField(i, { description: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-1 pb-1">
                    <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                    <Button size="icon" variant="ghost" onClick={() => removeField(i)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addField}><Plus className="mr-1 h-4 w-4" /> Add field</Button>
            </div>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Save schema
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!mapSchema} onOpenChange={(v) => !v && setMapSchema(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Map schema “{mapSchema?.name}” → DuckDB table</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>DuckDB database</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={mapDb} onChange={(e) => setMapDb(e.target.value)}>
                <option value="">Select…</option>
                {dbs.map((d) => <option key={d.id} value={d.path}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Table name</Label>
              <Input value={mapTable} onChange={(e) => setMapTable(e.target.value)} placeholder="articles" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Field → column mapping (columns are created with these types)</Label>
            <div className="max-h-56 space-y-1 overflow-auto rounded-lg border p-2">
               {(mapSchema ? safeJsonParse<FieldRow[]>(mapSchema.fields, []) : []).map((f: FieldRow, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate font-medium">{f.name || "—"}</span>
                  <span className="text-muted-foreground">→ {f.name || "—"} : {duckTypeFromField(f.type)}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMapSchema(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!mapSchema || !mapDb || !mapTable.trim()) return toast.error("Database and table are required");
                let flds: FieldRow[] = safeJsonParse<FieldRow[]>(mapSchema.fields, []);
                const cols = flds.map((f) => ({ name: f.name, type: duckTypeFromField(f.type) }));
                if (!cols.length) return toast.error("Schema has no fields");
                setMapBusy(true);
                try {
                  const res = await api.duckdbCreateTable({ database: mapDb, table: mapTable.trim(), columns: cols, include_meta: true });
                  toast.success(`Table ${res.table} created (${res.columns.length} columns) from schema "${mapSchema.name}"`);
                  setMapSchema(null);
                } catch (e) { toast.error(String(e)); } finally { setMapBusy(false); }
              }}
              disabled={mapBusy || !mapDb || !mapTable.trim()}
            >
              {mapBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Database className="mr-1 h-4 w-4" />} Create table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
