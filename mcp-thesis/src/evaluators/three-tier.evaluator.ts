import { z } from "zod";
import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";

const batchFlowEvalSchema = z.array(
  z.object({
    flowId: z.string(),
    category: z.enum(["grounded", "logical", "hallucination"]),
    score: z.number(),
    reasoning: z.string(),
    inVagueSummary: z.boolean(),
    inDetailedDescription: z.boolean().optional(),
  }),
);

type GroundTruthFlow = GenFlow & { embedding?: number[] };

export function flowToText(flow: GenFlow): string {
  const stepsText = flow.steps
    .map((step) => `${step.actor} ${step.description}`)
    .join(". ");
  const conditionText = flow.condition ? ` ${flow.condition}` : "";
  return `${flow.kind}${conditionText}: ${stepsText}`;
}

async function getGroundTruthEmbeddings(
  groundTruthFlows: GroundTruthFlow[],
): Promise<number[][]> {
  const embeddings: number[][] = new Array(groundTruthFlows.length);
  const missingTexts: string[] = [];
  const missingIndexes: number[] = [];

  groundTruthFlows.forEach((flow, index) => {
    if (flow.embedding && flow.embedding.length > 0) {
      embeddings[index] = flow.embedding;
    } else {
      missingTexts.push(flowToText(flow));
      missingIndexes.push(index);
    }
  });

  if (missingTexts.length > 0) {
    console.warn(
      `Missing ${missingTexts.length} ground truth embeddings; embedding on the fly.`,
    );
    const generated = await semanticService.embedBatch(missingTexts);
    generated.forEach((embedding, idx) => {
      embeddings[missingIndexes[idx]] = embedding;
    });
  }

  return embeddings;
}

interface FlowMatchResult {
  inGroundTruth: boolean;
  isDuplicate: boolean;
  matchedFlowId?: string;
  bestScore: number;
}

async function matchFlowsToGroundTruth(
  generatedFlows: GenFlow[],
  groundTruthFlows: GroundTruthFlow[],
  threshold = 0.6,
): Promise<Map<string, FlowMatchResult>> {
  const matchResults = new Map<string, FlowMatchResult>();

  if (generatedFlows.length === 0 || groundTruthFlows.length === 0) {
    return matchResults;
  }

  const groundTruthEmbeddings =
    await getGroundTruthEmbeddings(groundTruthFlows);
  const generatedTexts = generatedFlows.map(flowToText);
  const generatedEmbeddings = await semanticService.embedBatch(generatedTexts);

  // First pass: compute all best match scores
  const allMatches: {
    genFlowId: string;
    bestGTFlowId: string | undefined;
    bestScore: number;
  }[] = [];

  for (let i = 0; i < generatedFlows.length; i++) {
    let bestScore = -Infinity;
    let bestGTFlowId: string | undefined;

    for (let j = 0; j < groundTruthEmbeddings.length; j++) {
      const score = await semanticService.cosineSimilarity(
        generatedEmbeddings[i],
        groundTruthEmbeddings[j],
      );
      if (score > bestScore) {
        bestScore = score;
        bestGTFlowId = groundTruthFlows[j].id;
      }
    }

    allMatches.push({
      genFlowId: generatedFlows[i].id,
      bestGTFlowId,
      bestScore,
    });
  }

  // Sort by bestScore descending (best matches claim first)
  allMatches.sort((a, b) => b.bestScore - a.bestScore);

  // Second pass: assign claims with deduplication
  const claimedGTFlows = new Set<string>();

  function setMatchResult(
    genFlowId: string,
    result: FlowMatchResult,
  ): void {
    matchResults.set(genFlowId, result);
  }

  for (const match of allMatches) {
    if (match.bestScore < threshold || !match.bestGTFlowId) {
      setMatchResult(match.genFlowId, {
        inGroundTruth: false,
        isDuplicate: false,
        bestScore: match.bestScore,
      });
      continue;
    }

    if (!claimedGTFlows.has(match.bestGTFlowId)) {
      // First to claim this GT flow
      claimedGTFlows.add(match.bestGTFlowId);
      setMatchResult(match.genFlowId, {
        inGroundTruth: true,
        isDuplicate: false,
        matchedFlowId: match.bestGTFlowId,
        bestScore: match.bestScore,
      });
      continue;
    }

    // GT flow already claimed - this is a duplicate
    setMatchResult(match.genFlowId, {
      inGroundTruth: false,
      isDuplicate: true,
      matchedFlowId: match.bestGTFlowId,
      bestScore: match.bestScore,
    });
  }

  return matchResults;
}

export async function evaluateUseCase(
  useCase: GenUseCase,
  context: {
    vagueSummary: string;
    detailedDescription?: string;
    groundTruth: GenUseCase;
    domain: string;
  },
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<{
  totalFlows: number;
  breakdown: {
    grounded: number;
    logical: number;
    hallucinations: number;
    duplicates: number;
  };
  scores: {
    qualityScore: number;
    discoveryRate: number;
    precision: number;
    f1Score: number;
  };
  flowDetails: Array<
    z.infer<typeof batchFlowEvalSchema>[number] & {
      inGroundTruth: boolean;
      isDuplicate: boolean;
      matchedFlowId?: string;
    }
  >;
}> {
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
            `${s.index}. ${s.actor} -> ${s.target || "N/A"}: ${s.description}`,
        )
        .join("; ")}
  `,
    )
    .join("\n---\n");

  const prompt = `
Evaluate ALL flows as GROUNDED (1.0), LOGICAL (0.7), or HALLUCINATION (0.0).

Domain: ${context.domain}
Vague: ${context.vagueSummary}
${context.detailedDescription ? `Detailed: ${context.detailedDescription}` : ""}

Flows to Evaluate:
${flowsDescription}

Rules:
- GROUNDED: Explicitly mentioned in description
- LOGICAL: Not mentioned, but reasonable for domain/actors
- HALLUCINATION: Neither

Return array with evaluation for each flow.
  `;

  const matchResults = await matchFlowsToGroundTruth(
    useCase.flows,
    context.groundTruth.flows,
  );
  const flowEvals = await geminiFunctions.generateStructured({
    prompt,
    schema: batchFlowEvalSchema,
  });

  const flowDetails = flowEvals.map((flowEval) => {
    const match = matchResults.get(flowEval.flowId);
    return {
      ...flowEval,
      inGroundTruth: match?.inGroundTruth ?? false,
      isDuplicate: match?.isDuplicate ?? false,
      matchedFlowId: match?.matchedFlowId,
    };
  });

  // Calculate metrics
  const grounded = flowDetails.filter((f) => f.category === "grounded").length;
  const logical = flowDetails.filter((f) => f.category === "logical").length;
  const hallucinations = flowDetails.filter(
    (f) => f.category === "hallucination",
  ).length;
  const duplicates = flowDetails.filter((f) => f.isDuplicate).length;

  const qualityScore = (grounded * 1.0 + logical * 0.7) / flowDetails.length;
  // Discovery rate = unique GT flows found / total GT flows
  const uniqueGTCovered = flowDetails.filter((f) => f.inGroundTruth).length;
  const discoveryRate = uniqueGTCovered / context.groundTruth.flows.length;
  const precision = (grounded + logical) / flowDetails.length;
  const f1Score =
    (2 * (precision * discoveryRate)) / (precision + discoveryRate);

  return {
    totalFlows: flowDetails.length,
    breakdown: { grounded, logical, hallucinations, duplicates },
    scores: { qualityScore, discoveryRate, precision, f1Score },
    flowDetails,
  };
}
