export interface Actor {
  actor_id: string;
  name: string;
  description: string;
}

export interface Step {
  id: string;
  type: "action" | "system";
  description: string;
  from: string;
  to: string;
  nextStepId?: string;
  prevStepId?: string;

  alt?: {
    condition: string; // điều kiện phân nhánh
    ifSteps: Step[]; // bước khi điều kiện đúng
    elseSteps?: Step[]; // bước khi điều kiện sai
  };

  loop?: {
    condition: string;
    steps: Step[];
  };
}
export interface UseCase {
  id?: string;
  name: string;
  description: string;
  mainActor: string; // actor_id
  actors: string[]; // actor_ids
  firstStepId?: string; // step_id
  steps: Step[];
}
