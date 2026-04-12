import { useEffect, useState } from "react";
import type { FormEvent } from "react";

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

  // Reset answer fields when a new question batch arrives (new iteration)
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
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">
          Questions — iteration {iteration}
        </span>
        <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">
          {questions.length} to answer
        </span>
      </div>

      {questions.map((q, i) => (
        <div key={q.id} className="flex flex-col gap-2 rounded border p-4">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500">
              {i + 1}
            </span>
            <p className="text-sm leading-relaxed text-gray-800">{q.question}</p>
          </div>

          {q.context.step && (
            <span className="self-start rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">
              {q.context.step}
              {q.context.flowId ? ` · ${q.context.flowId}` : ""}
            </span>
          )}

          <p className="text-xs italic text-gray-400">{q.context.whyAsking}</p>

          <textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
            rows={3}
            placeholder={q.answerGuidance}
            disabled={isLoading}
            className="rounded border px-3 py-2 text-sm outline-none focus:border-gray-400"
          />
        </div>
      ))}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {answeredCount}/{questions.length} answered
        </span>
        <button
          type="submit"
          disabled={!allAnswered || isLoading}
          className="rounded bg-black px-5 py-2 text-sm text-white disabled:opacity-40"
        >
          {isLoading ? "Submitting…" : "Submit Answers"}
        </button>
      </div>
    </form>
  );
}
