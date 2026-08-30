import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Website, WebsiteChange, SchemaDef } from "@/lib/types";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { setStatus, clearStatus } from "@/lib/status";

export function Websites() {
  const navigate = useNavigate();
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
    ignore_selectors: "",
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
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState("monitors");
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
      const pending = await api.allWebsiteChanges("pending").catch(() => [] as WebsiteChange[]);
      setChanges(pending);
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
      .then((items) => {
        setBackends(items);
        const preferred = items.find((b) => b.id === "playwright-chromium" && b.available);
        if (preferred) {
          setForm((current) =>
            current.fetch_method === "http" ? { ...current, fetch_method: preferred.id } : current,
          );
        }
      })
      .catch(() => {});
  }, []);
  const buildFetchOptions = () => {
    const ignore = form.ignore_selectors
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      respect_robots: form.respect_robots,
      ignore_selectors: ignore,
      viewport_width: Number(form.browser.viewport_width) || 1440,
      viewport_height: Number(form.browser.viewport_height) || 900,
      locale: form.browser.locale || "en-US",
      timezone: form.browser.timezone || "UTC",
      user_agent: form.browser.user_agent,
      wait_until: form.browser.wait_until || "domcontentloaded",
      extra_wait_ms: Number(form.browser.extra_wait_ms) || 0,
    };
  };
  const testFetch = async () => {
    if (!form.url.trim()) return toast.error("URL is required");
    setTestBusy(true);
    setTestResult(null);
    try {
      const result = await api.testWebsiteFetch({
        url: form.url,
        fetch_method: form.fetch_method,
        fetch_options: buildFetchOptions(),
      });
      setTestResult(result);
      toast.success(`Fetched ${result.text_length ?? 0} chars in ${result.duration_ms ?? "?"}ms`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTestBusy(false);
    }
  };
  const add = async () => {
    if (!form.url.trim()) return toast.error("URL is required");
    try {
      await api.saveWebsite({
        ...form,
        name: form.name || form.url,
        schema_id: form.schema_id ? Number(form.schema_id) : null,
        fetch_options: buildFetchOptions(),
      });
      setForm({ ...form, name: "", url: "", ignore_selectors: "" });
      setTestResult(null);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };
  const check = async (id: number) => {
    setBusy(id);
    const site = items.find((x) => x.id === id);
    const name = site ? site.name : "website";
    setStatus({ label: `Checking website "${name}"…`, indeterminate: true });
    try {
      const result = await api.checkWebsite(id);
      toast.success(
        result.changed ? "Meaningful change detected" : "No meaningful change",
      );
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
      clearStatus();
    }
  };
  const refreshChanges = (id: number) =>
    api
      .websiteChanges(id)
      .then(setChanges)
      .catch((e) => toast.error(String(e)));
  const openSession = async (site: Website) => {
    setStatus({ label: `Opening interactive browser session for "${site.name}"…`, indeterminate: true });
    try {
      toast.info("A visible browser will open. Interact manually, then close it to save the session.");
      await api.openWebsiteSession(site.id);
      toast.success("Browser opened. Close it when finished to save the session locally.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      clearStatus();
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
        ".autofeeder-hover { outline: 3px solid #525252 !important; cursor: crosshair !important; }";
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
  const pendingCount = changes.filter((c) => c.status === "pending").length;
  const siteName = (id: number) => items.find((s) => s.id === id)?.name || `Site #${id}`;

  return (
    <PageShell
      title="Websites"
      description="Monitor public pages, keep local snapshots, and extract only meaningful changes."
      width="6xl"
      actions={
        <Link
          to="/pipelines?new=1"
          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          New pipeline
        </Link>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="monitors">Monitors</TabsTrigger>
          <TabsTrigger value="changes">
            Pending changes
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monitors" className="space-y-6">
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
          <div className="space-y-1 md:col-span-3">
            <Label>Ignore selectors</Label>
            <Input
              value={form.ignore_selectors}
              onChange={(e) => setForm({ ...form, ignore_selectors: e.target.value })}
              placeholder=".cookie-banner, #comments, .sidebar"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated CSS selectors stripped before change detection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:col-span-3">
            <Button variant="outline" onClick={testFetch} disabled={testBusy || !form.url.trim()}>
              {testBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1 h-4 w-4" />}
              Test fetch
            </Button>
            <Button onClick={add}>
              <Plus className="mr-1 h-4 w-4" /> Add website
            </Button>
          </div>
          {testResult && (
            <div className="md:col-span-3 rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-2 font-medium">Test result</div>
              <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                <span>Backend: {String(testResult.backend || form.fetch_method)}</span>
                <span>Status: {String(testResult.status_code ?? "—")}</span>
                <span>Duration: {String(testResult.duration_ms ?? "—")} ms</span>
                <span>Text length: {String(testResult.text_length ?? 0)} chars</span>
              </div>
              {typeof testResult.text === "string" && testResult.text && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-foreground">
                  {testResult.text.slice(0, 1200)}
                  {testResult.text.length > 1200 ? "…" : ""}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="space-y-3">
        {items.length === 0 && (
          <EmptyState
            icon={Globe}
            title="No website monitors yet"
            description="Add a URL, or install from Discover. Then put the monitor on a pipeline."
            actionLabel="Discover websites"
            onAction={() => navigate("/discover")}
            secondaryLabel="New pipeline"
            onSecondary={() => navigate("/pipelines?new=1")}
          />
        )}
        {items.map((site) => (
          <Card key={site.id}>
            <CardContent className="flex items-center gap-3 p-4">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{site.name}</div>
                  {(site.pending_changes ?? 0) > 0 && (
                    <Badge variant="secondary">{site.pending_changes} pending</Badge>
                  )}
                </div>
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
                size="sm"
                variant="outline"
                onClick={() => navigate(`/pipelines?new=1&website=${site.id}`)}
              >
                Pipeline
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
                <Trash2 className="h-4 w-4 text-muted-foreground" />
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
                  className="inline-flex items-center text-xs text-foreground underline-offset-4 hover:underline"
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
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Click elements in the rendered preview to select what Autofeeder
              scrapes. The preview is intentionally safe and inert; use{" "}
              <b className="text-foreground">Open original</b> for normal website interaction.
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
              <p className="text-xs text-muted-foreground">
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
        </TabsContent>

        <TabsContent value="changes" className="space-y-4">
          {changes.length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title="No pending changes"
              description="When a monitored page changes meaningfully, it will appear here for review and extraction."
              actionLabel="View monitors"
              onAction={() => setTab("monitors")}
            />
          ) : (
            changes.map((change) => (
              <Card key={change.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {change.website_name || siteName(change.source_id)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Change #{change.id} · {change.status} · {change.detected_at}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          api
                            .extractWebsiteChange(change.id)
                            .then(() => {
                              toast.success("Extraction started");
                              load();
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
                            .then(() => load())
                            .catch((e) => toast.error(String(e)))
                        }
                      >
                        <Check className="mr-1 h-3 w-3" /> Mark processed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          api
                            .updateWebsiteChange(change.id, "ignored")
                            .then(() => load())
                            .catch((e) => toast.error(String(e)))
                        }
                      >
                        <X className="mr-1 h-3 w-3" /> Ignore
                      </Button>
                    </div>
                  </div>
                  <DiffView diff={change.diff} />
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function DiffView({ diff }: { diff: string }) {
  const lines = (diff || "").split("\n");
  if (!diff.trim()) {
    return <p className="text-sm text-muted-foreground">No diff available.</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded border bg-muted/20 p-2 font-mono text-xs">
      {lines.map((line, i) => {
        let className = "whitespace-pre-wrap px-1";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className += " bg-foreground/10 text-foreground";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className += " bg-muted text-muted-foreground line-through";
        } else if (line.startsWith("@@")) {
          className += " text-muted-foreground";
        }
        return (
          <div key={i} className={className}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}
