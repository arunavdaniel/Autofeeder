import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Checkbox({ checked, onCheckedChange, disabled, id, className }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "bg-transparent",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
}
