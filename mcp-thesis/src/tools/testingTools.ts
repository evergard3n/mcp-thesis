import { readFile, writeFile } from "fs/promises";
import { z } from "zod";
import {
  analyzeGaps,
  clearGapCentroidsCache,
  collectStepEmbeddings,
  InteractionMemory,
  GapType,
} from "../analyzers/gap.analyzer.js";
import { detectActivatedBlueprints } from "../analyzers/blueprint.detector.js";
import { rankAllUncertainties } from "../analyzers/uncertainty.ranker.js";
import {
  evaluateUseCase,
  flowToText,
} from "../evaluators/three-tier.evaluator.js";
import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import {
  classifyUseCaseDomain,
  resolveBlueprintDomainFilter,
} from "../services/domain-classifier.service.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import semanticService from "../services/semantic.service.js";
import {
  generateFlatUseCase,
  refineWithHybridAnswers,
} from "../services/usecase.service.js";
import { validateUseCaseWithFeedback } from "../validators/flat.validator.js";
import {
  expertAnswerOpenEndedQuestions,
  generateAdaptiveQuestions,
  OpenEndedAnswer,
  probeBlueprintsWithExpert,
} from "../validators/llm.validator.js";

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
          detailed: textBasedGroundTruth,
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

function toInteractionMemories(
  questions: Array<{
    id: string;
    question: string;
    context: {
      step?: string;
      patternType?: string;
      whyAsking: string;
      flowId?: string;
    };
  }>,
  answers: OpenEndedAnswer[],
  iteration: number,
): Promise<InteractionMemory[]> {
  const contextsToEmbed: string[] = [];
  const questionsToEmbed: string[] = [];
  const records: Omit<InteractionMemory, "vector" | "questionVector">[] = [];

  for (const q of questions) {
    const a = answers.find((answer) => answer.questionId === q.id);
    if (!a) continue;

    const stepContext = q.context.step || "Global";
    const description = q.context.whyAsking;
    const contextString = `${stepContext} | ${description}`;

    contextsToEmbed.push(contextString);
    questionsToEmbed.push(q.question);

    records.push({
      stepContext,
      question: q.question,
      answer: a.answer,
      iteration,
      metadata: {
        stepIndex: q.id.match(/step-(\d+)/)
          ? parseInt(q.id.match(/step-(\d+)/)![1], 10)
          : undefined,
        gapType: q.context.patternType as GapType,
        flowId: q.context.flowId || "MAIN",
      },
    });
  }

  return (async () => {
    if (records.length === 0) return [];

    const contextVectors = await semanticService.embedBatch(contextsToEmbed);
    const questionVectors = await semanticService.embedBatch(questionsToEmbed);

    return records.map((record, index) => ({
      ...record,
      vector: contextVectors[index],
      questionVector: questionVectors[index],
    }));
  })();
}

