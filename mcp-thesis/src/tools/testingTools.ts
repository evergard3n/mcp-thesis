import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { z } from "zod";
import { evaluateUseCase } from "../evaluators/three-tier.evaluator.js";
import { flowToSentenceText } from "../helpers/usecase-text.js";
import { GenFlow } from "../interfaces/usecase.interface.new.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import semanticService from "../services/semantic.service.js";
import {
  generateFlatUseCase,
} from "../services/usecase.service.js";
import {
  expertAnswerOpenEndedQuestions,
} from "../validators/llm.validator.js";
import { runHITLLoop, type AnswerProvider } from "../orchestrator/hitl.core.js";

interface EmbeddedFlow extends GenFlow {
  embedding?: number[];
}

interface DatasetTestCase {
  id: string;
  domain: string;
  inputs: {
    vague: string;
    detailed: string;
  };
  groundTruth: {
    flows: EmbeddedFlow[];
  };
}

interface DatasetFile {
  testCases: DatasetTestCase[];
}

export interface HitlComparisonTestCaseResult {
  testCaseId: string;
  conditionA_Baseline: unknown;
  conditionA_DetailedBaseline: unknown;
  conditionB_EnhancedHITL: unknown;
  iterativeRefinement: {
    totalIterations: number;
    totalQuestionsAsked: number;
    iterations: Array<{
      iteration: number;
      questionsAsked: number;
      overallConfidence: number;
      highPriorityCount: number;
      flowCountBefore: number;
      flowCountAfter: number;
      newFlowsAdded: number;
      hadFlowProducingQuestions: boolean;
      questions: string[];
      answers: string[];
    }>;
    debugInfo: Record<string, unknown>;
  };
  groundTruth: unknown;
}

const metadataExtractionSchema = z.object({
  testCaseId: z
    .string()
    .describe(
      "Extract from UC # field (e.g., '1010' from 'UC #: 1010'). If not found, generate a short ID from the use case name.",
    ),
  name: z.string().describe("The use case name/title"),
  domain: z
    .string()
    .describe(
      "Extract from Scope field (e.g., 'Insurance/Claims' from 'Scope: Insurance company Operations')",
    ),
  complexity: z
    .enum(["simple", "medium", "complex"])
    .describe(
      "Determine complexity based on number and depth of extensions: simple (0-2 extensions), medium (3-5), complex (6+)",
    ),
  notes: z
    .string()
    .optional()
    .describe(
      "Optional notes about the use case (e.g., key characteristics, special patterns)",
    ),
  detailedInput: z.string().describe("The detailed description of the use case, representing the domain knowledge needed to create this use case, but not the text-based ground truth use case itself"),
});

