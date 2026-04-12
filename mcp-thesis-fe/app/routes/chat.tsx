import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";

import { useCreateSession } from "~/modules/sessions.module";
import { SessionView } from "~/components/SessionView";

export default function ChatRoute() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const createSession = useCreateSession();
  const hasCreatedRef = useRef(false);

  /**
   * Create a session exactly once on mount when no sessionId is in the URL.
   * Intentionally empty dep array — useMutation returns a new object on every
   * state change, so including it would re-fire the mutation on each render.
   */
  useEffect(() => {
    if (sessionId || hasCreatedRef.current) return;
    hasCreatedRef.current = true;
    createSession.mutate(undefined, {
      onSuccess: (data) => navigate(`/chat/${data.sessionId}`, { replace: true }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {createSession.isError ? (
          <p className="text-sm text-red-600">
            Failed to create session. Is the backend running at{" "}
            <code>localhost:3006</code>?
          </p>
        ) : (
          <p className="text-sm text-gray-500">Creating session…</p>
        )}
      </div>
    );
  }

  return <SessionView sessionId={sessionId} />;
}
