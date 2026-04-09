import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import { UseCaseTermScore } from "../validators/flat.validator.js";
import {
  detectBlueprintGaps,
  detectActivatedBlueprints,
  type BlueprintActivation,
  type EmbeddedStep,
} from "./blueprint.detector.js";
import {
  classifyUseCaseDomainHybrid,
  resolveBlueprintDomainFilter,
  type DomainType as ClassifierDomainType,
} from "../services/domain-classifier.service.js";
import {
  loadGapCentroids,
  type GapType,
} from "../data/gap-centroids.loader.js";
import {
  type Gap,
  type EmbeddedText,
  type StepSource,
  type ConditionSource,
  type GapDetectionContext,
  type DetectionPhase,
  type GapDetectorConfig,
  isStepSource,
  isConditionSource,
} from "./gap-detector.types.js";
import { GAP_DETECTORS } from "./gap-detectors.registry.js";

// ---------------------------------------------------------------------------
// Re-exports — maintain backward-compatible public API for all callers.
// ---------------------------------------------------------------------------
export type { GapType } from "../data/gap-centroids.loader.js";
export { clearGapCentroidsCache } from "../data/gap-centroids.loader.js";
export type {
  Gap,
  EmbeddedText,
  StepSource,
  ConditionSource,
  GapDetectionContext,
  DetectionPhase,
  GapDetectorConfig,
} from "./gap-detector.types.js";

// ---------------------------------------------------------------------------
// Public interfaces that remain owned by this module
// ---------------------------------------------------------------------------

export interface GapAnalysis {
  missingExceptionFlows: boolean;
  missingAlternativeFlows: boolean;
  incompleteActors: string[];
  uncertainConditions: string[];
  gaps: Gap[];
  priorityGaps: GapType[];
  completenessScore: number;
  detectedDomains?: Set<"human-system" | "system-system">;
  dominantDomain?: "human-system" | "system-system" | "mixed";
  activatedBlueprints: BlueprintActivation[];
  /** Hybrid classifier output (includes `ambiguous`); for evaluation / batch JSON. */
  classifierDominantDomain?: ClassifierDomainType;
  classifierOverallConfidence?: number;
  classifierFlowDomains?: Array<{
    flowId: string;
    domainType: ClassifierDomainType;
    confidence: number;
  }>;
}

export interface InteractionMemory {
  stepContext: string;
  question: string;
  answer: string;
  vector: number[];
  questionVector?: number[];
  iteration: number;
  answerConfidence?: "low" | "medium" | "high";
  metadata: {
    stepIndex?: number;
    stepIndexes?: number[];
    flowId?: string;
    gapType?: GapType;
    consolidatedGroupId?: string;
  };
}

export interface ConsolidationGroup {
  groupId: string;
  memberGapTypes: GapType[];
  questionTemplate: (
    steps: Array<{
      index: number;
      actor: string;
      description: string;
      flowId: string;
    }>,
  ) => string;
  answerGuidance: string;
}

// ---------------------------------------------------------------------------
// Consolidation group templates (used by llm.validator.ts / question generator)
// ---------------------------------------------------------------------------

function formatConsolidatedStepLine(step: {
  index: number;
  actor: string;
  description: string;
  flowId: string;
}): string {
  if (step.flowId !== "MAIN") {
    return `- ${step.flowId} Step ${step.index}: "${step.actor} ${step.description}"`;
  }
  return `- Step ${step.index}: "${step.actor} ${step.description}"`;
}

function formatConsolidatedStepList(
  steps: Array<{
    index: number;
    actor: string;
    description: string;
    flowId: string;
  }>,
): string {
  return steps.map((step) => formatConsolidatedStepLine(step)).join("\n");
}

