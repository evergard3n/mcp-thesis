import { GapAnalysis, InteractionMemory } from "../analyzers/gap.analyzer.js";
import { UncertaintyAnalysis } from "../analyzers/uncertainty.ranker.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { OpenEndedQuestion } from "../validators/llm.validator.js";

export type HITLStatus =
  | "IDLE"
  | "GENERATING_BASELINE"
  | "ANALYZING_GAPS"
  | "GENERATING_QUESTIONS"
  | "WAITING_FOR_ANSWERS"
  | "REFINING"
  | "DONE"
  | "ERROR";

export interface AnswerInput {
  questionId: string;
  answer: string;
}

export interface HITLStartInput {
  vague: string;
  domain?: string;
  maxIterations?: number;
  maxQuestions?: number;
}

export interface HITLState {
  sessionId: string;
  status: HITLStatus;
  vague: string | null;
  domain: string | null;
  currentUseCase: GenUseCase | null;
  baselineUseCase: GenUseCase | null;
  conversationHistory: InteractionMemory[];
  allQuestions: string[];
  iterationCount: number;
  totalQuestionsAsked: number;
  maxIterations: number;
  maxQuestions: number;
  lastGapAnalysis: GapAnalysis | null;
  lastUncertaintyAnalysis: UncertaintyAnalysis | null;
  lastQuestions: OpenEndedQuestion[] | null;
  confirmedBlueprintIds: string[];
  droppedBlueprintIds: string[];
  blueprintsProbed: boolean;
  error: string | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export type HITLEvent =
  | {
      type: "state";
      state: HITLState;
    }
  | {
      type: "status_change";
      status: HITLStatus;
      iteration: number;
      message: string;
      state: HITLState;
    }
  | {
      type: "questions";
      iteration: number;
      questions: OpenEndedQuestion[];
      state: HITLState;
    }
  | {
      type: "done";
      state: HITLState;
    }
  | {
      type: "error";
      message: string;
      state: HITLState;
    };