export async function runHITLComparison(
  geminiFunctions: GeminiOpenRouterFunctions,
  input: {
    datasetPath: string;
    testCaseIds?: string[];
  },
) {
  const { datasetPath, testCaseIds } = input;
  clearGapCentroidsCache();
  const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
  const testCases = testCaseIds
    ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
    : dataset.testCases;

  const results = [];

  for (const tc of testCases) {
    const baseline = await generateFlatUseCase({
      description: tc.inputs.vague,
      geminiFunctions,
    });

    const baselineDomainAnalysis = await classifyUseCaseDomain(
      baseline,
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

    let currentUseCase = JSON.parse(JSON.stringify(baseline));
    const baselineFlowIds = new Set<string>(
      baseline.flows.map((flow: GenFlow) => flow.id),
    );
    const MAX_QUESTIONS = 20;
    const MAX_ITERATIONS = 5;
    let iteration = 0;
    let totalQuestionsAsked = 0;
    const conversationHistory: InteractionMemory[] = [];
    const allIterations: any[] = [];
    const allQuestions: string[] = [];
    let debugInfo: any = {};

    const confirmedBlueprintIds = new Set<string>();
    const droppedBlueprintIds = new Set<string>();
    let blueprintsProbed = false;

    while (iteration < MAX_ITERATIONS && totalQuestionsAsked < MAX_QUESTIONS) {
      iteration++;

      if (!blueprintsProbed) {
        const stepEmbeddings = await collectStepEmbeddings(currentUseCase);
        const domainAnalysis = await classifyUseCaseDomain(currentUseCase);
        const activationFilter = resolveBlueprintDomainFilter(domainAnalysis);

        const activations = await detectActivatedBlueprints(
          stepEmbeddings,
          activationFilter,
          { useCase: currentUseCase, originalDescription: tc.inputs.vague },
        );

        const confirmed = await probeBlueprintsWithExpert(
          activations,
          tc.inputs.detailed,
          tc.domain,
          geminiFunctions,
        );

        confirmed.forEach((id) => confirmedBlueprintIds.add(id));
        activations
          .filter(
            (activation) => !confirmedBlueprintIds.has(activation.blueprintId),
          )
          .forEach((activation) =>
            droppedBlueprintIds.add(activation.blueprintId),
          );

        blueprintsProbed = true;
      }

      const validation = await validateUseCaseWithFeedback(currentUseCase);
      const gapAnalysis = await analyzeGaps(
        currentUseCase,
        validation.score!,
        tc.inputs.vague,
        conversationHistory,
        confirmedBlueprintIds,
        new Set(),
        "post-probe",
      );
      const uncertaintyAnalysis = rankAllUncertainties(
        currentUseCase,
        validation.score!,
        gapAnalysis,
      );

      if (iteration === 1) {
        debugInfo = {
          gapsFound: gapAnalysis.gaps.length,
          gapTypes: gapAnalysis.gaps.map((g) => g.type),
          confidence: uncertaintyAnalysis.overallConfidence,
          highPriorityCount: uncertaintyAnalysis.highPriorityCount,
          confirmedBlueprints: Array.from(confirmedBlueprintIds),
          droppedBlueprints: Array.from(droppedBlueprintIds),
        };
      }

      if (
        uncertaintyAnalysis.overallConfidence > 0.85 &&
        uncertaintyAnalysis.highPriorityCount === 0
      ) {
        break;
      }

      const isFirstIteration = iteration === 1;
      const globalGaps = gapAnalysis.gaps.filter((g) => g.relatedStep === undefined);
      const adaptiveQuestions = await generateAdaptiveQuestions(
        uncertaintyAnalysis.stepPriorities,
        uncertaintyAnalysis.flowUncertainties,
        Math.min(6, MAX_QUESTIONS - totalQuestionsAsked),
        allQuestions,
        isFirstIteration,
        confirmedBlueprintIds.size,
        baselineFlowIds,
        globalGaps,
      );

      if (adaptiveQuestions.length === 0) {
        break;
      }

      const answers = await expertAnswerOpenEndedQuestions(
        adaptiveQuestions,
        tc.inputs.detailed,
        tc.domain,
        geminiFunctions,
      );

      const memories = await toInteractionMemories(
        adaptiveQuestions,
        answers,
        iteration,
      );
      conversationHistory.push(...memories);

      currentUseCase = await refineWithHybridAnswers(
        tc.inputs.vague,
        currentUseCase,
        [],
        [],
        answers,
        geminiFunctions,
      );

      allIterations.push({
        iteration,
        questionsAsked: adaptiveQuestions.length,
        overallConfidence: uncertaintyAnalysis.overallConfidence,
        highPriorityCount: uncertaintyAnalysis.highPriorityCount,
        questions: adaptiveQuestions.map((q) => q.question),
        answers: answers.map((a) => a.answer),
      });

      totalQuestionsAsked += adaptiveQuestions.length;
      allQuestions.push(...adaptiveQuestions.map((q) => q.question));
    }

    results.push({
      testCaseId: tc.id,
      conditionA_Baseline: baseline,
      conditionA_BaselineDomain: baselineDomainAnalysis,
      conditionA_DetailedBaseline: detailedBaseline,
      conditionA_DetailedDomain: detailedDomainAnalysis,
      conditionB_EnhancedHITL: currentUseCase,
      iterativeRefinement: {
        totalIterations: iteration,
        totalQuestionsAsked,
        iterations: allIterations,
        debugInfo,
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
