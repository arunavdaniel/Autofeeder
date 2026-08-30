import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { EmbeddingModelOption, EmbeddingProviderOption } from "@/lib/embedding-models";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FALLBACK: EmbeddingProviderOption[] = [
  {
    id: "local",
    name: "Local",
    default_endpoint: "",
    needs_key: false,
    models: [
      { id: "local-hash", name: "Hash vectors", notes: "No extra install" },
      { id: "all-MiniLM-L6-v2", name: "MiniLM L6 v2" },
      { id: "all-mpnet-base-v2", name: "MPNet base v2" },
      { id: "BAAI/bge-small-en-v1.5", name: "BGE small English v1.5" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    default_endpoint: "https://api.openai.com/v1",
    needs_key: true,
    models: [
      { id: "text-embedding-3-small", name: "text-embedding-3-small" },
      { id: "text-embedding-3-large", name: "text-embedding-3-large" },
      { id: "text-embedding-ada-002", name: "text-embedding-ada-002" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    default_endpoint: "http://localhost:11434/v1",
    needs_key: false,
    models: [
      { id: "nomic-embed-text", name: "nomic-embed-text" },
      { id: "mxbai-embed-large", name: "mxbai-embed-large" },
      { id: "all-minilm", name: "all-minilm" },
      { id: "bge-m3", name: "bge-m3" },
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    default_endpoint: "http://localhost:1234/v1",
    needs_key: false,
    models: [{ id: "text-embedding-nomic-embed-text-v1.5", name: "Nomic (LM Studio)" }],
  },
  {
    id: "gemini",
    name: "Gemini",
    default_endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    needs_key: true,
    models: [
      { id: "text-embedding-004", name: "text-embedding-004" },
      { id: "gemini-embedding-001", name: "gemini-embedding-001" },
    ],
  },
];

export function EmbeddingModelFields({
  provider,
  model,
  endpoint,
  apiKey,
  compact,
  onChange,
}: {
  provider: string;
  model: string;
  endpoint?: string;
  apiKey?: string;
  compact?: boolean;
  onChange: (patch: { provider?: string; model?: string; endpoint?: string; api_key?: string }) => void;
}) {
  const [providers, setProviders] = useState<EmbeddingProviderOption[]>(FALLBACK);
  useEffect(() => {
    api
      .embeddingModels()
      .then((data) => {
        if (data.providers?.length) setProviders(data.providers);
      })
      .catch(() => {});
  }, []);

  const current = providers.find((p) => p.id === provider) || providers[0];
  const knownIds = useMemo(() => new Set((current?.models || []).map((m) => m.id)), [current]);
  const modelValue = knownIds.has(model) ? model : "__custom__";
  const selected = current?.models.find((m) => m.id === model);
  const labelClass = compact ? "text-[10px]" : "text-sm";
  const inputClass = compact ? "h-8 text-xs" : "";

  const applyProvider = (next: string) => {
    const info = providers.find((p) => p.id === next) || providers[0];
    onChange({
      provider: next,
      endpoint: info.default_endpoint || "",
      model: info.models[0]?.id || "",
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className={labelClass}>Embedding provider</Label>
          <select
            className={`w-full rounded-md border bg-background px-2 py-1 ${compact ? "h-8 text-xs" : "h-10 text-sm"}`}
            value={provider}
            onChange={(e) => applyProvider(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className={labelClass}>Embedding model</Label>
          <select
            className={`w-full rounded-md border bg-background px-2 py-1 ${compact ? "h-8 text-xs" : "h-10 text-sm"}`}
            value={modelValue}
            onChange={(e) => {
              if (e.target.value === "__custom__") onChange({ model: model && !knownIds.has(model) ? model : "" });
              else onChange({ model: e.target.value });
            }}
          >
            {(current?.models || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="__custom__">Custom model id…</option>
          </select>
        </div>
      </div>
      {modelValue === "__custom__" && (
        <div className="space-y-1">
          <Label className={labelClass}>Custom model id</Label>
          <Input className={inputClass} value={knownIds.has(model) ? "" : model} onChange={(e) => onChange({ model: e.target.value })} placeholder="model id" />
        </div>
      )}
      {provider !== "local" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className={labelClass}>Endpoint</Label>
            <Input className={inputClass} value={endpoint || ""} onChange={(e) => onChange({ endpoint: e.target.value })} />
          </div>
          {current?.needs_key !== false && (
            <div className="space-y-1">
              <Label className={labelClass}>API key</Label>
              <Input type="password" className={inputClass} value={apiKey || ""} onChange={(e) => onChange({ api_key: e.target.value })} />
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {selected?.notes || current?.description || "Use the same model to index and search. Mixing models produces empty results."}
        {provider === "local" && model !== "local-hash" ? " First run downloads the model via sentence-transformers." : ""}
      </p>
    </div>
  );
}
