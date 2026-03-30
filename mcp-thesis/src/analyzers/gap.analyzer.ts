import { readFile } from "fs/promises";
import { join } from "path";
import {
  GenUseCase,
  GenFlow,
  GenStep,
} from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import { UseCaseTermScore } from "../validators/flat.validator.js";
import { detectBlueprintGaps, detectActivatedBlueprints, type BlueprintActivation, type EmbeddedStep } from "./blueprint.detector.js";
import {
  classifyUseCaseDomainHybrid,
  type UseCaseDomainAnalysis,
} from "../services/domain-classifier.service.js";

export type GapType =
  | "missing_exception_flows"
  | "missing_alternative_flows"
  | "incomplete_actors"
  | "uncertain_conditions"
  | "missing_validation_handling"
  | "missing_search_handling"
  | "missing_system_failure_handling"
  | "missing_temporal_exceptions"
  | "missing_nested_exceptions"
  | "missing_resource_availability"
  | "missing_post_completion_scenarios"
  | "missing_data_quality_handling"
  | "missing_environmental_interruptions"
  | "missing_technology_variations"
  | "missing_save_resume_handling"
  | "missing_eligibility_failure_handling"
  | "missing_assignment_unavailability_handling"
  | "missing_policy_outcome_branching"
  | `blueprint_${string}`;

export interface Gap {
  type: GapType;
  severity: "high" | "medium" | "low";
  description: string;
  relatedStep?: number;
  relatedFlow?: string;
  suggestedQuestion?: string;
  blueprintConfidence?: number;
}

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
}

