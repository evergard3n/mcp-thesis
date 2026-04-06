import {
  analyzeGaps,
  clearGapCentroidsCache,
  collectStepEmbeddings,
} from "../analyzers/gap.analyzer.js";
import { buildInteractionMemories } from "../helpers/memory.builder.js";
import { detectActivatedBlueprints } from "../analyzers/blueprint.detector.js";
import { rankAllUncertainties } from "../analyzers/uncertainty.ranker.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import {
  classifyUseCaseDomainHybrid,
  resolveBlueprintDomainFilter,
} from "../services/domain-classifier.service.js";
import {
  generateFlatUseCase,
  refineWithHybridAnswers,
} from "../services/usecase.service.js";
import { validateUseCaseWithFeedback } from "../validators/flat.validator.js";
import {
  expertAnswerOpenEndedQuestions,
  generateAdaptiveQuestions,
  normalizeHumanAnswers,
  probeBlueprintsWithExpert,
  type OpenEndedAnswer,
} from "../validators/llm.validator.js";
import {
  AnswerInput,
  HITLEvent,
  HITLStartInput,
  HITLState,
  HITLStatus,
} from "./hitl.state.js";

type EventEmitter = (event: HITLEvent) => void;

function createInitialState(sessionId: string): HITLState {
  return {
    sessionId,
    status: "IDLE",
    mode: "interactive",
    vague: null,
    detailed: null,
    domain: null,
    currentUseCase: null,
    baselineUseCase: null,
    conversationHistory: [],
    allQuestions: [],
    iterationCount: 0,
    totalQuestionsAsked: 0,
    maxIterations: 5,
    maxQuestions: 20,
    lastGapAnalysis: null,
    lastUncertaintyAnalysis: null,
    lastQuestions: null,
    confirmedBlueprintIds: [],
    droppedBlueprintIds: [],
    blueprintsProbed: false,
    error: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

export class HITLOrchestrator {
  private state: HITLState;
  private readonly geminiFunctions: GeminiOpenRouterFunctions;
  private subscribers = new Set<EventEmitter>();
  private running = false;
  private waitingResolver: ((answers: AnswerInput[]) => void) | null = null;
  private cancelled = false;

  constructor(sessionId: string, geminiFunctions: GeminiOpenRouterFunctions) {
    this.state = createInitialState(sessionId);
    this.geminiFunctions = geminiFunctions;
  }

  getState(): HITLState {
    return this.state;
  }

  subscribe(emitter: EventEmitter): () => void {
    this.subscribers.add(emitter);
    emitter({ type: "state", state: this.state });
    return () => {
      this.subscribers.delete(emitter);
    };
  }

  submitAnswers(answers: AnswerInput[]): boolean {
    if (!this.waitingResolver || this.state.status !== "WAITING_FOR_ANSWERS") {
      return false;
    }
    const resolver = this.waitingResolver;
    this.waitingResolver = null;
    resolver(answers);
    return true;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.waitingResolver) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      resolver([]);
    }
    if (!this.running) {
      this.state = createInitialState(this.state.sessionId);
      this.emit({ type: "state", state: this.state });
    }
  }

  async start(input: HITLStartInput): Promise<boolean> {
    if (this.running) {
      return false;
    }

    this.cancelled = false;
    this.state = {
      ...createInitialState(this.state.sessionId),
      mode: input.mode,
      vague: input.vague,
      detailed: input.mode === "automated" ? input.detailed ?? null : null,
      domain: input.domain ?? null,
      maxIterations: input.maxIterations ?? 5,
      maxQuestions: input.maxQuestions ?? 20,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.emit({ type: "state", state: this.state });

    this.running = true;
    this.runLoop().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.state = {
        ...this.state,
        status: "ERROR",
        error: message,
        updatedAt: new Date().toISOString(),
      };
      this.emit({ type: "error", message, state: this.state });
    }).finally(() => {
      this.running = false;
    });

    return true;
  }

  private emit(event: HITLEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private transition(status: HITLStatus, message: string): void {
    this.state = {
      ...this.state,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.emit({
      type: "status_change",
      status,
      iteration: this.state.iterationCount + 1,
      message,
      state: this.state,
    });
  }

  private async waitForAnswers(): Promise<AnswerInput[]> {
    return new Promise((resolve) => {
      this.waitingResolver = resolve;
    });
  }

  private async runLoop(): Promise<void> {
    const vague = this.state.vague;
    if (!vague) {
      throw new Error("Missing vague input");
    }

    clearGapCentroidsCache();

    this.transition("GENERATING_BASELINE", "Generating baseline use case");
    const baseline = await generateFlatUseCase({
      description: vague,
      geminiFunctions: this.geminiFunctions,
    });
    const baselineFlowIds = new Set<string>(baseline.flows.map((flow) => flow.id));

    this.state = {
      ...this.state,
      currentUseCase: baseline,
      baselineUseCase: baseline,
      updatedAt: new Date().toISOString(),
    };

    while (!this.cancelled) {
      if (
        this.state.iterationCount >= this.state.maxIterations ||
        this.state.totalQuestionsAsked >= this.state.maxQuestions
      ) {
        break;
      }

      this.transition("ANALYZING_GAPS", "Validating and analyzing gaps");
      const currentUseCase = this.state.currentUseCase;
      if (!currentUseCase || !this.state.vague) {
        throw new Error("State corruption: missing use case or vague input");
      }

      if (!this.state.blueprintsProbed) {
        const stepEmbeddings = await collectStepEmbeddings(currentUseCase);
        const domainAnalysis = await classifyUseCaseDomainHybrid(currentUseCase);
        const activationFilter = resolveBlueprintDomainFilter(domainAnalysis);
        const activations = await detectActivatedBlueprints(
          stepEmbeddings,
          activationFilter,
          { useCase: currentUseCase, originalDescription: this.state.vague },
        );
        const confirmed = await probeBlueprintsWithExpert(
          activations,
          this.state.detailed ?? this.state.vague,
          this.state.domain ?? "General",
          this.geminiFunctions,
        );

        const confirmedSet = new Set(confirmed);
        const dropped = activations
          .filter((activation) => !confirmedSet.has(activation.blueprintId))
          .map((activation) => activation.blueprintId);

        this.state = {
          ...this.state,
          confirmedBlueprintIds: confirmed,
          droppedBlueprintIds: dropped,
          blueprintsProbed: true,
          updatedAt: new Date().toISOString(),
        };
      }

      const currentVague = this.state.vague;
      if (!currentVague) {
        throw new Error("State corruption: missing vague input during analysis");
      }

      const validation = await validateUseCaseWithFeedback(currentUseCase);
      const gapAnalysis = await analyzeGaps(
        currentUseCase,
        validation.score!,
        currentVague,
        this.state.conversationHistory,
        new Set(this.state.confirmedBlueprintIds),
        new Set(),
        "post-probe",
      );
      const uncertaintyAnalysis = rankAllUncertainties(
        currentUseCase,
        validation.score!,
        gapAnalysis,
      );

      this.state = {
        ...this.state,
        lastGapAnalysis: gapAnalysis,
        lastUncertaintyAnalysis: uncertaintyAnalysis,
        updatedAt: new Date().toISOString(),
      };

      if (
        uncertaintyAnalysis.overallConfidence > 0.85 &&
        uncertaintyAnalysis.highPriorityCount === 0
      ) {
        break;
      }

      this.transition("GENERATING_QUESTIONS", "Generating adaptive questions");
      const remainingBudget = this.state.maxQuestions - this.state.totalQuestionsAsked;
      const isFirstIteration = this.state.iterationCount === 0;
      const hasBlueprintsToExplore = this.state.confirmedBlueprintIds.length > 0;
      const globalGaps = gapAnalysis.gaps.filter((g) => g.relatedStep === undefined);
      const questions = await generateAdaptiveQuestions(
        uncertaintyAnalysis.stepPriorities,
        uncertaintyAnalysis.flowUncertainties,
        Math.min(6, remainingBudget),
        this.state.allQuestions,
        isFirstIteration && hasBlueprintsToExplore,
        this.state.confirmedBlueprintIds.length,
        baselineFlowIds,
        globalGaps,
      );

      if (questions.length === 0) {
        break;
      }

      this.state = {
        ...this.state,
        lastQuestions: questions,
        updatedAt: new Date().toISOString(),
      };

      this.emit({
        type: "questions",
        iteration: this.state.iterationCount + 1,
        questions,
        state: this.state,
      });

      let answers: OpenEndedAnswer[] = [];

      if (this.state.mode === "automated") {
        const detailedContext = this.state.detailed ?? currentVague;
        answers = await expertAnswerOpenEndedQuestions(
          questions,
          detailedContext,
          this.state.domain ?? "General",
          this.geminiFunctions,
        );
      } else {
        this.transition("WAITING_FOR_ANSWERS", "Waiting for human answers");
        const providedAnswers = await this.waitForAnswers();
        if (this.cancelled) {
          break;
        }
        answers = normalizeHumanAnswers(providedAnswers);
      }

      this.transition("REFINING", "Refining use case with answers");
      const memories = await buildInteractionMemories(
        this.state.lastQuestions ?? [],
        answers,
        this.state.iterationCount + 1,
      );

      const updatedUseCase = await refineWithHybridAnswers(
        currentVague,
        currentUseCase,
        [],
        [],
        answers,
        this.geminiFunctions,
      );

      this.state = {
        ...this.state,
        currentUseCase: updatedUseCase,
        conversationHistory: [...this.state.conversationHistory, ...memories],
        allQuestions: [
          ...this.state.allQuestions,
          ...(this.state.lastQuestions ?? []).map((q) => q.question),
        ],
        iterationCount: this.state.iterationCount + 1,
        totalQuestionsAsked: this.state.totalQuestionsAsked + answers.length,
        lastGapAnalysis: null,
        lastUncertaintyAnalysis: null,
        lastQuestions: null,
        updatedAt: new Date().toISOString(),
      };
    }

    this.state = {
      ...this.state,
      status: this.cancelled ? "IDLE" : "DONE",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.emit({ type: "done", state: this.state });
  }
}
