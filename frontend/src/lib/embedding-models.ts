export type EmbeddingModelOption = {
  id: string;
  name: string;
  dims?: number;
  notes?: string;
};

export type EmbeddingProviderOption = {
  id: string;
  name: string;
  description?: string;
  default_endpoint?: string;
  needs_key?: boolean;
  models: EmbeddingModelOption[];
};
