import { clearGapCentroidsCache } from "../analyzers/gap.analyzer.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import { generateFlatUseCase } from "../services/usecase.service.js";
import {
  expertAnswerOpenEndedQuestions,
  normalizeHumanAnswers,
  type OpenEndedAnswer,
} from "../validators/llm.validator.js";
import {
  AnswerInput,
  HITLEvent,
  HITLStartInput,
  HITLState,
  HITLStatus,
} from "./hitl.state.js";
import { probeBlueprints, runIteration } from "./hitl.core.js";

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

      const currentUseCase = this.state.currentUseCase;
      const currentVague = this.state.vague;
      if (!currentUseCase || !currentVague) {
        throw new Error("State corruption: missing use case or vague input");
      }

      if (!this.state.blueprintsProbed) {
        const { activations, confirmed } = await probeBlueprints(
          currentUseCase,
          this.state.detailed ?? currentVague,
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

      this.transition("ANALYZING_GAPS", "Validating and analyzing gaps");

      const answerProvider = async (
        questions: Parameters<typeof expertAnswerOpenEndedQuestions>[0],
        _iteration: number,
      ): Promise<OpenEndedAnswer[]> => {
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

        if (this.state.mode === "automated") {
          const detailedContext = this.state.detailed ?? currentVague;
          return expertAnswerOpenEndedQuestions(
            questions,
            detailedContext,
            this.state.domain ?? "General",
            this.geminiFunctions,
          );
        }

        this.transition("WAITING_FOR_ANSWERS", "Waiting for human answers");
        const providedAnswers = await this.waitForAnswers();
        if (this.cancelled) return [];
        return normalizeHumanAnswers(providedAnswers);
      };

      const result = await runIteration({
        useCase: currentUseCase,
        vague: currentVague,
        conversationHistory: this.state.conversationHistory,
        allQuestions: this.state.allQuestions,
        confirmedBlueprintIds: this.state.confirmedBlueprintIds,
        baselineFlowIds,
        iterationIndex: this.state.iterationCount,
        totalQuestionsAsked: this.state.totalQuestionsAsked,
        maxQuestions: this.state.maxQuestions,
        perIterationCap: 6,
        geminiFunctions: this.geminiFunctions,
        answerProvider,
      });

      this.state = {
        ...this.state,
        lastGapAnalysis: result.gapAnalysis,
        lastUncertaintyAnalysis: result.uncertaintyAnalysis,
        updatedAt: new Date().toISOString(),
      };

      if (result.stop === "confidence" || result.stop === "no_questions") {
        break;
      }

      this.transition("REFINING", "Refining use case with answers");

      this.state = {
        ...this.state,
        currentUseCase: result.updatedUseCase,
        conversationHistory: [
          ...this.state.conversationHistory,
          ...result.memories,
        ],
        allQuestions: [
          ...this.state.allQuestions,
          ...result.questions.map((q) => q.question),
        ],
        iterationCount: this.state.iterationCount + 1,
        totalQuestionsAsked:
          this.state.totalQuestionsAsked + result.answers.length,
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
