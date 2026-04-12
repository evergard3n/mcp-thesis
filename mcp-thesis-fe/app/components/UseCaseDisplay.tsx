import type { GenFlow, GenUseCase } from "~/interfaces/hitl.interface";

interface UseCaseDisplayProps {
  useCase: GenUseCase;
}

export function UseCaseDisplay({ useCase }: UseCaseDisplayProps) {
  const mainFlow = useCase.flows.find((f) => f.id === "MAIN");
  const otherFlows = useCase.flows.filter((f) => f.id !== "MAIN");

  return (
    <div className="flex flex-col gap-4 rounded border p-4">
      <div>
        <span className="mb-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
          Refined Use Case
        </span>
        <h2 className="text-base font-semibold text-gray-900">{useCase.name}</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{useCase.summary}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          Main actor: {useCase.mainActor}
        </span>
        {useCase.actors
          .filter((a) => a !== useCase.mainActor)
          .map((a) => (
            <span key={a} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {a}
            </span>
          ))}
      </div>

      {mainFlow && <FlowSteps flow={mainFlow} label="Main Flow" variant="main" />}

      {otherFlows.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {label}
          </p>
        )}
        <ol className="flex flex-col gap-2">
          {flow.steps.map((step) => (
            <li key={step.index} className="flex items-start gap-3 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-500">
                {step.index}
              </span>
              <span className="leading-relaxed text-gray-700">
                <strong>{step.actor}</strong>
                {step.target ? ` → ${step.target}: ` : ": "}
                {step.description}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="rounded border-l-2 border-gray-300 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <code className="font-mono font-semibold text-gray-600">{flow.id}</code>
        {flow.condition && <span className="text-gray-400">· {flow.condition}</span>}
      </div>
      <ol className="mt-2 flex flex-col gap-1">
        {flow.steps.map((step) => (
          <li key={step.index} className="flex items-start gap-2 text-xs text-gray-600">
            <span className="shrink-0 font-mono text-gray-400">{step.index}.</span>
            <span>
              <strong>{step.actor}</strong>
              {step.target ? ` → ${step.target}` : ""}: {step.description}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
