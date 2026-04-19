import {
  analyzeGaps,
  clearGapCentroidsCache,
  collectStepEmbeddings,
  type InteractionMemory,
  type GapAnalysis,
} from "../analyzers/gap.analyzer.js";
import {
  detectActivatedBlueprints,
  type BlueprintActivation,
} from "../analyzers/blueprint.detector.js";
import {
  rankAllUncertainties,
  type UncertaintyAnalysis,
} from "../analyzers/uncertainty.ranker.js";
import { buildInteractionMemories } from "../helpers/memory.builder.js";
import { parseConsolidatedId } from "../helpers/consolidated-id.js";
import {
  classifyUseCaseDomainHybrid,
  resolveBlueprintDomainFilter,
} from "../services/domain-classifier.service.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import {
  generateFlatUseCase,
  refineWithHybridAnswers,
  extractFlowsFromOpenEndedAnswers,
  normalizeFlowIds,
} from "../services/usecase.service.js";
import { validateUseCaseWithFeedback } from "../validators/flat.validator.js";
import {
  expertAnswerOpenEndedQuestions,
  generateAdaptiveQuestions,
  type OpenEndedAnswer,
  type OpenEndedQuestion,
} from "../validators/llm.validator.js";
import { type GenUseCase, type GenFlow } from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";

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

  if (question.context.steps && question.context.steps.length > BROAD_SCOPE_STEP_THRESHOLD) {
    return "broad";
  }

  if (question.context.step) return "step-specific";

  return "broad";
}

function flowToText(flow: GenFlow): string {
  const parts: string[] = [flow.kind];
  if (flow.condition) parts.push(flow.condition);
  parts.push(...flow.steps.map((s) => `${s.actor}: ${s.description}`));
  return parts.join(" | ");
}

