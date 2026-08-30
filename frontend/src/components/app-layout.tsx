import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Workflow,
  History,
  Rss,
  Moon,
  Monitor,
  Circle,
  Sun,
  Settings,
  Menu,
  X,
  Database,
  SlidersHorizontal,
  FileText,
  Braces,
  BarChart3,
  Globe,
  Download,
  Tags,
  Camera,
  Plus,
  Search,
  ChevronRight,
  Library,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { StatusBar } from "@/components/status-bar";
import { AppLogo } from "@/components/app-logo";
import { useTheme } from "@/components/theme-provider";
import { LLMSettingsDialog } from "@/components/llm-settings-dialog";
import { CommandPalette } from "@/components/command-palette";
import { BackendStatus } from "@/components/backend-status";
import { Button } from "@/components/ui/button";
import { routeMeta } from "@/lib/routes";

const navGroups = [
  {
    title: "Home",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/runs", label: "Run history", icon: History },
      { to: "/stats", label: "Stats", icon: BarChart3 },
    ],
  },
  {
    title: "Sources",
    items: [
      { to: "/discover", label: "Discover", icon: Library },
      { to: "/sources", label: "Feeds", icon: Rss },
      { to: "/websites", label: "Websites", icon: Globe },
      { to: "/api-sources", label: "APIs", icon: Braces },
    ],
  },
  {
    title: "Processing",
    items: [{ to: "/pipelines", label: "Pipelines", icon: Workflow }],
  },
  {
    title: "Data",
    items: [
      { to: "/duckdb", label: "DuckDB", icon: Database },
      { to: "/snapshots", label: "Snapshots", icon: Camera },
      { to: "/exports", label: "Exports", icon: Download },
    ],
  },
  {
    title: "Config",
    items: [
      { to: "/settings", label: "Settings", icon: SlidersHorizontal },
      { to: "/prompts", label: "Prompts", icon: FileText },
      { to: "/schemas", label: "Schemas", icon: Braces },
      { to: "/keywords", label: "Keywords", icon: Tags },
    ],
  },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === "black" ? Circle : theme === "dark" ? Sun : theme === "system" ? Monitor : Moon;
  const themeLabel =
    theme === "light"
      ? "Light theme (click for dark)"
      : theme === "dark"
        ? "Dark theme (click for full black)"
        : theme === "black"
          ? "Full black theme (click for system)"
          : "System theme (click for light)";
  const location = useLocation();
  const navigate = useNavigate();
  const meta = routeMeta(location.pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {navOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col border-r border-sidebar-border/80 bg-sidebar/95 text-sidebar-foreground backdrop-blur-xl transition-transform md:static md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <AppLogo className="h-[1.35rem] w-[1.35rem]" />
          </div>
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
            Autofeeder
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="rounded-lg p-1.5 hover:bg-sidebar-accent md:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 px-3 pb-3">
          <Button className="h-10 w-full justify-start gap-2 rounded-xl shadow-sm" onClick={() => navigate("/pipelines?new=1")}>
            <Plus className="h-4 w-4" />
            New pipeline
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-sidebar-border/80 bg-background/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1">Search…</span>
            <kbd className="hidden rounded-md border bg-muted/80 px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="px-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
                {group.title}
              </div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--primary)]"
                        : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={1.75} />
                  <span className="truncate">{item.label}</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-30 [[aria-current=page]_&]:opacity-50" />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border/80 px-4 py-3 pb-16">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500/80" : "bg-destructive"}`} />
            {online ? "Online" : "Offline"}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-xl p-2 hover:bg-sidebar-accent"
              aria-label="LLM settings"
              title="LLM settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={toggle}
              className="rounded-xl border border-sidebar-border/80 p-2 hover:bg-sidebar-accent"
              aria-label={themeLabel}
              title={themeLabel}
            >
              <ThemeIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/60 bg-background/75 px-4 py-3.5 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setNavOpen(true)}
            className="rounded-xl border border-border/80 p-2 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            {meta.group && (
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {meta.group}
              </div>
            )}
            <div className="truncate text-lg font-semibold tracking-tight">{meta.title}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="hidden gap-2 rounded-xl sm:flex"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="h-4 w-4" />
            Search
          </Button>
        </header>

        <BackendStatus />

        <main className="app-surface relative flex-1 overflow-auto pb-14">
          <div className="page-enter">{children}</div>
        </main>
      </div>

      <StatusBar />
      <Toaster closeButton position="top-right" />
      <LLMSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
