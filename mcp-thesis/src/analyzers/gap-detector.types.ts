import {
  GenStep,
  GenFlow,
  GenUseCase,
} from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import { type GapCategory, type GapType } from "../data/gap-centroids.loader.js";

// ---------------------------------------------------------------------------
// Core data types (moved here so blueprint.detector.ts and gap.analyzer.ts
// can both depend on this file without a circular import).
// ---------------------------------------------------------------------------

export enum GapSeverity {
  High = "high",
  Medium = "medium",
  Low = "low",
}

export interface Gap {
  type: GapType;
  severity: GapSeverity;
  description: string;
  relatedStep?: number;
  relatedFlow?: string;
  suggestedQuestion?: string;
  blueprintConfidence?: number;
}

export interface StepSource {
  type: "step";
  flowId: string;
  stepIndex: number;
  step: GenStep;
  flow: GenFlow;
}

export interface ConditionSource {
  type: "condition";
  flowId: string;
  flow: GenFlow;
}

export interface EmbeddedText {
  text: string;
  embedding: number[];
  source: StepSource | ConditionSource;
}

export function isStepSource(
  source: EmbeddedText["source"],
): source is StepSource {
  return source.type === "step";
}

export function isConditionSource(
  source: EmbeddedText["source"],
): source is ConditionSource {
  return source.type === "condition";
}

// ---------------------------------------------------------------------------
// Detector contract
// ---------------------------------------------------------------------------

export type DetectionPhase = "initial" | "post-probe" | "always";

/**
 * Everything a detector needs to run. Built once per analyzeGaps() call and
 * passed unchanged to every detector in the registry.
 */
export interface GapDetectionContext {
  useCase: GenUseCase;
  originalDescription: string;
  embeddedTexts: EmbeddedText[];
  categories: GapCategory[];
  coveredStepKeys: Set<string>;
  suppressedGapTypes: Set<GapType>;
}

export interface GapDetectorConfig {
  gapType: GapType;
  phase: DetectionPhase;
  detect: (ctx: GapDetectionContext) => Gap[] | Promise<Gap[]>;
}

// ---------------------------------------------------------------------------
// Factory functions — the four common strategies.
// Each factory returns a GapDetectorConfig whose detect() implementation is
// fully self-contained.  Adding a new gap type = one new factory call in the
// registry; no new standalone function, no changes to analyzeGaps().
// ---------------------------------------------------------------------------

/**
 * Strategy 1 — Semantic centroid match per MAIN-flow step.
 * Fires when a step's embedding exceeds the category threshold AND the step
 * has no exception/alternative flow handling it.  An optional preFilter gate
 * can restrict detection to steps that match a heuristic pattern first.
 */
export function centroidGap(options: {
  gapType: GapType;
  categoryName: string;
  phase: DetectionPhase;
  severity: Gap["severity"];
  question: (step: GenStep) => string;
  preFilter?: (step: GenStep) => boolean;
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
    phase: options.phase,
    detect: async (ctx: GapDetectionContext): Promise<Gap[]> => {
      if (ctx.suppressedGapTypes.has(options.gapType)) return [];
      const category = ctx.categories.find(
        (c) => c.name === options.categoryName,
      );
      if (!category?.centroid) return [];

      const gaps: Gap[] = [];
      const stepItems = ctx.embeddedTexts.filter((e) => isStepSource(e.source));

      for (const item of stepItems) {
        const src = item.source as StepSource;
        if (ctx.coveredStepKeys.has(`${src.flowId}|${src.stepIndex}`)) continue;
        if (options.preFilter && !options.preFilter(src.step)) continue;

        const similarity = await semanticService.cosineSimilarity(
          item.embedding,
          category.centroid,
        );
        if (similarity < category.threshold) continue;

        // Only skip if there is a flow explicitly anchored to THIS step.
        // Flows with fromStepIndex === undefined are temporal/global and must
        // NOT suppress gap detection for individual steps.
        const hasException = ctx.useCase.flows.some(
          (f) =>
            (f.kind === "EXCEPTION" || f.kind === "ALTERNATIVE") &&
            f.parentFlow === src.flowId &&
            f.fromStepIndex === src.stepIndex,
        );
        if (hasException) continue;

        gaps.push({
          type: options.gapType,
          severity: options.severity,
          description: `Step ${src.stepIndex} in flow ${src.flowId} matches "${options.categoryName}" pattern but has no exception handling.`,
          relatedStep: src.stepIndex,
          relatedFlow: src.flowId,
          suggestedQuestion: options.question(src.step),
        });
      }
      return gaps;
    },
  };
}

/**
 * Strategy 2 — Keyword trigger on originalDescription.
 * Fires when at least one trigger keyword is present in the description AND
 * the isCovered predicate returns false (gap is not already addressed).
 * Emits at most one gap per detector config.
 */
export function keywordGap(options: {
  gapType: GapType;
  triggerKeywords: string[];
  phase: DetectionPhase;
  severity: Gap["severity"];
  description: string;
  question: string;
  isCovered: (useCase: GenUseCase) => boolean;
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
    phase: options.phase,
    detect: (ctx: GapDetectionContext): Gap[] => {
      const descLower = ctx.originalDescription.toLowerCase();
      if (!options.triggerKeywords.some((kw) => descLower.includes(kw)))
        return [];
      if (options.isCovered(ctx.useCase)) return [];
      return [
        {
          type: options.gapType,
          severity: options.severity,
          description: options.description,
          suggestedQuestion: options.question,
        },
      ];
    },
  };
}

/**
 * Strategy 3 — Structural check.
 * For detectors that inspect global use-case flags (e.g. missing exception
 * flows) or actor declarations.  The detect callback receives the full context
 * and returns zero or more gaps directly.
 */
export function structuralGap(options: {
  gapType: GapType;
  phase: DetectionPhase;
  detect: (ctx: GapDetectionContext) => Gap[];
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
    phase: options.phase,
    detect: options.detect,
  };
}

/**
 * Strategy 4 — Pattern / escape hatch.
 * For complex detectors that may emit multiple distinct gap types from a
 * single pass (e.g. claim adjudication outcomes) or need async access to
 * semantic services.  gapTypes[0] is used as the primary config identifier.
 */
export function patternGap(options: {
  gapTypes: GapType[];
  phase: DetectionPhase;
  detect: (ctx: GapDetectionContext) => Gap[] | Promise<Gap[]>;
}): GapDetectorConfig {
  return {
    gapType: options.gapTypes[0],
    phase: options.phase,
    detect: options.detect,
  };
}