async function deduplicateFlows(
  existingFlows: GenFlow[],
  newFlows: GenFlow[],
  threshold = 0.82,
): Promise<GenFlow[]> {
  if (newFlows.length === 0) return [];
  if (existingFlows.length === 0 && newFlows.length === 1) return newFlows;

  const existingTexts = existingFlows.map(flowToText);
  const newTexts = newFlows.map(flowToText);
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

  const answerTexts = broadAnswers.map((a) => a.answer).filter((t) => t.trim().length > 0);
  if (answerTexts.length === 0) return deltaFlows;

  const flowTexts = deltaFlows.map(flowToText);
  const allTexts = [...flowTexts, ...answerTexts];
  const allEmbeddings = await semanticService.embedBatch(allTexts);

  const flowEmbeddings = allEmbeddings.slice(0, flowTexts.length);
  const answerEmbeddings = allEmbeddings.slice(flowTexts.length);

  const grounded: GenFlow[] = [];
  for (let i = 0; i < deltaFlows.length; i++) {
    let maxSim = 0;
    for (const answerEmb of answerEmbeddings) {
      const sim = await semanticService.cosineSimilarity(flowEmbeddings[i], answerEmb);
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
  geminiFunctions: GeminiOpenRouterFunctions;
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
): Promise<{ activations: BlueprintActivation[]; confirmed: string[] }> {
  const stepEmbeddings = await collectStepEmbeddings(useCase);
  const domainAnalysis = await classifyUseCaseDomainHybrid(useCase);
  const activationFilter = resolveBlueprintDomainFilter(domainAnalysis);

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

  return { activations, confirmed };
}

async function probeBlueprintsWithExpert(
  activations: BlueprintActivation[],
  description: string,
  domain: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<string[]> {
  const { probeBlueprintsWithExpert: probe } = await import(
    "../validators/llm.validator.js"
  );
  return probe(activations, description, domain, geminiFunctions);
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

// ---------------------------------------------------------------------------
// Single iteration (pure logic — no state management)
// ---------------------------------------------------------------------------

export interface IterationInput {
  useCase: GenUseCase;
  vague: string;
  detailed: string;
  conversationHistory: InteractionMemory[];
  allQuestions: string[];
  confirmedBlueprintIds: string[];
  baselineFlowIds: Set<string>;
  iterationIndex: number;
  totalQuestionsAsked: number;
  maxQuestions: number;
  perIterationCap: number;
  geminiFunctions: GeminiOpenRouterFunctions;
  answerProvider: AnswerProvider;
  previousIterations: HITLIterationResult[];
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

export async function runIteration(
  input: IterationInput,
): Promise<IterationOutput> {
  const validation = await validateUseCaseWithFeedback(input.useCase);
  const gapAnalysis = await analyzeGaps(
    input.useCase,
    validation.score!,
    input.vague,
    input.conversationHistory,
    new Set(input.confirmedBlueprintIds),
    new Set(),
    "post-probe",
  );
  const uncertaintyAnalysis = rankAllUncertainties(
    input.useCase,
    validation.score!,
    gapAnalysis,
  );

  const flowCount = input.useCase.flows.length;
  const recentIterations = input.previousIterations.slice(-2);
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
    uncertaintyAnalysis.highPriorityCount === 0;

  const shouldStopByStall =
    isStalled && uncertaintyAnalysis.overallConfidence > 0.6;

  const hasMinimumFlows = flowCount >= 3;

  if ((shouldStopByConfidence && hasMinimumFlows) || shouldStopByStall) {
    return {
      updatedUseCase: input.useCase,
      questions: [],
      answers: [],
      memories: [],
      gapAnalysis,
      uncertaintyAnalysis,
      stop: "confidence",
    };
  }

  const remainingBudget = input.maxQuestions - input.totalQuestionsAsked;
  const isFirstIteration = input.iterationIndex === 0;
  const hasBlueprintsToExplore = input.confirmedBlueprintIds.length > 0;
  const globalGaps = gapAnalysis.gaps.filter(
    (g) => g.relatedStep === undefined,
  );

  const questions = await generateAdaptiveQuestions(
    uncertaintyAnalysis.stepPriorities,
    uncertaintyAnalysis.flowUncertainties,
    Math.min(input.perIterationCap, remainingBudget),
    input.allQuestions,
    isFirstIteration && hasBlueprintsToExplore,
    input.confirmedBlueprintIds.length,
    input.baselineFlowIds,
    globalGaps,
    input.useCase,
    input.detailed,
  );

  if (questions.length === 0) {
    return {
      updatedUseCase: input.useCase,
      questions: [],
      answers: [],
      memories: [],
      gapAnalysis,
      uncertaintyAnalysis,
      stop: "no_questions",
    };
  }

  const answers = await input.answerProvider(questions, input.iterationIndex);

  const memories = await buildInteractionMemories(
    questions,
    answers,
    input.iterationIndex + 1,
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

  let updatedUseCase = input.useCase;

  if (broadAnswers.length > 0) {
    const preBroadFlowIds = new Set(updatedUseCase.flows.map((f) => f.id));

    updatedUseCase = await refineWithHybridAnswers(
      input.vague,
      updatedUseCase,
      [],
      [],
      broadAnswers,
      input.geminiFunctions,
    );

    // F4: remove delta flows not grounded in any broad answer (prevents hallucination accumulation)
    const deltaFlows = updatedUseCase.flows.filter((f) => !preBroadFlowIds.has(f.id));
    if (deltaFlows.length > 0) {
      const groundedDelta = await filterUngroundedDeltaFlows(deltaFlows, broadAnswers);
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
      input.geminiFunctions,
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

  return {
    updatedUseCase,
    questions,
    answers,
    memories,
    gapAnalysis,
    uncertaintyAnalysis,
    stop: null,
  };
}

// ---------------------------------------------------------------------------
// Full HITL loop (the shared core both orchestrator and testingTools use)
// ---------------------------------------------------------------------------

export async function runHITLLoop(
  loopInput: HITLLoopInput,
  config: HITLLoopConfig,
  answerProvider: AnswerProvider,
  callbacks?: HITLCallbacks,
): Promise<HITLLoopResult> {
  callbacks?.onPhaseChange?.("GENERATING_BASELINE", "Generating baseline use case", 0);

  const baseline = await generateBaseline(
    loopInput.vague,
    loopInput.geminiFunctions,
  );
  const baselineFlowIds = new Set(baseline.flows.map((f) => f.id));

  callbacks?.onBaseline?.(baseline);

  callbacks?.onPhaseChange?.("PROBING_BLUEPRINTS", "Probing blueprints", 0);

  const { activations, confirmed } = await probeBlueprints(
    baseline,
    loopInput.detailed,
    loopInput.domain,
    loopInput.geminiFunctions,
  );

  const confirmedSet = new Set(confirmed);
  const dropped = activations
    .filter((a) => !confirmedSet.has(a.blueprintId))
    .map((a) => a.blueprintId);

  callbacks?.onProbeComplete?.({
    confirmedBlueprintIds: confirmed,
    droppedBlueprintIds: dropped,
  });

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

    const result = await runIteration({
      useCase: currentUseCase,
      vague: loopInput.vague,
      detailed: loopInput.detailed,
      conversationHistory,
      allQuestions,
      confirmedBlueprintIds: confirmed,
      baselineFlowIds,
      iterationIndex,
      totalQuestionsAsked,
      maxQuestions: config.maxQuestions,
      perIterationCap: dynamicPerIterationCap,
      geminiFunctions: loopInput.geminiFunctions,
      answerProvider,
      previousIterations: iterations,
    });

    lastGapAnalysis = result.gapAnalysis;
    lastUncertaintyAnalysis = result.uncertaintyAnalysis;

    if (result.stop === "confidence" || result.stop === "no_questions") {
      callbacks?.onIterationComplete?.(result, iterationIndex + 1);
      break;
    }

    callbacks?.onQuestions?.(result.questions, iterationIndex + 1);

    callbacks?.onPhaseChange?.("REFINING", "Refining use case with answers", iterationIndex + 1);

    currentUseCase = result.updatedUseCase;
    const flowCountAfter = currentUseCase.flows.length;
    const newFlowsAdded = flowCountAfter - flowCountBefore;

    // F2: use module-level constant (includes uncertain_conditions)
    const hadFlowProducingQuestions = result.questions.some(
      (q) => !NON_FLOW_PRODUCING_PATTERN_TYPES.has(q.context.patternType ?? ""),
    );

    conversationHistory.push(...result.memories);
    allQuestions.push(...result.questions.map((q) => q.question));
    totalQuestionsAsked += result.answers.length;

    iterations.push({
      iteration: iterationIndex + 1,
      questionsAsked: result.questions.length,
      overallConfidence: result.uncertaintyAnalysis.overallConfidence,
      highPriorityCount: result.uncertaintyAnalysis.highPriorityCount,
      flowCountBefore,
      flowCountAfter,
      newFlowsAdded,
      hadFlowProducingQuestions,
      questions: result.questions,
      answers: result.answers,
    });

    // F7: compound on current dynamic cap, not the static config baseline
    if (newFlowsAdded > 0) {
      dynamicPerIterationCap = Math.min(dynamicPerIterationCap + 2, 10);
    } else {
      dynamicPerIterationCap = Math.max(dynamicPerIterationCap - 2, 3);
    }

    callbacks?.onIterationComplete?.(result, iterationIndex + 1);
  }

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
