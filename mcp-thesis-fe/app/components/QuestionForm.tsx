import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Textarea } from "~/components/ui/textarea";
import type { OpenEndedQuestion } from "~/interfaces/hitl.interface";

interface Answer {
  questionId: string;
  answer: string;
}

interface QuestionFormProps {
  questions: OpenEndedQuestion[];
  iteration: number;
  onSubmit: (answers: Answer[]) => void;
  isLoading: boolean;
}

export function QuestionForm({ questions, iteration, onSubmit, isLoading }: QuestionFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, ""])),
  );

  useEffect(() => {
    setAnswers(Object.fromEntries(questions.map((q) => [q.id, ""])));
  }, [questions]);

  const allAnswered = questions.every((q) => answers[q.id]?.trim().length > 0);
  const answeredCount = questions.filter((q) => answers[q.id]?.trim()).length;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!allAnswered) return;
    onSubmit(questions.map((q) => ({ questionId: q.id, answer: answers[q.id].trim() })));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-medium text-foreground">
          Questions
        </span>
        <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-xs text-primary">
          iteration {iteration}
        </span>
        <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {answeredCount}/{questions.length} answered
        </span>
      </div>

      {questions.map((q, i) => (
        <div
          key={q.id}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
            <p className="text-sm leading-relaxed text-foreground">{q.question}</p>
          </div>

          {q.context.step && (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {q.context.step}
                {q.context.flowId ? ` · ${q.context.flowId}` : ""}
              </span>
            </div>
          )}

          {q.context.whyAsking && (
            <p className="text-xs italic text-muted-foreground/70">{q.context.whyAsking}</p>
          )}

          <Textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
            placeholder={q.answerGuidance}
            disabled={isLoading}
            className="min-h-[80px]"
          />
        </div>
      ))}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!allAnswered || isLoading}
          className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isLoading ? "Submitting…" : "Submit Answers"}
        </button>
      </div>
    </form>
  );
}
