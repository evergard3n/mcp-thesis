import type { Step } from "../interfaces/usecase.interface.js";
import { UseCase } from "../interfaces/usecase.interface.js";
import { JsonProjectStore } from "../stores/projectStore.js";

export function isContain<T>(arrayA: T[], arrayB: T[]): boolean {
  const setA = new Set(arrayA);

  return arrayB.every((bElement) => {
    return setA.has(bElement);
  });
}

export async function useCaseToUML(
  useCase: UseCase,
  projectStore: JsonProjectStore
): Promise<string> {
  projectStore.log(`Converting use case to UML: ${JSON.stringify(useCase)}`);
  const actors = await projectStore.getAllActors();

  const actorsMap = new Map(
    actors.map((actor) => [actor.actor_id, actor.name])
  );

  const mainActor = actorsMap.get(useCase.mainActor);

  const participants = useCase.actors
    .filter((actor) => actor !== mainActor)
    .map((actor) => actorsMap.get(actor));

  const steps = useCase.steps.map((step) => {
    projectStore.log(`Extracting actions from step: ${JSON.stringify(step)}`);
    return recursiveExtractActions(step, actorsMap);
  });

  return `@startuml\n
  actor ${mainActor}\n
  ${participants.map((p) => `participant ${p}`).join("\n")}\n
  ${steps.join("\n")}
  \n@enduml`;
}

function recursiveExtractActions(
  step: Step,
  actorsMap: Map<string, string>
): string {
  if (step.from && step.to) {
    // action node
    return `${actorsMap.get(step.from)} ${
      step.type === "system" ? "-->" : "->"
    } ${actorsMap.get(step.to)}: ${step.description}`;
  }

  // control blocks
  if (step.alt) {
    let result = `alt ${step.alt.condition || ""}\n${step.alt.ifSteps
      .map((s) => indent(recursiveExtractActions(s, actorsMap)))
      .join("\n")}`;
    if (step.alt.elseSteps && step.alt.elseSteps.length > 0) {
      result += `\nelse\n${step.alt.elseSteps
        .map((s) => indent(recursiveExtractActions(s, actorsMap)))
        .join("\n")}`;
    }
    result += `\nend`;
    return result;
  }
  if (step.loop) {
    return `loop ${step.loop.condition}\n${step.loop.steps
      .map((s) => indent(recursiveExtractActions(s, actorsMap)))
      .join("\n")}\nend`;
  }

  return "";
}

function indent(text: string, spaces = 2): string {
  return text
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n");
}

