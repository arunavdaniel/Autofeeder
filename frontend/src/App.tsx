import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { AppLayout } from "@/components/app-layout";
import { Overview } from "@/pages/overview";
import { Pipelines } from "@/pages/pipelines";
import { RunHistory } from "@/pages/run-history";
import { Sources } from "@/pages/sources";
import { Settings } from "@/pages/settings";
import { Prompts } from "@/pages/prompts";
import { Schemas } from "@/pages/schemas";
import { DuckDB } from "@/pages/duckdb";
import { Stats } from "@/pages/stats";
import { Websites } from "@/pages/websites";
import { Snapshots } from "@/pages/snapshots";
import { Exports } from "@/pages/exports";
import { Keywords } from "@/pages/keywords";
import { ApiSources } from "@/pages/api-sources";
import { Discover } from "@/pages/discover";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/pipelines" element={<Pipelines />} />
            <Route path="/runs" element={<RunHistory />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/websites" element={<Websites />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/prompts" element={<Prompts />} />
            <Route path="/schemas" element={<Schemas />} />
            <Route path="/duckdb" element={<DuckDB />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/schedules" element={<Navigate to="/pipelines?mode=snapshot" replace />} />
            <Route path="/mapper" element={<Navigate to="/duckdb" replace />} />
            <Route path="/snapshots" element={<Snapshots />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/keywords" element={<Keywords />} />
            <Route path="/api-sources" element={<ApiSources />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </ThemeProvider>
  );
}
