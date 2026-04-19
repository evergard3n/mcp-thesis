import { useState } from "react";
import type { KeyboardEvent, ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowUp, Loader2, ChevronDown, ChevronUp } from "lucide-react";

import { AppSidebar } from "~/components/AppSidebar";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useCreateSession } from "~/modules/sessions.module";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "HITL Studio" },
    { name: "description", content: "Human-in-the-Loop session workspace" },
  ];
}

const PLACEHOLDERS = [
  "Describe a workflow, process, or use case you want to refine…",
  "e.g. A claims adjuster needs to process an insurance claim…",
  "e.g. An onboarding flow for new enterprise customers…",
  "e.g. A document review pipeline for legal compliance…",
];

export default function Home() {
  const navigate = useNavigate();
  const createSession = useCreateSession();

  const [vague, setVague] = useState("");
  const [domain, setDomain] = useState("");
  const [maxIterations, setMaxIterations] = useState(5);
  const [maxQuestions, setMaxQuestions] = useState(20);
  const [showOptions, setShowOptions] = useState(false);

  const isLoading = createSession.isPending;
  const canSubmit = vague.trim().length > 0 && !isLoading;

  async function handleSubmit() {
    if (!canSubmit) return;
    const result = await createSession.mutateAsync();
    const params = new URLSearchParams({ vague: vague.trim() });
    if (domain.trim()) params.set("domain", domain.trim());
    params.set("maxIterations", String(maxIterations));
    params.set("maxQuestions", String(maxQuestions));
    navigate(`/chat/${result.sessionId}?${params.toString()}`);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex flex-1 flex-col items-center justify-center px-8 py-12">
        <div className="w-full max-w-2xl">
          {/* Heading */}
          <div className="mb-10 space-y-3">
            <h1
              className="text-5xl leading-tight text-foreground"
              style={{ fontFamily: "var(--font-display)" }}
            >
              What are you
              <br />
              <span className="italic text-primary">building?</span>
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Describe a vague use case. The HITL loop will refine it into a
              structured specification through guided questions.
            </p>
          </div>

          {/* Chat input card */}
          <div className="relative rounded-xl border border-border bg-card shadow-lg shadow-black/30">
            <Textarea
              value={vague}
              onChange={(e) => setVague(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDERS[0]}
              disabled={isLoading}
              className="resize-none rounded-xl border-none bg-transparent px-5 pt-5 pb-14 text-sm leading-relaxed shadow-none outline-none ring-0 focus-visible:ring-0 min-h-[120px] max-h-[240px] overflow-y-auto"
            />

            {/* Bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between rounded-b-xl border-t border-border/50 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowOptions((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {showOptions ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Options
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground/50">
                  ↵ to send · ⇧↵ for newline
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:opacity-30"
                >
                  {isLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ArrowUp size={15} />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Options panel */}
          {showOptions && (
            <div className="mt-3 rounded-xl border border-border bg-card p-5">
              <div className="grid grid-cols-3 gap-5">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Domain</span>
                  <Input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="e.g. Insurance"
                    className="h-7 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Max iterations · {maxIterations}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(Number(e.target.value))}
                    className="accent-primary"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Max questions · {maxQuestions}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={maxQuestions}
                    onChange={(e) => setMaxQuestions(Number(e.target.value))}
                    className="accent-primary"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
