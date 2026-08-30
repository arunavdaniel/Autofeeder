import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectContextValue {
  value: string;
  setValue: (v: string) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
  items: Record<string, string>;
  register: (value: string, label: string) => void;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelect() {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("Select components must be used within <Select>");
  return ctx;
}

export function Select({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Record<string, string>>({});
  const register = (v: string, l: string) =>
    setItems((s) => (s[v] === l ? s : { ...s, [v]: l }));
  const setValue = (v: string) => {
    onValueChange(v);
    setOpen(false);
  };
  return (
    <SelectContext.Provider value={{ value, setValue, open, setOpen, items, register }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({ className, children }: { className?: string; children?: ReactNode }) {
  const { open, setOpen } = useSelect();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {children}
      <ChevronDown className="h-4 w-4 opacity-50" />
    </button>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value, items } = useSelect();
  const text = value ? items[value] ?? value : placeholder ?? "";
  return <span className="truncate">{text}</span>;
}

export function SelectContent({ className, children }: { className?: string; children: ReactNode }) {
  const { open, setOpen } = useSelect();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        open ? "block" : "hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SelectItem({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { setValue, value: selected, register } = useSelect();
  const label = typeof children === "string" ? children : String(value);
  useEffect(() => {
    register(value, label);
  }, [register, value, label]);
  return (
    <div
      role="option"
      aria-selected={selected === value}
      onClick={() => setValue(value)}
      className={cn(
        "cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent",
        selected === value && "bg-accent"
      )}
    >
      {children}
    </div>
  );
}
