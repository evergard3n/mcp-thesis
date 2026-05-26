import {
  detectActivatedBlueprints,
  type BlueprintActivation,
} from "../analyzers/blueprint.detector.js";
import {
  analyzeGaps,
  clearGapCentroidsCache,
  collectStepEmbeddings,
  type GapAnalysis,
  type InteractionMemory,
} from "../analyzers/gap.analyzer.js";
import {
  rankAllUncertainties,
  type UncertaintyAnalysis,
} from "../analyzers/uncertainty.ranker.js";
import { parseConsolidatedId } from "../helpers/consolidated-id.js";
import { flowToPipeText } from "../helpers/usecase-text.js";
import { buildInteractionMemories } from "../helpers/memory.builder.js";
import {
  type GenFlow,
  type GenUseCase,
} from "../interfaces/usecase.interface.new.js";
import {
  classifyUseCaseDomainHybrid,
  DomainType,
} from "../services/domain-classifier.service.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import semanticService from "../services/semantic.service.js";
import {
  extractFlowsFromOpenEndedAnswers,
  generateFlatUseCase,
  normalizeFlowIds,
  refineWithHybridAnswers,
  consolidateFlows,
} from "../services/usecase.service.js";
import {
  generateAdaptiveQuestions,
  probeBlueprintsWithExpert,
  type OpenEndedAnswer,
} from "../validators/llm.validator.js";
import { OpenEndedQuestion } from "../validators/question-builders.js";

// ---------------------------------------------------------------------------
// Answer classification + flow dedup helpers
// ---------------------------------------------------------------------------

const BROAD_SCOPE_STEP_THRESHOLD = 4;

/**
 * F2: Pattern types that, when asked, do NOT produce new flows.
 * Kept as a module-level constant so adding a new non-productive pattern
 * type only requires editing this one place (not searching the loop body).
 *
 * - "incomplete_actors": asks about actor roles, not exception/alt flows
 * - "clarification": asks about step details, not new branches
 * - "uncertain_conditions": asks about trigger conditions for existing flows,
 *   not new branches; answered iterations should NOT count as stalls
 */
const NON_FLOW_PRODUCING_PATTERN_TYPES = new Set([
  "incomplete_actors",
  "clarification",
  "uncertain_conditions",
]);

function classifyAnswerScope(
  answer: OpenEndedAnswer,
  questions: OpenEndedQuestion[],
): "broad" | "step-specific" {
  const question = questions.find((q) => q.id === answer.questionId);
  if (!question) {
    // F6: log mismatch so it's visible in run output rather than silently triggering a full rebuild
    console.warn(
      `[classifyAnswerScope] No question found for ID "${answer.questionId}" — defaulting to "broad". This may cause an unintended full use case rebuild.`,
    );
    return "broad";
  }

  if (answer.questionId.startsWith("global-gap-")) return "broad";
  if (answer.questionId.startsWith("main-expansion-")) return "broad";

  // F3: use shared parser instead of inline regex
  const parsed = parseConsolidatedId(answer.questionId);
  if (parsed) {
    if (parsed.stepIndexes.length > BROAD_SCOPE_STEP_THRESHOLD) return "broad";
    return "step-specific";
  }

  if (
    question.context.steps &&
    question.context.steps.length > BROAD_SCOPE_STEP_THRESHOLD
  ) {
    return "broad";
  }

  if (question.context.step) return "step-specific";

  return "broad";
}

