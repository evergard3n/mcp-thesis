import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import {
  CONSOLIDATION_GROUPS,
  GapType,
} from "../analyzers/gap.analyzer.js";
import { type Gap } from "../analyzers/gap-detector.types.js";
import { getGuidanceForGapType } from "../data/gap-centroids.loader.js";
import semanticService from "../services/semantic.service.js";
import { buildConsolidatedId } from "../helpers/consolidated-id.js";
import {
  describeBranchEntry,
  stepToColonText,
  stepToSummaryLine,
} from "../helpers/usecase-text.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface OpenEndedQuestion {
  id: string;
  question: string;
  context: {
    step?: string;
    steps?: string[];
    patternType?: string;
    whyAsking: string;
    flowId?: string;
  };
  answerGuidance: string;
}

export interface StepPriorityShape {
  stepIndex: number;
  flowId: string;
  actor: string;
  description: string;
  uncertaintyScore: number;
  criticalityScore: number;
  priorityScore: number;
  priorityRank: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  uncertaintyReasons: string[];
  relatedGaps: Array<{
    type: string;
    severity: string;
    description: string;
    suggestedQuestion?: string;
    blueprintConfidence?: number;
  }>;
}

interface ConsolidatedGapGroup {
  groupId: string;
  question: string;
  answerGuidance: string;
  steps: Array<{
    index: number;
    flowId: string;
    actor: string;
    description: string;
  }>;
  memberGapTypes: GapType[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Checks if a question is a duplicate of previously asked questions.
 *
 * L1 — exact text match only (removed substring overlap: too many false positives
 *       when similar gap types fire on different steps or with rephrased context).
 * L2 — semantic similarity; threshold raised to 0.92 so only near-paraphrase
 *       questions are suppressed, allowing related-but-distinct follow-ups through.
 */
export async function isQuestionDuplicate(
  newQuestion: string,
  previousQuestions: string[],
  threshold: number = 0.85,
): Promise<boolean> {
  if (previousQuestions.length === 0) return false;

  const normalizedNew = newQuestion.toLowerCase().replace(/\s+/g, " ").trim();
  const newStepMatch = normalizedNew.match(/step\s+(\d+)/i);
  const newStepIndex = newStepMatch ? Number(newStepMatch[1]) : null;

  // Pre-compute once — both layers reuse this instead of re-normalizing
  const prevMeta = previousQuestions.map((q) => {
    const normalized = q.toLowerCase().replace(/\s+/g, " ").trim();
    const match = normalized.match(/step\s+(\d+)/i);
    return { original: q, normalized, stepIndex: match ? Number(match[1]) : null };
  });

  // Layer 1: Exact text match only
  for (const prev of prevMeta) {
    if (newStepIndex !== null && prev.stepIndex !== null && newStepIndex !== prev.stepIndex) continue;
    if (normalizedNew === prev.normalized) {
      console.log(`[DEDUP L1] Exact match — skipping: "${newQuestion.slice(0, 80)}..." ~ "${prev.original.slice(0, 80)}..."`);
      return true;
    }
  }

  // Layer 2: Semantic similarity — only compare against same-step previous questions
  const eligiblePrev = prevMeta.filter((prev) => {
    if (newStepIndex !== null && prev.stepIndex !== null) return newStepIndex === prev.stepIndex;
    return true;
  });

  if (eligiblePrev.length === 0) return false;

  const allTexts = [newQuestion, ...eligiblePrev.map((p) => p.original)];
  const embeddings = await semanticService.embedBatch(allTexts);
  const newVec = embeddings[0];

  for (let i = 1; i < embeddings.length; i++) {
    const sim = await semanticService.cosineSimilarity(newVec, embeddings[i]);
    if (sim >= threshold) {
      console.log(`[DEDUP L2] Semantic match (sim=${sim.toFixed(3)}) — skipping: "${newQuestion.slice(0, 80)}..." ~ "${eligiblePrev[i - 1].original.slice(0, 80)}..."`);
      return true;
    }
  }

  return false;
}

function isBlueprintGap(gapType: string): boolean {
  return gapType.startsWith("blueprint_");
}

function formatStepLabel(flowId: string, stepIndex: number): string {
  if (flowId !== "MAIN") {
    return `${flowId} Step ${stepIndex}`;
  }
  return `Step ${stepIndex}`;
}

function buildConsolidatedGroups(
  gapSteps: StepPriorityShape[],
  groupFilter: (gapType: string, flowId: string) => boolean,
): { consolidated: ConsolidatedGapGroup[]; consumedKeys: Set<string> } {
  const consolidated: ConsolidatedGapGroup[] = [];
  const consumedKeys = new Set<string>();

  for (const group of CONSOLIDATION_GROUPS) {
    const memberGapTypes = new Set(group.memberGapTypes);
    const stepMap = new Map<
      number,
      { flowId: string; actor: string; description: string }
    >();

    for (const priority of gapSteps) {
      const hasMatchingGap = priority.relatedGaps.some(
        (gap) =>
          memberGapTypes.has(gap.type as GapType) &&
          groupFilter(gap.type, priority.flowId),
      );
      if (!hasMatchingGap) continue;
      if (stepMap.has(priority.stepIndex)) continue;

      stepMap.set(priority.stepIndex, {
        flowId: priority.flowId,
        actor: priority.actor,
        description: priority.description,
      });
    }

    const steps = Array.from(stepMap.entries())
      .map(([index, meta]) => ({
        index,
        flowId: meta.flowId,
        actor: meta.actor,
        description: meta.description,
      }))
      .sort((a, b) => a.index - b.index);

    if (steps.length >= 2) {
      const question = group.questionTemplate(steps);
      consolidated.push({
        groupId: group.groupId,
        question,
        answerGuidance: group.answerGuidance,
        steps,
        memberGapTypes: group.memberGapTypes,
      });

      for (const step of steps) {
        for (const gapType of group.memberGapTypes) {
          consumedKeys.add(`${step.flowId}|${step.index}|${gapType}`);
        }
      }
    }
  }

  return { consolidated, consumedKeys };
}

// ---------------------------------------------------------------------------
// Phase builders
// ---------------------------------------------------------------------------

/**
 * Phase 0: Coverage seed questions — ask about critical eligibility, assignment, and
 * policy-outcome branches on the first pass before any gaps are known.
 */
export async function buildSeedQuestions(
  stepPriorities: StepPriorityShape[],
  previousQuestions: string[],
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [];

  const mainSteps = stepPriorities
    .filter((p) => p.flowId === "MAIN")
    .sort((a, b) => a.stepIndex - b.stepIndex);

  const findMainStep = (matcher: (description: string) => boolean) =>
    mainSteps.find((step) => matcher(step.description.toLowerCase()));

  const eligibilityStep = findMainStep((d) =>
    /policy.*(valid|verif|align)|eligib.*verif/.test(d)
  );

  const assignmentStep = findMainStep((d) =>
    /assign.*(agent|review|adjuster)/.test(d)
  );

  const guidelineStep = findMainStep((d) =>
    /guideline|policy.*(within|violat)/.test(d)
  );

  const seedQuestions: Array<{ question: string; step?: StepPriorityShape }> = [];

  if (eligibilityStep) {
    seedQuestions.push({
      step: eligibilityStep,
      question: `If eligibility/policy validation fails at MAIN step ${eligibilityStep.stepIndex} ("${eligibilityStep.description}"), what exact actions occur (decline, notify claimant, record details, terminate), and is any retry or appeal path allowed?`,
    });
  }

  if (assignmentStep) {
    seedQuestions.push({
      step: assignmentStep,
      question: `What happens if no reviewer/agent is available at MAIN step ${assignmentStep.stepIndex} ("${assignmentStep.description}")? Is the case queued or put on hold, who is notified, and when does processing resume?`,
    });
  }

  if (guidelineStep) {
    seedQuestions.push({
      step: guidelineStep,
      question: `At MAIN step ${guidelineStep.stepIndex} ("${guidelineStep.description}"), how are major policy violations handled versus minor violations? Does one path terminate the claim while another allows negotiation or adjusted payment?`,
    });
  }

  for (const seed of seedQuestions) {
    const allPrevious = [...previousQuestions, ...asked];
    if (await isQuestionDuplicate(seed.question, allPrevious)) continue;

    questions.push({
      id: `coverage-${seed.step?.stepIndex ?? "general"}`,
      question: seed.question,
      context: {
        step: seed.step ? `Step ${seed.step.stepIndex}` : undefined,
        patternType: "coverage_first",
        whyAsking:
          "Coverage-first safeguard: ensure critical eligibility, availability, and policy-outcome branches are captured before deeper probing.",
        flowId: "MAIN",
      },
      answerGuidance:
        "State explicit trigger, actor actions, and end state (resume, terminate, or negotiate). If not specified in source description, say so explicitly.",
    });
    asked.push(seed.question);
  }

  return { questions, asked };
}

/**
 * Phase 0.5: MAIN flow expansion questions — detects when the baseline MAIN flow
 * is too thin relative to the original description's richness and asks targeted
 * questions about gaps between consecutive steps.
 *
 * This solves the "thin MAIN → no surface area → starvation" problem where
 * the gap detectors have nothing to work with.
 */
export async function buildMainExpansionQuestions(
  useCase: GenUseCase,
  originalDescription: string,
  previousQuestions: string[],
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [];

  const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
  if (!mainFlow) return { questions, asked };

  const mainStepCount = mainFlow.steps.length;

  // F1: Measure description richness using the larger of prose-sentence count OR
  // list-item count. The original prose-only split (/[.!?]\s+/) scored 0 for
  // bullet/numbered descriptions, silently suppressing Phase 0.5.
  const proseSentences = originalDescription
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const listItems = originalDescription
    .split(/\n/)
    .map((s) => s.replace(/^[\s\-*\d.]+/, "").trim())
    .filter((s) => s.length > 20);
  const sentences = proseSentences.length >= listItems.length ? proseSentences : listItems;

  const descSentenceCount = sentences.length;

  // Heuristic: description has significantly more detail than baseline captured.
  // Trigger when description has ≥4 meaningful sentences and the ratio of
  // description sentences to MAIN steps is ≥ 2.0.
  const isThin = descSentenceCount >= 4 && descSentenceCount / mainStepCount >= 2.0;

  if (!isThin) return { questions, asked };

  console.log(
    `[MAIN-EXPANSION] Thin MAIN detected: ${mainStepCount} steps vs ${descSentenceCount} description sentences (ratio=${(descSentenceCount / mainStepCount).toFixed(1)})`,
  );

  const sortedSteps = [...mainFlow.steps].sort((a, b) => a.index - b.index);
  const MAX_EXPANSION_QUESTIONS = 3;
  const firstStep = sortedSteps[0];
  const lastStep = sortedSteps[sortedSteps.length - 1];

  if (!firstStep || !lastStep) return { questions, asked };

  const currentStepsSummary = sortedSteps
    .map((step) => `  ${stepToSummaryLine(step)}`)
    .join("\n");

  const overallQuestion = `The current MAIN flow has ${mainStepCount} steps:\n${currentStepsSummary}\n\nBased on the use case description, are there important intermediate steps missing between these? For example, are there validation steps, confirmation steps, system processing steps, or actor interactions that should appear between the current steps? Describe any missing steps in the order they should occur.`;

  const allPrevious1 = [...previousQuestions, ...asked];
  if (!(await isQuestionDuplicate(overallQuestion, allPrevious1))) {
    questions.push({
      id: "main-expansion-overall",
      question: overallQuestion,
      context: {
        steps: sortedSteps.map((s) => `Step ${s.index}`),
        patternType: "main_expansion",
        whyAsking: `The MAIN flow has only ${mainStepCount} steps but the description suggests a richer process with ~${descSentenceCount} distinct actions. Intermediate steps may be missing.`,
        flowId: "MAIN",
      },
      answerGuidance:
        "List the missing steps in sequence. For each step, state: (1) which actor performs it, (2) what they do, (3) where it fits between existing steps. If no steps are missing, say so explicitly.",
    });
    asked.push(overallQuestion);
  }

  if (questions.length < MAX_EXPANSION_QUESTIONS && sortedSteps.length >= 3) {
    const gapCandidates: Array<{
      fromStep: typeof sortedSteps[0];
      toStep: typeof sortedSteps[0];
      score: number;
    }> = [];

    for (let i = 0; i < sortedSteps.length - 1; i++) {
      const from = sortedSteps[i];
      const to = sortedSteps[i + 1];

      let score = 0;
      if (from.actor !== to.actor) score += 1;
      if (from.description.includes(" and ") || to.description.includes(" and ")) score += 2;
      if (from.description.length < 30 || to.description.length < 30) score += 1;

      gapCandidates.push({ fromStep: from, toStep: to, score });
    }

    gapCandidates.sort((a, b) => b.score - a.score);

    for (const gap of gapCandidates) {
      if (questions.length >= MAX_EXPANSION_QUESTIONS) break;
      if (gap.score < 2) break;

      const gapQuestion = `In the MAIN flow, step ${gap.fromStep.index} is "${stepToColonText(gap.fromStep)}" and the next step ${gap.toStep.index} is "${stepToColonText(gap.toStep)}". Are there any intermediate steps between these two? For instance, does the system perform any validation, display any information, or does the actor need to make any decisions between these actions?`;

      const allPreviousN = [...previousQuestions, ...asked];
      if (await isQuestionDuplicate(gapQuestion, allPreviousN)) continue;

      questions.push({
        id: `main-expansion-gap-${gap.fromStep.index}-${gap.toStep.index}`,
        question: gapQuestion,
        context: {
          step: `Step ${gap.fromStep.index}-${gap.toStep.index}`,
          patternType: "main_expansion",
          whyAsking: `Steps ${gap.fromStep.index} and ${gap.toStep.index} may have missing intermediate actions between them.`,
          flowId: "MAIN",
        },
        answerGuidance:
          "Describe any missing steps between these two steps. For each step, state the actor and action. If no steps are missing, say so explicitly.",
      });
      asked.push(gapQuestion);
    }
  }

  if (questions.length > 0) {
    console.log(`[MAIN-EXPANSION] Generated ${questions.length} expansion questions`);
  }

  return { questions, asked };
}

/**
 * Phase 1: Gap-based exception questions (highest value).
 * Discovers missing flows by asking about detected gaps.
 */
export async function buildGapExceptionQuestions(
  stepPriorities: StepPriorityShape[],
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
  blueprintOnly: boolean,
  blueprintCap: number,
  baselineFlowIds?: Set<string>,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[]; blueprintEmitted: number }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];
  let blueprintQuestionsEmitted = 0;

