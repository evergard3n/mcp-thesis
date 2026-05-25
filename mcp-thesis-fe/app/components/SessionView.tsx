import { useEffect, useRef } from "react";

import { useHITLSession } from "~/hooks/useHITLSession";
import { RUNNING_STATUSES } from "~/consts/hitl";
import { ConnectionBadge } from "~/components/ConnectionBadge";
import { StateSummary } from "~/components/StateSummary";
import { StartForm } from "~/components/StartForm";
import { QuestionForm } from "~/components/QuestionForm";
import { UseCaseDisplay } from "~/components/UseCaseDisplay";
import { Spinner } from "~/components/Spinner";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";

interface SessionViewProps {
  sessionId: string;
  initialVague?: string;
  initialDomain?: string;
  initialMaxIterations?: number;
  initialMaxQuestions?: number;
}

export function SessionView({
  sessionId,
  initialVague,
  initialDomain,
  initialMaxIterations,
  initialMaxQuestions,
}: SessionViewProps) {
  const {
    state,
    connectionStatus,
    pendingQuestions,
    statusMessage,
    isStarting,
    isSubmitting,
    isCancelling,
    start,
    submitAnswers,
    cancel,
  } = useHITLSession(sessionId);

  const hasAutoStarted = useRef(false);

  const navigate = useNavigate();

  const isIdle = state === null || state.status === "IDLE";
  const sessionIsIdle = state !== null && state.status === "IDLE";
  const isRunning = state !== null && RUNNING_STATUSES.includes(state.status);
  const isDone = state?.status === "DONE";
  const isError = state?.status === "ERROR";

  // Show split layout once the loop is active (not idle)
  const isActive = state !== null && state.status !== "IDLE";

  function onCancel() {
    cancel();
    navigate("/");
  }

  // Auto-start when navigated from home with an initial vague description
  useEffect(() => {
    if (initialVague && sessionIsIdle && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      start({
        vague: initialVague,
        domain: initialDomain,
        maxIterations: initialMaxIterations ?? 5,
        maxQuestions: initialMaxQuestions ?? 20,
      });
    }
  }, [
    initialVague,
    sessionIsIdle,
    start,
    initialDomain,
    initialMaxIterations,
    initialMaxQuestions,
  ]);

  const showStartForm = isIdle && !initialVague && !hasAutoStarted.current;
  const showAutoStarting =
    (isIdle && initialVague && state !== null) ||
    (initialVague && state === null);

  // Label for the use case badge in the left panel
  const useCaseBadge = isDone
    ? "Final Use Case"
    : state && state.iterationCount > 0
      ? `Draft · Iteration ${state.iterationCount}`
      : "Baseline";

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Header — always full width */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-background/80 px-8 py-4 backdrop-blur-sm">
        <div>
          <h1
            className="text-lg text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            HITL Session
          </h1>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/60">{sessionId}</p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge status={connectionStatus} />
          {(isRunning || isError) && (
            <button
              onClick={onCancel}
              disabled={isCancelling}
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          )}
          {
            isDone && (
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                Return to Home
              </Button>
            )
          }
          {state?.status}
        </div>
      </div>

      {/* Body */}
      {isActive ? (
        /* ── Two-column split ── */
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT: live use case */}
          <div className="flex flex-1 flex-col overflow-y-auto border-r border-border">
            {state.currentUseCase ? (
              <div className="px-8 py-6">
                <UseCaseDisplay useCase={state.currentUseCase} badge={useCaseBadge} />
              </div>
            ) : (
              /* Baseline not yet generated */
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Spinner className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Generating baseline…</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Building an initial use case from your description.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: interaction panel */}
          <div className="flex w-[420px] shrink-0 flex-col gap-5 overflow-y-auto px-6 py-6">
            {state && <StateSummary state={state} message={statusMessage} />}

            {isRunning && !pendingQuestions && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
                <Spinner />
                {statusMessage || "Processing…"}
              </div>
            )}

            {pendingQuestions && (
              <QuestionForm
                questions={pendingQuestions.questions}
                iteration={pendingQuestions.iteration}
                onSubmit={submitAnswers}
                isLoading={isSubmitting}
              />
            )}

            {isDone && (
              <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
                Loop complete. See the refined use case on the left.
              </div>
            )}

            {isError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
                <strong className="font-medium">Loop error:</strong>{" "}
                {state.error ?? "Unknown error"}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Single column (idle / starting) ── */
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-8 py-8">
            {showAutoStarting && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
                <Spinner />
                <span>Initialising session…</span>
              </div>
            )}

            {initialVague && isStarting && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
                <Spinner />
                Starting loop with your description…
              </div>
            )}

            {showStartForm && <StartForm onSubmit={start} isLoading={isStarting} />}
          </div>
        </div>
      )}
    </main>
  );
}
