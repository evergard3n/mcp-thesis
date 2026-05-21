import type { HitlStatus } from "~/interfaces/hitl.interface";

export const STATUS_COLOR: Record<HitlStatus, string> = {
  IDLE: "text-muted-foreground bg-muted/50",
  GENERATING_BASELINE: "text-blue-400 bg-blue-500/10",
  PROBING_BLUEPRINTS: "text-violet-400 bg-violet-500/10",
  ANALYZING_GAPS: "text-yellow-400 bg-yellow-500/10",
  GENERATING_QUESTIONS: "text-yellow-400 bg-yellow-500/10",
  WAITING_FOR_ANSWERS: "text-green-400 bg-green-500/10",
  REFINING: "text-violet-400 bg-violet-500/10",
  DONE: "text-green-400 bg-green-500/10",
  ERROR: "text-red-400 bg-red-500/10",
};

export const RUNNING_STATUSES: HitlStatus[] = [
  "GENERATING_BASELINE",
  "PROBING_BLUEPRINTS",
  "ANALYZING_GAPS",
  "GENERATING_QUESTIONS",
  "WAITING_FOR_ANSWERS",
  "REFINING",
];
