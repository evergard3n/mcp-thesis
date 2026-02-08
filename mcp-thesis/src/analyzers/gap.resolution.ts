/**
 * Gap Resolution Detector - Semantic detection of gap resolution
 * Uses SemanticService for embedding-based similarity matching
 */

import semanticService from "../services/semantic.service.js";
import { Gap } from "../analyzers/gap.analyzer.js";
import {
  GenUseCase,
  GenFlow,
  GenStep,
} from "../interfaces/usecase.interface.new.js";
import { GapResolutionStatus } from "../interfaces/tracking.interface.js";

/**
 * Detects if a gap has been resolved by comparing previous and current use cases
 * Uses semantic similarity between gap description and new flows/steps
 */
export async function detectGapResolution(
  gap: Gap,
  previousUseCase: GenUseCase,
  currentUseCase: GenUseCase,
): Promise<GapResolutionStatus> {
  await semanticService.waitForReady();

  // Find new flows (not in previous use case)
  const newFlows = currentUseCase.flows.filter(
    (f) => !previousUseCase.flows.some((pf) => pf.id === f.id),
  );

  // Find modified flows (same ID but different steps)
  const modifiedFlows = currentUseCase.flows.filter((f) => {
    const prevFlow = previousUseCase.flows.find((pf) => pf.id === f.id);
    return prevFlow && prevFlow.steps.length !== f.steps.length;
  });

  const flowsToCheck = [...newFlows, ...modifiedFlows];

  if (flowsToCheck.length === 0) {
    return {
      gapId: gap.type,
      resolutionConfidence: 0,
      resolutionMethod: "none",
      partiallyResolved: false,
    };
  }

  // Embed gap description
  const gapEmbedding = await semanticService.embed(gap.description);

  let maxSimilarity = 0;
  let resolvedByFlow = "";
  let resolvedByStep = -1;

  // Check each new/modified flow
  for (const flow of flowsToCheck) {
    // Get new steps only for modified flows
    let stepsToCheck = flow.steps;
    if (modifiedFlows.includes(flow)) {
      const prevFlow = previousUseCase.flows.find((pf) => pf.id === flow.id);
      if (prevFlow) {
        stepsToCheck = flow.steps.filter(
          (s) => !prevFlow.steps.some((ps) => ps.index === s.index),
        );
      }
    }

    // Check similarity with each step
    for (const step of stepsToCheck) {
      const stepEmbedding = await semanticService.embed(step.description);
      const similarity = await semanticService.cosineSimilarity(
        gapEmbedding,
        stepEmbedding,
      );

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        resolvedByFlow = flow.id;
        resolvedByStep = step.index;
      }
    }

    // Also check flow condition for alternative/exception flows
    if (flow.condition) {
      const conditionEmbedding = await semanticService.embed(flow.condition);
      const similarity = await semanticService.cosineSimilarity(
        gapEmbedding,
        conditionEmbedding,
      );

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        resolvedByFlow = flow.id;
        resolvedByStep = 0; // Condition-level resolution
      }
    }
  }

  // Determine resolution thresholds
  const resolvedThreshold = gap.type.includes("validation") ? 0.7 : 0.65;
  const partialThreshold = 0.55;

  const isResolved = maxSimilarity >= resolvedThreshold;
  const isPartial = maxSimilarity >= partialThreshold && !isResolved;

  return {
    gapId: gap.type,
    resolvedAt: isResolved ? new Date().toISOString() : undefined,
    resolutionConfidence: maxSimilarity,
    resolvedByFlow: isResolved || isPartial ? resolvedByFlow : undefined,
    resolvedByStep: isResolved || isPartial ? resolvedByStep : undefined,
    resolutionMethod: isResolved ? "semantic" : "none",
    partiallyResolved: isPartial,
  };
}

/**
 * Batch detect resolution for all gaps
 * More efficient than calling detectGapResolution individually
 */
export async function detectAllGapResolutions(
  gaps: Gap[],
  previousUseCase: GenUseCase,
  currentUseCase: GenUseCase,
): Promise<GapResolutionStatus[]> {
  await semanticService.waitForReady();

  const resolutions: GapResolutionStatus[] = [];

  // Optimize: find new/modified flows once
  const newFlows = currentUseCase.flows.filter(
    (f) => !previousUseCase.flows.some((pf) => pf.id === f.id),
  );

  const modifiedFlows = currentUseCase.flows.filter((f) => {
    const prevFlow = previousUseCase.flows.find((pf) => pf.id === f.id);
    return prevFlow && prevFlow.steps.length !== f.steps.length;
  });

  // Early return if no changes
  if (newFlows.length === 0 && modifiedFlows.length === 0) {
    return gaps.map((gap) => ({
      gapId: gap.type,
      resolutionConfidence: 0,
      resolutionMethod: "none",
      partiallyResolved: false,
    }));
  }

  // Batch embed all gap descriptions
  const gapEmbeddings = await semanticService.embedBatch(
    gaps.map((g) => g.description),
  );

  // Collect all new step descriptions
  const newStepDescriptions: string[] = [];
  const stepMetadata: Array<{ flowId: string; stepIndex: number }> = [];

  for (const flow of newFlows) {
    for (const step of flow.steps) {
      newStepDescriptions.push(step.description);
      stepMetadata.push({ flowId: flow.id, stepIndex: step.index });
    }
    if (flow.condition) {
      newStepDescriptions.push(flow.condition);
      stepMetadata.push({ flowId: flow.id, stepIndex: 0 });
    }
  }

  for (const flow of modifiedFlows) {
    const prevFlow = previousUseCase.flows.find((pf) => pf.id === flow.id);
    const newSteps = prevFlow
      ? flow.steps.filter(
          (s) => !prevFlow.steps.some((ps) => ps.index === s.index),
        )
      : flow.steps;

    for (const step of newSteps) {
      newStepDescriptions.push(step.description);
      stepMetadata.push({ flowId: flow.id, stepIndex: step.index });
    }
  }

  // Batch embed all new step descriptions
  const stepEmbeddings =
    newStepDescriptions.length > 0
      ? await semanticService.embedBatch(newStepDescriptions)
      : [];

  // Compute similarities for each gap
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    const gapEmbedding = gapEmbeddings[i];

    let maxSimilarity = 0;
    let resolvedByFlow = "";
    let resolvedByStep = -1;

    // Compare with all new steps
    for (let j = 0; j < stepEmbeddings.length; j++) {
      const similarity = await semanticService.cosineSimilarity(
        gapEmbedding,
        stepEmbeddings[j],
      );

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        resolvedByFlow = stepMetadata[j].flowId;
        resolvedByStep = stepMetadata[j].stepIndex;
      }
    }

    // Determine resolution
    const resolvedThreshold = gap.type.includes("validation") ? 0.7 : 0.65;
    const partialThreshold = 0.55;

    const isResolved = maxSimilarity >= resolvedThreshold;
    const isPartial = maxSimilarity >= partialThreshold && !isResolved;

    resolutions.push({
      gapId: gap.type,
      resolvedAt: isResolved ? new Date().toISOString() : undefined,
      resolutionConfidence: maxSimilarity,
      resolvedByFlow: isResolved || isPartial ? resolvedByFlow : undefined,
      resolvedByStep: isResolved || isPartial ? resolvedByStep : undefined,
      resolutionMethod: isResolved ? "semantic" : "none",
      partiallyResolved: isPartial,
    });
  }

  return resolutions;
}
