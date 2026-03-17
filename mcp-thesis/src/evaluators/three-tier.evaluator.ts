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

type BranchInferenceContext = {
  mainSteps: GenFlow["steps"];
  mainStepEmbeddings: number[][];
  actorToStepIndexes: Map<string, number[]>;
};

async function inferBranchStepIndex(
  flow: GenFlow,
  context: BranchInferenceContext,
): Promise<number | null> {
  if (flow.kind === "MAIN") return null;
  const firstStep = flow.steps[0];
  if (!firstStep) return null;

  const actorKey = firstStep.actor.toLowerCase().trim();
  const candidateIndexes = context.actorToStepIndexes.get(actorKey) ?? [];
  if (candidateIndexes.length === 0) return null;
  if (candidateIndexes.length === 1) return candidateIndexes[0];

  const flowText = flowToText(flow);
  const [flowEmbedding] = await semanticService.embedBatch([flowText]);
  let bestScore = -Infinity;
  let bestIndex: number | null = null;

  for (const index of candidateIndexes) {
    const mainStepEmbedding = context.mainStepEmbeddings[index - 1];
    if (!mainStepEmbedding) continue;
    const score = await semanticService.cosineSimilarity(
      flowEmbedding,
      mainStepEmbedding,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

async function buildBranchInferenceContext(
  mainFlow: GenFlow,
): Promise<BranchInferenceContext> {
  const mainStepTexts = mainFlow.steps.map(
    (step) => `${step.actor} ${step.description}`,
  );
  const mainStepEmbeddings = await semanticService.embedBatch(mainStepTexts);
  const actorToStepIndexes = new Map<string, number[]>();

  for (const step of mainFlow.steps) {
    const actorKey = step.actor.toLowerCase().trim();
    const existing = actorToStepIndexes.get(actorKey) ?? [];
    existing.push(step.index);
    actorToStepIndexes.set(actorKey, existing);
  }

  return {
    mainSteps: mainFlow.steps,
    mainStepEmbeddings,
    actorToStepIndexes,
  };
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
  const duplicateThreshold = 0.75;

  if (generatedFlows.length === 0 || groundTruthFlows.length === 0) {
    return matchResults;
  }

  const groundTruthMain = groundTruthFlows.find((flow) => flow.id === "MAIN");
  const branchContext = groundTruthMain
    ? await buildBranchInferenceContext(groundTruthMain)
    : null;

  const groundTruthEmbeddings =
    await getGroundTruthEmbeddings(groundTruthFlows);
  const generatedTexts = generatedFlows.map(flowToText);
  const generatedEmbeddings = await semanticService.embedBatch(generatedTexts);

  const groundTruthBranchIndexes: Array<number | null> = [];
  const generatedBranchIndexes: Array<number | null> = [];

  for (const flow of groundTruthFlows) {
    if (!branchContext) {
      groundTruthBranchIndexes.push(null);
      continue;
    }
    const inferred = await inferBranchStepIndex(flow, branchContext);
    groundTruthBranchIndexes.push(inferred);
  }

  for (const flow of generatedFlows) {
    if (typeof flow.fromStepIndex === "number") {
      generatedBranchIndexes.push(flow.fromStepIndex);
      continue;
    }
    if (!branchContext) {
      generatedBranchIndexes.push(null);
      continue;
    }
    const inferred = await inferBranchStepIndex(flow, branchContext);
    generatedBranchIndexes.push(inferred);
  }

  // First pass: compute all match scores with structural bonuses
  const candidatesByGen = new Map<
    string,
    Array<{
      gtFlowId: string;
      baseScore: number;
      adjustedScore: number;
    }>
  >();

  const allMatches: {
    genFlowId: string;
    bestAdjustedScore: number;
  }[] = [];

  for (let i = 0; i < generatedFlows.length; i++) {
    const candidates: Array<{
      gtFlowId: string;
      baseScore: number;
      adjustedScore: number;
    }> = [];
    let bestAdjustedScore = -Infinity;

    for (let j = 0; j < groundTruthEmbeddings.length; j++) {
      const baseScore = await semanticService.cosineSimilarity(
        generatedEmbeddings[i],
        groundTruthEmbeddings[j],
      );
      let adjustedScore = baseScore;
      if (generatedFlows[i].kind === groundTruthFlows[j].kind) {
        adjustedScore += 0.05;
      }
      const genBranch = generatedBranchIndexes[i];
      const gtBranch = groundTruthBranchIndexes[j];
      if (genBranch !== null && gtBranch !== null && genBranch === gtBranch) {
        adjustedScore += 0.1;
      }
      candidates.push({
        gtFlowId: groundTruthFlows[j].id,
        baseScore,
        adjustedScore,
      });
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
      }
    }

    candidates.sort((a, b) => b.adjustedScore - a.adjustedScore);
    candidatesByGen.set(generatedFlows[i].id, candidates);
    allMatches.push({
      genFlowId: generatedFlows[i].id,
      bestAdjustedScore,
    });
  }

  // Sort by bestAdjustedScore descending (best matches claim first)
  allMatches.sort((a, b) => b.bestAdjustedScore - a.bestAdjustedScore);

  // Second pass: assign claims with deduplication
  const claimedGTFlows = new Set<string>();

  function setMatchResult(genFlowId: string, result: FlowMatchResult): void {
    matchResults.set(genFlowId, result);
  }

  for (const match of allMatches) {
    const candidates = candidatesByGen.get(match.genFlowId) ?? [];
    const unclaimed = candidates.find(
      (candidate) =>
        candidate.baseScore >= threshold &&
        !claimedGTFlows.has(candidate.gtFlowId),
    );

    if (unclaimed) {
      claimedGTFlows.add(unclaimed.gtFlowId);
      setMatchResult(match.genFlowId, {
        inGroundTruth: true,
        isDuplicate: false,
        matchedFlowId: unclaimed.gtFlowId,
        bestScore: unclaimed.baseScore,
      });
      continue;
    }

    const bestCandidate = candidates[0];
    if (!bestCandidate || bestCandidate.baseScore < threshold) {
      setMatchResult(match.genFlowId, {
        inGroundTruth: false,
        isDuplicate: false,
        bestScore: bestCandidate?.baseScore ?? -Infinity,
      });
      continue;
    }

    if (
      bestCandidate.baseScore >= duplicateThreshold &&
      claimedGTFlows.has(bestCandidate.gtFlowId)
    ) {
      setMatchResult(match.genFlowId, {
        inGroundTruth: false,
        isDuplicate: true,
        matchedFlowId: bestCandidate.gtFlowId,
        bestScore: bestCandidate.baseScore,
      });
      continue;
    }

    setMatchResult(match.genFlowId, {
      inGroundTruth: false,
      isDuplicate: false,
      bestScore: bestCandidate.baseScore,
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
