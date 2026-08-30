export interface LLMSettings {
  endpoint: string;
  model: string;
  api_key: string;
  prompt: string;
  firecrawl_api_key: string;
  firecrawl_base_url: string;
}

const KEY = "autofeedly-llm";

export function loadLLM(): LLMSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LLMSettings>;
      return {
        endpoint: parsed.endpoint ?? "",
        model: parsed.model ?? "",
        api_key: parsed.api_key ?? "",
        prompt: parsed.prompt ?? "",
        firecrawl_api_key: parsed.firecrawl_api_key ?? "",
        firecrawl_base_url: parsed.firecrawl_base_url ?? "https://api.firecrawl.dev",
      };
    }
  } catch {
    /* ignore */
  }
  return {
    endpoint: "",
    model: "",
    api_key: "",
    prompt: "",
    firecrawl_api_key: "",
    firecrawl_base_url: "https://api.firecrawl.dev",
  };
}

export function saveLLM(settings: LLMSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