export async function prepareTestData(
  geminiFunctions: GeminiOpenRouterFunctions,
  input: {
    textBasedGroundTruth: string;
    testCaseId?: string;
  },
) {
  const { textBasedGroundTruth, testCaseId } = input;

  const metadataPrompt = `<instruction>
You are a professional business analyst. Extract metadata from the following use case description.

Follow these rules:
1. Extract the test case ID from the "UC #:" field. If not found, generate a short alphanumeric ID from the use case name (e.g., "Handle Claim" -> "HC").
2. Extract the domain from the "Scope:" field. Normalize to a standard format (e.g., "Insurance/Claims").
3. Determine complexity by counting extensions:
   - simple: 0-2 extension scenarios
   - medium: 3-5 extension scenarios
   - complex: 6+ extension scenarios
4. Add any relevant notes about special characteristics (e.g., "asynchronous validation", "nested exceptions", "temporal patterns").
5. Extract the detailed description that contains the domain knowledge needed to create this use case, excluding any structured flow information. It should represent the narrative and context of the use case, containing ALL flows (main flows + alternative flows + exception flows) descriptions, but NOT the step-by-step flow details.
DO NOT include specific step ids, flow labels, or structured flow information in the detailed description. Focus on capturing the overall narrative and context that encompasses all scenarios.
</instruction>

<useCaseText>
${textBasedGroundTruth}
</useCaseText>`;

  const extractedMetadata = await geminiFunctions.generateStructured({
    prompt: metadataPrompt,
    schema: metadataExtractionSchema,
  });

  const finalTestCaseId = testCaseId || extractedMetadata.testCaseId;

  const vagueSummaryPrompt = `<instruction>
You are a stakeholder describing a use case to a business analyst. Generate a brief, high-level summary (2-3 sentences) that describes ONLY the main success scenario (happy path).

CRITICAL RULES:
- Do NOT mention extensions, alternative flows, error handling, or edge cases
- Focus only on the normal, expected flow
- Use natural language, as if a domain expert is giving a verbal description
- Keep it vague and high-level (avoid implementation details)
- Do NOT include any markdown formatting or special characters
</instruction>

<useCaseText>
${textBasedGroundTruth}
</useCaseText>

Generate a vague summary:`;

  const vagueSummary = (
    await geminiFunctions.generate({ prompt: vagueSummaryPrompt })
  ).trim();

  const groundTruth = await generateFlatUseCase({
    description: textBasedGroundTruth,
    geminiFunctions,
  });
  const validatedTruth = genUseCaseSchema.parse(groundTruth);

  const dataset = {
    version: "1.0",
    createdAt: new Date().toISOString(),
    testCases: [
      {
        id: finalTestCaseId,
        domain: extractedMetadata.domain,
        metadata: {
          complexity: extractedMetadata.complexity,
          expectedFlows: validatedTruth.flows.length,
          notes: extractedMetadata.notes,
        },
        inputs: {
          vague: vagueSummary,
          detailed: extractedMetadata.detailedInput,
        },
        groundTruth: validatedTruth,
      },
    ],
  };

  const outputPath = `test-data/dataset-${finalTestCaseId}.json`;
  await writeFile(outputPath, JSON.stringify(dataset, null, 2));

  return {
    testCaseId: finalTestCaseId,
    domain: extractedMetadata.domain,
    complexity: extractedMetadata.complexity,
    flowCount: validatedTruth.flows.length,
    outputFile: outputPath,
  };
}

export async function embedDataset(input: {
  datasetPath: string;
  testCaseIds?: string[];
  forceReembed?: boolean;
}) {
  const { datasetPath, testCaseIds, forceReembed } = input;
  const dataset = JSON.parse(
    await readFile(datasetPath, "utf-8"),
  ) as DatasetFile;

  const testCases = testCaseIds
    ? dataset.testCases.filter((tc) => testCaseIds.includes(tc.id))
    : dataset.testCases;

  let totalFlows = 0;
  let embeddedCount = 0;
  let skippedCount = 0;

  for (const testCase of testCases) {
    const flows = testCase.groundTruth?.flows ?? [];
    for (const flow of flows) {
      totalFlows += 1;
      if (flow.embedding && flow.embedding.length > 0 && !forceReembed) {
        skippedCount += 1;
        continue;
      }

      const text = flowToSentenceText(flow);
      flow.embedding = await semanticService.embed(text);
      embeddedCount += 1;
    }
  }

  await writeFile(datasetPath, JSON.stringify(dataset, null, 2));

  return {
    datasetPath,
    totalFlows,
    embeddedCount,
    skippedCount,
  };
}

