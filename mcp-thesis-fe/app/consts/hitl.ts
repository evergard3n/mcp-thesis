import type { HitlStatus } from "~/interfaces/hitl.interface";

export const STATUS_COLOR: Record<HitlStatus, string> = {
  IDLE: "text-gray-400 bg-gray-50",
  GENERATING_BASELINE: "text-blue-600 bg-blue-50",
  PROBING_BLUEPRINTS: "text-purple-600 bg-purple-50",
  ANALYZING_GAPS: "text-yellow-700 bg-yellow-50",
  GENERATING_QUESTIONS: "text-yellow-700 bg-yellow-50",
  WAITING_FOR_ANSWERS: "text-green-700 bg-green-50",
  REFINING: "text-purple-600 bg-purple-50",
  DONE: "text-green-700 bg-green-50",
  ERROR: "text-red-600 bg-red-50",
};

export const RUNNING_STATUSES: HitlStatus[] = [
  "GENERATING_BASELINE",
  "PROBING_BLUEPRINTS",
  "ANALYZING_GAPS",
  "GENERATING_QUESTIONS",
  "WAITING_FOR_ANSWERS",
  "REFINING",
];
