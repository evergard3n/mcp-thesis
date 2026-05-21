import {
  GenStep,
  GenFlow,
  GenUseCase,
} from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import { type GapCategory, type GapType } from "../data/gap-centroids.loader.js";
import { describeBranchEntry } from "../helpers/usecase-text.js";

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
  severity: Gap["severity"];
  preFilter?: (step: GenStep) => boolean;
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
    detect: async (ctx: GapDetectionContext): Promise<Gap[]> => {
      if (ctx.suppressedGapTypes.has(options.gapType)) return [];
      const category = ctx.categories.find(
        (c) => c.name === options.categoryName,
      );
      if (!category?.centroid) return [];

      const questionSuffix = category.questionSuffix ?? "";
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

        const step = src.step;
        const targetContext = step.target ? ` targeting ${step.target}` : "";
        const stepCtx = `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}`;

        gaps.push({
          type: options.gapType,
          severity: options.severity,
          description: `Step ${src.stepIndex} in flow ${src.flowId} matches "${options.categoryName}" pattern but has no exception handling.`,
          relatedStep: src.stepIndex,
          relatedFlow: src.flowId,
          suggestedQuestion: `${stepCtx}. ${questionSuffix}`,
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
  severity: Gap["severity"];
  description: string;
  question: string;
  isCovered: (useCase: GenUseCase) => boolean;
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
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
 * Strategy 3 — Unused actor check.
 * Detects actors declared in the use case but never appearing in any step.
 * Question template is read from the JSON category entry for this gapType.
 */
export function actorGap(options: {
  gapType: GapType;
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
    detect: (ctx: GapDetectionContext): Gap[] => {
      const category = ctx.categories.find((c) => c.gapType === options.gapType);
      const questionTemplate =
        category?.questionTemplate ?? "What role does {actor} play in this use case?";

      const allSteps = ctx.useCase.flows.flatMap((f) => f.steps);
      const usedActors = new Set(allSteps.map((s) => s.actor.toLowerCase()));

      return ctx.useCase.actors
        .filter((actor) => !usedActors.has(actor.toLowerCase()))
        .map((actor) => ({
          type: options.gapType,
          severity: GapSeverity.Low,
          description: `Actor '${actor}' is declared but never appears in any step.`,
          suggestedQuestion: questionTemplate.replace("{actor}", actor),
        }));
    },
  };
}

/**
 * Strategy 4 — Condition quality check.
 * Detects flows whose branching condition is too vague, too short, or
 * semantically unrelated to the step it branches from.
 * Question template is read from the "vague_condition" JSON category entry.
 */
export function conditionQualityGap(options: {
  gapType: GapType;
}): GapDetectorConfig {
  return {
    gapType: options.gapType,
    detect: async (ctx: GapDetectionContext): Promise<Gap[]> => {
      const gaps: Gap[] = [];
      const conditionItems = ctx.embeddedTexts.filter((e) =>
        isConditionSource(e.source),
      );
      const category = ctx.categories.find((c) => c.name === "vague_condition");
      const vagueCentroid = category?.centroid;
      const questionTemplate =
        category?.questionTemplate ??
        'In the "{flowId}" {flowKindLabel}:{branchContext} What is the exact condition or event that triggers this branch? Describe the specific state, actor action, or system signal that causes execution to leave the normal flow and enter "{flowId}".';

      for (const item of conditionItems) {
        const src = item.source as ConditionSource;
        const issues: string[] = [];
        let qualityScore = 0.7;

        if (vagueCentroid) {
          const vagueSim = await semanticService.cosineSimilarity(
            item.embedding,
            vagueCentroid,
          );
          if (vagueSim > 0.6) {
            qualityScore -= 0.3;
            issues.push("Condition is semantically vague");
          }
        }

        if (src.flow.fromStepIndex !== undefined && src.flow.parentFlow) {
          const anchorStep = ctx.embeddedTexts.find(
            (e) =>
              isStepSource(e.source) &&
              (e.source as StepSource).flowId === src.flow.parentFlow &&
              (e.source as StepSource).stepIndex === src.flow.fromStepIndex,
          );
          if (anchorStep) {
            const anchorSim = await semanticService.cosineSimilarity(
              item.embedding,
              anchorStep.embedding,
            );
            if (anchorSim < 0.3) {
              qualityScore -= 0.2;
              issues.push("Condition unrelated to anchor step");
            }
          }
        }

        if (src.flow.condition && src.flow.condition.trim().length < 10) {
          qualityScore -= 0.2;
          issues.push("Condition too short");
        }

        if (qualityScore < 0.5) {
          const flow = src.flow;
          const flowKindLabel =
            flow.kind === "ALTERNATIVE" ? "alternative flow" : "exception flow";
          const branchContext = describeBranchEntry(ctx.useCase, flow);

          const suggestedQuestion = questionTemplate
            .replaceAll("{flowId}", src.flowId)
            .replaceAll("{flowKindLabel}", flowKindLabel)
            .replaceAll("{branchContext}", branchContext);

          gaps.push({
            type: options.gapType,
            severity: qualityScore < 0.3 ? GapSeverity.High : GapSeverity.Medium,
            description: `Flow "${src.flowId}" has weak condition: ${issues.join(", ")}`,
            relatedFlow: src.flowId,
            suggestedQuestion,
          });
        }
      }
      return gaps;
    },
  };
}