async function deduplicateFlows(
  existingFlows: GenFlow[],
  newFlows: GenFlow[],
  threshold = 0.82,
): Promise<GenFlow[]> {
  if (newFlows.length === 0) return [];
  if (existingFlows.length === 0 && newFlows.length === 1) return newFlows;

  const existingTexts = existingFlows.map(flowToPipeText);
  const newTexts = newFlows.map(flowToPipeText);
  const allTexts = [...existingTexts, ...newTexts];
  const embeddings = await semanticService.embedBatch(allTexts);

  const existingEmbeddings = embeddings.slice(0, existingTexts.length);
  const newEmbeddings = embeddings.slice(existingTexts.length);

  const unique: GenFlow[] = [];
  const uniqueEmbeddings: number[][] = [];

  for (let i = 0; i < newFlows.length; i++) {
    let isDuplicate = false;

    for (let j = 0; j < existingEmbeddings.length; j++) {
      const sim = await semanticService.cosineSimilarity(
        newEmbeddings[i],
        existingEmbeddings[j],
      );
      if (sim >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      for (let k = 0; k < uniqueEmbeddings.length; k++) {
        const sim = await semanticService.cosineSimilarity(
          newEmbeddings[i],
          uniqueEmbeddings[k],
        );
        if (sim >= threshold) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      unique.push(newFlows[i]);
      uniqueEmbeddings.push(newEmbeddings[i]);
    }
  }
  return unique;
}

/**
 * F4: After a broad rebuild, remove delta flows that are not grounded in any
 * of the broad answers that triggered the rebuild.
 *
 * "Grounded" means the flow text has cosine similarity >= threshold to at
 * least one answer.  This uses the existing semanticService — no new deps.
 * Threshold 0.45 is intentionally conservative: keeps flows loosely related
 * to any answer topic, only removes truly unsolicited extrapolations.
 */
async function filterUngroundedDeltaFlows(
  deltaFlows: GenFlow[],
  broadAnswers: OpenEndedAnswer[],
  threshold = 0.45,
): Promise<GenFlow[]> {
  if (deltaFlows.length === 0 || broadAnswers.length === 0) return deltaFlows;

  const answerTexts = broadAnswers
    .map((a) => a.answer)
    .filter((t) => t.trim().length > 0);
  if (answerTexts.length === 0) return deltaFlows;

  const flowTexts = deltaFlows.map(flowToPipeText);
  const allTexts = [...flowTexts, ...answerTexts];
  const allEmbeddings = await semanticService.embedBatch(allTexts);

  const flowEmbeddings = allEmbeddings.slice(0, flowTexts.length);
  const answerEmbeddings = allEmbeddings.slice(flowTexts.length);

  const grounded: GenFlow[] = [];
  for (let i = 0; i < deltaFlows.length; i++) {
    let maxSim = 0;
    for (const answerEmb of answerEmbeddings) {
      const sim = await semanticService.cosineSimilarity(
        flowEmbeddings[i],
        answerEmb,
      );
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim >= threshold) {
      grounded.push(deltaFlows[i]);
    } else {
      console.log(
        `[Grounding] Removed ungrounded delta flow "${deltaFlows[i].id}" (max sim to answers: ${maxSim.toFixed(3)} < ${threshold})`,
      );
    }
  }
  return grounded;
}

export interface HITLLoopConfig {
  maxIterations: number;
  maxQuestions: number;
  perIterationCap: number;
}

export interface HITLLoopInput {
  vague: string;
  detailed: string;
  domain: string;
}

export interface HITLIterationResult {
  iteration: number;
  questionsAsked: number;
  overallConfidence: number;
  highPriorityCount: number;
  flowCountBefore: number;
  flowCountAfter: number;
  newFlowsAdded: number;
  hadFlowProducingQuestions: boolean;
  questions: OpenEndedQuestion[];
  answers: OpenEndedAnswer[];
}

export interface HITLProbeResult {
  confirmedBlueprintIds: string[];
  droppedBlueprintIds: string[];
}

export interface HITLLoopResult {
  useCase: GenUseCase;
  baseline: GenUseCase;
  iterations: HITLIterationResult[];
  totalQuestionsAsked: number;
  conversationHistory: InteractionMemory[];
  probe: HITLProbeResult;
  lastGapAnalysis: GapAnalysis | null;
  lastUncertaintyAnalysis: UncertaintyAnalysis | null;
}

export type AnswerProvider = (
  questions: OpenEndedQuestion[],
  iteration: number,
) => Promise<OpenEndedAnswer[]>;

export interface HITLCallbacks {
  onPhaseChange?: (phase: string, message: string, iteration: number) => void;
  onBaseline?: (baseline: GenUseCase) => void;
  onProbeComplete?: (probe: HITLProbeResult) => void;
  onIterationComplete?: (result: IterationOutput, iteration: number) => void;
  onQuestions?: (questions: OpenEndedQuestion[], iteration: number) => void;
  shouldCancel?: () => boolean;
}

// ---------------------------------------------------------------------------
// Blueprint probing (shared, runs once)
// ---------------------------------------------------------------------------

export async function probeBlueprints(
  useCase: GenUseCase,
  description: string,
  domain: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<{
  activations: BlueprintActivation[];
  confirmed: string[];
  domainType: DomainType;
}> {
  const stepEmbeddings = await collectStepEmbeddings(useCase);
  const domainType = await classifyUseCaseDomainHybrid(useCase);
  const activationFilter =
    domainType === DomainType.Ambiguous ? undefined : domainType;

  const activations = await detectActivatedBlueprints(
    stepEmbeddings,
    activationFilter,
    { useCase, originalDescription: description },
  );

  const confirmed = await probeBlueprintsWithExpert(
    activations,
    description,
    domain,
    geminiFunctions,
  );

  return { activations, confirmed, domainType };
}

// ---------------------------------------------------------------------------
// Baseline generation
// ---------------------------------------------------------------------------

export async function generateBaseline(
  vague: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<GenUseCase> {
  clearGapCentroidsCache();
  return generateFlatUseCase({ description: vague, geminiFunctions });
}

export interface IterationOutput {
  updatedUseCase: GenUseCase;
  questions: OpenEndedQuestion[];
  answers: OpenEndedAnswer[];
  memories: InteractionMemory[];
  gapAnalysis: GapAnalysis;
  uncertaintyAnalysis: UncertaintyAnalysis;
  stop: "confidence" | "no_questions" | null;
}

// ---------------------------------------------------------------------------
// Full HITL loop (the shared core both orchestrator and testingTools use)
// ---------------------------------------------------------------------------

export async function runHITLLoop(
  loopInput: HITLLoopInput,
  config: HITLLoopConfig,
  geminiFunctions: GeminiOpenRouterFunctions,
  answerProvider: AnswerProvider,
  callbacks?: HITLCallbacks,
): Promise<HITLLoopResult> {
  callbacks?.onPhaseChange?.(
    "GENERATING_BASELINE",
    "Generating baseline use case",
    0,
  );

  // generating baseline
  const baseline = await generateBaseline(loopInput.vague, geminiFunctions);
  const baselineFlowIds = new Set(baseline.flows.map((f) => f.id));

  callbacks?.onBaseline?.(baseline);

  callbacks?.onPhaseChange?.("PROBING_BLUEPRINTS", "Probing blueprints", 0);

  // probing blueprints (shared, runs once)

  const {
    activations,
    confirmed,
    domainType: initialDomainType,
  } = await probeBlueprints(
    baseline,
    loopInput.detailed,
    loopInput.domain,
    geminiFunctions,
  );

  const confirmedSet = new Set(confirmed);
  const dropped = activations
    .filter((a) => !confirmedSet.has(a.blueprintId))
    .map((a) => a.blueprintId);

  callbacks?.onProbeComplete?.({
    confirmedBlueprintIds: confirmed,
    droppedBlueprintIds: dropped,
  });

  // main iterative loop
  let currentUseCase = baseline;
  const conversationHistory: InteractionMemory[] = [];
  const allQuestions: string[] = [];
  const iterations: HITLIterationResult[] = [];
  let totalQuestionsAsked = 0;
  let lastGapAnalysis: GapAnalysis | null = null;
  let lastUncertaintyAnalysis: UncertaintyAnalysis | null = null;
  let dynamicPerIterationCap = config.perIterationCap;

  for (
    let iterationIndex = 0;
    iterationIndex < config.maxIterations;
    iterationIndex++
  ) {
    if (totalQuestionsAsked >= config.maxQuestions) break;
    if (callbacks?.shouldCancel?.()) break;

    callbacks?.onPhaseChange?.(
      "ANALYZING_GAPS",
      "Validating and analyzing gaps",
      iterationIndex + 1,
    );

    const flowCountBefore = currentUseCase.flows.length;

    // --- analyze ---
    const gapAnalysis = await analyzeGaps(
      currentUseCase,
      loopInput.vague,
      {
        domainType: initialDomainType,
        activations,
        confirmedIds: new Set(confirmed),
      },
      conversationHistory,
    );
    const uncertaintyAnalysis = rankAllUncertainties(
      currentUseCase,
      gapAnalysis,
    );

    lastGapAnalysis = gapAnalysis;
    lastUncertaintyAnalysis = uncertaintyAnalysis;

    // --- stop check ---
    const recentIterations = iterations.slice(-2);
    // Only count as a stall if the iteration asked flow-producing questions
    // (gap-based, blueprint, consolidated) but still produced 0 new flows.
    // Iterations that only asked actor-role or clarification questions are
    // not meaningful stalls — they never had flow-discovery potential.
    const consecutiveStalls = recentIterations.filter(
      (it) => it.newFlowsAdded <= 0 && it.hadFlowProducingQuestions,
    ).length;
    const isStalled = recentIterations.length >= 2 && consecutiveStalls >= 2;
    const shouldStopByConfidence =
      uncertaintyAnalysis.overallConfidence > 0.85 &&
      uncertaintyAnalysis.highPriorityCount === 0 &&
      iterationIndex >= 2; // F5: allow at least 2 iterations regardless of confidence (bootstrapping + initial low-confidence phases)
    const shouldStopByStall =
      isStalled && uncertaintyAnalysis.overallConfidence > 0.6;
    const hasMinimumFlows = currentUseCase.flows.length >= 3;

    console.log(
      "[STOPPING CHECK]",
      shouldStopByConfidence,
      shouldStopByStall,
      uncertaintyAnalysis.overallConfidence,
      uncertaintyAnalysis.highPriorityCount,
      iterationIndex,
      consecutiveStalls,
    );

    if ((shouldStopByConfidence && hasMinimumFlows) || shouldStopByStall) {
      console.log(
        `[Stopping] Stopping loop at iteration ${iterationIndex + 1} due to ${
          shouldStopByConfidence ? "high confidence" : "stalls"
        }.`,
      );
      callbacks?.onIterationComplete?.(
        {
          updatedUseCase: currentUseCase,
          questions: [],
          answers: [],
          memories: [],
          gapAnalysis,
          uncertaintyAnalysis,
          stop: "confidence",
        },
        iterationIndex + 1,
      );
      break;
    }

    // --- generate questions ---
    const remainingBudget = config.maxQuestions - totalQuestionsAsked;
    const globalGaps = gapAnalysis.gaps.filter(
      (g) => g.relatedStep === undefined,
    );
    const questions: OpenEndedQuestion[] = await generateAdaptiveQuestions(
      uncertaintyAnalysis.stepPriorities,
      uncertaintyAnalysis.flowUncertainties,
      Math.min(dynamicPerIterationCap, remainingBudget),
      allQuestions,
      iterationIndex === 0 && confirmed.length > 0,
      confirmed.length,
      baselineFlowIds,
      globalGaps,
      currentUseCase,
      loopInput.detailed,
    );

    if (questions.length === 0) {
      callbacks?.onIterationComplete?.(
        {
          updatedUseCase: currentUseCase,
          questions: [],
          answers: [],
          memories: [],
          gapAnalysis,
          uncertaintyAnalysis,
          stop: "no_questions",
        },
        iterationIndex + 1,
      );
      break;
    }

    callbacks?.onQuestions?.(questions, iterationIndex + 1);
    callbacks?.onPhaseChange?.(
      "REFINING",
      "Refining use case with answers",
      iterationIndex + 1,
    );

    // --- answer + refine ---
    const answers = await answerProvider(questions, iterationIndex);
    const qaTuple = [];
    for (const answer of answers) {
      for (const question of questions) {
        if (question.id === answer.questionId) {
          qaTuple.push({
            ...answer,
            question: question.question,
          });
        }
      }
    }
    const memories = await buildInteractionMemories(
      questions,
      answers,
      iterationIndex + 1,
    );

    const broadAnswers: OpenEndedAnswer[] = [];
    const stepSpecificAnswers: OpenEndedAnswer[] = [];
    for (const answer of answers) {
      if (classifyAnswerScope(answer, questions) === "broad") {
        broadAnswers.push(answer);
      } else {
        stepSpecificAnswers.push(answer);
      }
    }

    let updatedUseCase = currentUseCase;

    if (broadAnswers.length > 0) {
      const preBroadFlowIds = new Set(updatedUseCase.flows.map((f) => f.id));
      updatedUseCase = await refineWithHybridAnswers(
        loopInput.vague,
        updatedUseCase,
        broadAnswers,
        geminiFunctions,
      );
      // F4: remove delta flows not grounded in any broad answer (prevents hallucination accumulation)
      const deltaFlows = updatedUseCase.flows.filter(
        (f) => !preBroadFlowIds.has(f.id),
      );
      if (deltaFlows.length > 0) {
        const groundedDelta = await filterUngroundedDeltaFlows(
          deltaFlows,
          broadAnswers,
        );
        const survivingDeltaIds = new Set(groundedDelta.map((f) => f.id));
        updatedUseCase = {
          ...updatedUseCase,
          flows: updatedUseCase.flows.filter(
            (f) => preBroadFlowIds.has(f.id) || survivingDeltaIds.has(f.id),
          ),
        };
      }
    }

    if (stepSpecificAnswers.length > 0) {
      const extractedFlows = await extractFlowsFromOpenEndedAnswers(
        stepSpecificAnswers,
        updatedUseCase,
        geminiFunctions,
      );
      const uniqueFlows = await deduplicateFlows(
        updatedUseCase.flows,
        extractedFlows,
      );
      if (uniqueFlows.length > 0) {
        updatedUseCase = normalizeFlowIds({
          ...updatedUseCase,
          flows: [...updatedUseCase.flows, ...uniqueFlows],
        });
      }
    }

    // temporary fix to prevent misbehavior
    currentUseCase = await refineWithHybridAnswers(
      loopInput.vague,
      currentUseCase,
      qaTuple,
      geminiFunctions,
    );

    currentUseCase = normalizeFlowIds(currentUseCase);

    const flowCountAfter = currentUseCase.flows.length;
    const newFlowsAdded = flowCountAfter - flowCountBefore;

    // F2: use module-level constant (includes uncertain_conditions)
    const hadFlowProducingQuestions = questions.some(
      (q) => !NON_FLOW_PRODUCING_PATTERN_TYPES.has(q.context.patternType ?? ""),
    );

    conversationHistory.push(...memories);
    allQuestions.push(...questions.map((q) => q.question));
    totalQuestionsAsked += answers.length;

    iterations.push({
      iteration: iterationIndex + 1,
      questionsAsked: questions.length,
      overallConfidence: uncertaintyAnalysis.overallConfidence,
      highPriorityCount: uncertaintyAnalysis.highPriorityCount,
      flowCountBefore,
      flowCountAfter,
      newFlowsAdded,
      hadFlowProducingQuestions,
      questions,
      answers,
    });

    // F7: compound on current dynamic cap, not the static config baseline
    if (newFlowsAdded > 0) {
      dynamicPerIterationCap = Math.min(dynamicPerIterationCap + 2, 10);
    } else {
      dynamicPerIterationCap = Math.max(dynamicPerIterationCap - 2, 3);
    }

    callbacks?.onIterationComplete?.(
      {
        updatedUseCase: currentUseCase,
        questions,
        answers,
        memories,
        gapAnalysis,
        uncertaintyAnalysis,
        stop: null,
      },
      iterationIndex + 1,
    );
  }

  // callbacks?.onPhaseChange?.(
  //   "CONSOLIDATING",
  //   "Consolidating redundant flows",
  //   iterations.length,
  // );
  // const flowCountBeforeConsolidate = currentUseCase.flows.length;
  // currentUseCase = await consolidateFlows(currentUseCase, geminiFunctions);
  // const removed = flowCountBeforeConsolidate - currentUseCase.flows.length;
  // if (removed > 0) {
  //   console.log(
  //     `[Consolidation] Removed ${removed} redundant flow(s). Flows: ${flowCountBeforeConsolidate} → ${currentUseCase.flows.length}`,
  //   );
  // }

  return {
    useCase: currentUseCase,
    baseline,
    iterations,
    totalQuestionsAsked,
    conversationHistory,
    probe: {
      confirmedBlueprintIds: confirmed,
      droppedBlueprintIds: dropped,
    },
    lastGapAnalysis,
    lastUncertaintyAnalysis,
  };
}
