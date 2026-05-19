import {
  loadGapCentroids,
  type GapType,
} from "../data/gap-centroids.loader.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import {
  DomainType,
} from "../services/domain-classifier.service.js";
import semanticService from "../services/semantic.service.js";
import {
  detectBlueprintGaps,
  type BlueprintActivation,
  type EmbeddedStep,
} from "./blueprint.detector.js";
import {
  GapSeverity,
  isStepSource,
  type DetectionPhase,
  type EmbeddedText,
  type Gap,
  type GapDetectionContext,
  type StepSource
} from "./gap-detector.types.js";
import { GAP_DETECTORS } from "./gap-detectors.registry.js";

// ---------------------------------------------------------------------------
// Re-exports — maintain backward-compatible public API for all callers.
// ---------------------------------------------------------------------------
export { clearGapCentroidsCache } from "../data/gap-centroids.loader.js";
export type { GapType } from "../data/gap-centroids.loader.js";
export type {
  ConditionSource, DetectionPhase, EmbeddedText, Gap, GapDetectionContext, GapDetectorConfig, StepSource
} from "./gap-detector.types.js";

// ---------------------------------------------------------------------------
// Public interfaces that remain owned by this module
// ---------------------------------------------------------------------------

export interface GapAnalysis {
  missingExceptionFlows: boolean;
  missingAlternativeFlows: boolean;
  gaps: Gap[];
  priorityGaps: GapType[];
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

/**
 * Carries the outputs of the blueprint probe phase into gap analysis.
 * Groups domain type, activated blueprints, and the confirmed subset
 * so they travel as one coherent unit.
 */
export interface BlueprintProbeContext {
  domainType: DomainType;
  activations: BlueprintActivation[];
  confirmedIds: Set<string>;
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

function computePriorityGaps(gaps: Gap[]): GapType[] {
  const priorityGaps: GapType[] = [];
  const blueprintTypes = Array.from(
    new Set(
      gaps.map((g) => g.type).filter((type) => type.startsWith("blueprint_")),
    ),
  );

  for (const type of blueprintTypes) {
    if (gaps.some((g) => g.type === type && g.severity === GapSeverity.High)) {
      priorityGaps.push(type);
    }
  }
  for (const type of blueprintTypes) {
    if (!priorityGaps.includes(type)) priorityGaps.push(type);
  }

  for (const type of GAP_TYPE_PRIORITY) {
    if (gaps.some((g) => g.type === type && g.severity === GapSeverity.High)) {
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
  originalDescription: string,
  probeContext: BlueprintProbeContext,
  conversationHistory?: InteractionMemory[],
  phase: DetectionPhase = "post-probe",
): Promise<GapAnalysis> {
  const gaps: Gap[] = [];
  const { domainType, confirmedIds } = probeContext;

  // Phase 1: Embed all texts in the use case (steps + flow conditions)
  const embeddedTexts = await collectAndEmbedTexts(useCase);
  const stepEmbeddings = embeddedTexts
    .filter((item) => isStepSource(item.source))
    .map((item) => ({
      step: (item.source as StepSource).step,
      flow: (item.source as StepSource).flow,
      embedding: item.embedding,
    }));
  const categories = await loadGapCentroids();
  const blueprintDomainFilter = domainType === DomainType.Ambiguous ? undefined : domainType;

  // Phase 2: Detect blueprint-specific gaps using confirmed blueprints from probe
  const blueprintResult = await detectBlueprintGaps(
    useCase,
    stepEmbeddings,
    blueprintDomainFilter,
    confirmedIds,
    { useCase, originalDescription },
  );
  gaps.push(...blueprintResult.gaps);

  // Phase 3: Run the registered detector pipeline (centroid, structural, pattern detectors)
  const ctx: GapDetectionContext = {
    useCase,
    originalDescription,
    embeddedTexts,
    categories,
    coveredStepKeys: blueprintResult.coveredStepKeys,
    suppressedGapTypes: new Set(),
  };

  const activeDetectors = GAP_DETECTORS.filter(
    (d) => d.phase === "always" || d.phase === phase,
  );

  for (const detector of activeDetectors) {
    gaps.push(...(await detector.detect(ctx)));
  }

  const missingExceptionFlows = !useCase.flows.some((f) => f.kind === "EXCEPTION");
  const missingAlternativeFlows = !useCase.flows.some((f) => f.kind === "ALTERNATIVE");

  const filteredGaps =
    conversationHistory && conversationHistory.length > 0
      ? await filterStaleGaps(gaps, useCase, conversationHistory)
      : gaps;

  const priorityGaps = computePriorityGaps(filteredGaps);

  return {
    missingExceptionFlows,
    missingAlternativeFlows,
    gaps: filteredGaps,
    priorityGaps,
  };
}