  const gapSteps = stepPriorities
    .filter((p) => p.relatedGaps.length > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const activeGapGroups = blueprintOnly
    ? [
        {
          label: "blueprint",
          filter: (gapType: string, _flowId: string) => isBlueprintGap(gapType),
        },
      ]
    : [
        {
          label: "blueprint",
          filter: (gapType: string, _flowId: string) => isBlueprintGap(gapType),
        },
        {
          label: "centroid-main",
          filter: (gapType: string, flowId: string) =>
            !isBlueprintGap(gapType) && flowId === "MAIN",
        },
        {
          label: "centroid-non-main",
          filter: (gapType: string, flowId: string) =>
            !isBlueprintGap(gapType) &&
            flowId !== "MAIN" &&
            (!baselineFlowIds || baselineFlowIds.has(flowId)),
        },
      ];

  for (const group of activeGapGroups) {
    if (currentCount + questions.length >= maxQuestions) break;

    const { consolidated, consumedKeys } = group.label === "centroid-main"
      ? buildConsolidatedGroups(gapSteps, group.filter)
      : { consolidated: [], consumedKeys: new Set<string>() };

    for (const consolidatedGroup of consolidated) {
      if (currentCount + questions.length >= maxQuestions) break;

      const questionText = consolidatedGroup.question;
      const allPrevious = [...previousQuestions, ...asked];
      if (await isQuestionDuplicate(questionText, allPrevious)) {
        console.log(`[DEDUP SKIPPED] Consolidated group "${consolidatedGroup.groupId}": "${questionText.slice(0, 100)}..."`);
        continue;
      }

      const stepLabels = consolidatedGroup.steps.map((step) =>
        formatStepLabel(step.flowId, step.index),
      );

      questions.push({
        id: buildConsolidatedId(
          consolidatedGroup.groupId,
          consolidatedGroup.steps.map((step) => step.index),
        ),
        question: questionText,
        context: {
          step: stepLabels.join(", "),
          steps: stepLabels,
          patternType: consolidatedGroup.groupId,
          whyAsking: `Consolidated gaps across ${consolidatedGroup.steps.length} steps: ${consolidatedGroup.memberGapTypes.join(", ")}. Provide step-specific handling (do not respond with a generic statement).`,
          flowId: consolidatedGroup.steps[0]?.flowId ?? "MAIN",
        },
        answerGuidance: consolidatedGroup.answerGuidance,
      });

      asked.push(questionText);
    }

    for (const priority of gapSteps) {
      if (currentCount + questions.length >= maxQuestions) break;

      const filteredGaps = priority.relatedGaps.filter((gap) =>
        group.filter(gap.type, priority.flowId) &&
        !consumedKeys.has(`${priority.flowId}|${priority.stepIndex}|${gap.type}`),
      );

      if (filteredGaps.length === 0) continue;

      const sortedGaps =
        group.label === "blueprint"
          ? [...filteredGaps].sort(
              // ?? 0: gaps without confidence sort to end of queue, not excluded
              (a, b) => (b.blueprintConfidence ?? 0) - (a.blueprintConfidence ?? 0),
            )
          : filteredGaps;

      for (const gap of sortedGaps) {
        if (currentCount + questions.length >= maxQuestions) break;
        if (!gap.suggestedQuestion) continue;

        if (group.label === "blueprint") {
          if (blueprintQuestionsEmitted >= blueprintCap) break;
        }

        const questionText = gap.suggestedQuestion;
        const allPrevious = [...previousQuestions, ...asked];

        if (await isQuestionDuplicate(questionText, allPrevious)) {
          console.log(`[DEDUP SKIPPED] Gap type "${gap.type}" step ${priority.stepIndex}: "${questionText.slice(0, 100)}..."`);
          continue;
        }

        questions.push({
          id: `gap-${gap.type}-step-${priority.stepIndex}`,
          question: questionText,
          context: {
            step: `Step ${priority.stepIndex}`,
            patternType: gap.type,
            whyAsking: `Gap detected: ${gap.description} (Severity: ${gap.severity})`,
            flowId: priority.flowId,
          },
          answerGuidance: getGuidanceForGapType(gap.type),
        });
        asked.push(questionText);

        if (group.label === "blueprint") {
          blueprintQuestionsEmitted++;
        }
      }
    }
  }

  return { questions, asked, blueprintEmitted: blueprintQuestionsEmitted };
}

/**
 * Phase 2: Missing flow condition questions (medium value).
 * Only ask if a baseline flow is completely missing a condition.
 */
export async function buildMissingConditionQuestions(
  flowUncertainties: Array<{
    flowId: string;
    flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
    hasCondition: boolean;
    uncertaintyScore: number;
  }>,
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
  useCase: GenUseCase,
  baselineFlowIds?: Set<string>,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];

