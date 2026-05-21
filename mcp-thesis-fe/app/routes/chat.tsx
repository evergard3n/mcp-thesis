import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { AppSidebar } from "~/components/AppSidebar";
import { SessionView } from "~/components/SessionView";

export default function ChatRoute() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialVague = searchParams.get("vague") ?? undefined;
  const initialDomain = searchParams.get("domain") ?? undefined;
  const initialMaxIterations = searchParams.get("maxIterations")
    ? Number(searchParams.get("maxIterations"))
    : undefined;
  const initialMaxQuestions = searchParams.get("maxQuestions")
    ? Number(searchParams.get("maxQuestions"))
    : undefined;

  useEffect(() => {
    if (!sessionId) {
      navigate("/");
    }
  }, [sessionId, navigate]);

  if (!sessionId) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar sessionId={sessionId} />
      <SessionView
        sessionId={sessionId}
        initialVague={initialVague}
        initialDomain={initialDomain}
        initialMaxIterations={initialMaxIterations}
        initialMaxQuestions={initialMaxQuestions}
      />
    </div>
  );
}