export async function runHITLComparison(
  geminiFunctions: GeminiOpenRouterFunctions,
  input: {
    datasetPath: string;
    testCaseIds?: string[];
  },
): Promise<{ results: HitlComparisonTestCaseResult[]; outputPath: string }> {
  const { datasetPath, testCaseIds } = input;
  const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
  const testCases = testCaseIds
    ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
    : dataset.testCases;

  const results: HitlComparisonTestCaseResult[] = [];

  for (const tc of testCases) {
    const answerProvider: AnswerProvider = async (questions) =>
      expertAnswerOpenEndedQuestions(
        questions,
        tc.inputs.detailed,
        tc.domain,
        geminiFunctions,
      );

    const loopResult = await runHITLLoop(
      {
        vague: tc.inputs.vague,
        detailed: tc.inputs.detailed,
        domain: tc.domain,
      },
      { maxIterations: 5, maxQuestions: 20, perIterationCap: 6 },
      geminiFunctions,
      answerProvider,
    );

    const detailedBaseline = await generateFlatUseCase({
      description: tc.inputs.detailed,
      geminiFunctions,
    });

    results.push({
      testCaseId: tc.id,
      conditionA_Baseline: loopResult.baseline,
      conditionA_DetailedBaseline: detailedBaseline,
      conditionB_EnhancedHITL: loopResult.useCase,
      iterativeRefinement: {
        totalIterations: loopResult.iterations.length,
        totalQuestionsAsked: loopResult.totalQuestionsAsked,
        iterations: loopResult.iterations.map((iter) => ({
          iteration: iter.iteration,
          questionsAsked: iter.questionsAsked,
          overallConfidence: iter.overallConfidence,
          highPriorityCount: iter.highPriorityCount,
          flowCountBefore: iter.flowCountBefore,
          flowCountAfter: iter.flowCountAfter,
          newFlowsAdded: iter.newFlowsAdded,
          hadFlowProducingQuestions: iter.hadFlowProducingQuestions,
          questions: iter.questions.map((q) => q.question),
          answers: iter.answers.map((a) => a.answer),
        })),
        debugInfo: {},
      },
      groundTruth: tc.groundTruth,
    });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = `test-data/results/raw/enhanced-hitl-${timestamp}.json`;
  await writeFile(outputPath, JSON.stringify(results, null, 2));

  return { results, outputPath };
}

export interface DatasetRunResult {
  datasetFile: string;
  datasetPath: string;
  elapsedMs: number;
  testCaseCount?: number;
  totalIterations?: number;
  totalQuestions?: number;
  outputPath?: string;
  status: "success" | "error";
  error?: string;
}

export async function runHITLBatch(
  geminiFunctions: GeminiOpenRouterFunctions,
  input: {
    concurrency?: number;
    only?: string[];
    exclude?: string[];
  },
) {
  const { concurrency = 3, only, exclude = [] } = input;
  const testDataDir = "test-data";

  const allFiles = (await readdir(testDataDir))
    .filter((f) => f.startsWith("dataset-") && f.endsWith(".json"))
    .sort();

  const onlySet = only && only.length > 0 ? new Set(only) : null;
  const excludeSet = new Set(exclude);

  const datasetFiles = allFiles.filter((name) => {
    const id = name.replace(/^dataset-/, "").replace(/\.json$/, "");
    if (onlySet && !onlySet.has(id)) return false;
    if (excludeSet.has(id)) return false;
    return true;
  });

  if (datasetFiles.length === 0) {
    return {
      batchResults: [] as DatasetRunResult[],
      indexPath: null,
      summary: { total: 0, succeeded: 0, failed: 0 },
    };
  }

  console.log(
    `[batch] starting ${datasetFiles.length} dataset(s), concurrency=${concurrency}`,
  );

  const batchResults: DatasetRunResult[] = [];
  const total = datasetFiles.length;

  for (let offset = 0; offset < total; offset += concurrency) {
    const chunk = datasetFiles.slice(offset, offset + concurrency);

    const chunkResults = await Promise.all(
      chunk.map(async (datasetFile, i) => {
        const index = offset + i + 1;
        const label = `[${String(index).padStart(2)}/${total}]`;
        const datasetPath = `${testDataDir}/${datasetFile}`;
        const startedAt = Date.now();

        console.log(`${label} ▶ ${datasetFile}`);

        try {
          const { results, outputPath } = await runHITLComparison(
            geminiFunctions,
            { datasetPath },
          );

          const elapsedMs = Date.now() - startedAt;
          const totalIterations = results.reduce(
            (sum, r) => sum + (r.iterativeRefinement?.totalIterations ?? 0),
            0,
          );
          const totalQuestions = results.reduce(
            (sum, r) => sum + (r.iterativeRefinement?.totalQuestionsAsked ?? 0),
            0,
          );

          console.log(
            `${label} ✅ ${datasetFile} — ${(elapsedMs / 1000).toFixed(1)}s | ` +
              `cases=${results.length} iters=${totalIterations} qs=${totalQuestions}`,
          );

          return {
            datasetFile,
            datasetPath,
            elapsedMs,
            testCaseCount: results.length,
            totalIterations,
            totalQuestions,
            outputPath,
            status: "success" as const,
          };
        } catch (err) {
          const elapsedMs = Date.now() - startedAt;
          const error = err instanceof Error ? err.message : String(err);
          console.error(
            `${label} ❌ ${datasetFile} — ${(elapsedMs / 1000).toFixed(1)}s | ${error.slice(0, 120)}`,
          );
          return {
            datasetFile,
            datasetPath,
            elapsedMs,
            status: "error" as const,
            error,
          };
        }
      }),
    );

    batchResults.push(...chunkResults);
    console.log(`--- ${Math.min(offset + concurrency, total)}/${total} done ---`);
  }

  await mkdir("test-data/results/raw", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const indexPath = `test-data/results/raw/hitl-batch-index-${timestamp}.json`;

  const errors = batchResults.filter((r) => r.status === "error");
  await writeFile(
    indexPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        concurrency,
        datasetCount: batchResults.length,
        successCount: batchResults.length - errors.length,
        errorCount: errors.length,
        batchResults,
      },
      null,
      2,
    ),
  );

  const summary = {
    total: batchResults.length,
    succeeded: batchResults.length - errors.length,
    failed: errors.length,
  };

  console.log(
    `[batch] done — ${summary.succeeded}/${summary.total} succeeded, index saved: ${indexPath}`,
  );

  return { batchResults, indexPath, summary };
}

