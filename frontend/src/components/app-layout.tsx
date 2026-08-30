import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Workflow, History, Rss, Moon, Sun, Settings, Menu, X, Database, SlidersHorizontal, FileText, Braces, ArrowLeftRight, BarChart3, Clock, Globe, Search, Brain, Download, Tags, Camera } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { StatusBar } from "@/components/status-bar";
import { AppLogo } from "@/components/app-logo";
import { useTheme } from "@/components/theme-provider";
import { LLMSettingsDialog } from "@/components/llm-settings-dialog";

const navGroups = [
  {
    title: "Control Room",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/runs", label: "Run history", icon: History },
      { to: "/stats", label: "Stats", icon: BarChart3 },
    ],
  },
  {
    title: "Data Inflow",
    items: [
      { to: "/sources", label: "Feeds", icon: Rss },
      { to: "/websites", label: "Websites", icon: Globe },
      { to: "/api-sources", label: "APIs", icon: Braces },
      { to: "/schedules", label: "Schedules", icon: Clock },
    ],
  },
  {
    title: "Processing",
    items: [
      { to: "/pipelines", label: "Pipelines", icon: Workflow },
      { to: "/mapper", label: "Mapper", icon: ArrowLeftRight },
    ],
  },
  {
    title: "AI Configuration",
    items: [
      { to: "/settings", label: "API Configs", icon: SlidersHorizontal },
      { to: "/prompts", label: "Prompt Editor", icon: FileText },
      { to: "/schemas", label: "Schema Generator", icon: Braces },
      { to: "/keywords", label: "Keywords Filter", icon: Tags },
    ],
  },
  {
    title: "Data Hub",
    items: [
      { to: "/duckdb", label: "DuckDB", icon: Database },
      { to: "/snapshots", label: "Snapshots", icon: Camera },
      { to: "/exports", label: "Exports", icon: Download },
    ],
  },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {navOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-card transition-transform md:static md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 border-b px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-foreground">
            <AppLogo className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Autofeeder</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Local Extraction Engine
            </div>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="ml-auto rounded-md p-1 hover:bg-accent md:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-4 pr-1 scrollbar-thin">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">
                {group.title}
              </div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-r-md rounded-l-none border-l-2 py-1.5 px-3 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground border-brand"
                        : "text-muted-foreground border-transparent hover:bg-accent/60 hover:text-foreground"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Local engine online
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md p-1 hover:bg-accent"
              aria-label="LLM settings"
              title="LLM settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={toggle}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-accent"
              aria-label="Toggle theme"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
          </div>
        </div>
      </aside>
      <main className="relative flex-1 overflow-auto pb-12">
        <div className="sticky top-0 z-20 flex justify-between p-3 md:justify-end">
          <button
            onClick={() => setNavOpen(true)}
            className="rounded-md border bg-card p-2 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <button
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-xs shadow-sm hover:bg-accent"
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
        {children}
      </main>
      <StatusBar />
      <Toaster />
      <LLMSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
