/**
 * Question History Tracker - Tracks questions asked in previous iterations
 */

import { QuestionHistory } from "../interfaces/tracking.interface.js";

/**
 * Applies question history penalty to step priorities
 * Exponential decay: 0.85^timesAsked
 */
export function applyQuestionHistoryPenalty(
  priorities: any[], // StepPriority from uncertainty.ranker.ts
  history: QuestionHistory[],
): any[] {
  return priorities.map((p) => {
    const historyEntry = history.find(
      (h) => h.flowId === p.flowId && h.stepIndex === p.stepIndex,
    );

    if (!historyEntry) {
      return p;
    }

    const penalty = Math.pow(0.85, historyEntry.timesAsked);

    return {
      ...p,
      priorityScore: p.priorityScore * penalty,
      uncertaintyReasons: [
        ...p.uncertaintyReasons,
        `Previously asked ${historyEntry.timesAsked} time(s) - penalty ${(penalty * 100).toFixed(0)}%`,
      ],
    };
  });
}

/**
 * Updates question history with newly asked questions
 */
export function updateQuestionHistory(
  history: QuestionHistory[],
  newQuestions: Array<{
    question: string;
    targetGap: string;
    targetFlowId: string;
    targetStepIndex: number;
  }>,
  currentIteration: number,
): QuestionHistory[] {
  const updatedHistory = [...history];

  for (const q of newQuestions) {
    const existingEntry = updatedHistory.find(
      (h) =>
        h.gapId === q.targetGap &&
        h.flowId === q.targetFlowId &&
        h.stepIndex === q.targetStepIndex,
    );

    if (existingEntry) {
      existingEntry.timesAsked += 1;
      existingEntry.lastAskedIteration = currentIteration;
      existingEntry.questions.push(q.question);
    } else {
      updatedHistory.push({
        gapId: q.targetGap,
        flowId: q.targetFlowId,
        stepIndex: q.targetStepIndex,
        timesAsked: 1,
        lastAskedIteration: currentIteration,
        questions: [q.question],
      });
    }
  }

  return updatedHistory;
}

/**
 * Coverage-based exploration boost
 * Boosts priority for unexplored flows
 */
export function applyCoverageBoost(
  priorities: any[], // StepPriority
  history: QuestionHistory[],
): any[] {
  const flowCoverage = new Map<string, number>();

  for (const h of history) {
    flowCoverage.set(h.flowId, (flowCoverage.get(h.flowId) || 0) + 1);
  }

  return priorities.map((p) => {
    const coverage = flowCoverage.get(p.flowId) || 0;

    const explorationBonus = coverage === 0 ? 1.5 : 1.0 / (1 + coverage * 0.3);

    return {
      ...p,
      priorityScore: p.priorityScore * explorationBonus,
      uncertaintyReasons: [
        ...p.uncertaintyReasons,
        coverage === 0
          ? "Unexplored flow (+50% boost)"
          : `Flow explored ${coverage} times (${(explorationBonus * 100).toFixed(0)}% factor)`,
      ],
    };
  });
}
