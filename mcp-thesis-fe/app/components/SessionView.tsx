import { useHITLSession } from "~/hooks/useHITLSession";
import { RUNNING_STATUSES } from "~/consts/hitl";
import { ConnectionBadge } from "~/components/ConnectionBadge";
import { StateSummary } from "~/components/StateSummary";
import { StartForm } from "~/components/StartForm";
import { QuestionForm } from "~/components/QuestionForm";
import { UseCaseDisplay } from "~/components/UseCaseDisplay";
import { Spinner } from "~/components/Spinner";

interface SessionViewProps {
  sessionId: string;
}

export function SessionView({ sessionId }: SessionViewProps) {
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

  const isIdle = state === null || state.status === "IDLE";
  const isRunning = state !== null && RUNNING_STATUSES.includes(state.status);
  const isDone = state?.status === "DONE";
  const isError = state?.status === "ERROR";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">HITL Session</h1>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{sessionId}</p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge status={connectionStatus} />
          {isRunning && (
            <button
              onClick={cancel}
              disabled={isCancelling}
              className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600 disabled:opacity-50"
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      {state && <StateSummary state={state} message={statusMessage} />}

      {isIdle && <StartForm onSubmit={start} isLoading={isStarting} />}

      {isRunning && !pendingQuestions && (
        <div className="flex items-center gap-2 rounded border bg-gray-50 p-4 text-sm text-gray-500">
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

      {isDone && state.currentUseCase && (
        <UseCaseDisplay useCase={state.currentUseCase} />
      )}

      {isError && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Loop error:</strong> {state.error ?? "Unknown error"}
        </div>
      )}
    </main>
  );
}
