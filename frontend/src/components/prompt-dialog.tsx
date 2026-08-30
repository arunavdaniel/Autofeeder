import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue = "",
  placeholder,
  confirmText = "Save",
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  onConfirm: (value: string) => void | Promise<void>;
  children?: ReactNode;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(value);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children ?? (
          <div className="space-y-1">
            {label && <Label>{label}</Label>}
            <Input
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
