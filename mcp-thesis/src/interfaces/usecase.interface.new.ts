export interface GenStep {
  index: number;
  actor: string;
  target?: string;
  description: string;
}

export interface GenFlow {
  id: "MAIN" | string;
  kind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
  parentFlow?: "MAIN" | string; // MAIN if attached to main flow, or must be string (id of another flow)
  fromStepIndex?: number;
  condition?: string;
  steps: GenStep[];
}

export interface GenLoop {
  // Which flow this loop belongs to
  flowRef: "MAIN" | string; // or an index into your flows array

  // Steps inside that flow that repeat
  startIndex: number; // first step in the loop
  endIndex: number; // last step in the loop

  // Why they repeat
  condition: string; // "for each item in the cart", "while user keeps adding passengers"
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
