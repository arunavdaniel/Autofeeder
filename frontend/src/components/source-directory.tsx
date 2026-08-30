import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

export interface CatalogItem {
  id: string;
  title?: string;
  name?: string;
  url: string;
  category: string;
  description?: string;
  installed?: boolean;
  fetch_method?: string;
  frequency?: string;
  catalog_source?: string;
}

const PAGE_SIZE = 60;

export function SourceDirectory({
  kind,
  onInstalled,
}: {
  kind: "feeds" | "apis" | "websites";
  onInstalled?: () => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    setCategory("all");
    setQuery("");
    setItems([]);
    setOffset(0);
    setError(null);
  }, [kind]);

  const load = useCallback(
    async (opts?: { append?: boolean; nextOffset?: number }) => {
      const append = Boolean(opts?.append);
      const pageOffset = opts?.nextOffset ?? 0;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.catalog(kind, {
          q: query.trim() || undefined,
          category: category === "all" ? undefined : category,
          offset: pageOffset,
          limit: PAGE_SIZE,
        });
        setCategories(res.categories);
        setTotal(res.total);
        setOffset(pageOffset + res.items.length);
        setItems((current) => (append ? [...current, ...res.items] : res.items));
      } catch (e) {
        const message = String(e);
        setError(message);
        if (!append) setItems([]);
        toast.error(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [kind, query, category],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const visibleCategory = category;
  const hasMore = items.length < total;

  const installOne = async (id: string) => {
    setBusyId(id);
    try {
      const res = await api.installCatalog({ kind, ids: [id] });
      if (res.added) {
        toast.success("Added — next: put it on a pipeline", {
          action: {
            label: "New pipeline",
            onClick: () => navigate("/pipelines?new=1"),
          },
        });
      } else if (res.skipped) toast.message("Already in your library");
      if (res.errors?.length) toast.error(res.errors[0].error);
      await load();
      onInstalled?.();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const installCategory = async () => {
    if (visibleCategory === "all") return;
    setBulkBusy(true);
    try {
      const res = await api.installCatalog({ kind, category: visibleCategory });
      toast.success(`Added ${res.added} source(s)${res.skipped ? ` · ${res.skipped} already had` : ""}`);
      if (res.errors?.length) toast.error(`${res.errors.length} failed to add`);
      await load();
      onInstalled?.();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const label = (item: CatalogItem) => item.title || item.name || item.url;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="lg:w-52 lg:shrink-0">
        <div className="sticky top-0 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categories</div>
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
              category === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                category === cat ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              <span className="truncate">{cat}</span>
            </button>
          ))}
          {category !== "all" && (
            <Button variant="outline" size="sm" className="mt-2 w-full rounded-xl" onClick={installCategory} disabled={bulkBusy}>
              {bulkBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              Add all {category}
            </Button>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kind}…`}
            className="h-11 rounded-xl bg-background pl-10"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading catalog…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-dashed px-6 py-16 text-center">
            <p className="text-sm font-medium">Could not load catalog</p>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Start the backend with <code className="rounded bg-muted px-1 py-0.5">python -m rss_reader.web</code>, then click Try again.
            </p>
            <Button className="mt-4 rounded-xl" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No matches. Try another category or search term.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{label(item)}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {item.category}
                        </Badge>
                        {item.catalog_source ? (
                          <Badge variant="outline" className="text-[10px]">
                            {item.catalog_source}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {item.installed && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium">
                        <Check className="h-3 w-3" /> Added
                      </span>
                    )}
                  </div>
                  <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{item.url}</div>
                  {kind === "websites" && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {item.fetch_method || "http"} · every {item.frequency || "1h"}
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="mt-3 w-full rounded-xl"
                    variant={item.installed ? "outline" : "default"}
                    disabled={item.installed || busyId === item.id}
                    onClick={() => installOne(item.id)}
                  >
                    {busyId === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : item.installed ? (
                      "In your library"
                    ) : (
                      <>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  disabled={loadingMore}
                  onClick={() => void load({ append: true, nextOffset: offset })}
                >
                  {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Load more ({items.length} of {total})
                </Button>
              </div>
            )}
          </>
        )}
        {!loading && !error && category !== "all" && (
          <p className="text-center text-xs text-muted-foreground">
            Showing {items.length} of {total} in {category}
          </p>
        )}
      </div>
    </div>
  );
}
