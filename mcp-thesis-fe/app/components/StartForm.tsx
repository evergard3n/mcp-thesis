import { useState } from "react";
import type { FormEvent } from "react";

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border p-4">
      <label className="text-sm font-medium text-gray-700">Describe your use case</label>
      <textarea
        value={vague}
        onChange={(e) => setVague(e.target.value)}
        rows={4}
        placeholder="e.g. A claims adjuster needs to process an insurance claim…"
        className="rounded border px-3 py-2 text-sm outline-none focus:border-gray-400"
        disabled={isLoading}
      />

      <button
        type="button"
        onClick={() => setShowConfig((v) => !v)}
        className="self-start text-xs text-gray-400 hover:text-gray-600"
      >
        {showConfig ? "Hide" : "Show"} options
      </button>

      {showConfig && (
        <div className="grid grid-cols-3 gap-4 rounded bg-gray-50 p-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Domain (optional)</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. Insurance/Claims"
              className="rounded border px-2 py-1 text-xs outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Max iterations: {maxIterations}</span>
            <input
              type="range"
              min={1}
              max={20}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Max questions: {maxQuestions}</span>
            <input
              type="range"
              min={1}
              max={100}
              value={maxQuestions}
              onChange={(e) => setMaxQuestions(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={!vague.trim() || isLoading}
        className="self-end rounded bg-black px-5 py-2 text-sm text-white disabled:opacity-40"
      >
        {isLoading ? "Starting…" : "Start Loop"}
      </button>
    </form>
  );
}
