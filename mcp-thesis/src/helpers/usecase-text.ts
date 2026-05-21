import {
  GenFlow,
  GenStep,
  GenUseCase,
} from "../interfaces/usecase.interface.new.js";

interface BranchEntryDescriptionOptions {
  fallbackParentFlowLabel?: string;
}

export function stepToSentenceText(step: GenStep): string {
  return `${step.actor} ${step.description}`;
}

export function stepToColonText(step: GenStep): string {
  return `${step.actor}: ${step.description}`;
}

export function stepToSummaryLine(step: GenStep): string {
  return `Step ${step.index}: ${step.actor} — "${step.description}"`;
}

export function describeBranchEntry(
  useCase: GenUseCase,
  flow: GenFlow,
  options: BranchEntryDescriptionOptions = {},
): string {
  const { fallbackParentFlowLabel = "the main flow" } = options;

  let anchorContext = "";
  if (flow.parentFlow && flow.fromStepIndex !== undefined) {
    const parentFlow = useCase.flows.find((candidate) => candidate.id === flow.parentFlow);
    const anchorStep = parentFlow?.steps.find(
      (step) => step.index === flow.fromStepIndex,
    );
    if (anchorStep) {
      anchorContext = ` It branches off from ${flow.parentFlow} step ${flow.fromStepIndex} where ${anchorStep.actor} performs: "${anchorStep.description}".`;
    } else {
      anchorContext = ` It branches off from ${flow.parentFlow ?? fallbackParentFlowLabel} step ${flow.fromStepIndex}.`;
    }
  }

  let firstStepContext = "";
  const firstStep = flow.steps.find((step) => step.index === 1) ?? flow.steps[0];
  if (firstStep) {
    firstStepContext = ` The first step of this branch is: "${stepToSentenceText(firstStep)}".`;
  }

  return `${anchorContext}${firstStepContext}`;
}

export function collectUseCaseText(
  useCase: GenUseCase,
  originalDescription: string,
): string {
  const flowBits = useCase.flows.flatMap((flow) => [
    flow.id,
    flow.condition ?? "",
    ...flow.steps.map(stepToSentenceText),
  ]);

  return [
    useCase.name,
    useCase.summary,
    originalDescription,
    ...(useCase.actors ?? []),
    ...flowBits,
  ]
    .join(" ")
    .toLowerCase();
}

export function flowToSentenceText(flow: GenFlow): string {
  const stepsText = flow.steps.map(stepToSentenceText).join(". ");
  const conditionText = flow.condition ? ` ${flow.condition}` : "";
  return `${flow.kind}${conditionText}: ${stepsText}`;
}

export function flowToPipeText(flow: GenFlow): string {
  const parts: string[] = [flow.kind];
  if (flow.condition) parts.push(flow.condition);
  parts.push(...flow.steps.map(stepToColonText));
  return parts.join(" | ");
}