export async function evaluateResults(
  geminiFunctions: GeminiOpenRouterFunctions,
  input: { resultsPath: string; datasetPath: string },
) {
  const { resultsPath, datasetPath } = input;
  const results = JSON.parse(await readFile(resultsPath, "utf-8"));
  const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));

  const evaluations = [];

  for (const result of results) {
    const testCase = dataset.testCases.find(
      (tc: any) => tc.id === result.testCaseId,
    );
    if (!testCase) continue;

    const conditionEvals: any = {};

    for (const [key, useCase] of Object.entries(result)) {
      if (
        key === "testCaseId" ||
        key === "groundTruth" ||
        key === "hitlQuestions" ||
        key === "intermediateData" ||
        key === "iterativeRefinement"
      ) {
        continue;
      }

      conditionEvals[key] = await evaluateUseCase(
        useCase as any,
        {
          vagueSummary: testCase.inputs.vague,
          detailedDescription: testCase.inputs.detailed,
          groundTruth: testCase.groundTruth,
          domain: testCase.domain,
        },
        geminiFunctions,
      );
    }

    evaluations.push({
      testCaseId: result.testCaseId,
      evaluations: conditionEvals,
    });
  }

  if (evaluations.length === 0) {
    return {
      evaluations,
      summary: {},
      outputPath: null,
    };
  }

  const summary: any = {};
  const conditions = Object.keys(evaluations[0].evaluations);

  for (const cond of conditions) {
    const scores = evaluations.map((e: any) => e.evaluations[cond].scores);
    summary[cond] = {
      avgQuality:
        scores.reduce((sum: number, s: any) => sum + s.qualityScore, 0) /
        scores.length,
      avgDiscovery:
        scores.reduce((sum: number, s: any) => sum + s.discoveryRate, 0) /
        scores.length,
      avgF1:
        scores.reduce((sum: number, s: any) => sum + s.f1Score, 0) /
        scores.length,
    };
  }

  const filename = resultsPath.split("/").pop() || "";
  const outputPath = `test-data/results/evaluated/${filename}`;
  await writeFile(
    outputPath,
    JSON.stringify({ evaluations, summary }, null, 2),
  );

  return {
    evaluations,
    summary,
    outputPath,
  };
}
