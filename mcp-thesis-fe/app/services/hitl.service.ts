import {
  buildApiUrl,
  buildSessionHitlUrl,
} from "~/consts/apiUrl";
import type {
  CancelHitlResponse,
  StartHitlRequest,
  StartHitlResponse,
  SubmitHitlAnswersRequest,
  SubmitHitlAnswersResponse,
} from "~/interfaces/hitl.interface";

import httpService from "./http.service";

class HitlService {
  startHitl(sessionId: string, body: StartHitlRequest) {
    return httpService.post<StartHitlResponse>(
      buildSessionHitlUrl(sessionId, "start"),
      body,
    );
  }

  submitAnswers(sessionId: string, body: SubmitHitlAnswersRequest) {
    return httpService.post<SubmitHitlAnswersResponse>(
      buildSessionHitlUrl(sessionId, "answers"),
      body,
    );
  }

  cancelHitl(sessionId: string) {
    return httpService.post<CancelHitlResponse>(
      buildSessionHitlUrl(sessionId, "cancel"),
    );
  }

  createHitlStream(sessionId: string) {
    return new EventSource(
      buildApiUrl(buildSessionHitlUrl(sessionId, "stream")),
    );
  }
}

export default new HitlService();
