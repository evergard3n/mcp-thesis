export type HitlStatus =
  | "IDLE"
  | "GENERATING_BASELINE"
  | "PROBING_BLUEPRINTS"
  | "ANALYZING_GAPS"
  | "GENERATING_QUESTIONS"
  | "WAITING_FOR_ANSWERS"
  | "REFINING"
  | "DONE"
  | "ERROR";

export interface GenStep {
  index: number;
  actor: string;
  target?: string;
  description: string;
}

export interface GenFlow {
  id: string;
  kind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
  parentFlow?: string;
  fromStepIndex?: number;
  condition?: string;
  steps: GenStep[];
}

export interface GenLoop {
  flowRef: string;
  startIndex: number;
  endIndex: number;
  condition: string;
}

export interface GenUseCase {
  name: string;
  summary: string;
  mainActor: string;
  actors: string[];
  preconditions?: string[];
  postconditions?: string[];
  flows: GenFlow[];
  loops?: GenLoop[];
}

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

export interface HitlState {
  sessionId: string;
  status: HitlStatus;
  mode: "interactive";
  vague: string | null;
  detailed: string | null;
  domain: string | null;
  currentUseCase: GenUseCase | null;
  baselineUseCase: GenUseCase | null;
  conversationHistory: unknown[];
  allQuestions: string[];
  iterationCount: number;
  totalQuestionsAsked: number;
  maxIterations: number;
  maxQuestions: number;
  lastGapAnalysis: unknown | null;
  lastUncertaintyAnalysis: unknown | null;
  lastQuestions: OpenEndedQuestion[] | null;
  confirmedBlueprintIds: string[];
  droppedBlueprintIds: string[];
  blueprintsProbed: boolean;
  error: string | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface StartHitlRequest {
  vague: string;
  domain?: string;
  maxIterations?: number;
  maxQuestions?: number;
}

export interface StartHitlResponse {
  status: "started";
  state: HitlState;
}

export interface HitlAnswer {
  questionId: string;
  answer: string;
}

export interface SubmitHitlAnswersRequest {
  answers: HitlAnswer[];
}

export interface SubmitHitlAnswersResponse {
  accepted: true;
  status: "answers_received";
}

export interface CancelHitlResponse {
  cancelled: true;
  state: HitlState;
}

export interface HitlStateEvent {
  type: "state";
  state: HitlState;
}

export interface HitlStatusChangeEvent {
  type: "status_change";
  status: HitlStatus;
  iteration: number;
  message: string;
  state: HitlState;
}

export interface HitlQuestionsEvent {
  type: "questions";
  iteration: number;
  questions: OpenEndedQuestion[];
  state: HitlState;
}

export interface HitlDoneEvent {
  type: "done";
  state: HitlState;
}

export interface HitlErrorEvent {
  type: "error";
  message: string;
  state: HitlState;
}

export type HitlStreamEvent =
  | HitlStateEvent
  | HitlStatusChangeEvent
  | HitlQuestionsEvent
  | HitlDoneEvent
  | HitlErrorEvent;
