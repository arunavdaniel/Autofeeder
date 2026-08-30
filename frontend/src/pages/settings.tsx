import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Loader2, Download, Upload, SlidersHorizontal, HardDrive, Brain, Moon, Sun, Monitor, Circle } from "lucide-react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";
import { EmbeddingModelFields } from "@/components/embedding-model-fields";

const PROVIDERS = ["openai", "ollama", "lmstudio", "gemini", "custom"];
const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  custom: "",
};

export function Settings() {
  const { theme, setTheme } = useTheme();
  const [items, setItems] = useState<ApiConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [embBusy, setEmbBusy] = useState(false);
  const [emb, setEmb] = useState({
    provider: "local",
    model: "all-MiniLM-L6-v2",
    endpoint: "",
    api_key: "",
  });
  const [form, setForm] = useState({
    name: "",
    provider: "openai",
    endpoint: PROVIDER_ENDPOINTS.openai,
    model: "",
    temperature: "",
    timeout: "60",
  });
  const load = () => api.apiConfigs().then(setItems).catch(() => {});
  useEffect(() => {
    load();
    api
      .embeddingConfig()
      .then((data) =>
        setEmb({
          provider: String(data.provider || "local"),
          model: String(data.model || "all-MiniLM-L6-v2"),
          endpoint: String(data.endpoint || ""),
          api_key: String(data.api_key || ""),
        }),
      )
      .catch(() => {});
  }, []);
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
      toast.success("Configuration saved");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageShell
      title="Settings"
      description="Appearance, LLM configs, embedding models, and local backups."
      width="5xl"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Paper, ink dark, full black, or follow the OS. Teal is used for actions.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(
            [
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "black", label: "Full black", icon: Circle },
              { id: "system", label: "System", icon: Monitor },
            ] as { id: Theme; label: string; icon: typeof Sun }[]
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              variant={theme === opt.id ? "default" : "outline"}
              className="gap-2"
              onClick={() => setTheme(opt.id)}
            >
              <opt.icon className="h-4 w-4" />
              {opt.label}
            </Button>
          ))}
        </CardContent>
      </Card>
      <Tabs defaultValue="api" className="space-y-4">
        <TabsList>
          <TabsTrigger value="api" className="gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            API configs
          </TabsTrigger>
          <TabsTrigger value="embeddings" className="gap-2">
            <Brain className="h-4 w-4" />
            Embeddings
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-2">
            <HardDrive className="h-4 w-4" />
            Data & backup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Saved configurations</CardTitle>
                <CardDescription>Reusable endpoint presets for pipelines and extraction.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No configurations yet.</p>
                )}
                {items.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-xl border bg-muted/10 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.provider} · {c.model || "—"}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => api.deleteApiConfig(c.id).then(load).catch((e) => toast.error(String(e)))}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New configuration</CardTitle>
                <CardDescription>API keys stay in browser local storage, not on the server.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="OpenAI Production"
                  />
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
                      <option key={p} value={p}>
                        {p}
                      </option>
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
                    <Input
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      placeholder="gpt-4o-mini"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Timeout (s)</Label>
                    <Input value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Temperature</Label>
                  <Input
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                    placeholder="0.2"
                  />
                </div>
                <Button onClick={submit} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}{" "}
                  Save configuration
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="embeddings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Default embedding model</CardTitle>
              <CardDescription>
                Used for semantic search and as the default when a pipeline indexes chunks. Index and query must use the same model.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <EmbeddingModelFields
                provider={emb.provider}
                model={emb.model}
                endpoint={emb.endpoint}
                apiKey={emb.api_key}
                onChange={(patch) =>
                  setEmb((current) => ({
                    ...current,
                    provider: patch.provider ?? current.provider,
                    model: patch.model ?? current.model,
                    endpoint: patch.endpoint ?? current.endpoint,
                    api_key: patch.api_key ?? current.api_key,
                  }))
                }
              />
              <Button
                disabled={embBusy}
                onClick={async () => {
                  setEmbBusy(true);
                  try {
                    await api.saveEmbeddingConfig(emb);
                    toast.success("Embedding model saved");
                  } catch (e) {
                    toast.error(String(e));
                  } finally {
                    setEmbBusy(false);
                  }
                }}
              >
                {embBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Save embedding model
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data backup</CardTitle>
              <CardDescription>
                Zip your SQLite metadata and registered DuckDB files. Restore replaces local data — restart the app
                after restoring.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true);
                  try {
                    const result = await api.createBackup();
                    toast.success(`Backup saved (${result.filename})`);
                  } catch (e) {
                    toast.error(String(e));
                  } finally {
                    setBackupBusy(false);
                  }
                }}
              >
                {backupBusy ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                Download backup
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50">
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  disabled={restoreBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (!window.confirm("Restore will replace local data. Continue?")) return;
                    setRestoreBusy(true);
                    try {
                      const result = await api.restoreBackup(file);
                      toast.success(
                        `Restored ${result.restored_duckdb_files} DuckDB file(s). Restart Autofeeder to finish.`,
                      );
                    } catch (err) {
                      toast.error(String(err));
                    } finally {
                      setRestoreBusy(false);
                    }
                  }}
                />
                {restoreBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Restore backup
              </label>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
