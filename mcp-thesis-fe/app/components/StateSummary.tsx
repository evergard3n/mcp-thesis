import type { HitlState } from "~/interfaces/hitl.interface";
import { STATUS_COLOR } from "~/consts/hitl";

interface StateSummaryProps {
  state: HitlState;
  message: string;
}

export function StateSummary({ state, message }: StateSummaryProps) {
  const colorClass = STATUS_COLOR[state.status] ?? "text-gray-500 bg-gray-50";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
      <span className={`rounded px-2 py-0.5 font-mono text-xs font-medium ${colorClass}`}>
        {state.status}
      </span>
      {message && <span className="text-gray-600">{message}</span>}
      <span className="ml-auto text-xs text-gray-400">
        iter {state.iterationCount}/{state.maxIterations} · {state.totalQuestionsAsked}/
        {state.maxQuestions} q
      </span>
    </div>
  );
}
