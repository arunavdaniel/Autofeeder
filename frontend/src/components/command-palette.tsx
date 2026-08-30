import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  Play,
  Rss,
  Database,
  Workflow,
  Settings,
  Globe,
  History,
  Library,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PaletteItem = {
  label: string;
  keywords: string;
  icon: typeof Search;
  action: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (to: string) => {
    navigate(to);
    onOpenChange(false);
  };

  const items = useMemo<PaletteItem[]>(
    () => [
      { label: "Overview", keywords: "home dashboard", icon: Search, action: () => go("/") },
      { label: "New pipeline", keywords: "create workflow extract", icon: Plus, action: () => go("/pipelines?new=1") },
      { label: "Discover sources", keywords: "catalog feeds apis websites feedly browse", icon: Library, action: () => go("/discover") },
      { label: "Add RSS feed", keywords: "sources subscribe atom", icon: Rss, action: () => go("/sources") },
      { label: "Run history", keywords: "logs jobs status", icon: Play, action: () => go("/runs") },
      { label: "Pipelines", keywords: "workflow schedule snapshot timer", icon: Workflow, action: () => go("/pipelines") },
      { label: "Snapshot job", keywords: "schedule capture timer feeds", icon: Workflow, action: () => go("/pipelines?mode=snapshot") },
      { label: "DuckDB browser", keywords: "sql query data table", icon: Database, action: () => go("/duckdb") },
      { label: "Websites", keywords: "monitor scrape change", icon: Globe, action: () => go("/websites") },
      { label: "Exports", keywords: "publish rss json csv parquet sync upsert files", icon: Database, action: () => go("/exports") },
      { label: "Publish RSS or JSON", keywords: "feed api endpoint", icon: Rss, action: () => go("/exports?tab=publish") },
      { label: "Sync target", keywords: "sqlite upsert postgres", icon: Database, action: () => go("/exports?tab=sync") },
      { label: "Feeds", keywords: "rss atom library subscribe", icon: Rss, action: () => go("/sources") },
      { label: "API sources", keywords: "json poll endpoint", icon: Globe, action: () => go("/api-sources") },
      { label: "Prompts", keywords: "templates extraction", icon: Settings, action: () => go("/prompts") },
      { label: "Settings", keywords: "llm api backup config appearance theme", icon: Settings, action: () => go("/settings") },
      { label: "Schemas", keywords: "fields mapper structure", icon: Settings, action: () => go("/schemas") },
      { label: "Keywords", keywords: "filter boost tags", icon: Settings, action: () => go("/keywords") },
      { label: "Snapshots", keywords: "captures archive", icon: Database, action: () => go("/snapshots") },
      { label: "Stats", keywords: "charts metrics", icon: History, action: () => go("/stats") },
      { label: "Recent runs", keywords: "history extraction", icon: History, action: () => go("/runs") },
    ],
    [navigate, onOpenChange],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q),
    );
  }, [query, items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <div className="relative">
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages and actions…"
              className="border-0 bg-transparent pl-7 shadow-none focus-visible:ring-0"
            />
          </div>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matches</p>
          )}
          {results.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.action}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          <kbd className="rounded-md border bg-muted px-1.5 py-0.5">⌘</kbd>
          <kbd className="ml-1 rounded-md border bg-muted px-1.5 py-0.5">K</kbd>
          <span className="ml-2">anywhere</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