export const CONSOLIDATION_GROUPS: ConsolidationGroup[] = [
  {
    groupId: "data_handling",
    memberGapTypes: [
      "missing_data_quality_handling",
      "missing_validation_handling",
    ],
    questionTemplate: (steps) => {
      const stepList = formatConsolidatedStepList(steps);
      return `The following steps involve data entry or validation:\n${stepList}\nHow does the system handle basic input errors (missing fields, wrong formats) versus business rule violations (duplicates, contradictory logic) at these steps? For each step, specify any differences in minimum required fields, error handling, or routing.`;
    },
    answerGuidance:
      "For each step listed, describe: (1) what minimum data is required, (2) what happens on basic input errors, (3) what happens on business rule violations, (4) any step-specific differences. Avoid vague answers like 'the same for all steps'—state the differences or explicitly confirm no differences after checking each step.",
  },
  {
    groupId: "infrastructure",
    memberGapTypes: [
      "missing_resource_availability",
      "missing_system_failure_handling",
    ],
    questionTemplate: (steps) => {
      const stepList = formatConsolidatedStepList(steps);
      return `The following steps involve resource assignments or system interactions:\n${stepList}\nWhat happens if the assigned person is unavailable, the system times out, or a resource cannot be allocated at these steps? For each step, specify the fallback or escalation path.`;
    },
    answerGuidance:
      "For each step listed, describe: (1) what happens when the person/system is unavailable, (2) whether there is automatic reassignment or escalation, (3) any timeout or retry behavior. Avoid generic answers; note step-specific differences or explicitly confirm none after checking each step.",
  },
  {
    groupId: "save_resume",
    memberGapTypes: ["missing_save_resume_handling"],
    questionTemplate: (steps) => {
      const stepList = formatConsolidatedStepList(steps);
      return `The following steps involve multi-field or complex data submissions:\n${stepList}\nCan any of these steps be partially completed, saved as a draft, and resumed later? For each step, specify what state is preserved and what happens on resume.`;
    },
    answerGuidance:
      "For each step listed, describe: (1) whether the actor can save progress, (2) what data is preserved vs lost, (3) whether resuming requires re-validation. Avoid vague answers; specify differences or explicitly confirm none after checking each step.",
  },
];

// ---------------------------------------------------------------------------
// Priority ordering for gap types
// ---------------------------------------------------------------------------

const GAP_TYPE_PRIORITY: GapType[] = [
  "missing_exception_flows",
  "missing_data_quality_handling",
  "missing_validation_handling",
  "missing_search_handling",
  "missing_resource_availability",
  "missing_eligibility_failure_handling",
  "missing_assignment_unavailability_handling",
  "missing_policy_outcome_branching",
  "missing_system_failure_handling",
  "missing_save_resume_handling",
  "missing_post_completion_scenarios",
  "missing_temporal_exceptions",
  "missing_nested_exceptions",
  "missing_environmental_interruptions",
  "missing_alternative_flows",
  "missing_technology_variations",
  "uncertain_conditions",
  "incomplete_actors",
];

// ---------------------------------------------------------------------------
// Blueprint → centroid suppression map
// When a blueprint family is dropped by the expert, linked centroid gap types
// are suppressed to avoid asking questions the expert already ruled out.
// ---------------------------------------------------------------------------

const BLUEPRINT_CENTROID_SUPPRESSION: Partial<Record<string, GapType[]>> = {
  session_persistence: ["missing_save_resume_handling"],
};

function buildSuppressedGapTypes(
  droppedBlueprintIds?: Set<string>,
): Set<GapType> {
  const suppressed = new Set<GapType>();
  if (!droppedBlueprintIds) return suppressed;
  for (const blueprintId of droppedBlueprintIds) {
    const linked = BLUEPRINT_CENTROID_SUPPRESSION[blueprintId];
    if (linked) {
      for (const gapType of linked) {
        suppressed.add(gapType);
        console.log(
          `[Blueprint-Centroid Suppression] Suppressing gap type "${gapType}" because blueprint "${blueprintId}" was dropped`,
        );
      }
    }
  }
  return suppressed;
}