  const missingConditions = flowUncertainties
    .filter((f) => f.flowKind !== "MAIN" && !f.hasCondition && (!baselineFlowIds || baselineFlowIds.has(f.flowId)))
    .sort((a, b) => b.uncertaintyScore - a.uncertaintyScore);

  for (const flowUnc of missingConditions) {
    if (currentCount + questions.length >= maxQuestions) break;

    const flow = useCase.flows.find((f) => f.id === flowUnc.flowId);
    const flowKindLabel =
      flowUnc.flowKind === "ALTERNATIVE" ? "alternative flow" : "exception flow";
    const branchContext = flow
      ? describeBranchEntry(useCase, flow, {
          fallbackParentFlowLabel: "the normal flow",
        })
      : "";

    const questionText =
      `The "${flowUnc.flowId}" ${flowKindLabel} has no documented trigger condition.${branchContext} ` +
      `What is the exact condition or event that causes execution to enter "${flowUnc.flowId}"? ` +
      `Describe the specific state, actor action, or system signal that initiates this branch.`;
    const whyAsking = `Flow "${flowUnc.flowId}" is missing a condition entirely. Without a trigger, this branch cannot be reliably implemented or tested.`;

    const allPrevious = [...previousQuestions, ...asked];

    if (await isQuestionDuplicate(questionText, allPrevious)) continue;

    questions.push({
      id: `missing-condition-${flowUnc.flowId}`,
      question: questionText,
      context: {
        patternType: "uncertain_conditions",
        whyAsking,
        flowId: flowUnc.flowId,
      },
      answerGuidance: getGuidanceForGapType("uncertain_conditions"),
    });
    asked.push(questionText);
  }

  return { questions, asked };
}

/**
 * Phase 3: Global gap questions — gaps with no relatedStep (structural, keyword-based).
 * These never appear in stepPriorities (no anchor step) and would otherwise be silently dropped.
 */
export async function buildGlobalGapQuestions(
  globalGaps: Gap[],
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];

  const sorted = [...globalGaps].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2);
  });

  for (const gap of sorted) {
    if (currentCount + questions.length >= maxQuestions) break;
    if (!gap.suggestedQuestion) continue;

    const questionText = gap.suggestedQuestion;
    const allPrevious = [...previousQuestions, ...asked];

    if (await isQuestionDuplicate(questionText, allPrevious)) {
      console.log(`[DEDUP SKIPPED] Global gap "${gap.type}": "${questionText.slice(0, 100)}..."`);
      continue;
    }

    questions.push({
      id: `global-gap-${gap.type}`,
      question: questionText,
      context: {
        patternType: gap.type,
        whyAsking: gap.description,
        flowId: "MAIN",
      },
      answerGuidance: getGuidanceForGapType(gap.type),
    });
    asked.push(questionText);
  }

  return { questions, asked };
}
