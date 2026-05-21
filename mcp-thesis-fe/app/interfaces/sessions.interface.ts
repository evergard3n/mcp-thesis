import type { HitlState } from "./hitl.interface";

export interface CreateSessionResponse {
  sessionId: string;
  createdAt: string;
}

export type GetSessionStateResponse = HitlState;