// ---------------------------------------------------------------------------
// Embedding helpers (used by orchestrator + probe phase)
// ---------------------------------------------------------------------------

export async function collectAndEmbedTexts(
  useCase: GenUseCase,
): Promise<EmbeddedText[]> {
  const textsToEmbed: string[] = [];
  const textSources: EmbeddedText["source"][] = [];

  for (const flow of useCase.flows) {
    for (const step of flow.steps) {
      textsToEmbed.push(step.description);
      textSources.push({
        type: "step",
        flowId: flow.id,
        stepIndex: step.index,
        step,
        flow,
      });
    }

    if (flow.condition && flow.kind !== "MAIN") {
      textsToEmbed.push(flow.condition);
      textSources.push({ type: "condition", flowId: flow.id, flow });
    }
  }

  if (textsToEmbed.length === 0) return [];

  const embeddings = await semanticService.embedBatch(textsToEmbed);

  return textsToEmbed.map((text, i) => ({
    text,
    embedding: embeddings[i],
    source: textSources[i],
  }));
}

/**
 * Convenience helper: embeds all steps and returns them as EmbeddedStep[].
 * Used by the tool layer to run detectActivatedBlueprints before analyzeGaps
 * (probe phase must happen before gap analysis so confirmed set is populated first).
 */
export async function collectStepEmbeddings(
  useCase: GenUseCase,
): Promise<EmbeddedStep[]> {
  const texts = await collectAndEmbedTexts(useCase);
  return texts
    .filter((item) => isStepSource(item.source))
    .map((item) => ({
      step: (item.source as StepSource).step,
      flow: (item.source as StepSource).flow,
      embedding: item.embedding,
    }));
}

// ---------------------------------------------------------------------------
// Stale-gap filtering (conversation-history deduplication)
// ---------------------------------------------------------------------------

function getStepContext(gap: Gap, useCase: GenUseCase): string {
  if (gap.relatedStep === undefined) {
    return `[Global] ${gap.description}`;
  }

  const flow = useCase.flows.find((f) => f.id === (gap.relatedFlow || "MAIN"));
  const step = flow?.steps.find((s) => s.index === gap.relatedStep);

  if (step) {
    return `[Step ${step.index}] Actor: ${step.actor}, Action: ${step.description}`;
  }
  return `[Step ${gap.relatedStep}] ${gap.description}`;
}

export async function filterStaleGaps(
  gaps: Gap[],
  useCase: GenUseCase,
  history: InteractionMemory[],
  threshold: number = 0.80,
): Promise<Gap[]> {
  if (history.length === 0 || gaps.length === 0) return gaps;

  // Layer 0 — metadata-based pre-filter
  const exploredTuples = new Set(
    history
      .filter((h) => h.metadata.stepIndex !== undefined && h.metadata.gapType)
      .map((h) => `${h.metadata.stepIndex}|${h.metadata.gapType}`),
  );

  const metadataFiltered = gaps.filter((gap) => {
    if (gap.relatedStep === undefined) return true;
    return !exploredTuples.has(`${gap.relatedStep}|${gap.type}`);
  });

  if (metadataFiltered.length === 0) return [];

  const gapQueries = metadataFiltered.map((gap) => {
    const stepContext = getStepContext(gap, useCase);
    return `${stepContext} | ${gap.description}`;
  });

  const gapVectors = await semanticService.embedBatch(gapQueries);
  const freshGaps: Gap[] = [];

  for (let i = 0; i < metadataFiltered.length; i++) {
    const isCovered = await isGapCoveredByHistory(
      gapVectors[i],
      history,
      threshold,
    );
    if (!isCovered) {
      freshGaps.push(metadataFiltered[i]);
    }
  }

  return freshGaps;
}

