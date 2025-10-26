export interface Actor {
  actor_id: string;
  name: string;
  description: string;
}

export interface Action {
  id: string;
  order: number;
  from: string; // actor_id
  to: string; // actor_id
  action: string;
  type?: "request" | "response";
}

export interface UseCase {
  id?: string;
  name: string;
  description: string;
  mainActor: string; // actor_id
  actors: string[]; // actor_ids
  actions: Action[];
}
