import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PromptTemplate, SchemaDef } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function Prompts() {
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [schemas, setSchemas] = useState<SchemaDef[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    system_prompt: "",
    extraction_prompt: "",
    variables: "",
    schema_id: "",
  });
  const load = () => {
    api.prompts().then(setItems).catch(() => {});
    api.schemas().then(setSchemas).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      await api.savePrompt({
        name: form.name,
        system_prompt: form.system_prompt,
        extraction_prompt: form.extraction_prompt,
        variables: form.variables.split(",").map((v) => v.trim()).filter(Boolean),
        schema_id: form.schema_id ? Number(form.schema_id) : null,
      });
      setForm({ name: "", system_prompt: "", extraction_prompt: "", variables: "", schema_id: "" });
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Prompt Editor</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prompt templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.length === 0 && <p className="text-sm text-muted-foreground">No prompts yet.</p>}
            {items.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">v{p.version} · {p.extraction_prompt.slice(0, 40) || "—"}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => api.deletePrompt(p.id).then(load).catch((e) => toast.error(String(e)))}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New prompt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>System prompt</Label>
              <Textarea value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Extraction prompt</Label>
              <Textarea value={form.extraction_prompt} onChange={(e) => setForm({ ...form, extraction_prompt: e.target.value })} rows={5} placeholder="Extract the fields described in the schema from the article text." />
            </div>
            <div className="space-y-1">
              <Label>Variables (comma separated)</Label>
              <Input value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} placeholder="title, author, published" />
            </div>
            <div className="space-y-1">
              <Label>Linked schema</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.schema_id} onChange={(e) => setForm({ ...form, schema_id: e.target.value })}>
                <option value="">None</option>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Save prompt
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
