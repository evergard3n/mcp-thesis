import { randomUUID } from "crypto";
import { HITLOrchestrator } from "../orchestrator/hitl.orchestrator.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import { JsonProjectStore } from "../stores/projectStore.js";

export interface SessionContext {
  sessionId: string;
  projectStore: JsonProjectStore;
  geminiFunctions: GeminiOpenRouterFunctions;
  hitl: HITLOrchestrator;
  createdAt: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionContext>();
  private readonly openrouterApiKey: string;
  private readonly geminiApiKey: string;

  constructor(openrouterApiKey: string, geminiApiKey: string) {
    this.openrouterApiKey = openrouterApiKey;
    this.geminiApiKey = geminiApiKey;
  }

  createSession(): SessionContext {
    const sessionId = randomUUID();
    const projectStore = new JsonProjectStore(sessionId);
    const geminiFunctions = new GeminiOpenRouterFunctions(
      this.geminiApiKey,
      this.openrouterApiKey,
    );
    const hitl = new HITLOrchestrator(sessionId, geminiFunctions);

    const session: SessionContext = {
      sessionId,
      projectStore,
      geminiFunctions,
      hitl,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): SessionContext | null {
    return this.sessions.get(sessionId) ?? null;
  }

  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.hitl.cancel();
    return this.sessions.delete(sessionId);
  }
}
