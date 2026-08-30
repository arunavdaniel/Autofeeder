import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiSource, SchemaDef } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  Braces,
  Loader2,
  Play,
  Save,
  ChevronRight,
  ChevronDown,
  Wand2,
} from "lucide-react";
import { safeJsonParse } from "@/lib/json";
import { toast } from "sonner";

function JsonTree({
  value,
  path = "",
  onPick,
}: {
  value: any;
  path?: string;
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(path.length < 1);
  const isObject = value !== null && typeof value === "object";
  if (!isObject)
    return (
      <button
        draggable
        className="block w-full cursor-grab truncate rounded px-2 py-1 text-left text-xs hover:bg-accent active:cursor-grabbing"
        onDragStart={(event) => event.dataTransfer.setData("text/plain", path)}
        onClick={() => onPick(path)}
        title="Drag this JSON value onto a schema field"
      >
        <span className="font-mono text-brand">{path.split(".").pop()}</span>
        <span className="ml-2 text-muted-foreground">{String(value)}</span>
      </button>
    );
  const entries = Array.isArray(value)
    ? value.slice(0, 20).map((item, index) => [String(index), item] as const)
    : Object.entries(value).slice(0, 100);
  return (
    <div className="ml-2">
      <button
        className="flex items-center gap-1 py-1 text-xs font-medium"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span className="font-mono">
          {path ? path.split(".").pop() : "JSON response"}
        </span>
        <span className="text-muted-foreground">
          {Array.isArray(value)
            ? `[${value.length}]`
            : `{${Object.keys(value).length}}`}
        </span>
      </button>
      {open && (
        <div className="border-l pl-2">
          {entries.map(([key, child]) => (
            <JsonTree
              key={key}
              value={child}
              path={path ? `${path}.${key}` : key}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ApiSources() {
  const [items, setItems] = useState<ApiSource[]>([]);
  const [form, setForm] = useState({ name: "", url: "", frequency: "1h" });
  const [busy, setBusy] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    items: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotCounts, setSnapshotCounts] = useState<Record<number, number>>(
    {},
  );
  const [schemas, setSchemas] = useState<SchemaDef[]>([]);
  const [designerSource, setDesignerSource] = useState<ApiSource | null>(null);
  const [payload, setPayload] = useState<any>(null);
  const [arrays, setArrays] = useState<
    Array<{ path: string; length: number; sample: any[] }>
  >([]);
  const [itemPointer, setItemPointer] = useState("");
  const [schemaId, setSchemaId] = useState("");
  const [fields, setFields] = useState<
    Array<{ schema_field: string; json_path: string; type: string }>
  >([]);
  const [activeField, setActiveField] = useState(0);
  const [mappedPreview, setMappedPreview] = useState<any[]>([]);

  const load = async () => {
    try {
      const res = await api.apiSources();
      setItems(res);
      const counts = await Promise.all(
        res.map(
          async (source) =>
            [
              source.id,
              (await api.apiSourceSnapshots(source.id)).length,
            ] as const,
        ),
      );
      setSnapshotCounts(Object.fromEntries(counts));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api
      .schemas()
      .then(setSchemas)
      .catch(() => {});
  }, []);

  const openDesigner = async (source: ApiSource) => {
    try {
      const result = await api.apiSourceJson(source.id);
      const saved = result.config || {};
      setDesignerSource(source);
      setPayload(result.payload);
      setArrays(result.arrays || []);
      const validPointer = (result.arrays || []).some((item) => item.path === saved.item_pointer);
      setItemPointer(validPointer ? saved.item_pointer : result.arrays?.[0]?.path || "$");
      setSchemaId(saved.schema_id ? String(saved.schema_id) : "");
      setFields((saved.fields || []).map((field: any) => ({ ...field, json_path: String(field.json_path || "").replace(/^0\./, "") })));
      setMappedPreview([]);
    } catch (e) {
      toast.error(String(e));
    }
  };
  const chooseSchema = (id: string) => {
    setSchemaId(id);
    const schema = schemas.find((item) => String(item.id) === id);
    if (!schema) return;
    const values = safeJsonParse<Array<{ name: string; type: string }>>(
      schema.fields,
      [],
    );
    setFields(
      values.map((field) => ({
        schema_field: field.name,
        json_path: "",
        type: field.type || "string",
      })),
    );
  };
  const updateField = (
    index: number,
    patch: Partial<{ schema_field: string; json_path: string; type: string }>,
  ) =>
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  const assignPath = (index: number, path: string) => {
    const prefix = itemPointer && itemPointer !== "$" ? `${itemPointer}.0.` : "";
    updateField(index, {
      json_path: path.startsWith(prefix) ? path.slice(prefix.length) : path,
    });
  };
  const previewMapping = async () => {
    if (!designerSource || !itemPointer)
      return toast.error("Select the array containing the records first");
    try {
      const result = await api.apiSourceJsonPreview(
        designerSource.id,
        payload,
        {
          schema_id: schemaId ? Number(schemaId) : null,
          item_pointer: itemPointer,
          fields,
        },
      );
      setMappedPreview(result.records);
    } catch (e) {
      toast.error(String(e));
    }
  };
  const saveDesigner = async () => {
    if (!designerSource || !itemPointer || !schemaId)
      return toast.error("Select a schema and item array first");
    try {
      await api.saveApiExtractionConfig(designerSource.id, {
        schema_id: Number(schemaId),
        item_pointer: itemPointer,
        fields: fields.filter((field) => field.schema_field && field.json_path),
      });
      toast.success("JSON extraction mapping saved");
      setDesignerSource(null);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.url.trim()) return toast.error("URL is required");
    try {
      await api.saveApiSource({
        name: form.name.trim() || form.url.trim(),
        url: form.url.trim(),
        frequency: form.frequency,
      });
      setForm({ name: "", url: "", frequency: "1h" });
      toast.success("API source added");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const check = async (id: number) => {
    setBusy(id);
    setPreview(null);
    try {
      const result = await api.checkApiSource(id);
      setPreview(result);
      toast.success(`Successfully fetched ${result.items.length} items`);
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deleteApiSource(id);
      toast.success("API source deleted");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Sources</h1>
        <p className="text-sm text-muted-foreground">
          Register custom JSON API endpoints to fetch structured data chunks for
          your extraction pipelines.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add API source</CardTitle>
          <CardDescription>
            Configure a JSON API feed to pull articles or structured logs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-4 md:grid-cols-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Developer Portal News"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="url">JSON API Endpoint URL</Label>
              <Input
                id="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://api.example.com/v1/posts.json"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="frequency">Fetch Frequency</Label>
              <select
                id="frequency"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.frequency}
                onChange={(e) =>
                  setForm({ ...form, frequency: e.target.value })
                }
              >
                {["5m", "10m", "15m", "30m", "1h", "6h", "daily"].map((x) => (
                  <option key={x} value={x}>
                    every {x}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="md:col-span-4 w-full">
              <Plus className="mr-1 h-4 w-4" /> Add API source
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Registered API Sources ({items.length})
        </h2>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 border rounded-lg bg-card">
            No API sources registered yet. Add an endpoint URL above to start.
          </p>
        ) : (
          items.map((site) => (
            <Card key={site.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="flex items-center gap-3 p-4">
                <Braces className="h-5 w-5 text-brand shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{site.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {site.url} · {site.frequency}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Last checked:{" "}
                    {site.last_checked
                      ? new Date(site.last_checked).toLocaleString()
                      : "never"}{" "}
                    · Snapshots: {snapshotCounts[site.id] ?? 0}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openDesigner(site)}
                  >
                    <Wand2 className="mr-1 h-3.5 w-3.5" /> Design
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => check(site.id)}
                    disabled={busy === site.id}
                  >
                    {busy === site.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Play className="mr-1 h-3.5 w-3.5" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(site.id)}
                    className="hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {designerSource && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              JSON extraction designer · {designerSource.name}
            </CardTitle>
            <CardDescription>
              Choose the record array, select a schema, then click JSON leaves
              to map fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Item array</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={itemPointer}
                  onChange={(e) => setItemPointer(e.target.value)}
                >
                  <option value="">Select an array or root object…</option>
                  {arrays.map((item) => (
                    <option key={item.path} value={item.path}>
                      {item.path === "$" ? "Root object" : item.path} ({item.length} record{item.length === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Extraction schema</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={schemaId}
                  onChange={(e) => chooseSchema(e.target.value)}
                >
                  <option value="">Select a schema…</option>
                  {schemas.map((schema) => (
                    <option key={schema.id} value={schema.id}>
                      {schema.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <div className="max-h-96 overflow-auto rounded border bg-muted/20 p-2">
                <div className="mb-2 text-xs text-muted-foreground">
                  Drag a JSON leaf onto a schema field, or click a leaf for the
                  selected row.
                </div>
                <JsonTree
                  value={payload}
                  onPick={(path) => assignPath(activeField, path)}
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Schema field mappings</div>
                {fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Select a schema to show its fields.
                  </p>
                )}
                {fields.map((field, index) => (
                  <div
                    key={index}
                    className={`grid gap-2 rounded border p-2 md:grid-cols-[1fr_1fr_100px] ${activeField === index ? "ring-2 ring-brand/40" : ""}`}
                    onClick={() => setActiveField(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const path = event.dataTransfer.getData("text/plain");
                      if (path) assignPath(index, path);
                    }}
                  >
                    <Input
                      value={field.schema_field}
                      onChange={(e) =>
                        updateField(index, { schema_field: e.target.value })
                      }
                      placeholder="Schema field"
                    />
                    <Input
                      value={field.json_path}
                      onChange={(e) =>
                        updateField(index, { json_path: e.target.value })
                      }
                      placeholder="data.name"
                    />
                    <Input
                      value={field.type}
                      onChange={(e) =>
                        updateField(index, { type: e.target.value })
                      }
                      placeholder="string"
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={previewMapping}>
                    <Play className="mr-1 h-4 w-4" /> Preview mapped records
                  </Button>
                  <Button
                    onClick={saveDesigner}
                    disabled={!schemaId || !itemPointer}
                  >
                    <Save className="mr-1 h-4 w-4" /> Save mapping
                  </Button>
                </div>
                {mappedPreview.length > 0 && (
                  <pre className="max-h-64 overflow-auto rounded border bg-muted/40 p-3 text-xs">
                    {JSON.stringify(mappedPreview, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card className="animate-in fade-in duration-200">
          <CardHeader>
            <CardTitle className="text-base">
              Test Fetch Results: {preview.title}
            </CardTitle>
            <CardDescription>
              Discovered {preview.items.length} normalised article/item chunks
              from the API response payload.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-96 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
              {preview.items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded border bg-muted/30 p-3 text-xs space-y-1"
                >
                  <div className="font-semibold text-foreground">
                    {item.title}
                  </div>
                  {item.url && (
                    <div className="text-muted-foreground truncate">
                      <strong>URL:</strong> {item.url}
                    </div>
                  )}
                  {item.published && (
                    <div className="text-muted-foreground">
                      <strong>Published:</strong> {item.published}
                    </div>
                  )}
                  {item.summary && (
                    <div className="text-muted-foreground">
                      <strong>Summary:</strong> {item.summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
