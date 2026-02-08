/**
 * Hybrid Strategy - Combines Question History and Semantic Resolution
 *
 * This strategy applies two complementary penalty mechanisms:
 * 1. Question History: Penalize steps we've already asked about (0.85^n)
 * 2. Semantic Resolution: Penalize gaps that have been semantically resolved (0.3 or 0.6)
 *
 * The penalties multiply, creating a "defense in depth" approach that:
 * - Reduces duplicate questions (history penalty)
 * - Detects implicit gap resolution (semantic penalty)
 * - Self-corrects for false positives (history provides backup)
 */

import { StepPriority } from "./uncertainty.ranker.js";
import { Gap } from "./gap.analyzer.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import {
  QuestionHistory,
  GapResolutionStatus,
} from "../interfaces/tracking.interface.js";
import {
  applyQuestionHistoryPenalty,
  applyCoverageBoost,
} from "./question.history.js";
import { detectAllGapResolutions } from "./gap.resolution.js";

/**
 * Applies hybrid penalty combining question history and semantic resolution
 *
 * @param priorities - Base priorities from uncertainty analysis
 * @param questionHistory - History of questions asked
 * @param gapResolutions - Semantic resolution status of gaps
 * @returns Updated priorities with both penalties applied
 */
export async function applyHybridPenalty(
  priorities: StepPriority[],
  questionHistory: QuestionHistory[],
  gapResolutions: GapResolutionStatus[],
): Promise<StepPriority[]> {
  const results: StepPriority[] = [];

  for (const p of priorities) {
    let finalScore = p.priorityScore;
    const reasons = [...p.uncertaintyReasons];

    // Penalty 1: Question History
    const historyEntry = questionHistory.find(
      (h) => h.flowId === p.flowId && h.stepIndex === p.stepIndex,
    );

    if (historyEntry) {
      const historyPenalty = Math.pow(0.85, historyEntry.timesAsked);
      finalScore *= historyPenalty;
      reasons.push(
        `Asked ${historyEntry.timesAsked} times (${(historyPenalty * 100).toFixed(0)}% penalty)`,
      );
    }

    // Penalty 2: Semantic Resolution
    const relatedResolutions = gapResolutions.filter((r) =>
      p.relatedGaps.some((g) => g.type === r.gapId),
    );

    for (const res of relatedResolutions) {
      if (res.resolvedAt) {
        // Fully resolved
        const semanticPenalty = 0.3;
        finalScore *= semanticPenalty;
        reasons.push(
          `Gap '${res.gapId}' resolved semantically (confidence: ${res.resolutionConfidence.toFixed(2)}, 70% penalty)`,
        );
      } else if (res.partiallyResolved) {
        // Partially resolved
        const partialPenalty = 0.6;
        finalScore *= partialPenalty;
        reasons.push(
          `Gap '${res.gapId}' partially resolved (confidence: ${res.resolutionConfidence.toFixed(2)}, 40% penalty)`,
        );
      }
    }

    results.push({
      ...p,
      priorityScore: finalScore,
      uncertaintyReasons: reasons,
    });
  }

  // Sort by final priority
  return results.sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Full hybrid strategy pipeline with coverage boost
 *
 * @param priorities - Base priorities
 * @param questionHistory - Question history
 * @param gaps - Current gaps
 * @param previousUseCase - Use case from previous iteration
 * @param currentUseCase - Current use case
 * @returns Updated priorities with all strategies applied
 */
export async function applyFullHybridStrategy(
  priorities: StepPriority[],
  questionHistory: QuestionHistory[],
  gaps: Gap[],
  previousUseCase: GenUseCase,
  currentUseCase: GenUseCase,
): Promise<{
  priorities: StepPriority[];
  resolutions: GapResolutionStatus[];
}> {
  // Step 1: Detect semantic resolutions (if we have previous iteration)
  let resolutions: GapResolutionStatus[] = [];
  if (previousUseCase.flows.length > 0) {
    resolutions = await detectAllGapResolutions(
      gaps,
      previousUseCase,
      currentUseCase,
    );
  }

  // Step 2: Apply question history penalty
  let updatedPriorities = applyQuestionHistoryPenalty(
    priorities,
    questionHistory,
  );

  // Step 3: Apply coverage boost (breadth exploration)
  updatedPriorities = applyCoverageBoost(updatedPriorities, questionHistory);

  // Step 4: Apply semantic resolution penalty
  if (resolutions.length > 0) {
    const results: StepPriority[] = [];

    for (const p of updatedPriorities) {
      let finalScore = p.priorityScore;
      const reasons = [...p.uncertaintyReasons];

      const relatedResolutions = resolutions.filter((r) =>
        p.relatedGaps.some((g: Gap) => g.type === r.gapId),
      );

      for (const res of relatedResolutions) {
        if (res.resolvedAt) {
          finalScore *= 0.3;
          reasons.push(
            `Gap '${res.gapId}' resolved (${res.resolutionConfidence.toFixed(2)}, 70% penalty)`,
          );
        } else if (res.partiallyResolved) {
          finalScore *= 0.6;
          reasons.push(
            `Gap '${res.gapId}' partial (${res.resolutionConfidence.toFixed(2)}, 40% penalty)`,
          );
        }
      }

      results.push({
        ...p,
        priorityScore: finalScore,
        uncertaintyReasons: reasons,
      });
    }

    updatedPriorities = results.sort(
      (a, b) => b.priorityScore - a.priorityScore,
    );
  }

  return {
    priorities: updatedPriorities,
    resolutions,
  };
}
