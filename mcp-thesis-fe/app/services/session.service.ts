import type { AxiosRequestConfig } from "axios";

import { buildSessionStateUrl, buildSessionUrl, SESSIONS_URL } from "~/consts/apiUrl";
import type { HitlState } from "~/interfaces/hitl.interface";
import type { CreateSessionResponse } from "~/interfaces/sessions.interface";

import httpService from "./http.service";

class SessionService {
  createSession() {
    return httpService.post<CreateSessionResponse>(SESSIONS_URL);
  }

  getSessionState(sessionId: string, config?: AxiosRequestConfig) {
    return httpService.get<HitlState>(buildSessionStateUrl(sessionId), config);
  }

  deleteSession(sessionId: string) {
    return httpService.delete<void>(buildSessionUrl(sessionId));
  }
}

export default new SessionService();
