import { useState } from "react";
import type { FormEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import type { StartHitlRequest } from "~/interfaces/hitl.interface";

interface StartFormProps {
  onSubmit: (body: StartHitlRequest) => void;
  isLoading: boolean;
}

export function StartForm({ onSubmit, isLoading }: StartFormProps) {
  const [vague, setVague] = useState("");
  const [domain, setDomain] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [maxIterations, setMaxIterations] = useState(5);
  const [maxQuestions, setMaxQuestions] = useState(20);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!vague.trim()) return;
    onSubmit({
      vague: vague.trim(),
      domain: domain.trim() || undefined,
      maxIterations,
      maxQuestions,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
    >
      <label className="text-xs font-medium text-muted-foreground">Describe your use case</label>
      <Textarea
        value={vague}
        onChange={(e) => setVague(e.target.value)}
        placeholder="e.g. A claims adjuster needs to process an insurance claim…"
        className="min-h-[100px]"
        disabled={isLoading}
      />

      <button
        type="button"
        onClick={() => setShowConfig((v) => !v)}
        className="flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {showConfig ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showConfig ? "Hide" : "Show"} options
      </button>

      {showConfig && (
        <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <label className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Domain (optional)</span>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. Insurance"
              className="h-7 text-xs"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Max iterations · {maxIterations}</span>
            <input
              type="range"
              min={1}
              max={20}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number(e.target.value))}
              className="accent-primary"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Max questions · {maxQuestions}</span>
            <input
              type="range"
              min={1}
              max={100}
              value={maxQuestions}
              onChange={(e) => setMaxQuestions(Number(e.target.value))}
              className="accent-primary"
            />
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={!vague.trim() || isLoading}
        className="self-end rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {isLoading ? "Starting…" : "Start Loop"}
      </button>
    </form>
  );
}
