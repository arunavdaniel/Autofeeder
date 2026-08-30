import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "black" | "system";
export type ResolvedTheme = "light" | "dark" | "black";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = "autofeeder-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("autofeedly-theme");
  if (saved === "light" || saved === "dark" || saved === "black" || saved === "system") return saved;
  return "system";
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.add("theme");
  root.classList.toggle("dark", resolved !== "light");
  root.classList.toggle("theme-black", resolved === "black");
  root.style.colorScheme = resolved === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    apply(resolvedTheme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, resolvedTheme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggle = () =>
    setThemeState((t) => (t === "light" ? "dark" : t === "dark" ? "black" : t === "black" ? "system" : "light"));

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
