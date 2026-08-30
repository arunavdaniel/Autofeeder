import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Website, WebsiteChange, SchemaDef } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  RefreshCw,
  Trash2,
  Globe,
  Loader2,
  Play,
  Check,
  X,
  ScanSearch,
  Table2,
  Save,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

export function Websites() {
  const [items, setItems] = useState<Website[]>([]);
  const [schemas, setSchemas] = useState<SchemaDef[]>([]);
  const [changes, setChanges] = useState<WebsiteChange[]>([]);
  const [snapshotCounts, setSnapshotCounts] = useState<Record<number, number>>(
    {},
  );
  const [backends, setBackends] = useState<
    Array<{
      id: string;
      label: string;
      kind: string;
      available: boolean;
      hint: string;
    }>
  >([]);
  const [form, setForm] = useState({
    name: "",
    url: "",
    fetch_method: "http",
    frequency: "1h",
    schema_id: "",
    prompt: "",
    respect_robots: true,
    browser: {
      viewport_width: 1440,
      viewport_height: 900,
      locale: "en-US",
      timezone: "UTC",
      user_agent: "",
      wait_until: "domcontentloaded",
      extra_wait_ms: "500",
    },
  });
  const [busy, setBusy] = useState<number | null>(null);
  const [viewer, setViewer] = useState<Website | null>(null);
  const [preview, setPreview] = useState<Record<string, any> | null>(null);
  const [selector, setSelector] = useState("");
  const [viewerMode, setViewerMode] = useState<"content" | "table">("content");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [respectRobots, setRespectRobots] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const load = async () => {
    try {
      const sites = await api.websites();
      setItems(sites);
      const counts = await Promise.all(
        sites.map(
          async (site) =>
            [site.id, (await api.websiteSnapshots(site.id)).length] as const,
        ),
      );
      setSnapshotCounts(Object.fromEntries(counts));
    } catch (e) {
      toast.error(String(e));
    }
    api
      .schemas()
      .then(setSchemas)
      .catch(() => {});
  };
  useEffect(() => {
    load();
    api
      .fetchBackends()
      .then(setBackends)
      .catch(() => {});
  }, []);
  const add = async () => {
    if (!form.url.trim()) return toast.error("URL is required");
    try {
      await api.saveWebsite({
        ...form,
        name: form.name || form.url,
        schema_id: form.schema_id ? Number(form.schema_id) : null,
        fetch_options: {
          respect_robots: form.respect_robots,
          viewport_width: Number(form.browser.viewport_width) || 1440,
          viewport_height: Number(form.browser.viewport_height) || 900,
          locale: form.browser.locale || "en-US",
          timezone: form.browser.timezone || "UTC",
          user_agent: form.browser.user_agent,
          wait_until: form.browser.wait_until || "domcontentloaded",
          extra_wait_ms: Number(form.browser.extra_wait_ms) || 0,
        },
      });
      setForm({ ...form, name: "", url: "" });
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const check = async (id: number) => {
    setBusy(id);
    try {
      const result = await api.checkWebsite(id);
      toast.success(
        result.changed ? "Meaningful change detected" : "No meaningful change",
      );
      load();
      if (result.changed) api.websiteChanges(id).then(setChanges);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };
  const refreshChanges = (id: number) =>
    api
      .websiteChanges(id)
      .then(setChanges)
      .catch((e) => toast.error(String(e)));
  const openSession = async (site: Website) => {
    try {
      toast.info("A visible browser will open. Interact manually, then close it to save the session.");
      await api.openWebsiteSession(site.id);
      toast.success("Browser opened. Close it when finished to save the session locally.");
    } catch (e) {
      toast.error(String(e));
    }
  };
  const makeSelector = (element: Element) => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (
      current &&
      current.tagName.toLowerCase() !== "html" &&
      parts.length < 5
    ) {
      let part = current.tagName.toLowerCase();
      if ((current as HTMLElement).id)
        part += `#${CSS.escape((current as HTMLElement).id)}`;
      else if (current.classList.length)
        part += `.${Array.from(current.classList).slice(0, 2).map(CSS.escape).join(".")}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current?.tagName,
        );
        if (siblings.length > 1)
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  useEffect(() => {
    const install = () => {
      const document = frameRef.current?.contentDocument;
      if (!document) return;
      const style = document.createElement("style");
      style.textContent =
        ".autofeeder-hover { outline: 3px solid #14b8a6 !important; cursor: crosshair !important; }";
      document.head?.appendChild(style);
      const over = (event: Event) => {
        event.preventDefault();
        (event.target as HTMLElement)?.classList.add("autofeeder-hover");
      };
      const out = (event: Event) => {
        (event.target as HTMLElement)?.classList.remove("autofeeder-hover");
      };
      const click = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        setSelector(makeSelector(event.target as Element));
      };
      document.addEventListener("mouseover", over);
      document.addEventListener("mouseout", out);
      document.addEventListener("click", click, true);
      return () => {
        document.removeEventListener("mouseover", over);
        document.removeEventListener("mouseout", out);
        document.removeEventListener("click", click, true);
        style.remove();
      };
    };
    let cleanup = install();
    const timer = window.setTimeout(() => {
      cleanup?.();
      cleanup = install();
    }, 100);
    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [preview?.html]);
  const openViewer = async (site: Website) => {
    setViewer(site);
    setPreview(null);
    setSelector("");
    setViewerMode("content");
    setPreviewBusy(true);
    try {
      const options = (site as any).fetch_options || {};
      setRespectRobots(options.respect_robots !== false);
      setSelector(options.content_selector || options.table_selector || "");
      setPreview(
        await api.websitePreview({
          url: site.url,
          fetch_method: site.fetch_method,
          fetch_options: {
            ...options,
            respect_robots: options.respect_robots !== false,
          },
          selector: options.content_selector || options.table_selector || "",
          mode: options.mode || "content",
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setPreviewBusy(false);
    }
  };
  const runPreview = async () => {
    if (!viewer) return;
    setPreviewBusy(true);
    try {
      setPreview(
        await api.websitePreview({
          url: viewer.url,
          fetch_method: viewer.fetch_method,
          fetch_options: {
            ...((viewer as any).fetch_options || {}),
            respect_robots: respectRobots,
          },
          selector,
          mode: viewerMode,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setPreviewBusy(false);
    }
  };
  const saveViewer = async () => {
    if (!viewer || !selector.trim())
      return toast.error("Select an element first");
    try {
      const fetch_options = {
        ...((viewer as any).fetch_options || {}),
        mode: viewerMode,
        respect_robots: respectRobots,
        content_selector:
          viewerMode === "content"
            ? selector.trim()
            : (viewer as any).fetch_options?.content_selector || "",
        table_selector:
          viewerMode === "table"
            ? selector.trim()
            : (viewer as any).fetch_options?.table_selector || "",
      };
      await api.saveWebsite({ fetch_options }, viewer.id);
      toast.success("Scraping selection saved");
      setViewer({ ...viewer, fetch_options } as Website);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Websites</h1>
        <p className="text-sm text-muted-foreground">
          Monitor public pages, keep local snapshots, and extract only
          meaningful changes.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add website source</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Company news"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>URL</Label>
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://example.com/news"
            />
          </div>
          <div className="space-y-1">
            <Label>Fetch backend</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.fetch_method}
              onChange={(e) =>
                setForm({ ...form, fetch_method: e.target.value })
              }
            >
              {(backends.length
                ? backends
                : [
                    {
                      id: "http",
                      label: "HTTP",
                      kind: "local",
                      available: true,
                      hint: "",
                    },
                    {
                      id: "playwright-chromium",
                      label: "Playwright · Chromium",
                      kind: "local",
                      available: true,
                      hint: "",
                    },
                  ]
              ).map((backend) => (
                <option
                  key={backend.id}
                  value={backend.id}
                  disabled={!backend.available}
                >
                  {backend.label}
                  {backend.kind === "external" ? " · external" : ""}
                  {!backend.available ? " · unavailable" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Frequency</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            >
              {["5m", "10m", "15m", "30m", "1h", "6h", "daily"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Extraction schema</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.schema_id}
              onChange={(e) => setForm({ ...form, schema_id: e.target.value })}
            >
              <option value="">None</option>
              {schemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label>Extraction prompt</Label>
            <Textarea
              rows={2}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Extract only when this page meaningfully changes..."
            />
          </div>
          <label className="flex items-center gap-2 text-xs md:col-span-3">
            <input
              type="checkbox"
              checked={form.respect_robots}
              onChange={(e) =>
                setForm({ ...form, respect_robots: e.target.checked })
              }
            />{" "}
            Respect robots.txt{" "}
            <span className="text-muted-foreground">(recommended)</span>
          </label>
          <details className="md:col-span-3 rounded-md border p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Advanced browser options
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Viewport</Label>
                <Input
                  type="number"
                  value={form.browser.viewport_width}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, viewport_width: Number(e.target.value) },
                    })
                  }
                  placeholder="1440"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Height</Label>
                <Input
                  type="number"
                  value={form.browser.viewport_height}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, viewport_height: Number(e.target.value) },
                    })
                  }
                  placeholder="900"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Locale</Label>
                <Input
                  value={form.browser.locale}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, locale: e.target.value },
                    })
                  }
                  placeholder="en-US"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Timezone</Label>
                <Input
                  value={form.browser.timezone}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, timezone: e.target.value },
                    })
                  }
                  placeholder="UTC"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Wait until</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.browser.wait_until}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, wait_until: e.target.value },
                    })
                  }
                >
                  <option value="domcontentloaded">DOM content loaded</option>
                  <option value="load">Full page load</option>
                  <option value="networkidle">Network idle</option>
                  <option value="commit">Commit</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Extra wait (ms)</Label>
                <Input
                  value={form.browser.extra_wait_ms}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, extra_wait_ms: e.target.value },
                    })
                  }
                  placeholder="500"
                />
              </div>
              <div className="space-y-1 md:col-span-3">
                <Label className="text-xs">User agent (optional)</Label>
                <Input
                  value={form.browser.user_agent}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      browser: { ...form.browser, user_agent: e.target.value },
                    })
                  }
                  placeholder="Leave blank for Autofeeder's default"
                />
              </div>
            </div>
          </details>
          <Button onClick={add} className="md:col-span-3">
            <Plus className="mr-1 h-4 w-4" /> Add website
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No website monitors yet.
          </p>
        )}
        {items.map((site) => (
          <Card key={site.id}>
            <CardContent className="flex items-center gap-3 p-4">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{site.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {site.url} · every {site.frequency} · {site.fetch_method}
                </div>
                <div className="text-xs text-muted-foreground">
                  Last checked: {site.last_checked || "never"} · Last changed:{" "}
                  {site.last_changed || "never"} · Snapshots:{" "}
                  {snapshotCounts[site.id] ?? 0}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => openSession(site)}>
                Open browser
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openViewer(site)}
              >
                <ScanSearch className="mr-1 h-4 w-4" /> Viewer
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => check(site.id)}
                disabled={busy === site.id}
              >
                {busy === site.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}{" "}
                Check
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  api
                    .deleteWebsite(site.id)
                    .then(load)
                    .catch((e) => toast.error(String(e)))
                }
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {viewer && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Website Viewer · {viewer.name}
              </CardTitle>
              <div className="flex items-center gap-2">
                <a
                  className="inline-flex items-center text-xs text-brand hover:underline"
                  href={viewer.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original <ExternalLink className="ml-1 h-3 w-3" />
                </a>
                <Button variant="ghost" onClick={() => setViewer(null)}>
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Click elements in the rendered preview to select what Autofeeder
              scrapes. The preview is intentionally safe and inert; use{" "}
              <b>Open original</b> for normal website interaction.
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1 space-y-1">
                <Label>Selected CSS selector</Label>
                <Input
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                  placeholder="Click an element in the preview"
                />
              </div>
              <div className="space-y-1">
                <Label>Mode</Label>
                <select
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  value={viewerMode}
                  onChange={(e) =>
                    setViewerMode(e.target.value as "content" | "table")
                  }
                >
                  <option value="content">Content area</option>
                  <option value="table">Table</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pb-2 text-xs">
                <input
                  type="checkbox"
                  checked={respectRobots}
                  onChange={(e) => setRespectRobots(e.target.checked)}
                />{" "}
                Respect robots.txt
              </label>
              <Button
                variant="outline"
                onClick={runPreview}
                disabled={previewBusy}
              >
                {previewBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}{" "}
                Preview selection
              </Button>
              <Button onClick={saveViewer} disabled={!selector.trim()}>
                <Save className="mr-1 h-4 w-4" /> Save selection
              </Button>
            </div>
            {!respectRobots && (
              <p className="text-xs text-amber-600">
                Robots.txt enforcement is disabled for this explicit request.
                Continue to respect the site’s terms and rate limits.
              </p>
            )}
            {preview && (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="overflow-hidden rounded border bg-white">
                  <iframe
                    ref={frameRef}
                    title="Website preview"
                    srcDoc={preview.html}
                    className="h-[520px] w-full"
                  />
                </div>
                <div className="space-y-3">
                  <div className="rounded border p-3">
                    <div className="mb-2 text-sm font-medium">
                      Selection preview
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {preview.match_count} matching element(s)
                    </div>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                      {preview.text || "No text found"}
                    </pre>
                  </div>
                  {preview.tables?.length > 0 && (
                    <div className="rounded border p-3">
                      <div className="mb-2 flex items-center gap-1 text-sm font-medium">
                        <Table2 className="h-4 w-4" /> Detected tables
                      </div>
                      {preview.tables.map((table: any, i: number) => (
                        <div key={i} className="overflow-auto rounded border p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-[11px] text-muted-foreground">
                              {table.selector || "table"}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelector(table.selector);
                                setViewerMode("table");
                              }}
                            >
                              <Table2 className="mr-1 h-3 w-3" /> Use this table
                            </Button>
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr>
                                {table.headers.map((head: string) => (
                                  <th
                                    key={head}
                                    className="border-b p-1 text-left"
                                  >
                                    {head}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.rows
                                .slice(0, 8)
                                .map((row: string[], ri: number) => (
                                  <tr key={ri}>
                                    {row.map((cell, ci) => (
                                      <td key={ci} className="border-b p-1">
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {changes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest detected changes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {changes.map((change) => (
              <div key={change.id} className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Change #{change.id} · {change.status} · {change.detected_at}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        api
                          .extractWebsiteChange(change.id)
                          .then(() => {
                            toast.success("Extraction started");
                            api.updateWebsiteChange(change.id, "processed");
                            refreshChanges(change.source_id);
                          })
                          .catch((e) => toast.error(String(e)))
                      }
                    >
                      <Play className="mr-1 h-3 w-3" /> Extract
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        api
                          .updateWebsiteChange(change.id, "processed")
                          .then(() => refreshChanges(change.source_id))
                          .catch((e) => toast.error(String(e)))
                      }
                    >
                      <Check className="mr-1 h-3 w-3" /> Processed
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        api
                          .updateWebsiteChange(change.id, "ignored")
                          .then(() => refreshChanges(change.source_id))
                          .catch((e) => toast.error(String(e)))
                      }
                    >
                      <X className="mr-1 h-3 w-3" /> Ignore
                    </Button>
                  </div>
                </div>
                <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-3 text-xs">
                  {change.diff}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
