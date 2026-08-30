import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { safeJsonParse } from "@/lib/json";
import type { Folder, SnapshotSchedule } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function Schedules() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<SnapshotSchedule[]>([]);
  const [dbs, setDbs] = useState<{ id: number; name: string; path: string }[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [feedChecks, setFeedChecks] = useState<number[]>([]);
  const [kind, setKind] = useState<"interval" | "daily">("interval");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState("09:00");
  const [destDb, setDestDb] = useState("");
  const [destTable, setDestTable] = useState("snapshot_articles");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.snapshotSchedules().then(setSchedules).catch(() => {});
    api.duckdbDatabases().then((d) => setDbs(d.map((x) => ({ id: x.id, name: x.name, path: x.path })))).catch(() => {});
    api.folders().then(setFolders).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!feedChecks.length) return toast.error("Select at least one feed");
    setBusy(true);
    try {
      await api.createSnapshotSchedule({
        name: name || "Scheduled capture",
        feed_ids: feedChecks,
        folder_ids: [],
        max_articles: 50,
        dest: destDb ? { database: destDb, table: destTable, dedupe_key: "url" } : null,
        schedule: {
          enabled: true,
          kind,
          minutes: kind === "interval" ? minutes : undefined,
          time: kind === "daily" ? time : undefined,
        },
      });
      toast.success("Schedule created.");
      setOpen(false);
      setName("");
      setFeedChecks([]);
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted-foreground">Automatic snapshot captures from your feeds.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/sources")}><Plus className="mr-1 h-4 w-4" /> New snapshot</Button>
          <Button size="sm" onClick={() => setOpen(true)}><Clock className="mr-1 h-4 w-4" /> Add schedule</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled captures</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {schedules.length === 0 && <p className="text-sm text-muted-foreground">No scheduled captures yet. Add one to run captures automatically.</p>}
          {schedules.map((sc) => (
            <div key={sc.id} className="flex items-center gap-2 rounded-lg border p-3">
              <span className={`h-2 w-2 rounded-full ${sc.enabled ? "bg-emerald-500" : "bg-zinc-400"}`} />
              <div className="flex-1">
                <div className="text-sm font-medium">{sc.name}</div>
                <div className="text-xs text-muted-foreground">
                  {safeJsonParse<{ kind?: string; minutes?: number; time?: string }>(sc.schedule, {}).kind === "interval"
                    ? `Every ${safeJsonParse<{ minutes?: number }>(sc.schedule, {}).minutes} min`
                    : `Daily at ${safeJsonParse<{ time?: string }>(sc.schedule, {}).time}`}
                  {sc.last_run ? ` · last run ${sc.last_run}` : " · never run"}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => api.deleteSnapshotSchedule(sc.id).then(load).catch((e) => toast.error(String(e)))}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add scheduled capture</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hourly news capture" />
          </div>
          <div className="space-y-1">
            <Label>Feeds</Label>
            <div className="max-h-40 space-y-1 overflow-auto rounded-lg border p-2">
              {folders.flatMap((f) => f.feeds).map((feed) => (
                <label key={feed.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={feedChecks.includes(feed.id)} onCheckedChange={() => setFeedChecks((s) => (s.includes(feed.id) ? s.filter((x) => x !== feed.id) : [...s, feed.id]))} />
                  {feed.title}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Frequency</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as "interval" | "daily")}>
                <option value="interval">Every N minutes</option>
                <option value="daily">Daily at time</option>
              </select>
            </div>
            {kind === "daily" ? (
              <div className="space-y-1">
                <Label>Time (HH:MM)</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Every (minutes)</Label>
                <Input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value)))} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>DuckDB database (optional)</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={destDb} onChange={(e) => setDestDb(e.target.value)}>
                <option value="">None</option>
                {dbs.map((d) => <option key={d.id} value={d.path}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Table</Label>
              <Input value={destTable} onChange={(e) => setDestTable(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={create} disabled={busy || !feedChecks.length}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create schedule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
