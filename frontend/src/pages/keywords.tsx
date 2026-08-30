import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Keyword } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Tag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export function Keywords() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [word, setWord] = useState("");
  const [category, setCategory] = useState("general");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await api.keywords();
      setKeywords(res);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    setBusy(true);
    try {
      await api.addKeyword({ word: word.trim(), category: category.trim() });
      toast.success("Keyword added");
      setWord("");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deleteKeyword(id);
      toast.success("Keyword deleted");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Keywords Filter</h1>
        <p className="text-sm text-muted-foreground">
          Manage keywords that are used to filter and fetch correct chunks during indexing, and quickly apply them to search criteria.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-base">Add Keyword</CardTitle>
            <CardDescription>Define a word or phrase to look for.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="word">Keyword / Phrase</Label>
                <Input
                  id="word"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  placeholder="e.g. microsoft, acquisitions"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. business, technology"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !word.trim()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Keyword
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Saved Keywords ({keywords.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : keywords.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No keywords saved yet. Add keywords on the left to start filtering chunks.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {keywords.map((kw) => (
                  <div
                    key={kw.id}
                    className="flex items-center gap-2 rounded-full border bg-secondary/40 px-3 py-1 text-sm shadow-sm"
                  >
                    <Tag className="h-3 w-3 text-brand shrink-0" />
                    <span className="font-medium text-foreground">{kw.word}</span>
                    {kw.category && kw.category !== "general" && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase font-bold tracking-wider">
                        {kw.category}
                      </Badge>
                    )}
                    <button
                      onClick={() => remove(kw.id)}
                      className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
                      title="Delete keyword"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
