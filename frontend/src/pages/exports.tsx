import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { DuckDBDatabase, DuckDBTable, PublishChannel, SyncTarget } from "@/lib/types";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Download, Rss, Braces, Database, Trash2, Play, Copy, Pencil, Workflow } from "lucide-react";
import { pickDatabaseWithRows, pickTableWithRows } from "@/lib/pipeline-utils";
import { toast } from "sonner";

type SyncKindMeta = { id: string; label: string; needs: string; placeholder?: string; install?: string | null };

const FILE_FORMATS = ["csv", "parquet", "sqlite", "json"];

function publicUrl(path: string) {
  return `${window.location.origin}${path}`;
}

export function Exports() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "publish" || params.get("tab") === "sync" ? params.get("tab")! : "files";
  const [dbs, setDbs] = useState<DuckDBDatabase[]>([]);
  const [dbsLoading, setDbsLoading] = useState(true);
  const [tables, setTables] = useState<DuckDBTable[]>([]);
  const [db, setDb] = useState("");
  const [table, setTable] = useState("");
  const [channels, setChannels] = useState<PublishChannel[]>([]);
  const [targets, setTargets] = useState<SyncTarget[]>([]);
  const [kinds, setKinds] = useState<SyncKindMeta[]>([]);
  const [exportPath, setExportPath] = useState("");
  const [justSaved, setJustSaved] = useState<null | { kind: "publish" | "sync"; name: string }>(null);

  const [pubId, setPubId] = useState<number | null>(null);
  const [pubKind, setPubKind] = useState<"rss" | "json">("rss");
  const [pubName, setPubName] = useState("");
  const [pubSlug, setPubSlug] = useState("");
  const [pubKey, setPubKey] = useState("");
  const [pubSql, setPubSql] = useState("");
  const [pubEnabled, setPubEnabled] = useState(true);
  const [mapTitle, setMapTitle] = useState("title");
  const [mapLink, setMapLink] = useState("url");
  const [mapDesc, setMapDesc] = useState("description");
  const [mapPublished, setMapPublished] = useState("published");

  const [syncId, setSyncId] = useState<number | null>(null);
  const [syncKind, setSyncKind] = useState("sqlite");
  const [syncName, setSyncName] = useState("SQLite upsert");
  const [syncPath, setSyncPath] = useState("");
  const [syncDsn, setSyncDsn] = useState("");
  const [syncDestTable, setSyncDestTable] = useState("");
  const [syncKey, setSyncKey] = useState("url");
  const [syncSql, setSyncSql] = useState("");
  const [syncMinutes, setSyncMinutes] = useState(60);
  const [syncKindSched, setSyncKindSched] = useState<"interval" | "daily">("interval");
  const [syncTime, setSyncTime] = useState("09:00");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncTargetEnabled, setSyncTargetEnabled] = useState(true);

  const kindMeta = useMemo(() => kinds.find((k) => k.id === syncKind), [kinds, syncKind]);

  const applyDb = (value: string, list: DuckDBDatabase[], preferredTable?: string) => {
    setDb(value);
    if (!value) {
      setTables([]);
      setTable("");
      return;
    }
    const match = list.find((x) => x.path === value);
    const fromStats = match?.stats?.tables || [];
    if (fromStats.length) {
      setTables(fromStats);
      const nextTable = pickTableWithRows(fromStats, preferredTable);
      setTable(nextTable);
    } else {
      setTable("");
    }
    api
      .duckdbTables(value)
      .then((x) => {
        setTables(x.tables);
        setTable(pickTableWithRows(x.tables, preferredTable));
      })
      .catch(() => {
        if (!fromStats.length) setTables([]);
      });
  };

  const load = () => {
    setDbsLoading(true);
    api
      .duckdbDatabases()
      .then((list) => {
        setDbs(list);
        setDb((current) => {
          const picked = pickDatabaseWithRows(list, current);
          const next = picked?.path || "";
          if (next) queueMicrotask(() => applyDb(next, list));
          return next;
        });
      })
      .catch(() => setDbs([]))
      .finally(() => setDbsLoading(false));
    api.publishChannels().then(setChannels).catch(() => {});
    api.syncTargets().then(setTargets).catch(() => {});
    api.syncKinds().then(setKinds).catch(() => {});
  };
  useEffect(() => {
    load();
  }, []);

  const choose = (value: string) => {
    applyDb(value, dbs);
  };

  const exportIt = async (format: string) => {
    if (!db || !table) return toast.error("Pick a database and table");
    try {
      const result = await api.exportTable(db, table, format, exportPath || undefined);
      toast.success(`Exported ${result.rows} rows to ${result.path}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const resetPublish = () => {
    setPubId(null);
    setPubName("");
    setPubSlug("");
    setPubKey("");
    setPubSql("");
    setPubEnabled(true);
    setMapTitle("title");
    setMapLink("url");
    setMapDesc("description");
    setMapPublished("published");
  };

  const editChannel = (ch: PublishChannel) => {
    setPubId(ch.id);
    setPubKind(ch.kind);
    setPubName(ch.name);
    setPubSlug(ch.slug);
    setPubKey(ch.api_key || "");
    setPubSql(ch.sql || "");
    setPubEnabled(ch.enabled);
    setDb(ch.database);
    setTable(ch.table);
    api.duckdbTables(ch.database).then((x) => setTables(x.tables)).catch(() => {});
    const m = ch.mapping || {};
    setMapTitle(m.title || "title");
    setMapLink(m.link || "url");
    setMapDesc(m.description || "description");
    setMapPublished(m.published || "published");
  };

  const createChannel = async () => {
    if (!db || !table) return toast.error("Pick a database and table");
    try {
      const ch = await api.savePublishChannel({
        id: pubId ?? undefined,
        kind: pubKind,
        name: pubName || table,
        slug: pubSlug || undefined,
        database: db,
        table,
        sql: pubSql,
        api_key: pubKey,
        enabled: pubEnabled,
        mapping: { title: mapTitle, link: mapLink, description: mapDesc, published: mapPublished },
      });
      toast.success(`${pubId ? "Updated" : "Published"} ${ch.kind} at /p/${ch.slug}.${ch.kind === "rss" ? "xml" : "json"}`);
      setJustSaved({ kind: "publish", name: ch.name });
      resetPublish();
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const resetSync = () => {
    setSyncId(null);
    setSyncName("SQLite upsert");
    setSyncKind("sqlite");
    setSyncPath("");
    setSyncDsn("");
    setSyncDestTable("");
    setSyncKey("url");
    setSyncSql("");
    setSyncMinutes(60);
    setSyncKindSched("interval");
    setSyncEnabled(false);
    setSyncTargetEnabled(true);
  };

  const editTarget = (t: SyncTarget) => {
    setSyncId(t.id);
    setSyncKind(t.kind);
    setSyncName(t.name);
    setSyncPath(t.dest?.path || "");
    setSyncDsn(t.dest?.dsn || "");
    setSyncDestTable(t.dest?.table || t.table);
    setSyncKey(t.key_column);
    setSyncSql(t.sql || "");
    setSyncEnabled(!!t.schedule?.enabled);
    setSyncKindSched((t.schedule?.kind as "interval" | "daily") || "interval");
    setSyncMinutes(t.schedule?.minutes || 60);
    setSyncTime(t.schedule?.time || "09:00");
    setSyncTargetEnabled(t.enabled);
    setDb(t.database);
    setTable(t.table);
    api.duckdbTables(t.database).then((x) => setTables(x.tables)).catch(() => {});
  };

  const createSync = async () => {
    if (!db || !table) return toast.error("Pick a database and table");
    try {
      await api.saveSyncTarget({
        id: syncId ?? undefined,
        name: syncName,
        kind: syncKind,
        database: db,
        table,
        sql: syncSql,
        key_column: syncKey,
        enabled: syncTargetEnabled,
        dest:
          syncKind === "sqlite"
            ? { path: syncPath, table: syncDestTable || table }
            : { dsn: syncDsn, table: syncDestTable || table },
        schedule: {
          enabled: syncEnabled,
          kind: syncKindSched,
          minutes: syncMinutes,
          time: syncTime,
        },
      });
      toast.success(syncId ? "Sync target updated" : "Sync target saved");
      setJustSaved({ kind: "sync", name: syncName });
      resetSync();
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const copyUrl = (path: string, extra?: string) => {
    const url = publicUrl(path) + (extra || "");
    void navigator.clipboard.writeText(url);
    toast.success("Copied URL");
  };

  const slugPreview = (pubSlug || pubName || table || "feed")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "feed";

  return (
    <PageShell
      title="Exports"
      description="Download a table, serve local RSS/JSON, or upsert elsewhere. Attach destinations on a pipeline Output step."
      width="5xl"
    >
      {dbsLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading DuckDB files…
        </p>
      )}
      {!dbsLoading && dbs.length === 0 && (
        <EmptyState
          icon={Workflow}
          title="No DuckDB tables yet"
          description="Pipelines write tables here. Create a pipeline with DuckDB output, run it, then come back to publish or download."
          actionLabel="New pipeline"
          onAction={() => navigate("/pipelines?new=1")}
          secondaryLabel="Open DuckDB"
          onSecondary={() => navigate("/duckdb")}
        />
      )}
      {justSaved && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">
                {justSaved.kind === "publish" ? "Publish endpoint saved" : "Sync target saved"}: {justSaved.name}
              </div>
              <p className="text-sm text-muted-foreground">
                Next: open a pipeline → Output, and attach this {justSaved.kind === "publish" ? "channel" : "target"} so it runs after each write.
              </p>
            </div>
            <Button onClick={() => navigate("/pipelines")}>Open pipelines</Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source table</CardTitle>
          <CardDescription>Every tab uses this DuckDB table. Create pipelines that write here, then publish or sync.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Database</Label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={db} onChange={(e) => choose(e.target.value)}>
              <option value="">Select database</option>
              {dbs.map((x) => (
                <option key={x.id} value={x.path}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Table</Label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">Select table</option>
              {tables.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                  {x.rows != null ? ` (${x.rows})` : ""}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === "files") next.delete("tab");
          else next.set("tab", v);
          setParams(next, { replace: true });
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="files" className="gap-2">
            <Download className="h-4 w-4" /> Files
          </TabsTrigger>
          <TabsTrigger value="publish" className="gap-2">
            <Rss className="h-4 w-4" /> Publish
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-2">
            <Database className="h-4 w-4" /> Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Download file</CardTitle>
              <CardDescription>One-shot export of the selected table. Optional path overrides the default in the data directory.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Output path (optional)</Label>
                <Input value={exportPath} onChange={(e) => setExportPath(e.target.value)} placeholder="~/Downloads/articles.csv" />
              </div>
              <div className="flex flex-wrap gap-2">
                {FILE_FORMATS.map((format) => (
                  <Button key={format} variant="outline" disabled={!db || !table} onClick={() => void exportIt(format)}>
                    <Download className="mr-1 h-4 w-4" />
                    {format.toUpperCase()}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publish" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{pubId ? "Edit endpoint" : "New RSS or JSON API"}</CardTitle>
              <CardDescription>
                Serves the table at a local URL. Optional key as <code>X-Publish-Key</code> or <code>?key=</code>. Select this channel on a pipeline Output step.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Kind</Label>
                  <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={pubKind} onChange={(e) => setPubKind(e.target.value as "rss" | "json")}>
                    <option value="rss">RSS feed (.xml)</option>
                    <option value="json">JSON API (.json)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={pubName} onChange={(e) => setPubName(e.target.value)} placeholder={table || "watchlist"} />
                </div>
                <div className="space-y-1">
                  <Label>Slug</Label>
                  <Input value={pubSlug} onChange={(e) => setPubSlug(e.target.value)} placeholder={slugPreview} />
                </div>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {publicUrl(`/p/${slugPreview}.${pubKind === "rss" ? "xml" : "json"}`)}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Publish key (optional)</Label>
                  <Input value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="leave empty for local open" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={pubEnabled} onCheckedChange={(c) => setPubEnabled(c === true)} />
                    Enabled
                  </label>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Custom SQL (optional, instead of whole table)</Label>
                <Input value={pubSql} onChange={(e) => setPubSql(e.target.value)} placeholder="SELECT * FROM articles WHERE status = 'ok'" />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <Label>RSS field mapping</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={mapTitle} onChange={(e) => setMapTitle(e.target.value)} placeholder="title column" />
                  <Input value={mapLink} onChange={(e) => setMapLink(e.target.value)} placeholder="link column" />
                  <Input value={mapDesc} onChange={(e) => setMapDesc(e.target.value)} placeholder="description column" />
                  <Input value={mapPublished} onChange={(e) => setMapPublished(e.target.value)} placeholder="published column" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button disabled={!db || !table} onClick={() => void createChannel()}>
                  {pubKind === "rss" ? <Rss className="mr-1 h-4 w-4" /> : <Braces className="mr-1 h-4 w-4" />}
                  {pubId ? "Save endpoint" : `Publish ${pubKind === "rss" ? "feed" : "API"}`}
                </Button>
                {pubId && (
                  <Button variant="outline" onClick={resetPublish}>
                    Cancel edit
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {channels.length === 0 && <p className="text-sm text-muted-foreground">No published endpoints yet.</p>}
            {channels.map((ch) => {
              const path = ch.kind === "rss" ? ch.urls?.rss : ch.urls?.json;
              const keyQs = ch.api_key ? `?key=${encodeURIComponent(ch.api_key)}` : "";
              return (
                <div key={ch.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {ch.name}{" "}
                      <span className="text-muted-foreground">
                        · {ch.kind} · {ch.enabled ? "on" : "off"} · {ch.table}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{path}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => copyUrl(path || "")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {ch.api_key && (
                    <Button size="sm" variant="outline" onClick={() => copyUrl(path || "", keyQs)}>
                      Copy with key
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => editChannel(ch)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      api
                        .savePublishChannel({ ...ch, enabled: !ch.enabled, id: ch.id })
                        .then(load)
                        .catch((e) => toast.error(String(e)))
                    }
                  >
                    {ch.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => api.deletePublishChannel(ch.id).then(load).catch((e) => toast.error(String(e)))}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="sync" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{syncId ? "Edit upsert target" : "New upsert target"}</CardTitle>
              <CardDescription>
                Periodic upsert by key — not streaming replication. Run now, on a timer while the app is open, or after each pipeline run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Engine</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={syncKind}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSyncKind(next);
                      const meta = kinds.find((k) => k.id === next);
                      if (!syncId) setSyncName(`${meta?.label || next} upsert`);
                    }}
                  >
                    {(kinds.length ? kinds : [{ id: "sqlite", label: "SQLite file" }]).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={syncName} onChange={(e) => setSyncName(e.target.value)} />
                </div>
                {syncKind === "sqlite" ? (
                  <div className="space-y-1 sm:col-span-2">
                    <Label>SQLite path</Label>
                    <Input value={syncPath} onChange={(e) => setSyncPath(e.target.value)} placeholder={kindMeta?.placeholder || "/tmp/autofeeder-sync.sqlite3"} />
                  </div>
                ) : (
                  <div className="space-y-1 sm:col-span-2">
                    <Label>DSN</Label>
                    <Input value={syncDsn} onChange={(e) => setSyncDsn(e.target.value)} placeholder={kindMeta?.placeholder} />
                    {kindMeta?.install && <p className="text-[11px] text-muted-foreground">Driver: {kindMeta.install}</p>}
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Destination table</Label>
                  <Input value={syncDestTable} onChange={(e) => setSyncDestTable(e.target.value)} placeholder={table || "articles"} />
                </div>
                <div className="space-y-1">
                  <Label>Key column</Label>
                  <Input value={syncKey} onChange={(e) => setSyncKey(e.target.value)} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Custom SQL (optional)</Label>
                  <Input value={syncSql} onChange={(e) => setSyncSql(e.target.value)} placeholder="SELECT * FROM articles" />
                </div>
                <div className="space-y-1">
                  <Label>Schedule</Label>
                  <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={syncKindSched} onChange={(e) => setSyncKindSched(e.target.value as "interval" | "daily")}>
                    <option value="interval">Every N minutes</option>
                    <option value="daily">Daily at time</option>
                  </select>
                </div>
                {syncKindSched === "daily" ? (
                  <div className="space-y-1">
                    <Label>Time</Label>
                    <Input type="time" value={syncTime} onChange={(e) => setSyncTime(e.target.value)} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label>Every (minutes)</Label>
                    <Input type="number" min={1} value={syncMinutes} onChange={(e) => setSyncMinutes(Number(e.target.value) || 60)} />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={syncEnabled} onCheckedChange={(c) => setSyncEnabled(c === true)} />
                  Run on a timer while the app is open
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={syncTargetEnabled} onCheckedChange={(c) => setSyncTargetEnabled(c === true)} />
                  Target enabled
                </label>
              </div>
              <div className="flex gap-2">
                <Button disabled={!db || !table} onClick={() => void createSync()}>
                  <Database className="mr-1 h-4 w-4" /> {syncId ? "Save target" : "Save sync"}
                </Button>
                {syncId && (
                  <Button variant="outline" onClick={resetSync}>
                    Cancel edit
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {targets.length === 0 && <p className="text-sm text-muted-foreground">No sync targets yet.</p>}
            {targets.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {t.name}{" "}
                    <span className="text-muted-foreground">
                      · {t.kind} · {t.enabled ? "on" : "off"} · key {t.key_column}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.schedule?.enabled
                      ? t.schedule.kind === "daily"
                        ? `daily ${t.schedule.time}`
                        : `every ${t.schedule.minutes ?? 60}m`
                      : "no timer"}
                    {t.last_run ? ` · last ${t.last_run}` : " · never run"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    api
                      .runSyncTarget(t.id)
                      .then((r) => {
                        toast.success(`Synced ${r.rows ?? 0} rows`);
                        load();
                      })
                      .catch((e) => toast.error(String(e)))
                  }
                >
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
                <Button size="sm" variant="outline" onClick={() => editTarget(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    api
                      .saveSyncTarget({ ...t, id: t.id, enabled: !t.enabled })
                      .then(load)
                      .catch((e) => toast.error(String(e)))
                  }
                >
                  {t.enabled ? "Disable" : "Enable"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => api.deleteSyncTarget(t.id).then(load).catch((e) => toast.error(String(e)))}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        After a pipeline writes this table, pick the same publish channel or sync target on the Output step.{" "}
        <Link
          className="underline"
          to={
            db && table
              ? `/pipelines?new=1&db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`
              : "/pipelines?new=1"
          }
        >
          New pipeline with this output
        </Link>
      </p>
    </PageShell>
  );
}
