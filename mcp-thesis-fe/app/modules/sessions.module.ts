import { useMutation, useQuery } from "@tanstack/react-query";

import queryKeys from "~/consts/queryKeys";
import sessionService from "~/services/session.service";

export const useGetSessionState = (sessionId?: string) =>
  useQuery({
    queryKey: [queryKeys.sessionState, sessionId],
    queryFn: async ({ signal }) => {
      const response = await sessionService.getSessionState(String(sessionId), {
        signal,
      });
      return response.data;
    },
    enabled: Boolean(sessionId),
    refetchOnMount: true,
  });

export const useCreateSession = () =>
  useMutation({
    mutationFn: async () => {
      const response = await sessionService.createSession();
      console.log("response", response);
      return response.data;
    },
  });

export const useDeleteSession = () =>
  useMutation({
    mutationFn: async (sessionId: string) => {
      await sessionService.deleteSession(sessionId);
    },
  });
