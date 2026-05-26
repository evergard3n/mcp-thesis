import type { GenFlow, GenUseCase } from "~/interfaces/hitl.interface";

interface UseCaseDisplayProps {
  useCase: GenUseCase;
  badge?: string;
}

export function UseCaseDisplay({ useCase, badge = "Refined Use Case" }: UseCaseDisplayProps) {
  const mainFlow = useCase.flows.find((f) => f.id === "MAIN");
  const otherFlows = useCase.flows.filter((f) => f.id !== "MAIN").sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
      <div>
        <span className="mb-2 inline-block rounded-md bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
          {badge}
        </span>
        <h2
          className="text-xl text-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {useCase.name}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{useCase.summary}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-foreground">
          {useCase.mainActor}
        </span>
        {useCase.actors
          .filter((a) => a !== useCase.mainActor)
          .map((a) => (
            <span
              key={a}
              className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
            >
              {a}
            </span>
          ))}
      </div>

      {mainFlow && <FlowSteps flow={mainFlow} label="Main Flow" variant="main" />}

      {otherFlows.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {otherFlows.length} Alternative / Exception Flow
            {otherFlows.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-col gap-3">
            {otherFlows.map((flow) => (
              <FlowSteps key={flow.id} flow={flow} variant="branch" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface FlowStepsProps {
  flow: GenFlow;
  label?: string;
  variant: "main" | "branch";
}

function FlowSteps({ flow, label, variant }: FlowStepsProps) {
  if (variant === "main") {
    return (
      <div>
        {label && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
        )}
        <ol className="flex flex-col gap-2.5">
          {flow.steps.map((step) => (
            <li key={step.index} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs text-primary">
                {step.index}
              </span>
              <span className="leading-relaxed text-foreground">
                <strong className="font-medium">{step.actor}</strong>
                {step.target ? (
                  <span className="text-muted-foreground"> → {step.target}</span>
                ) : null}
                {": "}
                <span className="text-muted-foreground">{step.description}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-l-2 border-border bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2 text-xs">
        <code className="font-mono font-semibold text-foreground">{flow.id}</code>
        {flow.condition && (
          <span className="text-muted-foreground">· {flow.condition}</span>
        )}
      </div>
      <ol className="mt-2.5 flex flex-col gap-1.5">
        {flow.steps.map((step) => (
          <li key={step.index} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono text-muted-foreground/50">{step.index}.</span>
            <span>
              <strong className="font-medium text-foreground">{step.actor}</strong>
              {step.target ? ` → ${step.target}` : ""}: {step.description}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
