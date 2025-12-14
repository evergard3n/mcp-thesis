import { z } from "zod";
import {
  genStepSchema,
  GenStep,
  genUseCaseSchema,
  GenUseCaseSchemaType,
} from "../schemas/genusecase.schema.js";
import { UseCase, Step } from "../interfaces/usecase.interface.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";

// Zod schema for GenStep validation

export function convertToFRSL(input: unknown): UseCase {
  // Parse + validate the external input using the Zod schema. Accepting
  // `unknown` here makes the contract explicit: callers may pass raw JSON
  // (from an LLM or HTTP) and this function will validate and convert it.
  let genUseCase: GenUseCaseSchemaType;
  try {
    genUseCase = genUseCaseSchema.parse(input);
  } catch (err) {
    throw new Error(`Invalid GenUseCase provided to convertToFRSL: ${err}`);
  }
  const steps: Step[] = [];
  const stepIdMap = new Map<string, Step>();
  let stepCounter = 1;

  // Helper function to generate unique step ID
  const generateStepId = (prefix: string) => `${prefix}_${stepCounter++}`;

  // Helper function to create Step from GenStep
  const createStep = (
    genStep: GenStep,
    flowKind: string,
    stepId?: string
  ): Step => {
    // Validate the GenStep using Zod to ensure schema conformance
    genStepSchema.parse(genStep);

    const id = stepId || generateStepId(flowKind.toLowerCase());

    // Defensive defaults for optional fields to avoid runtime crashes if a
    // field is missing even after validation (defense-in-depth).
    const actor = genStep.actor || "unknown";
    const description = genStep.description || "";
    const to = genStep.target || actor;

    // Use a relaxed type here so we can attach small metadata (original index)
    const step: Step & any = {
      id,
      type: String(actor).toLowerCase() === "system" ? "system" : "action",
      actor,
      description,
      from: actor,
      to,
      // preserve original GenStep.index for traceability in the FRSL output
      meta: {
        genIndex: typeof genStep.index === "number" ? genStep.index : null,
      },
    };
    return step as Step;
  };

  // Helper to create a shallow clone of a step for embedding as a child
  // We intentionally drop nested `loop` and `alt` properties to avoid
  // creating circular references while preserving step details.
  const cloneStepForEmbed = (s: Step): Step => {
    const copy: any = { ...s };
    // Remove nested containers to avoid cycles when this copy is embedded
    if (copy.loop) delete copy.loop;
    if (copy.alt) delete copy.alt;
    return copy as Step;
  };

  // Process MAIN flow first
  const mainFlow = genUseCase.flows.find((f) => f.kind === "MAIN");
  if (!mainFlow) {
    throw new Error("Main flow is required in GenUseCase");
  }

  let prevStep: Step | null = null;
  const mainSteps: Step[] = [];

  // Convert main flow steps
  mainFlow.steps.forEach((genStep, idx) => {
    const step = createStep(genStep, "MAIN", `main_${idx + 1}`);

    if (prevStep) {
      prevStep.nextStepId = step.id;
      step.prevStepId = prevStep.id;
    }

    mainSteps.push(step);
    stepIdMap.set(step.id, step);
    prevStep = step;
  });

  // Process loops in main flow
  if (genUseCase.loops && genUseCase.loops.length > 0) {
    genUseCase.loops.forEach((loop) => {
      if (loop.flowRef === "MAIN") {
        // Find steps in the loop range
        const loopSteps = mainSteps.filter((step) => {
          const stepIndex = parseInt(step.id.split("_")[1]);
          return stepIndex >= loop.startIndex && stepIndex <= loop.endIndex;
        });

        if (loopSteps.length > 0) {
          const firstLoopStep = loopSteps[0];
          const lastLoopStep = loopSteps[loopSteps.length - 1];

          // Add loop structure to the first step in the loop
          const loopContainerStep = mainSteps.find(
            (s) => s.id === firstLoopStep.id
          );
          if (loopContainerStep) {
            loopContainerStep.loop = {
              condition: loop.condition,
              // embed shallow clones of each step so consumers can see
              // full step objects without creating cycles to the parent
              steps: loopSteps.map(cloneStepForEmbed),
            };
          }
        }
      }
    });
  }

  // Process alternative and exception flows
  const altFlows = genUseCase.flows.filter(
    (f) => f.kind === "ALTERNATIVE" || f.kind === "EXCEPTION"
  );

  altFlows.forEach((flow, flowIdx) => {
    // Find the branch point in main flow
    const branchPointIndex = flow.fromStepIndex;
    if (!branchPointIndex) return;

    const branchPointStep = mainSteps.find((s) => {
      const stepIndex = parseInt(s.id.split("_")[1]);
      return stepIndex === branchPointIndex;
    });

    if (!branchPointStep) return;

    // Create alternative steps
    const altSteps: Step[] = [];
    let altPrevStep: Step | null = null;

    flow.steps.forEach((genStep, idx) => {
      const step = createStep(
        genStep,
        flow.kind,
        `${flow.kind.toLowerCase()}_${flowIdx + 1}_${idx + 1}`
      );

      if (altPrevStep) {
        altPrevStep.nextStepId = step.id;
        step.prevStepId = altPrevStep.id;
      }

      altSteps.push(step);
      stepIdMap.set(step.id, step);
      altPrevStep = step;
    });

    // Add alt structure to branch point
    if (!branchPointStep.alt) {
      branchPointStep.alt = {
        condition: flow.condition || "Alternative condition",
        ifSteps: flow.kind === "EXCEPTION" ? altSteps : [],
        elseSteps: flow.kind === "ALTERNATIVE" ? altSteps : undefined,
      };
    } else {
      // If alt already exists, add to elseSteps
      if (flow.kind === "ALTERNATIVE") {
        branchPointStep.alt.elseSteps = altSteps;
      }
    }

    steps.push(...altSteps);
  });

  // Add all main steps to final steps array
  steps.push(...mainSteps);

  // Build final UseCase
  const useCase: UseCase = {
    id: genUseCase.name.toLowerCase().replace(/\s+/g, "_"),
    name: genUseCase.name,
    description: genUseCase.summary,
    mainActor: genUseCase.mainActor,
    actors: genUseCase.actors,
    firstStepId: mainSteps[0]?.id,
    steps: steps,
  };

  return useCase;
}
