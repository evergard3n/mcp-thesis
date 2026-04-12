import { useMutation } from "@tanstack/react-query";

import type {
  StartHitlRequest,
  SubmitHitlAnswersRequest,
} from "~/interfaces/hitl.interface";
import hitlService from "~/services/hitl.service";

export const useStartHitl = () =>
  useMutation({
    mutationFn: async ({ sessionId, body }: { sessionId: string; body: StartHitlRequest }) => {
      const response = await hitlService.startHitl(sessionId, body);
      return response.data;
    },
  });

export const useSubmitHitlAnswers = () =>
  useMutation({
    mutationFn: async ({
      sessionId,
      body,
    }: {
      sessionId: string;
      body: SubmitHitlAnswersRequest;
    }) => {
      const response = await hitlService.submitAnswers(sessionId, body);
      return response.data;
    },
  });

export const useCancelHitl = () =>
  useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await hitlService.cancelHitl(sessionId);
      return response.data;
    },
  });

export const createHitlStream = (sessionId: string) =>
  hitlService.createHitlStream(sessionId);
