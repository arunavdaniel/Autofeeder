import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { loadLLM, saveLLM, type LLMSettings } from "@/lib/llm-settings";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const PRESETS = [
  { id: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions" },
  { id: "ollama", label: "Ollama (local)", endpoint: "http://localhost:11434/v1/chat/completions" },
  { id: "lmstudio", label: "LM Studio (local)", endpoint: "http://localhost:1234/v1/chat/completions" },
  { id: "gemini", label: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  { id: "custom", label: "Custom", endpoint: "" },
];

export function LLMSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [s, setS] = useState<LLMSettings>(() => loadLLM());
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) setS(loadLLM());
  }, [open]);

  const presetId = (() => {
    const match = PRESETS.find((p) => p.endpoint && p.endpoint === s.endpoint);
    return match ? match.id : "custom";
  })();

  const test = async () => {
    if (!s.endpoint || !s.model) {
      toast.error("Set endpoint and model before testing.");
      return;
    }
    setTesting(true);
    try {
      await api.llmTest({ endpoint: s.endpoint, model: s.model, api_key: s.api_key });
      toast.success("Connection OK.");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    saveLLM(s);
    toast.success("LLM settings saved to this browser.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>LLM connection</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Saved only in this browser (localStorage) and used to prefill pipelines and the
          reader. Never stored on any server.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Provider preset</Label>
            <Select
              value={presetId}
              onValueChange={(v) => {
                const p = PRESETS.find((x) => x.id === v);
                if (p) setS({ ...s, endpoint: p.endpoint || s.endpoint });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Endpoint</Label>
            <Input
              value={s.endpoint}
              placeholder="https://api.openai.com/v1/chat/completions"
              onChange={(e) => setS({ ...s, endpoint: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Model</Label>
            <Input
              value={s.model}
              placeholder="gpt-4o-mini"
              onChange={(e) => setS({ ...s, model: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>API key (optional)</Label>
            <Input
              type="password"
              value={s.api_key}
              placeholder="sk-..."
              onChange={(e) => setS({ ...s, api_key: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Default prompt</Label>
            <Textarea
              rows={3}
              value={s.prompt}
              placeholder="Extract the fields described in the schema from the article text."
              onChange={(e) => setS({ ...s, prompt: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Test connection
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
