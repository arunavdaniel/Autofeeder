import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<string, string> = {
  success: "border-success/30 bg-success/10 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  running: "border-primary/40 bg-primary/15 text-primary animate-pulse",
  queued: "border-warning/30 bg-warning/10 text-warning-foreground dark:text-warning",
  cancelled: "border-border bg-transparent text-muted-foreground line-through decoration-muted-foreground/50",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`font-medium capitalize ${STATUS_STYLES[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </Badge>
  );
}
