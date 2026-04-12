import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { FormEvent } from "react";

import { createHitlStream, useStartHitl } from "~/modules/hitl.module";
import {
  useCreateSession,
  useGetSessionState,
} from "~/modules/sessions.module";

type StreamMessage = {
  id: string;
  label: string;
  payload: string;
};

export default function ChatRoute() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [vague, setVague] = useState("");
  const [streamMessages, setStreamMessages] = useState<StreamMessage[]>([]);

  const createSessionMutation = useCreateSession();
  const startHitlMutation = useStartHitl();
  const stateQuery = useGetSessionState(sessionId);

  useEffect(() => {
    if (sessionId) {
      return;
    }

    createSessionMutation.mutate(undefined, {
      onSuccess: (data) => {
        navigate(`/chat/${data.sessionId}`, { replace: true });
      },
    });
  }, [createSessionMutation, navigate, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const stream = createHitlStream(sessionId);

    const pushMessage = (label: string, payload: string) => {
      setStreamMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random()}`,
          label,
          payload,
        },
      ]);
    };

    stream.onopen = () => pushMessage("stream", "connected");
    stream.onerror = () => pushMessage("stream", "connection error");
    stream.addEventListener("state", (event) => {
      const messageEvent = event as MessageEvent<string>;
      pushMessage("state", messageEvent.data);
    });
    stream.addEventListener("status_change", (event) => {
      const messageEvent = event as MessageEvent<string>;
      pushMessage("status_change", messageEvent.data);
    });
    stream.addEventListener("questions", (event) => {
      const messageEvent = event as MessageEvent<string>;
      pushMessage("questions", messageEvent.data);
    });
    stream.addEventListener("done", (event) => {
      const messageEvent = event as MessageEvent<string>;
      pushMessage("done", messageEvent.data);
      stream.close();
    });
    stream.addEventListener("error", (event) => {
      const messageEvent = event as MessageEvent<string>;
      pushMessage("error", messageEvent.data);
      stream.close();
    });

    return () => {
      stream.close();
    };
  }, [sessionId]);

  const summary = useMemo(() => {
    if (!stateQuery.data) {
      return "No state loaded yet.";
    }

    return `status=${stateQuery.data.status}, iteration=${stateQuery.data.iterationCount}/${stateQuery.data.maxIterations}, questions=${stateQuery.data.totalQuestionsAsked}/${stateQuery.data.maxQuestions}`;
  }, [stateQuery.data]);

  const handleStart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!sessionId || !vague.trim()) {
      return;
    }

    startHitlMutation.mutate({
      sessionId,
      body: { vague: vague.trim() },
    });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">HITL Chat Demo</h1>
      <p className="text-sm text-gray-600">Session: {sessionId ?? "creating..."}</p>
      <p className="text-sm text-gray-600">{summary}</p>

      <form onSubmit={handleStart} className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="Describe your vague use case..."
          value={vague}
          onChange={(event) => setVague(event.target.value)}
        />
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          disabled={!sessionId || startHitlMutation.isPending}
        >
          Start
        </button>
      </form>

      {stateQuery.isError && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Session not found or unavailable. Create a new session by opening `/chat`.
        </p>
      )}

      <section className="flex flex-col gap-2 rounded border p-4">
        <h2 className="font-medium">Stream log</h2>
        <div className="max-h-96 overflow-auto space-y-2">
          {streamMessages.map((message) => (
            <article key={message.id} className="rounded bg-gray-50 p-2 text-sm">
              <p className="font-semibold">{message.label}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap">{message.payload}</pre>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
