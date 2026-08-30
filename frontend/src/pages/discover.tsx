import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceDirectory } from "@/components/source-directory";
import { Button } from "@/components/ui/button";
import { Rss, Braces, Globe, Library, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type CatalogSource = {
  id: string;
  name: string;
  repo: string;
  description?: string;
  count?: number;
};

export function Discover() {
  const [summary, setSummary] = useState<{
    feeds: number;
    apis: number;
    websites: number;
    sources?: Record<string, CatalogSource | CatalogSource[]>;
  } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadSummary = () =>
    api
      .catalogSummary()
      .then((data) => {
        setSummary(data);
        setSummaryError(null);
      })
      .catch((e) => setSummaryError(String(e)));

  useEffect(() => {
    loadSummary();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.refreshCatalog();
      setSummary((prev) => ({
        feeds: res.feeds,
        apis: res.apis,
        websites: res.websites,
        sources: prev?.sources,
      }));
      toast.success("Catalog refreshed from open-source providers");
      await loadSummary();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const sources = summary?.sources;

  return (
    <PageShell
      title="Discover"
      description="Install a feed, API, or website, then put it on a pipeline. Catalog installs land in Feeds, APIs, or Websites."
      width="7xl"
      actions={
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh catalog
        </Button>
      }
    >
      <div className="glass-panel space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl border bg-background">
              <Library className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">Open-source catalogs</div>
              <p className="text-sm text-muted-foreground">
                {summaryError
                  ? "Catalog API unavailable — restart the backend server, then refresh."
                  : summary
                    ? `${summary.feeds} feeds · ${summary.apis} APIs · ${summary.websites} websites in catalog. After Add, create a pipeline.`
                    : "Loading catalog…"}
              </p>
            </div>
          </div>
        </div>

        {sources && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(Array.isArray(sources.feed_catalogs) ? sources.feed_catalogs : []).map((source) => (
              <a
                key={source.id}
                href={source.repo}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/60 p-4 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {source.name}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{source.description}</p>
                </div>
              </a>
            ))}
            {(["apis", "websites"] as const).map((kind) => {
              const source = sources[kind];
              if (!source || Array.isArray(source)) return null;
              return (
                <a
                  key={kind}
                  href={source.repo}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/60 p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {source.name}
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{source.description}</p>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <Tabs defaultValue="feeds">
        <TabsList className="h-11 rounded-xl p-1">
          <TabsTrigger value="feeds" className="gap-2 rounded-lg px-4">
            <Rss className="h-4 w-4" /> RSS feeds
          </TabsTrigger>
          <TabsTrigger value="apis" className="gap-2 rounded-lg px-4">
            <Braces className="h-4 w-4" /> JSON APIs
          </TabsTrigger>
          <TabsTrigger value="websites" className="gap-2 rounded-lg px-4">
            <Globe className="h-4 w-4" /> Websites
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feeds" className="mt-6">
          <SourceDirectory kind="feeds" />
        </TabsContent>
        <TabsContent value="apis" className="mt-6">
          <SourceDirectory kind="apis" />
        </TabsContent>
        <TabsContent value="websites" className="mt-6">
          <SourceDirectory kind="websites" />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