export interface InteractionMemory {
  stepContext: string;
  question: string;
  answer: string;
  vector: number[];
  questionVector?: number[];
  iteration: number;
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

function buildDataHandlingQuestion(
  steps: Array<{
    index: number;
    actor: string;
    description: string;
    flowId: string;
  }>,
): string {
  const stepList = formatConsolidatedStepList(steps);
  return `The following steps involve data entry or validation:\n${stepList}\nHow does the system handle basic input errors (missing fields, wrong formats) versus business rule violations (duplicates, contradictory logic) at these steps? For each step, specify any differences in minimum required fields, error handling, or routing.`;
}

function buildInfrastructureQuestion(
  steps: Array<{
    index: number;
    actor: string;
    description: string;
    flowId: string;
  }>,
): string {
  const stepList = formatConsolidatedStepList(steps);
  return `The following steps involve resource assignments or system interactions:\n${stepList}\nWhat happens if the assigned person is unavailable, the system times out, or a resource cannot be allocated at these steps? For each step, specify the fallback or escalation path.`;
}

function buildSaveResumeQuestion(
  steps: Array<{
    index: number;
    actor: string;
    description: string;
    flowId: string;
  }>,
): string {
  const stepList = formatConsolidatedStepList(steps);
  return `The following steps involve multi-field or complex data submissions:\n${stepList}\nCan any of these steps be partially completed, saved as a draft, and resumed later? For each step, specify what state is preserved and what happens on resume.`;
}

export const CONSOLIDATION_GROUPS: ConsolidationGroup[] = [
  {
    groupId: "data_handling",
    memberGapTypes: [
      "missing_data_quality_handling",
      "missing_validation_handling",
    ],
    questionTemplate: buildDataHandlingQuestion,
    answerGuidance:
      "For each step listed, describe: (1) what minimum data is required, (2) what happens on basic input errors, (3) what happens on business rule violations, (4) any step-specific differences. Avoid vague answers like 'the same for all steps'—state the differences or explicitly confirm no differences after checking each step.",
  },
  {
    groupId: "infrastructure",
    memberGapTypes: [
      "missing_resource_availability",
      "missing_system_failure_handling",
    ],
    questionTemplate: buildInfrastructureQuestion,
    answerGuidance:
      "For each step listed, describe: (1) what happens when the person/system is unavailable, (2) whether there is automatic reassignment or escalation, (3) any timeout or retry behavior. Avoid generic answers; note step-specific differences or explicitly confirm none after checking each step.",
  },
  {
    groupId: "save_resume",
    memberGapTypes: ["missing_save_resume_handling"],
    questionTemplate: buildSaveResumeQuestion,
    answerGuidance:
      "For each step listed, describe: (1) whether the actor can save progress, (2) what data is preserved vs lost, (3) whether resuming requires re-validation. Avoid vague answers; specify differences or explicitly confirm none after checking each step.",
  },
];

interface StepSource {
  type: "step";
  flowId: string;
  stepIndex: number;
  step: GenStep;
  flow: GenFlow;
}

interface ConditionSource {
  type: "condition";
  flowId: string;
  flow: GenFlow;
}

interface EmbeddedText {
  text: string;
  embedding: number[];
  source: StepSource | ConditionSource;
}

interface GapCategory {
  name: string;
  keywords: string[];
  centroid: number[] | null;
  threshold: number;
  gapType: GapType;
  requiresExceptionCheck: boolean;
}

interface GapCentroidData {
  modelId: string;
  categories: Record<string, GapCategory>;
}

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

let gapCentroidsCache: GapCategory[] | null = null;

/**
 * Clear the gap centroids cache to force reloading from file.
 * Useful when gap-centroids.json has been updated.
 */
export function clearGapCentroidsCache(): void {
  gapCentroidsCache = null;
  console.log("Gap centroids cache cleared");
}

async function loadGapCentroids(): Promise<GapCategory[]> {
  if (gapCentroidsCache) return gapCentroidsCache;

  try {
    const dataPath = join(process.cwd(), "src/data/gap-centroids.json");
    const fileContent = await readFile(dataPath, "utf-8");
    const data = JSON.parse(fileContent) as GapCentroidData;

    console.log(`Loading gap centroids from ${dataPath}`);
    let categoriesWithCentroids = 0;

    for (const [name, category] of Object.entries(data.categories)) {
      if (!category.centroid) {
        console.log(
          `  Computing centroid for "${name}" from ${category.keywords.length} keywords`,
        );
        const embeddings = await semanticService.embedBatch(category.keywords);
        category.centroid = await semanticService.computeCentroid(embeddings);
        categoriesWithCentroids++;
      }
      category.name = name;
    }

    gapCentroidsCache = Object.values(data.categories);
    console.log(
      `Gap centroids loaded: ${gapCentroidsCache.length} categories (${categoriesWithCentroids} computed)`,
    );

    // Log thresholds for verification
    for (const cat of gapCentroidsCache) {
      if (cat.requiresExceptionCheck) {
        console.log(
          `  ${cat.name}: threshold=${cat.threshold}, keywords=${cat.keywords.length}`,
        );
      }
    }

    return gapCentroidsCache;
  } catch (error) {
    console.error("Failed to load gap centroids:", error);
    return [];
  }
}

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

/**
 * Filters out gaps already covered by previous Q&A interactions.
 * Uses dual-vector comparison (gap context + question asked) at 0.6 threshold.
 */
export async function filterStaleGaps(
  gaps: Gap[],
  useCase: GenUseCase,
  history: InteractionMemory[],
  threshold: number = 0.6,
): Promise<Gap[]> {
  if (history.length === 0 || gaps.length === 0) return gaps;

  // NEW: Layer 0 - Metadata-based pre-filter
  const exploredTuples = new Set(
    history
      .filter((h) => h.metadata.stepIndex !== undefined && h.metadata.gapType)
      .map((h) => `${h.metadata.stepIndex}|${h.metadata.gapType}`),
  );

  for (const record of history) {
    if (!record.metadata.consolidatedGroupId || !record.metadata.stepIndexes)
      continue;
    const group = CONSOLIDATION_GROUPS.find(
      (g) => g.groupId === record.metadata.consolidatedGroupId,
    );
    if (!group) continue;
    for (const stepIndex of record.metadata.stepIndexes) {
      for (const gapType of group.memberGapTypes) {
        exploredTuples.add(`${stepIndex}|${gapType}`);
      }
    }
  }

  const metadataFiltered = gaps.filter((gap) => {
    if (gap.relatedStep === undefined) return true; // Keep gaps without step info
    const tuple = `${gap.relatedStep}|${gap.type}`;
    return !exploredTuples.has(tuple);
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
    const simToContext = await semanticService.cosineSimilarity(
      gapVector,
      record.vector,
    );

    let simToQuestion = 0;
    if (record.questionVector) {
      simToQuestion = await semanticService.cosineSimilarity(
        gapVector,
        record.questionVector,
      );
    }

    if (Math.max(simToContext, simToQuestion) >= threshold) {
      return true;
    }
  }
  return false;
}

function generateQuestionForCategory(
  categoryName: string,
  step: GenStep,
): string {
  const targetContext = step.target ? ` targeting ${step.target}` : "";

  switch (categoryName) {
    case "validation":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. What happens when this validation encounters partial data, format mismatches, or conflicting records? Describe the specific failure scenario and how it's handled.`;
    case "search_lookup":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. What happens when this search returns no results, multiple ambiguous matches, or stale/outdated data? How does the actor proceed?`;
    case "data_input":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. What happens when the submitted data is incomplete, contains contradictory information, or duplicates an existing entry? What are the minimum required fields?`;
    case "resource_assignment":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. What happens when no suitable resource is available, the assigned resource becomes unavailable, or the assignment times out? Is there a default fallback?`;
    case "system_interaction":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. What happens when the system is unavailable, responds with a timeout, or returns a partial/corrupted response? Is data automatically saved?`;
    case "completion":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. What happens if the actor attempts to finish without completing all required information? Can the process be saved for later, reopened, or reversed after this point?`;
    case "save_resume":
      return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}. Can this step be partially completed and saved as a draft for later? What state is preserved, and what happens when the actor resumes?`;
    default:
      return `What exceptions might occur at step ${step.index}?`;
  }
}

function isStepSource(source: EmbeddedText["source"]): source is StepSource {
  return source.type === "step";
}

function isConditionSource(
  source: EmbeddedText["source"],
): source is ConditionSource {
  return source.type === "condition";
}

/**
 * Analyzes a use case to detect gaps using unified semantic embedding.
 */
export async function analyzeGaps(
  useCase: GenUseCase,
  validationFeedback: UseCaseTermScore,
  originalDescription: string,
  conversationHistory?: InteractionMemory[],
  confirmedBlueprintIds?: Set<string>,
  droppedBlueprintIds?: Set<string>,
): Promise<GapAnalysis> {
  const gaps: Gap[] = [];
  const incompleteActors: string[] = [];
  const uncertainConditions: string[] = [];

  // Phase 0: Classify domain to filter blueprints
  console.log(`[Gap Analyzer] Classifying use case domain...`);
  const domainAnalysis = await classifyUseCaseDomainHybrid(useCase);
  const detectedDomain = domainAnalysis.dominantDomain;
  console.log(
    `[Gap Analyzer] Detected domain: ${detectedDomain} (used for blueprint filtering)`,
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

  // Phase 1.5: Blueprint detection (prioritized) with domain filtering
  // Only apply domain filter if detection is clear (not ambiguous)
  const domainFilter =
    detectedDomain === "human-system" || detectedDomain === "system-system"
      ? detectedDomain
      : undefined;

  const blueprintResult = await detectBlueprintGaps(
    useCase,
    stepEmbeddings,
    domainFilter,
    confirmedBlueprintIds,
    droppedBlueprintIds,
  );
  gaps.push(...blueprintResult.gaps);

  // Detect activated blueprints for probe phase (reuses same stepEmbeddings)
  const activatedBlueprints = await detectActivatedBlueprints(
    stepEmbeddings,
    domainFilter,
  );

  // Phase 2: Analyze steps against category centroids
  const stepGaps = await analyzeStepsAgainstCategories(
    embeddedTexts,
    categories,
    useCase,
    blueprintResult.coveredStepKeys,
    droppedBlueprintIds,
  );
  gaps.push(...stepGaps);

  // Phase 3: Analyze condition quality
  const conditionResults = await analyzeConditionQuality(
    embeddedTexts,
    categories,
  );
  gaps.push(...conditionResults.gaps);
  uncertainConditions.push(...conditionResults.uncertainFlowIds);

  // Phase 4: Structural checks
  const missingExceptionFlows = !validationFeedback.hasExceptionFlow;
  const missingAlternativeFlows = !validationFeedback.hasAlternativeFlow;

  if (missingExceptionFlows) {
    gaps.push({
      type: "missing_exception_flows",
      severity: "high",
      description:
        "No exception flows found. Real-world scenarios need error handling.",
      suggestedQuestion:
        "What could go wrong during this process? What error conditions should be handled?",
    });
  }

  if (missingAlternativeFlows) {
    gaps.push({
      type: "missing_alternative_flows",
      severity: "medium",
      description:
        "No alternative flows found. Consider different valid paths to the same goal.",
      suggestedQuestion:
        "Are there different ways to accomplish this goal? What optional paths exist?",
    });
  }

  // Check for incomplete actors
  const allSteps = useCase.flows.flatMap((f) => f.steps);
  const usedActors = new Set(allSteps.map((s) => s.actor.toLowerCase()));

  for (const actor of useCase.actors) {
    if (!usedActors.has(actor.toLowerCase())) {
      incompleteActors.push(actor);
      gaps.push({
        type: "incomplete_actors",
        severity: "low",
        description: `Actor '${actor}' is declared but never appears in any step.`,
        suggestedQuestion: `What role does ${actor} play in this use case?`,
      });
    }
  }

  // Phase 5: Description-based detectors
  gaps.push(...detectClaimAdjudicationOutcomes(useCase));
  gaps.push(...detectTemporalExceptions(useCase, originalDescription));
  gaps.push(...detectNestedExceptions(useCase, originalDescription));
  gaps.push(...detectEnvironmentalInterruptions(useCase, originalDescription));
  gaps.push(...detectTechnologyVariations(useCase, originalDescription));

  // Phase 6: Calculate completeness and filter stale gaps
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

  // Determine dominant domain
  let dominantDomain: "human-system" | "system-system" | "mixed" | undefined;
  if (blueprintResult.detectedDomains.size === 1) {
    dominantDomain = Array.from(blueprintResult.detectedDomains)[0];
  } else if (blueprintResult.detectedDomains.size > 1) {
    dominantDomain = "mixed";
  }

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
  };
}

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

/**
 * Maps dropped blueprint IDs to centroid gap types that should be suppressed.
 * If a blueprint is dropped (the expert confirmed it doesn't apply), the linked
 * centroid-based gap types are also suppressed to avoid generating questions for
 * patterns the expert has already ruled out.
 */
const BLUEPRINT_CENTROID_SUPPRESSION: Partial<Record<string, GapType[]>> = {
  session_persistence: ["missing_save_resume_handling"],
};

async function analyzeStepsAgainstCategories(
  embeddedTexts: EmbeddedText[],
  categories: GapCategory[],
  useCase: GenUseCase,
  skipSteps?: Set<string>,
  droppedBlueprintIds?: Set<string>,
): Promise<Gap[]> {
  const gaps: Gap[] = [];
  const stepItems = embeddedTexts.filter((e) => isStepSource(e.source));

  // Build the set of gap types suppressed by dropped blueprints
  const suppressedGapTypes = new Set<GapType>();
  if (droppedBlueprintIds) {
    for (const blueprintId of droppedBlueprintIds) {
      const linked = BLUEPRINT_CENTROID_SUPPRESSION[blueprintId];
      if (linked) {
        for (const gapType of linked) {
          suppressedGapTypes.add(gapType);
          console.log(`[Blueprint-Centroid Suppression] Suppressing gap type "${gapType}" because blueprint "${blueprintId}" was dropped`);
        }
      }
    }
  }

  const relevantCategories = categories.filter(
    (c) => c.requiresExceptionCheck && c.centroid && !suppressedGapTypes.has(c.gapType),
  );
  const saveResumeCategory = suppressedGapTypes.has("missing_save_resume_handling")
    ? undefined
    : categories.find((c) => c.name === "save_resume");

  for (const item of stepItems) {
    const src = item.source as StepSource;
    if (skipSteps?.has(`${src.flowId}|${src.stepIndex}`)) continue;
    // Centroid gap detection only applies to MAIN flow steps.
    // ALT/EXT steps were generated from expert answers — asking about their
    // sub-steps creates circular meta-questions about flows we just created.
    if (src.flowId !== "MAIN") continue;

    for (const category of relevantCategories) {
      const similarity = await semanticService.cosineSimilarity(
        item.embedding,
        category.centroid!,
      );

      if (similarity >= category.threshold) {
        const hasException = useCase.flows.some(
          (f) =>
            (f.kind === "EXCEPTION" || f.kind === "ALTERNATIVE") &&
            f.parentFlow === src.flowId &&
            (f.fromStepIndex === src.stepIndex ||
              f.fromStepIndex === undefined),
        );

        if (!hasException) {
          gaps.push({
            type: category.gapType,
            severity: "high",
            description: `Step ${src.stepIndex} in flow ${src.flowId} matches "${category.name}" pattern but has no exception handling.`,
            relatedStep: src.stepIndex,
            relatedFlow: src.flowId,
            suggestedQuestion: generateQuestionForCategory(
              category.name,
              src.step,
            ),
          });
        }
      }
    }

    if (
      saveResumeCategory &&
      !skipSteps?.has(`${src.flowId}|${src.stepIndex}`)
    ) {
      const descLower = src.step.description.toLowerCase();
      const isSaveResumeCandidate =
        src.step.description.length > 50 ||
        /\b(form|report|details|fields|information|submission|entry|register|complete request|finalize|fill)\b/.test(
          descLower,
        );

      if (isSaveResumeCandidate) {
        const alreadyFlagged = gaps.some(
          (gap) =>
            gap.type === "missing_save_resume_handling" &&
            gap.relatedFlow === src.flowId &&
            gap.relatedStep === src.stepIndex,
        );
        if (alreadyFlagged) continue;
        const hasSaveResumeFlow = useCase.flows.some(
          (f) =>
            (f.kind === "ALTERNATIVE" || f.kind === "EXCEPTION") &&
            f.parentFlow === src.flowId &&
            (f.fromStepIndex === src.stepIndex ||
              f.fromStepIndex === undefined) &&
            (f.condition?.toLowerCase().includes("draft") ||
              f.condition?.toLowerCase().includes("save") ||
              f.condition?.toLowerCase().includes("resume") ||
              f.condition?.toLowerCase().includes("later")),
        );

        if (!hasSaveResumeFlow) {
          gaps.push({
            type: "missing_save_resume_handling",
            severity: "medium",
            description: `Step ${src.stepIndex} in flow ${src.flowId} appears to involve a multi-field submission but has no save/resume handling.`,
            relatedStep: src.stepIndex,
            relatedFlow: src.flowId,
            suggestedQuestion: generateQuestionForCategory(
              "save_resume",
              src.step,
            ),
          });
        }
      }
    }
  }

  return gaps;
}

async function analyzeConditionQuality(
  embeddedTexts: EmbeddedText[],
  categories: GapCategory[],
): Promise<{ gaps: Gap[]; uncertainFlowIds: string[] }> {
  const gaps: Gap[] = [];
  const uncertainFlowIds: string[] = [];

  const conditionItems = embeddedTexts.filter((e) =>
    isConditionSource(e.source),
  );
  const vagueCentroid = categories.find(
    (c) => c.name === "vague_condition",
  )?.centroid;

  for (const item of conditionItems) {
    const src = item.source as ConditionSource;
    const issues: string[] = [];
    let qualityScore = 0.7;

    // Check semantic vagueness
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

    // Check relation to anchor step
    if (src.flow.fromStepIndex !== undefined && src.flow.parentFlow) {
      const anchorStep = embeddedTexts.find(
        (e) =>
          isStepSource(e.source) &&
          e.source.flowId === src.flow.parentFlow &&
          e.source.stepIndex === src.flow.fromStepIndex,
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

    // Length check fallback
    if (src.flow.condition && src.flow.condition.trim().length < 10) {
      qualityScore -= 0.2;
      issues.push("Condition too short");
    }

    if (qualityScore < 0.5) {
      uncertainFlowIds.push(src.flowId);
      gaps.push({
        type: "uncertain_conditions",
        severity: qualityScore < 0.3 ? "high" : "medium",
        description: `Flow "${src.flowId}" has weak condition: ${issues.join(", ")}`,
        relatedFlow: src.flowId,
        suggestedQuestion: `What specific trigger causes flow "${src.flowId}" to occur?`,
      });
    }
  }

  return { gaps, uncertainFlowIds };
}

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
    const hasHighSeverity = gaps.some(
      (g) => g.type === type && g.severity === "high",
    );
    if (hasHighSeverity) priorityGaps.push(type);
  }

  for (const type of blueprintTypes) {
    if (!priorityGaps.includes(type)) priorityGaps.push(type);
  }

  // Add high-severity gaps first, then others
  for (const type of GAP_TYPE_PRIORITY) {
    const hasHighSeverity = gaps.some(
      (g) => g.type === type && g.severity === "high",
    );
    if (hasHighSeverity) {
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

// Description-based detectors for scenarios not captured by semantic analysis

function detectClaimAdjudicationOutcomes(useCase: GenUseCase): Gap[] {
  const mainFlow = useCase.flows.find((flow) => flow.id === "MAIN" || flow.kind === "MAIN");
  if (!mainFlow) return [];

  const mainSteps = mainFlow.steps.map((step) => ({
    ...step,
    descriptionLower: step.description.toLowerCase(),
  }));

  const hasPolicyValidation = mainSteps.some(
    (step) =>
      (step.descriptionLower.includes("policy") &&
        (step.descriptionLower.includes("valid") ||
          step.descriptionLower.includes("verify") ||
          step.descriptionLower.includes("align") ||
          step.descriptionLower.includes("guideline"))) ||
      (step.descriptionLower.includes("eligib") && step.descriptionLower.includes("verify")),
  );

  const hasAssignment = mainSteps.some(
    (step) =>
      step.descriptionLower.includes("assign") &&
      (step.descriptionLower.includes("agent") ||
        step.descriptionLower.includes("review") ||
        step.descriptionLower.includes("adjuster")),
  );

  const hasGuidelineReview = mainSteps.some(
    (step) =>
      step.descriptionLower.includes("guideline") ||
      (step.descriptionLower.includes("policy") && step.descriptionLower.includes("within")),
  );

  const nonMainFlows = useCase.flows.filter((flow) => flow.id !== mainFlow.id);

  const hasDeclineTerminationFlow = nonMainFlows.some((flow) => {
    const text = `${flow.condition ?? ""} ${flow.steps
      .map((step) => step.description)
      .join(" ")}`.toLowerCase();
    return (
      (text.includes("decline") || text.includes("reject")) &&
      (text.includes("terminate") || text.includes("close") || text.includes("end"))
    );
  });

  const hasAssignmentUnavailableFlow = nonMainFlows.some((flow) => {
    const text = `${flow.condition ?? ""} ${flow.steps
      .map((step) => step.description)
      .join(" ")}`.toLowerCase();
    const waits =
      text.includes("wait") || text.includes("hold") || text.includes("queue");
    const assignment =
      text.includes("assign") &&
      (text.includes("agent") || text.includes("review") || text.includes("adjuster"));
    return waits && assignment;
  });

  const hasNegotiationFlow = nonMainFlows.some((flow) => {
    const text = `${flow.condition ?? ""} ${flow.steps
      .map((step) => step.description)
      .join(" ")}`.toLowerCase();
    return (
      text.includes("negotiat") ||
      text.includes("partial payment") ||
      text.includes("adjusted payment")
    );
  });

  const gaps: Gap[] = [];

  if (hasPolicyValidation && !hasDeclineTerminationFlow) {
    gaps.push({
      type: "missing_eligibility_failure_handling",
      severity: "high",
      description:
        "Main flow validates policy/eligibility but no explicit decline-and-terminate outcome is modeled for invalid cases.",
      suggestedQuestion:
        "If eligibility or policy validation fails, what exact steps occur (decline, notify claimant, record details), and does the process terminate or allow retry/appeal?",
    });
  }

  if (hasAssignment && !hasAssignmentUnavailableFlow) {
    gaps.push({
      type: "missing_assignment_unavailability_handling",
      severity: "high",
      description:
        "Main flow assigns an agent/reviewer but no branch describes what happens when no assignee is available.",
      suggestedQuestion:
        "What happens if no reviewer/agent is available at assignment time? Is the case queued or put on hold, who is notified, and when does processing resume?",
    });
  }

  if (hasGuidelineReview && !hasNegotiationFlow) {
    gaps.push({
      type: "missing_policy_outcome_branching",
      severity: "medium",
      description:
        "Main flow checks policy guidelines but does not model differentiated outcomes for severe vs minor violations.",
      suggestedQuestion:
        "When policy guidelines are violated, how are major violations handled versus minor violations? Does one path terminate while another allows negotiation or adjusted payment?",
    });
  }

  return gaps;
}

function detectTemporalExceptions(
  useCase: GenUseCase,
  originalDescription: string,
): Gap[] {
  const descLower = originalDescription.toLowerCase();
  const temporalKeywords = [
    "at any time",
    "anytime",
    "at all times",
    "throughout",
    "during any",
    "while",
  ];

  const hasTemporalMention = temporalKeywords.some((kw) =>
    descLower.includes(kw),
  );
  if (!hasTemporalMention) return [];

  const hasGlobalException = useCase.flows.some(
    (f) =>
      f.kind === "EXCEPTION" &&
      (f.fromStepIndex === undefined || f.fromStepIndex === null),
  );

  if (hasGlobalException) return [];

  return [
    {
      type: "missing_temporal_exceptions",
      severity: "high",
      description:
        "Description mentions scenarios that can occur 'at any time' but no global exception flows found.",
      suggestedQuestion:
        "Are there any conditions that can occur at any time during the process (e.g., system failures, interruptions)?",
    },
  ];
}

function detectNestedExceptions(
  useCase: GenUseCase,
  originalDescription: string,
): Gap[] {
  const descLower = originalDescription.toLowerCase();
  const nestedKeywords = [
    "timeout",
    "does not respond",
    "fails to provide",
    "within time period",
    "no response",
    "does not supply",
  ];

  const hasNestedMention = nestedKeywords.some((kw) => descLower.includes(kw));
  if (!hasNestedMention) return [];

  const exceptionFlows = useCase.flows.filter((f) => f.kind === "EXCEPTION");
  if (exceptionFlows.length === 0) return [];

  const hasNestedExceptions = exceptionFlows.some((f) => {
    const parent = useCase.flows.find((pf) => pf.id === f.parentFlow);
    return parent && parent.kind === "EXCEPTION";
  });

  if (hasNestedExceptions) return [];

  return [
    {
      type: "missing_nested_exceptions",
      severity: "medium",
      description:
        "Description mentions timeout or non-response scenarios but no nested exception flows found.",
      suggestedQuestion:
        "What happens if a response or action is not received within the expected time? Are there timeouts or escalations?",
    },
  ];
}

function detectEnvironmentalInterruptions(
  useCase: GenUseCase,
  originalDescription: string,
): Gap[] {
  const descLower = originalDescription.toLowerCase();
  const environmentalKeywords = [
    "fire alarm",
    "emergency",
    "evacuation",
    "power outage",
    "natural disaster",
    "interruption",
    "external event",
  ];

  const hasEnvironmentalMention = environmentalKeywords.some((kw) =>
    descLower.includes(kw),
  );
  if (!hasEnvironmentalMention) return [];

  const hasEnvironmentalException = useCase.flows.some(
    (f) =>
      f.kind === "EXCEPTION" &&
      environmentalKeywords.some((kw) =>
        f.condition?.toLowerCase().includes(kw),
      ),
  );

  if (hasEnvironmentalException) return [];

  return [
    {
      type: "missing_environmental_interruptions",
      severity: "medium",
      description:
        "Description mentions environmental or external interruptions but no related exception flows found.",
      suggestedQuestion:
        "How does the process handle external interruptions like emergencies, power failures, or environmental events?",
    },
  ];
}

function detectTechnologyVariations(
  useCase: GenUseCase,
  originalDescription: string,
): Gap[] {
  const descLower = originalDescription.toLowerCase();
  const techKeywords = [
    "by check",
    "by cash",
    "electronic",
    "paper",
    "digital",
    "manual",
    "automated",
    "online",
    "offline",
  ];

  const hasTechMention = techKeywords.some((kw) => descLower.includes(kw));
  if (!hasTechMention) return [];

  const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
  const alternativeFlows = useCase.flows.filter(
    (f) => f.kind === "ALTERNATIVE",
  );

  if (!mainFlow || alternativeFlows.length > 0) return [];

  return [
    {
      type: "missing_technology_variations",
      severity: "low",
      description:
        "Description mentions different technology or implementation methods but no alternative flows found.",
      suggestedQuestion:
        "Are there different ways to implement certain steps (e.g., electronic vs. paper, online vs. offline)?",
    },
  ];
}