async function isGapCoveredByHistory(
  gapVector: number[],
  history: InteractionMemory[],
  threshold: number,
): Promise<boolean> {
  for (const record of history) {
    if (record.answerConfidence === "low") continue;

    const sim = await semanticService.cosineSimilarity(
      gapVector,
      record.vector,
    );

    if (sim >= threshold) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scoring & priority helpers
// ---------------------------------------------------------------------------

function calculateCompletenessScore(
  validationFeedback: UseCaseTermScore,
  gaps: Gap[],
  missingExceptionFlows: boolean,
  missingAlternativeFlows: boolean,
): number {
  let score = validationFeedback.overall / 100;

  if (missingExceptionFlows) {
    score *= 0.6;
  }

  const validationGapCount = gaps.filter(
    (g) =>
      g.type === "missing_validation_handling" ||
      g.type === "missing_system_failure_handling",
  ).length;
  if (validationGapCount > 0) {
    score *= Math.max(0.5, 1 - validationGapCount * 0.1);
  }

  const dataQualityGapCount = gaps.filter(
    (g) => g.type === "missing_data_quality_handling",
  ).length;
  if (dataQualityGapCount > 0) {
    score *= Math.max(0.5, 1 - dataQualityGapCount * 0.15);
  }

  const resourceGapCount = gaps.filter(
    (g) => g.type === "missing_resource_availability",
  ).length;
  if (resourceGapCount > 0) {
    score *= Math.max(0.6, 1 - resourceGapCount * 0.1);
  }

  if (missingAlternativeFlows) {
    score *= 0.85;
  }

  return score;
}

function computePriorityGaps(gaps: Gap[]): GapType[] {
  const priorityGaps: GapType[] = [];
  const blueprintTypes = Array.from(
    new Set(
      gaps.map((g) => g.type).filter((type) => type.startsWith("blueprint_")),
    ),
  );

  for (const type of blueprintTypes) {
    if (gaps.some((g) => g.type === type && g.severity === "high")) {
      priorityGaps.push(type);
    }
  }
  for (const type of blueprintTypes) {
    if (!priorityGaps.includes(type)) priorityGaps.push(type);
  }

  for (const type of GAP_TYPE_PRIORITY) {
    if (gaps.some((g) => g.type === type && g.severity === "high")) {
      priorityGaps.push(type);
    }
  }
  for (const type of GAP_TYPE_PRIORITY) {
    if (!priorityGaps.includes(type) && gaps.some((g) => g.type === type)) {
      priorityGaps.push(type);
    }
  }

  return priorityGaps;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyze gaps in a use case using the registered detector pipeline.
 *
 * @param phase  Controls which detectors run:
 *   - "initial"    — only "always" detectors fire (keyword, actor check).
 *                    Safe on a vague baseline before any probing.
 *   - "post-probe" — all detectors fire (centroid, structural, pattern too).
 *                    Pass this after blueprint probing has completed.
 *
 * Defaults to "initial" so existing callers that don't pass the argument
 * remain noise-free on the first run.
 */
export async function analyzeGaps(
  useCase: GenUseCase,
  validationFeedback: UseCaseTermScore,
  originalDescription: string,
  conversationHistory?: InteractionMemory[],
  confirmedBlueprintIds?: Set<string>,
  droppedBlueprintIds?: Set<string>,
  phase: DetectionPhase = "initial",
): Promise<GapAnalysis> {
  const gaps: Gap[] = [];

  // Phase 0: Classify domain to filter blueprints
  console.log(`[Gap Analyzer] Classifying use case domain...`);
  const domainAnalysis = await classifyUseCaseDomainHybrid(useCase);
  const blueprintDomainFilter = resolveBlueprintDomainFilter(domainAnalysis);
  console.log(
    `[Gap Analyzer] Classifier domain: ${domainAnalysis.dominantDomain} | blueprint pool: ${blueprintDomainFilter ?? "all (ambiguous → union)"}`,
  );

  // Phase 1: Collect and embed all texts
  const embeddedTexts = await collectAndEmbedTexts(useCase);
  const stepEmbeddings = embeddedTexts
    .filter((item) => isStepSource(item.source))
    .map((item) => ({
      step: (item.source as StepSource).step,
      flow: (item.source as StepSource).flow,
      embedding: item.embedding,
    }));
  const categories = await loadGapCentroids();

  // Phase 1.5: Blueprint detection (soft-drop: dropped IDs do not remove blueprints from gap pass)
  const blueprintResult = await detectBlueprintGaps(
    useCase,
    stepEmbeddings,
    blueprintDomainFilter,
    confirmedBlueprintIds,
    droppedBlueprintIds,
    { useCase, originalDescription },
  );
  gaps.push(...blueprintResult.gaps);

  const activatedBlueprints = await detectActivatedBlueprints(
    stepEmbeddings,
    blueprintDomainFilter,
    { useCase, originalDescription },
  );

  // Phase 2+: Run the registered detector pipeline (centroid suppression from probe drops disabled with soft-drop)
  const suppressedGapTypes = buildSuppressedGapTypes(new Set());
  const ctx: GapDetectionContext = {
    useCase,
    originalDescription,
    embeddedTexts,
    categories,
    coveredStepKeys: blueprintResult.coveredStepKeys,
    suppressedGapTypes,
    validationFeedback,
  };

  const activeDetectors = GAP_DETECTORS.filter(
    (d) => d.phase === "always" || d.phase === phase,
  );

  for (const detector of activeDetectors) {
    gaps.push(...(await detector.detect(ctx)));
  }

  // Structural flags — computed from validationFeedback independently of
  // whether detectors fired, so GapAnalysis always reflects the true state.
  const missingExceptionFlows = !validationFeedback.hasExceptionFlow;
  const missingAlternativeFlows = !validationFeedback.hasAlternativeFlow;

  // Derive incompleteActors from gaps emitted by the structural detector
  const incompleteActors = gaps
    .filter((g) => g.type === "incomplete_actors")
    .map((g) => {
      const match = g.description.match(/Actor '(.+)' is declared/);
      return match ? match[1] : "";
    })
    .filter(Boolean);

  // Phase 6: Filter stale gaps, compute completeness and priority
  const completenessScore = calculateCompletenessScore(
    validationFeedback,
    gaps,
    missingExceptionFlows,
    missingAlternativeFlows,
  );

  const filteredGaps =
    conversationHistory && conversationHistory.length > 0
      ? await filterStaleGaps(gaps, useCase, conversationHistory)
      : gaps;

  const priorityGaps = computePriorityGaps(filteredGaps);

  // Derive uncertainConditions from gaps — replaces the former side channel
  const uncertainConditions = filteredGaps
    .filter((g) => g.type === "uncertain_conditions" && g.relatedFlow)
    .map((g) => g.relatedFlow!);

  let dominantDomain: "human-system" | "system-system" | "mixed" | undefined;
  if (blueprintResult.detectedDomains.size === 1) {
    dominantDomain = Array.from(blueprintResult.detectedDomains)[0];
  } else if (blueprintResult.detectedDomains.size > 1) {
    dominantDomain = "mixed";
  }

  const classifierFlowDomains = domainAnalysis.flowClassifications.map((f) => ({
    flowId: f.flowId,
    domainType: f.domainType,
    confidence: f.confidence,
  }));

  return {
    missingExceptionFlows,
    missingAlternativeFlows,
    incompleteActors,
    uncertainConditions,
    gaps: filteredGaps,
    priorityGaps,
    completenessScore: Math.max(0, Math.min(1, completenessScore)),
    detectedDomains: blueprintResult.detectedDomains,
    dominantDomain,
    activatedBlueprints,
    classifierDominantDomain: domainAnalysis.dominantDomain,
    classifierOverallConfidence: domainAnalysis.overallConfidence,
    classifierFlowDomains,
  };
}
