import type { HitlState } from "~/interfaces/hitl.interface";
import { STATUS_COLOR } from "~/consts/hitl";

interface StateSummaryProps {
  state: HitlState;
  message: string;
}

export function StateSummary({ state, message }: StateSummaryProps) {
  const colorClass = STATUS_COLOR[state.status] ?? "text-muted-foreground bg-muted";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span className={`rounded-md px-2.5 py-0.5 font-mono text-xs font-medium ${colorClass}`}>
        {state.status}
      </span>
      {message && <span className="text-muted-foreground">{message}</span>}
      <span className="ml-auto font-mono text-xs text-muted-foreground/60">
        iter {state.iterationCount}/{state.maxIterations} · {state.totalQuestionsAsked}/
        {state.maxQuestions} q
      </span>
    </div>
  );
}
