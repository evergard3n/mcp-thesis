import { readFile, writeFile } from "fs/promises";
import { z } from "zod";
import {
  evaluateUseCase,
  flowToText,
} from "../evaluators/three-tier.evaluator.js";
import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import {
  classifyUseCaseDomain,
} from "../services/domain-classifier.service.js";
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
5. Extract the detailed description that contains the domain knowledge needed to create this use case, excluding any structured flow information. It should represent the narrative and context of the use case, but NOT the step-by-step flow details.
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

      const text = flowToText(flow);
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
) {
  const { datasetPath, testCaseIds } = input;
  const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
  const testCases = testCaseIds
    ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
    : dataset.testCases;

  const results = [];

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
        geminiFunctions,
      },
      { maxIterations: 5, maxQuestions: 20, perIterationCap: 6 },
      answerProvider,
    );

    const baselineDomainAnalysis = await classifyUseCaseDomain(
      loopResult.baseline,
      geminiFunctions,
    );

    const detailedBaseline = await generateFlatUseCase({
      description: tc.inputs.detailed,
      geminiFunctions,
    });

    const detailedDomainAnalysis = await classifyUseCaseDomain(
      detailedBaseline,
      geminiFunctions,
    );

    results.push({
      testCaseId: tc.id,
      conditionA_Baseline: loopResult.baseline,
      conditionA_BaselineDomain: baselineDomainAnalysis,
      conditionA_DetailedBaseline: detailedBaseline,
      conditionA_DetailedDomain: detailedDomainAnalysis,
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
        key === "iterativeRefinement" ||
        key === "conditionA_BaselineDomain" ||
        key === "conditionA_DetailedDomain" ||
        key === "conditionB_EnhancedHITLDomain"
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

export async function classifyUseCaseDomainTool(
  geminiFunctions: GeminiOpenRouterFunctions,
  useCase: GenUseCase,
) {
  return classifyUseCaseDomain(useCase, geminiFunctions);
}
