import { useCallback, useEffect, useRef, useState } from "react";

import type {
  HitlState,
  HitlStreamEvent,
  OpenEndedQuestion,
  StartHitlRequest,
} from "~/interfaces/hitl.interface";
import {
  createHitlStream,
  useCancelHitl,
  useStartHitl,
  useSubmitHitlAnswers,
} from "~/modules/hitl.module";
import { useGetSessionState } from "~/modules/sessions.module";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export interface PendingQuestions {
  iteration: number;
  questions: OpenEndedQuestion[];
}

export interface UseHITLSessionReturn {
  state: HitlState | null;
  connectionStatus: ConnectionStatus;
  pendingQuestions: PendingQuestions | null;
  statusMessage: string;
  isStarting: boolean;
  isSubmitting: boolean;
  isCancelling: boolean;
  start: (body: StartHitlRequest) => void;
  submitAnswers: (answers: Array<{ questionId: string; answer: string }>) => void;
  cancel: () => void;
}

function pendingQuestionsFromState(state: HitlState): PendingQuestions | null {
  if (state.status === "WAITING_FOR_ANSWERS" && state.lastQuestions?.length) {
    return { iteration: state.iterationCount, questions: state.lastQuestions };
  }
  return null;
}

export function useHITLSession(sessionId: string): UseHITLSessionReturn {
  const [state, setState] = useState<HitlState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestions | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  // Stable refs so callbacks don't cause effect re-runs
  const startMutation = useStartHitl();
  const submitMutation = useSubmitHitlAnswers();
  const cancelMutation = useCancelHitl();
  const startMutateRef = useRef(startMutation.mutate);
  const submitMutateRef = useRef(submitMutation.mutate);
  const cancelMutateRef = useRef(cancelMutation.mutate);
  startMutateRef.current = startMutation.mutate;
  submitMutateRef.current = submitMutation.mutate;
  cancelMutateRef.current = cancelMutation.mutate;

  // Seed initial state from REST — handles reconnect/page reload.
  // Guard on `state !== null` so SSE state always takes precedence.
  const stateQuery = useGetSessionState(sessionId);
  useEffect(() => {
    if (!stateQuery.data || state !== null) return;
    setState(stateQuery.data);
    setPendingQuestions(pendingQuestionsFromState(stateQuery.data));
  }, [stateQuery.data, state]);

  // SSE subscription — must be open before POST /hitl/start fires
  useEffect(() => {
    if (!sessionId) return;

    setConnectionStatus("connecting");
    let intentionallyClosed = false;

    const stream = createHitlStream(sessionId);

    stream.onopen = () => setConnectionStatus("connected");

    // Connection-level errors (network drop, server restart, etc.)
    stream.onerror = () => {
      if (!intentionallyClosed) setConnectionStatus("disconnected");
    };

    const handleEvent = (raw: Event) => {
      const data = (raw as MessageEvent<string>).data;
      if (!data) return;

      let event: HitlStreamEvent;
      try {
        event = JSON.parse(data) as HitlStreamEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "state":
          setState(event.state);
          setPendingQuestions(pendingQuestionsFromState(event.state));
          break;

        case "status_change":
          setState(event.state);
          setStatusMessage(event.message);
          if (event.status !== "WAITING_FOR_ANSWERS") setPendingQuestions(null);
          break;

        case "questions":
          setState(event.state);
          setPendingQuestions({ iteration: event.iteration, questions: event.questions });
          break;

        case "done":
          setState(event.state);
          setPendingQuestions(null);
          intentionallyClosed = true;
          stream.close();
          setConnectionStatus("disconnected");
          break;

        case "error":
          setState(event.state);
          intentionallyClosed = true;
          stream.close();
          setConnectionStatus("disconnected");
          break;
      }
    };

    stream.addEventListener("state", handleEvent);
    stream.addEventListener("status_change", handleEvent);
    stream.addEventListener("questions", handleEvent);
    stream.addEventListener("done", handleEvent);
    // Named server "error" event — distinct from the connection-level stream.onerror
    stream.addEventListener("error", handleEvent);

    return () => {
      intentionallyClosed = true;
      stream.close();
    };
  }, [sessionId]);

  const start = useCallback((body: StartHitlRequest) => {
    startMutateRef.current({ sessionId, body });
  }, [sessionId]);

  const submitAnswers = useCallback(
    (answers: Array<{ questionId: string; answer: string }>) => {
      submitMutateRef.current(
        { sessionId, body: { answers } },
        { onSuccess: () => setPendingQuestions(null) },
      );
    },
    [sessionId],
  );

  const cancel = useCallback(() => {
    cancelMutateRef.current(sessionId, {
      onSuccess: (data) => {
        setState(data.state);
        setPendingQuestions(null);
        setStatusMessage("");
      },
    });
  }, [sessionId]);

  return {
    state,
    connectionStatus,
    pendingQuestions,
    statusMessage,
    isStarting: startMutation.isPending,
    isSubmitting: submitMutation.isPending,
    isCancelling: cancelMutation.isPending,
    start,
    submitAnswers,
    cancel,
  };
}
