import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackendStatus() {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setOnline(res.ok);
    } catch {
      setOnline(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (online) return null;

  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Backend server is not running</div>
            <p className="text-xs text-destructive/80">
              Discover and other features need the Flask server. From the project folder run:{" "}
              <code className="rounded bg-background/80 px-1 py-0.5">./start_web.sh</code> or{" "}
              <code className="rounded bg-background/80 px-1 py-0.5">python -m rss_reader.web</code>
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 rounded-lg" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Retry connection"}
        </Button>
      </div>
    </div>
  );
}
