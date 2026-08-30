import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

type Point = { label: string; value: number };

export function BarChart({ data, height = 180 }: { data: Point[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 100;
  const gap = data.length > 1 ? 2 : 0;
  const barW = data.length ? (width - gap * (data.length - 1)) / data.length : width;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" preserveAspectRatio="none">
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 24);
          const x = i * (barW + gap);
          const y = height - 18 - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} className="fill-brand" rx={0.5} />
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[3px]">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LineChart({ data, height = 180 }: { data: Point[]; height?: number }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 100;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - 18 - (d.value / max) * (height - 24);
    return [x, y] as const;
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const area = `${path} L${width},${height - 18} L0,${height - 18} Z`;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" preserveAspectRatio="none">
        <path d={area} className="fill-brand/20" />
        <path d={path} className="fill-none stroke-brand" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={1} className="fill-brand" />
        ))}
        {data.map((d, i) => (
          <text key={i} x={pts[i][0]} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[3px]">
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
