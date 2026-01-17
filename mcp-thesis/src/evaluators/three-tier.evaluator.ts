import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import { z } from "zod";

const batchFlowEvalSchema = z.array(
  z.object({
    flowId: z.string(),
    category: z.enum(["grounded", "logical", "hallucination"]),
    score: z.number(),
    reasoning: z.string(),
    inVagueSummary: z.boolean(),
    inDetailedDescription: z.boolean().optional(),
    inGroundTruth: z.boolean(),
    matchedGroundTruthFlowId: z
      .string()
      .optional()
      .describe(
        "The ID of the semantically matching ground truth flow, if any"
      ),
  })
);

export async function evaluateUseCase(
  useCase: GenUseCase,
  context: {
    vagueSummary: string;
    detailedDescription?: string;
    groundTruth: GenUseCase;
    domain: string;
  },
  geminiFunctions: GeminiOpenRouterFunctions
) {
  // Build single prompt with all flows
  const flowsDescription = useCase.flows
    .map(
      (flow) => `
Flow ID: ${flow.id}
Kind: ${flow.kind}
Condition: ${flow.condition || "Main"}
Steps: ${flow.steps
        .map(
          (s) =>
            `${s.index}. ${s.actor} -> ${s.target || "N/A"}: ${s.description}`
        )
        .join("; ")}
  `
    )
    .join("\n---\n");

  const prompt = `
Evaluate ALL flows as GROUNDED (1.0), LOGICAL (0.7), or HALLUCINATION (0.0).

Domain: ${context.domain}
Vague: ${context.vagueSummary}
${context.detailedDescription ? `Detailed: ${context.detailedDescription}` : ""}

Ground Truth Flows: ${context.groundTruth.flows.map((f) => f.id).join(", ")}

Flows to Evaluate:
${flowsDescription}

Rules:
- GROUNDED: Explicitly mentioned in description
- LOGICAL: Not mentioned, but reasonable for domain/actors
- HALLUCINATION: Neither

For each flow, also check if it exists in ground truth.

Return array with evaluation for each flow.
  `;

  const flowEvals = await geminiFunctions.generateStructured({
    prompt,
    schema: batchFlowEvalSchema,
  });

  // Calculate metrics
  const grounded = flowEvals.filter((f) => f.category === "grounded").length;
  const logical = flowEvals.filter((f) => f.category === "logical").length;
  const hallucinations = flowEvals.filter(
    (f) => f.category === "hallucination"
  ).length;

  const qualityScore = (grounded * 1.0 + logical * 0.7) / flowEvals.length;
  const discoveryRate =
    flowEvals.filter((f) => f.inGroundTruth).length /
    context.groundTruth.flows.length;
  const precision = (grounded + logical) / flowEvals.length;
  const f1Score =
    (2 * (precision * discoveryRate)) / (precision + discoveryRate);

  return {
    totalFlows: flowEvals.length,
    breakdown: { grounded, logical, hallucinations },
    scores: { qualityScore, discoveryRate, precision, f1Score },
    flowDetails: flowEvals,
  };
}
