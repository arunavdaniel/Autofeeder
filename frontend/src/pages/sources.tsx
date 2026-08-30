import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { loadLLM, saveLLM } from "@/lib/llm-settings";
import type { Folder, Snapshot, SnapshotArticle } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PromptDialog } from "@/components/prompt-dialog";
import {
  FolderPlus,
  Rss,
  Plus,
  Pencil,
  Trash2,
  Camera,
  FileDown,
  Sparkles,
  Loader2,
  Workflow,
  RefreshCw,
  Search,
  Star,
  Check,
  Upload,
  X,
  Database,
  Flame,
  Clock,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { setStatus, clearStatus } from "@/lib/status";

type Article = Record<string, any>;

export function Sources() {
  return (
    <Tabs defaultValue="library" className="flex h-full flex-col">
      <div className="border-b px-6 py-3">
        <TabsList>
          <TabsTrigger value="library">Feed Library</TabsTrigger>
          <TabsTrigger value="extractions">Extractions</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="library" className="mt-0 flex-1 overflow-hidden">
        <FeedLibrary />
      </TabsContent>
      <TabsContent value="extractions" className="mt-0 flex-1 overflow-auto">
        <ExtractionsTab />
      </TabsContent>
    </Tabs>
  );
}

function FeedLibrary() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [feedChecks, setFeedChecks] = useState<number[]>([]);
  const [folderChecks, setFolderChecks] = useState<number[]>([]);
  const [selectedFeed, setSelectedFeed] = useState<number | null>(null);
  const [items, setItems] = useState<Article[]>([]);
  const [current, setCurrent] = useState<Article | null>(null);
  const [viewSnapshot, setViewSnapshot] = useState<SnapshotArticle[] | null>(null);
  const [viewSnapshotName, setViewSnapshotName] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Article[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [opmlOpen, setOpmlOpen] = useState(false);
  const [fetchSource, setFetchSource] = useState("builtin");
  const [fcKey, setFcKey] = useState(() => loadLLM().firecrawl_api_key);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const doSearch = async () => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await api.search(q);
      setSearchResults(res.results as Article[]);
    } catch (e) {
      toast.error(String(e));
    }
  };
  const clearSearch = () => {
    setSearch("");
    setSearchResults(null);
  };
  const toggleSelect = (i: number) =>
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  const bulkExtract = async () => {
    if (!selected.length) return;
    const fcOpts = fetchSource === "firecrawl" ? { fetch_source: "firecrawl", firecrawl_api_key: fcKey, firecrawl_base_url: loadLLM().firecrawl_base_url || "https://api.firecrawl.dev" } : undefined;
    setProgress({ current: 0, total: selected.length });
    setStatus({ label: `Extracting ${selected.length} article(s)…`, progress: { current: 0, total: selected.length } });
    try {
      let done = 0;
      for (const i of selected) {
        await api.extractArticle(items[i], "", fcOpts);
        done += 1;
        setProgress({ current: done, total: selected.length });
        setStatus({ label: `Extracting ${selected.length} article(s)…`, progress: { current: done, total: selected.length } });
      }
      toast.success(`Extracted ${selected.length} article(s).`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setProgress(null);
      clearStatus();
    }
  };

  const [addFolder, setAddFolder] = useState(false);
  const [addFeed, setAddFeed] = useState(false);
  const [renameFeed, setRenameFeed] = useState<{ id: number; name: string } | null>(null);
  const [renameFolder, setRenameFolder] = useState<{ id: number; name: string } | null>(null);
  const [renameSnap, setRenameSnap] = useState<{ id: number; name: string } | null>(null);
  const [capture, setCapture] = useState(false);

  const load = () => {
    api.folders().then(setFolders).catch(() => {});
    api.snapshots().then(setSnapshots).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const selectFeed = async (id: number) => {
    setSelectedFeed(id);
    setViewSnapshot(null);
    setCurrent(null);
    try {
      const data = await api.feedItems(id);
      setItems(data.items as Article[]);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const openItem = async (item: Article, source: string) => {
    try {
      const art = await api.extractArticle(item, source);
      setCurrent(art as Article);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const viewSnap = async (id: number) => {
    try {
      const data = await api.snapshot(id);
      setViewSnapshot(data.articles);
      setViewSnapshotName(data.snapshot.name || data.snapshot.source || "");
      setSelectedFeed(null);
      setItems([]);
      setCurrent(null);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const allFeedIds = () => {
    const folderIds = new Set(folderChecks);
    const fromFolders = folders
      .filter((f) => folderIds.has(f.id))
      .flatMap((f) => f.feeds.map((x) => x.id));
    return [...new Set([...feedChecks, ...fromFolders])];
  };

  const toggleFeed = (id: number) =>
    setFeedChecks((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleFolder = (id: number) =>
    setFolderChecks((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="flex h-full">
      <div className="flex w-80 flex-col gap-3 overflow-auto border-r p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Library</h2>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                const ids = allFeedIds();
                if (folderChecks.length === 1 && !feedChecks.length) {
                  navigate(`/pipelines?folder=${folderChecks[0]}`);
                } else if (ids.length) {
                  navigate(`/pipelines?new=1&feeds=${ids.join(",")}`);
                } else {
                  navigate("/pipelines?new=1");
                }
              }}
              title="Create pipeline"
            >
              <Workflow className="mr-1 h-3.5 w-3.5" /> Pipeline
            </Button>
            <Button size="icon" variant="ghost" onClick={load} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setOpmlOpen(true)} title="Import OPML">
              <Upload className="h-4 w-4" />
            </Button>
            <a
              href="/api/opml"
              download
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
              title="Export OPML"
            >
              <FileDown className="h-4 w-4" />
            </a>
            <Button size="icon" variant="ghost" onClick={() => setAddFolder(true)} title="New folder">
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setAddFeed(true)} title="Add Feed / API">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {folders.map((f) => (
            <div key={f.id} className="rounded-lg border">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Checkbox checked={folderChecks.includes(f.id)} onCheckedChange={() => toggleFolder(f.id)} />
                <span className="flex-1 text-sm font-medium">{f.name}</span>
                <Button size="icon" variant="ghost" onClick={() => setRenameFolder({ id: f.id, name: f.name })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => api.deleteFolder(f.id).then(load).catch((e) => toast.error(String(e)))}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
              <div className="space-y-1 pb-2 pl-3">
                {f.feeds.map((feed) => (
                  <div key={feed.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                    <Checkbox checked={feedChecks.includes(feed.id)} onCheckedChange={() => toggleFeed(feed.id)} />
                    <button className="flex-1 text-left hover:underline" onClick={() => selectFeed(feed.id)}>
                      {feed.title}
                    </button>
                    <Button size="icon" variant="ghost" onClick={() => setRenameFeed({ id: feed.id, name: feed.title })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => api.deleteFeed(feed.id).then(load).catch((e) => toast.error(String(e)))}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" className="mt-2" onClick={() => setCapture(true)} disabled={allFeedIds().length === 0}>
          <Camera className="mr-1 h-4 w-4" /> Capture feed snapshot
        </Button>

        <div className="mt-2">
          <h2 className="mb-2 text-sm font-semibold">Snapshots</h2>
          <div className="space-y-2">
            {snapshots.filter((s) => (s.type || s.kind || "feed") === "feed" || s.kind === "pipeline" || s.kind === "article").length === 0 && <p className="text-xs text-muted-foreground">No snapshots yet.</p>}
            {snapshots
              .filter((s) => ["feed", "pipeline", "article"].includes(s.type || s.kind || "feed"))
              .map((s) => (
              <div key={`${s.type || s.kind}-${s.id}`} className="rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{s.kind || s.type || "snapshot"}</Badge>
                  <span className="flex-1 truncate text-sm font-medium">{s.name || s.source || `Snapshot ${s.id}`}</span>
                  <Button size="icon" variant="ghost" onClick={() => setRenameSnap({ id: s.id, name: s.name || s.source || "" })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => api.deleteSnapshot(s.id).then(load).catch((e) => toast.error(String(e)))}>
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </div>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => viewSnap(s.id)}>View</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/pipelines?snapshot=${s.id}`)}>
                    <Workflow className="mr-1 h-3.5 w-3.5" /> Pipeline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search captured articles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
          </div>
          <Button variant="outline" size="sm" onClick={doSearch}>Search</Button>
          {searchResults && (
            <Button variant="ghost" size="icon" onClick={clearSearch} title="Clear">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {searchResults ? (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold">Search results ({searchResults.length})</h1>
            <div className="space-y-2">
              {searchResults.length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  className="block w-full rounded-lg border p-3 text-left hover:bg-accent/50"
                  onClick={() => { setCurrent({ ...r, links: r.links || [] }); setSearchResults(null); }}
                >
                  <div className="font-medium">{r.title || "Untitled"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.source}
                    {(r as any).snapshot_name ? ` · ${(r as any).snapshot_name}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : current ? (
          <ArticleView article={current} onBack={() => setCurrent(null)} />
        ) : viewSnapshot ? (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold">{viewSnapshotName}</h1>
            <div className="grid gap-2 md:grid-cols-2">
              {viewSnapshot.map((a, i) => (
                <div key={i} className="rounded-lg border p-3 text-left hover:bg-accent/50">
                  <button className="block w-full text-left" onClick={() => setCurrent({ ...a, links: a.links || [] })}>
                    <div className="font-medium">{a.title || "Untitled"}</div>
                    <div className="text-xs text-muted-foreground">{a.published}</div>
                  </button>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className={`rounded-md border px-2 py-1 text-xs ${a.starred ? "bg-brand text-brand-foreground" : ""}`}
                      onClick={() => {
                        const v = !a.starred;
                        api.patchSnapshotArticle(a.id, { starred: v }).catch((e) => toast.error(String(e)));
                        setViewSnapshot((prev) => prev && prev.map((x) => (x.id === a.id ? { ...x, starred: v ? 1 : 0 } : x)));
                      }}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className={`rounded-md border px-2 py-1 text-xs ${a.read ? "bg-brand text-brand-foreground" : ""}`}
                      onClick={() => {
                        const v = !a.read;
                        api.patchSnapshotArticle(a.id, { read: v }).catch((e) => toast.error(String(e)));
                        setViewSnapshot((prev) => prev && prev.map((x) => (x.id === a.id ? { ...x, read: v ? 1 : 0 } : x)));
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold">{selectedFeed ? "Feed articles" : "Select a feed or snapshot"}</h1>
            {selectedFeed && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-md border bg-background px-2 py-1.5 text-xs"
                    value={fetchSource}
                    onChange={(e) => setFetchSource(e.target.value)}
                  >
                    <option value="builtin">Built-in</option>
                    <option value="firecrawl">Firecrawl</option>
                  </select>
                  {fetchSource === "firecrawl" && (
                    <Input
                      className="h-8 w-48 text-xs"
                      value={fcKey}
                      onChange={(e) => setFcKey(e.target.value)}
                      placeholder="Firecrawl API key"
                    />
                  )}
                  <Button variant="outline" size="sm" onClick={bulkExtract} disabled={!selected.length || !!progress}>
                    {progress ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} Extract selected ({selected.length})
                  </Button>
                </div>
                {progress && (
                  <div className="space-y-1">
                    <Progress value={(progress.current / progress.total) * 100} />
                    <p className="text-xs text-muted-foreground">
                      Extracting {progress.current} / {progress.total}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border p-3 hover:bg-accent/50">
                  {selectedFeed && (
                    <Checkbox checked={selected.includes(i)} onCheckedChange={() => toggleSelect(i)} />
                  )}
                  <button className="block flex-1 text-left" onClick={() => openItem(it, "")}>
                    <div className="font-medium">{it.title || "Untitled"}</div>
                    <div className="text-xs text-muted-foreground">{it.published}</div>
                  </button>
                </div>
              ))}
              {!selectedFeed && <p className="text-sm text-muted-foreground">Pick a feed on the left to load its articles.</p>}
            </div>
          </div>
        )}
      </div>

      <PromptDialog open={addFolder} onOpenChange={setAddFolder} title="New folder" label="Folder name"
        onConfirm={(v) => api.addFolder(v).then(load)} />
      <AddFeedDialog open={addFeed} onOpenChange={setAddFeed} folders={folders} onAdd={(url, folderId) => api.addFeed(url, folderId).then(load)} />
      <PromptDialog open={!!renameFeed} onOpenChange={(v) => !v && setRenameFeed(null)} title="Rename feed" label="Feed name"
        initialValue={renameFeed?.name ?? ""} onConfirm={(v) => { if (renameFeed) return api.renameFeed(renameFeed.id, v).then(load); }} />
      <PromptDialog open={!!renameFolder} onOpenChange={(v) => !v && setRenameFolder(null)} title="Rename folder" label="Folder name"
        initialValue={renameFolder?.name ?? ""} onConfirm={(v) => { if (renameFolder) return api.renameFolder(renameFolder.id, v).then(load); }} />
      <PromptDialog open={!!renameSnap} onOpenChange={(v) => !v && setRenameSnap(null)} title="Rename snapshot" label="Snapshot name"
        initialValue={renameSnap?.name ?? ""} onConfirm={(v) => { if (renameSnap) return api.renameSnapshot(renameSnap.id, v).then(load); }} />
      <CaptureDialog open={capture} onOpenChange={setCapture} count={allFeedIds().length}
        onConfirm={(name) => api.createFeedSnapshot({ name, feed_ids: allFeedIds(), folder_ids: folderChecks }).then(() => { setFeedChecks([]); setFolderChecks([]); load(); })} />
      <OpmlDialog open={opmlOpen} onOpenChange={setOpmlOpen}
        onImport={(content, folder) => api.importOpml(content, folder).then((r) => { toast.success(`Imported ${r.added} feed(s).`); load(); })} />
    </div>
  );
}





function ExtractionsTab() {
  const [dbs, setDbs] = useState<{ id: number; name: string; path: string }[]>([]);
  const [db, setDb] = useState("");
  const [table, setTable] = useState("extractions");
  const [result, setResult] = useState<{ columns: string[]; rows: unknown[][]; row_count: number; error?: string } | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feedChecks, setFeedChecks] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const load = () => {
    api.duckdbDatabases().then((d) => setDbs(d.map((x) => ({ id: x.id, name: x.name, path: x.path })))).catch(() => {});
    api.folders().then(setFolders).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const loadExtractions = async () => {
    if (!db) return;
    try {
      const res = await api.extractions(db, table);
      setResult(res);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const extractFromFeeds = async () => {
    if (!db || !feedChecks.length) return toast.error("Select a database and at least one feed");
    setBusy(true);
    try {
      const feeds = folders.flatMap((f) => f.feeds).filter((x) => feedChecks.includes(x.id));
      const records: Article[] = [];
      let done = 0;
      setProgress({ current: 0, total: feeds.length });
      setStatus({ label: `Extracting from ${feeds.length} feed(s)…`, progress: { current: 0, total: feeds.length } });
      for (const feed of feeds) {
        try {
          const data = await api.feedItems(feed.id);
          for (const it of data.items as Article[]) {
            const art = await api.extractArticle(it, feed.title);
            records.push(art as Article);
          }
        } catch {
          /* skip */
        }
        done += 1;
        setProgress({ current: done, total: feeds.length });
        setStatus({ label: `Extracting from ${feeds.length} feed(s)…`, progress: { current: done, total: feeds.length } });
      }
      const out = await api.persistExtractions({
        db,
        table,
        records,
        mappings: [
          { source: "title", target: "title", type: "string" },
          { source: "url", target: "url", type: "string" },
          { source: "source", target: "source", type: "string" },
          { source: "text", target: "text", type: "string" },
        ],
      });
      toast.success(`Stored ${out.records} extractions in ${out.table}`);
      loadExtractions();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
      clearStatus();
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Extractions</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Browse extracted articles</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>DuckDB database</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={db} onChange={(e) => setDb(e.target.value)}>
                <option value="">Select…</option>
                {dbs.map((d) => <option key={d.id} value={d.path}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Table</Label>
              <Input value={table} onChange={(e) => setTable(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={loadExtractions} disabled={!db} className="w-full">Load</Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Extract from feeds into this table</Label>
            <div className="flex flex-wrap gap-2">
              {folders.flatMap((f) => f.feeds).map((feed) => (
                <label key={feed.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  <Checkbox checked={feedChecks.includes(feed.id)} onCheckedChange={() => setFeedChecks((s) => (s.includes(feed.id) ? s.filter((x) => x !== feed.id) : [...s, feed.id]))} />
                  {feed.title}
                </label>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-1" onClick={extractFromFeeds} disabled={busy || !db || !feedChecks.length}>
              <Database className="mr-1 h-4 w-4" /> {busy ? "Extracting…" : "Extract & store"}
            </Button>
            {progress && (
              <div className="space-y-1">
                <Progress value={(progress.current / progress.total) * 100} />
                <p className="text-xs text-muted-foreground">Processing feed {progress.current} / {progress.total}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <ResultTable result={result} />
    </div>
  );
}

function ResultTable({ result }: { result: { columns: string[]; rows: unknown[][]; row_count: number; error?: string } | null }) {
  if (!result) return <p className="text-sm text-muted-foreground">Select a database and table to view extracted articles.</p>;
  if (result.error) return <p className="text-sm text-red-500">{result.error}</p>;
  if (!result.columns?.length) return <p className="text-sm text-muted-foreground">No columns returned.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="border-b px-2 py-1 text-left font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="odd:bg-background even:bg-muted/30">
              {row.map((cell, j) => (
                <td key={j} className="max-w-[20rem] truncate border-b px-2 py-1">{cell == null ? "" : String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 text-xs text-muted-foreground">{result.row_count} rows</div>
    </div>
  );
}

function ArticleView({ article, onBack }: { article: Article; onBack: () => void }) {
  const [view, setView] = useState<Article>(article);
  const [llm, setLlm] = useState(() => loadLLM());
  const [llmResult, setLlmResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapName, setSnapName] = useState(article.title || "");
  const [snapOpen, setSnapOpen] = useState(false);
  const [duckOpen, setDuckOpen] = useState(false);
  const [duckDb, setDuckDb] = useState("");
  const [duckTable, setDuckTable] = useState("articles");
  const [duckBusy, setDuckBusy] = useState(false);
  const [dbs, setDbs] = useState<{ id: number; name: string; path: string }[]>([]);
  const [fetchSource, setFetchSource] = useState("builtin");
  const [fcKey, setFcKey] = useState(llm.firecrawl_api_key);
  const [fcUrl, setFcUrl] = useState(llm.firecrawl_base_url || "https://api.firecrawl.dev");
  const [fetchBusy, setFetchBusy] = useState(false);

  const saveSnapshot = async () => {
    try {
      await api.createArticleSnapshot({ ...view, name: snapName });
      toast.success("Article snapshot saved.");
      setSnapOpen(false);
    } catch (e) {
      toast.error(String(e));
    }
  };

  useEffect(() => {
    if (duckOpen) api.duckdbDatabases().then((d) => setDbs(d.map((x) => ({ id: x.id, name: x.name, path: x.path })))).catch(() => {});
  }, [duckOpen]);

  const saveToDuck = async () => {
    if (!duckDb) return toast.error("Select a DuckDB database");
    setDuckBusy(true);
    try {
      const record: Record<string, unknown> = {
        title: view.title || "",
        url: view.url || "",
        source: view.source || "",
        published: view.published || "",
        text: view.text || "",
        llm_json: llmResult || "",
      };
      const out = await api.persistExtractions({
        db: duckDb,
        table: duckTable || "articles",
        records: [record],
        mappings: [
          { source: "title", target: "title", type: "VARCHAR" },
          { source: "url", target: "url", type: "VARCHAR" },
          { source: "source", target: "source", type: "VARCHAR" },
          { source: "published", target: "published", type: "VARCHAR" },
          { source: "text", target: "text", type: "VARCHAR" },
          { source: "llm_json", target: "llm_json", type: "JSON" },
        ],
        dedupe_key: "url",
      });
      toast.success(`Saved to DuckDB (${out.records} record).`);
      setDuckOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDuckBusy(false);
    }
  };

  const refetch = async () => {
    setFetchBusy(true);
    setStatus({ label: `Re-fetching via ${fetchSource === "firecrawl" ? "Firecrawl" : "built-in"}…`, indeterminate: true });
    try {
      let art: Article;
      if (fetchSource === "firecrawl") {
        if (!fcKey.trim()) return toast.error("Firecrawl API key is required");
        const res = await api.firecrawlExtract(view.url || "", fcKey.trim(), fcUrl.trim() || "https://api.firecrawl.dev");
        art = { ...view, ...(res as Article), url: view.url };
      } else {
        const res = await api.extractArticle(view, view.source || "", { fetch_source: "builtin" });
        art = res as Article;
      }
      setView(art);
      toast.success(`Re-fetched via ${fetchSource === "firecrawl" ? "Firecrawl" : "built-in"}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setFetchBusy(false);
      clearStatus();
    }
  };

  const extract = async () => {
    setBusy(true);
    setStatus({ label: "Running LLM extraction…", indeterminate: true });
    try {
      const res = await api.llmExtract({
        endpoint: llm.endpoint,
        model: llm.model,
        api_key: llm.api_key,
        prompt: llm.prompt,
        snapshot: view.text || "",
      });
      setLlmResult(JSON.stringify(res.result, null, 2));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      clearStatus();
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => api.exportText(view.text || "", `${(view.title || "article").slice(0, 40)}.txt`)}>
            <FileDown className="mr-1 h-4 w-4" /> Save TXT
          </Button>
          <Button variant="outline" onClick={() => setSnapOpen(true)}>
            <Camera className="mr-1 h-4 w-4" /> Save snapshot
          </Button>
          <Button variant="outline" onClick={() => setDuckOpen(true)}>
            <Database className="mr-1 h-4 w-4" /> Save to DuckDB
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="space-y-1">
          <Label className="text-xs">Fetch source</Label>
          <select className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={fetchSource} onChange={(e) => setFetchSource(e.target.value)}>
            <option value="builtin">Built-in (Trafilatura)</option>
            <option value="firecrawl">Firecrawl</option>
          </select>
        </div>
        {fetchSource === "firecrawl" && (
          <>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Firecrawl API key</Label>
              <Input value={fcKey} onChange={(e) => setFcKey(e.target.value)} placeholder="fc-…" />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Base URL (self-hosted)</Label>
              <Input
                value={fcUrl}
                onChange={(e) => {
                  setFcUrl(e.target.value);
                  saveLLM({ ...loadLLM(), firecrawl_base_url: e.target.value });
                }}
                placeholder="https://api.firecrawl.dev"
              />
            </div>
          </>
        )}
        <Button variant="outline" size="sm" onClick={refetch} disabled={fetchBusy || !view.url}>
          {fetchBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Re-fetch
        </Button>
      </div>
      {fetchBusy && <Progress indeterminate />}
      <h1 className="text-2xl font-semibold">{view.title}</h1>
      <p className="text-sm text-muted-foreground">{view.source} · {view.published}</p>
      <ScrollArea className="h-72 rounded-lg border bg-muted/30 p-4">
        <pre className="whitespace-pre-wrap text-sm">{view.text}</pre>
      </ScrollArea>
      {view.links?.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Links</h3>
          <ul className="list-inside list-disc text-sm">
            {view.links.map((l: any, i: number) => (
              <li key={i}>
                <a className="text-brand hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.text || l.url}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">LLM JSON extraction</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Endpoint" value={llm.endpoint} onChange={(e) => setLlm({ ...llm, endpoint: e.target.value })} />
            <Input placeholder="Model" value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })} />
          </div>
          <Input placeholder="API key (optional)" value={llm.api_key} onChange={(e) => setLlm({ ...llm, api_key: e.target.value })} />
          <Textarea placeholder="Extraction prompt" value={llm.prompt} onChange={(e) => setLlm({ ...llm, prompt: e.target.value })} />
          <Button onClick={extract} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />} Extract to JSON
          </Button>
          {busy && <Progress indeterminate />}
          {llmResult && <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs">{llmResult}</pre>}
        </CardContent>
      </Card>
      <Dialog open={snapOpen} onOpenChange={setSnapOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save article snapshot</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={snapName} onChange={(e) => setSnapName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnapOpen(false)}>Cancel</Button>
            <Button onClick={saveSnapshot}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={duckOpen} onOpenChange={setDuckOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save article to DuckDB</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>DuckDB database</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={duckDb} onChange={(e) => setDuckDb(e.target.value)}>
                <option value="">Select…</option>
                {dbs.map((d) => <option key={d.id} value={d.path}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Table</Label>
              <Input value={duckTable} onChange={(e) => setDuckTable(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuckOpen(false)} disabled={duckBusy}>Cancel</Button>
            <Button onClick={saveToDuck} disabled={duckBusy || !duckDb}>{duckBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddFeedDialog({ open, onOpenChange, folders, onAdd }: { open: boolean; onOpenChange: (v: boolean) => void; folders: Folder[]; onAdd: (url: string, folderId: number) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setUrl(""); setFolderId(folders[0]?.id ? String(folders[0].id) : ""); }
  }, [open, folders]);
  const submit = async () => {
    if (!url || !folderId) return;
    setBusy(true);
    try { await onAdd(url, Number(folderId)); onOpenChange(false); } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Feed / API Source</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Feed or JSON API URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/feed.xml or json-api-url" />
          </div>
          <div className="space-y-1">
            <Label>Folder</Label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !folders.length}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaptureDialog({ open, onOpenChange, count, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; count: number; onConfirm: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(`Feed snapshot ${new Date().toLocaleDateString()}`); }, [open]);
  const submit = async () => {
    setBusy(true);
    try { await onConfirm(name); onOpenChange(false); } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Capture feed snapshot</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{count} feed(s) selected will be fetched and stored.</p>
        <div className="space-y-1">
          <Label>Snapshot name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Capture"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpmlDialog({ open, onOpenChange, onImport }: { open: boolean; onOpenChange: (v: boolean) => void; onImport: (content: string, folder?: string) => Promise<void> }) {
  const [content, setContent] = useState("");
  const [folder, setFolder] = useState("Imported OPML");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setContent(""); setFolder("Imported OPML"); setFileName(""); } }, [open]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setContent(text);
      // Use the file name (without extension) as folder name if user hasn't customized it
      const base = file.name.replace(/\.(opml|xml)$/i, "").trim();
      if (base) setFolder(base);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setContent(text);
      const base = file.name.replace(/\.(opml|xml)$/i, "").trim();
      if (base) setFolder(base);
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try { await onImport(content, folder.trim() || "Imported OPML"); onOpenChange(false); } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Import OPML</DialogTitle></DialogHeader>
        <div className="space-y-1">
          <Label>Folder name</Label>
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Imported OPML" />
        </div>
        <div className="space-y-2">
          <Label>Upload OPML file</Label>
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 transition-colors hover:border-primary/50 hover:bg-muted/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            {fileName ? (
              <span className="text-sm font-medium text-foreground">{fileName}</span>
            ) : (
              <span className="text-sm text-muted-foreground">Drop an .opml or .xml file here, or click to browse</span>
            )}
            <input type="file" accept=".opml,.xml,text/x-opml,text/xml,application/xml" className="hidden" onChange={handleFile} />
          </label>
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Or paste OPML / XML directly</Label>
          <Textarea className="min-h-28 font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value)} placeholder={'<opml version="2.0"><body><outline type="rss" xmlUrl="https://example.com/feed.xml"/></body></opml>'} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !content.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
