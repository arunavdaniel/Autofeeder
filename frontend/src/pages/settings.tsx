import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PROVIDERS = ["openai", "ollama", "lmstudio", "gemini", "custom"];
const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  custom: "",
};

export function Settings() {
  const [items, setItems] = useState<ApiConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    provider: "openai",
    endpoint: PROVIDER_ENDPOINTS.openai,
    model: "",
    temperature: "",
    timeout: "60",
  });
  const load = () => api.apiConfigs().then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      await api.saveApiConfig({
        name: form.name,
        provider: form.provider,
        endpoint: form.endpoint,
        model: form.model,
        temperature: form.temperature ? Number(form.temperature) : null,
        timeout: Number(form.timeout || 60),
      });
      setForm({ ...form, name: "", model: "", temperature: "" });
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">API Configurations</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved configurations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.length === 0 && <p className="text-sm text-muted-foreground">No configurations yet.</p>}
            {items.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.provider} · {c.model || "—"}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => api.deleteApiConfig(c.id).then(load).catch((e) => toast.error(String(e)))}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenAI Production" />
            </div>
            <div className="space-y-1">
              <Label>Provider</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.provider}
                onChange={(e) => {
                  const p = e.target.value;
                  setForm({ ...form, provider: p, endpoint: PROVIDER_ENDPOINTS[p] });
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Endpoint</Label>
              <Input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Model</Label>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="gpt-4o-mini" />
              </div>
              <div className="space-y-1">
                <Label>Timeout (s)</Label>
                <Input value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Temperature</Label>
              <Input value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} placeholder="0.2" />
            </div>
            <p className="text-xs text-muted-foreground">API keys stay in your browser (LLM settings), not on the server.</p>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Save configuration
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
