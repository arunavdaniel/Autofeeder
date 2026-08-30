import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Loader2, Camera, RefreshCw, Eye, Globe, Braces, Rss } from "lucide-react";
import { toast } from "sonner";

interface UnifiedSnapshot {
  type: "feed" | "website" | "api" | "pipeline";
  id: number;
  source: string;
  created_at: string;
  article_count: number | null;
  changed: boolean | null;
  backend?: string;
}

export function Snapshots() {
  const [snapshots, setSnapshots] = useState<UnifiedSnapshot[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [retention, setRetention] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  
  // Modal state
  const [activeSnap, setActiveSnap] = useState<UnifiedSnapshot | null>(null);
  const [snapDetails, setSnapDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const sn = await api.snapshots();
      setSnapshots(sn);
      const settings = await api.getSettings();
      setRetention(settings.snapshot_retention ?? 10);
    } catch (e) {
      toast.error("Failed to load snapshots data: " + String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveRetention = async () => {
    setSavingSettings(true);
    try {
      await api.saveSettings({ snapshot_retention: retention });
      toast.success("Snapshot retention limit updated and pruning applied.");
      loadData();
    } catch (e) {
      toast.error("Failed to save settings: " + String(e));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDelete = async (s: UnifiedSnapshot) => {
    if (s.type !== "feed" && s.type !== "pipeline") return;
    try {
      await api.deleteSnapshot(s.id);
      toast.success("Snapshot deleted.");
      loadData();
    } catch (e) {
      toast.error("Failed to delete snapshot: " + String(e));
    }
  };

  const handleOpenDetails = async (s: UnifiedSnapshot) => {
    setActiveSnap(s);
    setSnapDetails(null);
    setDetailsLoading(true);
    try {
      if (s.type === "feed" || s.type === "pipeline") {
        const res = await api.snapshot(s.id);
        setSnapDetails(res);
      } else if (s.type === "website") {
        const res = await api.websiteSnapshotDetail(s.id);
        setSnapDetails(res);
      } else if (s.type === "api") {
        const res = await api.apiSnapshotDetail(s.id);
        setSnapDetails(res);
      }
    } catch (e) {
      toast.error("Failed to load snapshot details: " + String(e));
      setActiveSnap(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const filtered = snapshots.filter((s) => {
    if (filterType === "all") return true;
    return s.type === filterType;
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8 animate-fade-in animate-duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
          <p className="text-sm text-muted-foreground">Review stored raw fetches from Feeds, Websites, and APIs.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Settings section */}
      <Card className="border bg-card shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Snapshot Retention Configuration</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-4">
          <div className="max-w-[200px] space-y-1">
            <Label htmlFor="retention-limit" className="text-xs">Keep last snapshots per source</Label>
            <Input
              id="retention-limit"
              type="number"
              min={1}
              value={retention}
              onChange={(e) => setRetention(Math.max(1, Number(e.target.value)))}
              className="h-9"
            />
          </div>
          <Button onClick={handleSaveRetention} size="sm" disabled={savingSettings}>
            {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save Limit
          </Button>
          <span className="text-xs text-muted-foreground pb-2">Old snapshots are pruned automatically when new snapshots are captured.</span>
        </CardContent>
      </Card>

      {/* Filter tabs */}
      <div className="flex gap-1.5 rounded-lg border bg-muted p-1 max-w-md">
        {[
          { id: "all", label: "All Types" },
          { id: "feed", label: "Feeds" },
          { id: "website", label: "Websites" },
          { id: "api", label: "APIs" },
          { id: "pipeline", label: "Pipelines" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setFilterType(t.id)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
              filterType === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/20 hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List content */}
      <div className="space-y-2">
        {loading && snapshots.length === 0 && (
          <div className="flex flex-col items-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p className="text-sm">Loading snapshots library...</p>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground bg-muted/10">
            No snapshots found for the selected filter.
          </div>
        )}

        {filtered.map((s) => {
          const typeLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: any; colorClass: string }> = {
            feed: { label: "Feed Capture", variant: "outline", icon: Rss, colorClass: "text-purple-500 bg-purple-500/10 border-purple-500/20" },
            website: { label: "Website Check", variant: "secondary", icon: Globe, colorClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
            api: { label: "API Payload", variant: "default", icon: Braces, colorClass: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
            pipeline: { label: "Pipeline Run", variant: "outline", icon: Camera, colorClass: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
          };

          const labelMeta = typeLabels[s.type] || { label: s.type, variant: "outline", icon: Camera, colorClass: "text-muted-foreground bg-muted/10 border-muted-foreground/20" };
          const SnapIcon = labelMeta.icon;

          return (
            <Card key={`${s.type}-${s.id}`} className="hover:bg-muted/5 transition-all shadow-none">
              <CardContent className="flex items-center gap-4 py-3.5 px-5">
                <div className={`p-2.5 rounded-lg border ${labelMeta.colorClass}`}>
                  <SnapIcon className="h-4.5 w-4.5" />
                </div>
                
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate text-foreground">{s.source}</span>
                    <Badge variant={labelMeta.variant} className="text-[10px] scale-90 origin-left py-0.25 font-semibold">
                      {labelMeta.label}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Status labels */}
                  {(s.type === "feed" || s.type === "pipeline") && s.article_count !== null && (
                    <Badge variant="secondary" className="font-normal text-xs">
                      {s.article_count} articles
                    </Badge>
                  )}
                  {(s.type === "website" || s.type === "api") && s.changed !== null && (
                    <Badge variant={s.changed ? "default" : "secondary"} className={`font-normal text-xs ${s.changed ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : ""}`}>
                      {s.changed ? "Changed" : "No change"}
                    </Badge>
                  )}

                  {/* Actions */}
                  <Button size="sm" variant="outline" onClick={() => handleOpenDetails(s)}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> Open
                  </Button>

                  {(s.type === "feed" || s.type === "pipeline") && (
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(s)} className="text-red-500 hover:text-red-600 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Snapshot details dialog */}
      <Dialog open={!!activeSnap} onOpenChange={(o) => !o && setActiveSnap(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="truncate">{activeSnap?.source}</span>
              <Badge variant="outline" className="text-xs font-semibold py-0.5 whitespace-nowrap">
                {activeSnap?.type === "feed" ? "Feed Capture" : activeSnap?.type === "website" ? "Website Check" : activeSnap?.type === "api" ? "API Payload" : "Pipeline Run"}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {detailsLoading && (
            <div className="flex flex-col items-center py-20 text-muted-foreground flex-1">
              <Loader2 className="h-8 w-8 animate-spin mb-2" />
              <p className="text-sm">Fetching snapshot data...</p>
            </div>
          )}

          {!detailsLoading && snapDetails && (
            <ScrollArea className="flex-1 max-h-[60vh] mt-2 rounded-lg border bg-muted/20 p-4">
              {(activeSnap?.type === "feed" || activeSnap?.type === "pipeline") && (
                <div className="space-y-4">
                  <div className="text-xs text-muted-foreground pb-2 border-b">
                    Captured: {new Date(activeSnap.created_at).toLocaleString()} &middot; {snapDetails.articles?.length || 0} articles
                  </div>
                  <div className="space-y-3">
                    {snapDetails.articles?.map((art: any) => (
                      <div key={art.id} className="p-3.5 bg-background border rounded-lg shadow-sm space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-semibold text-sm text-foreground line-clamp-2">{art.title || "Untitled"}</span>
                          {art.url && (
                            <a
                              href={art.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-brand hover:underline whitespace-nowrap"
                            >
                              Visit link &rarr;
                            </a>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                          <span>{art.source}</span>
                          <span>&middot;</span>
                          <span>{art.published}</span>
                        </div>
                        {art.text && (
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-3 bg-muted/10 p-2 rounded">
                            {art.text}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeSnap?.type === "website" && (
                <div className="space-y-4">
                  <div className="text-xs text-muted-foreground pb-2 border-b flex justify-between">
                    <span>Checked: {new Date(snapDetails.fetched_at).toLocaleString()}</span>
                    <span>Backend: {snapDetails.backend} &middot; Status: {snapDetails.status_code}</span>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Snapshot Title</Label>
                    <div className="text-sm font-semibold border bg-background p-2.5 rounded shadow-sm">{snapDetails.title || "No Title"}</div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-foreground">Clean Extracted Text</Label>
                    <div className="text-xs font-mono bg-background p-4 rounded border overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-sm">
                      {snapDetails.clean_text || "Empty snapshot clean text content."}
                    </div>
                  </div>
                </div>
              )}

              {activeSnap?.type === "api" && (
                <div className="space-y-4">
                  <div className="text-xs text-muted-foreground pb-2 border-b">
                    Fetched: {new Date(snapDetails.fetched_at).toLocaleString()}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prettified JSON Payload</Label>
                    <pre className="text-[11px] font-mono bg-background p-4 rounded border overflow-x-auto leading-relaxed shadow-sm">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(snapDetails.payload), null, 2);
                        } catch {
                          return snapDetails.payload;
                        }
                      })()}
                    </pre>
                  </div>
                </div>
              )}
            </ScrollArea>
          )}

          <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
            <Button onClick={() => setActiveSnap(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
