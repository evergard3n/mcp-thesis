import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import { writeFile, readFile } from "fs/promises";
import { JsonProjectStore } from "../stores/projectStore.js";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import semanticService from "../services/semantic.service.js";
import {
  generateFlatUseCase,
  improveUseCase,
  refineWithHybridAnswers,
} from "../services/usecase.service.js";
import {
  validateUseCaseWithFeedback,
  formatValidationForLLM,
  UseCaseValidationResult,
} from "../validators/flat.validator.js";
import {
  generateLLMQuestions,
  answerLLMQuestions,
  generateMultipleChoiceQuestions,
  expertAnswerMultipleChoice,
  generateHybridQuestions,
  expertAnswerOpenEndedQuestions,
  generateAdaptiveQuestions,
  OpenEndedAnswer,
} from "../validators/llm.validator.js";
import {
  evaluateUseCase,
  flowToText,
} from "../evaluators/three-tier.evaluator.js";
import {
  analyzeGaps,
  InteractionMemory,
  GapType,
  clearGapCentroidsCache,
  GapAnalysis,
} from "../analyzers/gap.analyzer.js";
import {
  rankAllUncertainties,
  UncertaintyAnalysis,
} from "../analyzers/uncertainty.ranker.js";
import { OpenEndedQuestion } from "../validators/llm.validator.js";

interface EmbeddedFlow extends GenFlow {
  embedding?: number[];
}

interface DatasetTestCase {
  id: string;
  groundTruth: {
    flows: EmbeddedFlow[];
  };
}

interface DatasetFile {
  testCases: DatasetTestCase[];
}

interface HITLSessionState {
  description: string | null;
  currentUseCase: GenUseCase | null;
  conversationHistory: InteractionMemory[];
  allQuestions: string[];
  iterationCount: number;
  lastValidation: UseCaseValidationResult | null;
  lastGapAnalysis: GapAnalysis | null;
  lastUncertaintyAnalysis: UncertaintyAnalysis | null;
  lastQuestions: OpenEndedQuestion[] | null;
}

export function registerTestingTools(
  server: McpServer,
  projectStore: JsonProjectStore,
  geminiFunctions: GeminiOpenRouterFunctions,
) {
  // Session-level state for Interactive Demo Tools
  const hitlState: HITLSessionState = {
    description: null,
    currentUseCase: null,
    conversationHistory: [],
    allQuestions: [],
    iterationCount: 0,
    lastValidation: null,
    lastGapAnalysis: null,
    lastUncertaintyAnalysis: null,
    lastQuestions: null,
  };

  // Tool 1: prepareTestData
  // Metadata extraction schema (for LLM structured output)
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

  server.registerTool(
    "prepareTestData",
    {
      title: "Prepare Test Dataset",
      description:
        "Generate structured test dataset from a single text-based use case description",
      inputSchema: {
        textBasedGroundTruth: z
          .string()
          .describe(
            "Full text-based use case description (including UC #, Main Success Scenario, Extensions, etc.)",
          ),
        testCaseId: z
          .string()
          .optional()
          .describe(
            "Optional override for test case ID. If not provided, will be auto-extracted from UC text.",
          ),
      },
    },
    async ({ textBasedGroundTruth, testCaseId }) => {
      try {
        // Step 1: Extract metadata using Gemini structured output
        console.log("Step 1/4: Extracting metadata from UC text...");
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

        // Use provided testCaseId or fall back to extracted one
        const finalTestCaseId = testCaseId || extractedMetadata.testCaseId;

        // Step 2: Generate vague summary (main scenario only, no extensions)
        console.log("Step 2/4: Generating vague summary...");
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

        // Step 3: Generate structured GenUseCase from full text
        console.log("Step 3/4: Generating structured use case...");
        const groundTruth = await generateFlatUseCase({
          description: textBasedGroundTruth,
          geminiFunctions,
        });
        const validatedTruth = genUseCaseSchema.parse(groundTruth);

        // Step 4: Create dataset and write to file
        console.log("Step 4/4: Writing dataset file...");
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
          content: [
            {
              type: "text" as const,
              text: `Dataset prepared successfully!\n\nTest Case ID: ${finalTestCaseId}\nDomain: ${extractedMetadata.domain}\nComplexity: ${extractedMetadata.complexity}\nExpected Flows: ${validatedTruth.flows.length}\n\nSaved to: ${outputPath}`,
            },
          ],
          structuredContent: {
            testCaseId: finalTestCaseId,
            domain: extractedMetadata.domain,
            complexity: extractedMetadata.complexity,
            flowCount: validatedTruth.flows.length,
            outputFile: outputPath,
          },
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error preparing dataset: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool 2: embedDataset (pre-embed ground truth flows)
  server.registerTool(
    "embedDataset",
    {
      title: "Embed Dataset Ground Truth",
      description:
        "Pre-embed ground truth flows and store embeddings in dataset JSON",
      inputSchema: {
        datasetPath: z.string(),
        testCaseIds: z.array(z.string()).optional(),
        forceReembed: z.boolean().optional(),
      },
    },
    async ({ datasetPath, testCaseIds, forceReembed }) => {
      try {
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
          content: [
            {
              type: "text" as const,
              text: `Embedded ${embeddedCount} flows (${skippedCount} skipped). Saved to: ${datasetPath}`,
            },
          ],
          structuredContent: {
            datasetPath,
            totalFlows,
            embeddedCount,
            skippedCount,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool 3: runHITLComparison
  server.registerTool(
    "runHITLComparison",
    {
      title: "Run Enhanced HITL Framework",
      description:
        "Compare baseline vs enhanced iterative HITL framework with priority ranking",
      inputSchema: {
        datasetPath: z.string(),
        testCaseIds: z.array(z.string()).optional(),
      },
    },
    async ({ datasetPath, testCaseIds }) => {
      console.log("========================== running version: 1825");

      // Clear gap centroids cache to ensure fresh centroids are loaded
      clearGapCentroidsCache();

      const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
      const testCases = testCaseIds
        ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
        : dataset.testCases;

      const results = [];

      for (const tc of testCases) {
        console.log(`Testing ${tc.id} with Enhanced HITL...`);

        // Run Enhanced HITL with Iterative Refinement
        // Step 1: Generate initial draft from vague input (this is the baseline)
        const baseline = await generateFlatUseCase({
          description: tc.inputs.vague,
          geminiFunctions: geminiFunctions,
        });

        const detailedBaseline = await generateFlatUseCase({
          description: tc.inputs.detailed,
          geminiFunctions: geminiFunctions,
        });

        console.log(`  Baseline generated, starting iterative refinement...`);

        // Clone baseline for iterative refinement
        let currentUseCase = JSON.parse(JSON.stringify(baseline));

        const MAX_QUESTIONS = 20;
        const MAX_ITERATIONS = 5;
        let iteration = 0;
        let totalQuestionsAsked = 0;
        const conversationHistory: InteractionMemory[] = [];
        const allIterations: any[] = [];
        const allQuestions: string[] = [];
        let debugInfo: any = {};

        // Iterative refinement loop
        while (
          iteration < MAX_ITERATIONS &&
          totalQuestionsAsked < MAX_QUESTIONS
        ) {
          iteration++;
          console.log(`  Iteration ${iteration}...`);

          // Step 2: Validate and analyze gaps
          const validation = await validateUseCaseWithFeedback(currentUseCase);

          const gapAnalysis = await analyzeGaps(
            currentUseCase,
            validation.score!,
            tc.inputs.vague,
            conversationHistory,
          );

          // Step 3: Uncertainty analysis and priority ranking
          const uncertaintyAnalysis = rankAllUncertainties(
            currentUseCase,
            validation.score!,
            gapAnalysis,
          );

          // Debug logging
          console.log(`  Gap analysis: ${gapAnalysis.gaps.length} gaps found`);
          console.log(
            `  Uncertainty: confidence=${uncertaintyAnalysis.overallConfidence.toFixed(3)}, highPriority=${uncertaintyAnalysis.highPriorityCount}`,
          );

          // Store debug info for first iteration
          if (iteration === 1) {
            debugInfo = {
              gapsFound: gapAnalysis.gaps.length,
              gapTypes: gapAnalysis.gaps.map((g) => g.type),
              confidence: uncertaintyAnalysis.overallConfidence,
              highPriorityCount: uncertaintyAnalysis.highPriorityCount,
              stepPriorities: uncertaintyAnalysis.stepPriorities
                .slice(0, 5)
                .map((p) => ({
                  step: p.stepIndex,
                  rank: p.priorityRank,
                  reasons: p.uncertaintyReasons,
                  relatedGaps: p.relatedGaps.length,
                })),
            };
          }

          // Stopping condition: high confidence and no high-priority gaps
          if (
            uncertaintyAnalysis.overallConfidence > 0.85 &&
            uncertaintyAnalysis.highPriorityCount === 0
          ) {
            console.log(
              `  Stopping: High confidence (${uncertaintyAnalysis.overallConfidence.toFixed(
                2,
              )}) and no high-priority items`,
            );
            break;
          }

          // Step 4: Generate adaptive questions based on priorities
          const adaptiveQuestions = await generateAdaptiveQuestions(
            uncertaintyAnalysis.stepPriorities,
            uncertaintyAnalysis.flowUncertainties,
            Math.min(6, MAX_QUESTIONS - totalQuestionsAsked),
            allQuestions,
          );

          if (adaptiveQuestions.length === 0) {
            console.log(`  Stopping: No more questions to ask`);
            break;
          }

          console.log(`  Generated ${adaptiveQuestions.length} questions`);

          // Step 5: Expert answers (simulating human)
          const answers = await expertAnswerOpenEndedQuestions(
            adaptiveQuestions,
            tc.inputs.detailed,
            tc.domain,
            geminiFunctions,
          );

          // Update conversation history for deduplication (Dual-Vector Approach)
          const contextsToEmbed: string[] = [];
          const questionsToEmbed: string[] = [];
          const historyRecords: any[] = []; // temporary holder

          for (const q of adaptiveQuestions) {
            const a = answers.find((ans) => ans.questionId === q.id);
            if (!a) continue;

            const stepContext = q.context.step || "Global";
            const description = q.context.whyAsking;

            // Format must match what filterStaleGaps expects: "Context: ... | Gap: ..."
            // But here we construct the raw strings that get embedded
            const contextString = `${stepContext} | ${description}`;

            contextsToEmbed.push(contextString);
            questionsToEmbed.push(q.question);

            historyRecords.push({
              stepContext,
              question: q.question,
              answer: a.answer,
              iteration,
              metadata: {
                stepIndex: q.id.match(/step-(\d+)/)
                  ? parseInt(q.id.match(/step-(\d+)/)![1])
                  : undefined,
                gapType: q.context.patternType as GapType,
                flowId: q.context.flowId || "MAIN",
              },
            });
          }

          if (contextsToEmbed.length > 0) {
            const contextVectors =
              await semanticService.embedBatch(contextsToEmbed);
            const questionVectors =
              await semanticService.embedBatch(questionsToEmbed);

            for (let i = 0; i < historyRecords.length; i++) {
              conversationHistory.push({
                ...historyRecords[i],
                vector: contextVectors[i],
                questionVector: questionVectors[i],
              });
            }
          }

          // Step 6: Refine use case with answers
          currentUseCase = await refineWithHybridAnswers(
            tc.inputs.vague,
            currentUseCase,
            [], // No MC questions in iterative mode
            [],
            answers,
            geminiFunctions,
          );

          // Track iteration data
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

        console.log(
          `  Completed ${iteration} iterations, ${totalQuestionsAsked} total questions`,
        );

        const hitlUseCase = currentUseCase;

        results.push({
          testCaseId: tc.id,
          conditionA_Baseline: baseline,
          conditionA_DetailedBaseline: detailedBaseline,
          conditionB_EnhancedHITL: hitlUseCase,
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

      return {
        content: [
          {
            type: "text" as const,
            text: `Enhanced HITL comparison complete: ${results.length} test cases
Baseline vs Enhanced HITL (with iterative refinement)
Results: ${outputPath}`,
          },
        ],
        structuredContent: { results, outputPath },
      };
    },
  );

  // Tool 4: evaluateResults
  server.registerTool(
    "evaluateResults",
    {
      title: "Evaluate Test Results",
      description: "Run three-tier evaluation on COVE or HITL results",
      inputSchema: {
        resultsPath: z.string(),
        datasetPath: z.string(),
      },
    },
    async ({ resultsPath, datasetPath }) => {
      const results = JSON.parse(await readFile(resultsPath, "utf-8"));
      const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));

      const evaluations = [];

      for (const result of results) {
        const testCase = dataset.testCases.find(
          (tc: any) => tc.id === result.testCaseId,
        );
        if (!testCase) continue;

        const conditionEvals: any = {};

        // Evaluate each condition in the result
        for (const [key, useCase] of Object.entries(result)) {
          if (
            key === "testCaseId" ||
            key === "groundTruth" ||
            key === "hitlQuestions" ||
            key === "intermediateData" ||
            key === "iterativeRefinement"
          )
            continue;

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

      // Calculate aggregate stats
      const summary: any = {};
      const conditions = Object.keys(evaluations[0].evaluations);

      for (const cond of conditions) {
        const scores = evaluations.map((e) => e.evaluations[cond].scores);
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

      // Extract filename from resultsPath and save to evaluated folder
      const filename = resultsPath.split("/").pop() || "";
      const outputPath = `test-data/results/evaluated/${filename}`;
      await writeFile(
        outputPath,
        JSON.stringify({ evaluations, summary }, null, 2),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Evaluation complete\n${JSON.stringify(
              summary,
              null,
              2,
            )}\nSaved: ${outputPath}`,
          },
        ],
        structuredContent: { evaluations, summary, outputPath },
      };
    },
  );

  // ============================================================================
  // Interactive Demo Tools (Split HITL Workflow)
  // ============================================================================

  // Tool 5: hitl_generateBaseline
  server.registerTool(
    "hitl_generateBaseline",
    {
      title: "Step 1: Generate Baseline",
      description: "Generate initial use case from user description (Resets session state)",
      inputSchema: {
        description: z.string().describe("The user's initial vague requirement"),
      },
    },
    async ({ description }: { description: string }) => {
      console.log("Interactive HITL: Generating baseline...");
      
      // Reset state
      hitlState.description = description;
      hitlState.conversationHistory = [];
      hitlState.allQuestions = [];
      hitlState.iterationCount = 0;
      hitlState.lastValidation = null;
      hitlState.lastGapAnalysis = null;
      hitlState.lastUncertaintyAnalysis = null;
      hitlState.lastQuestions = null;

      clearGapCentroidsCache();

      const baseline = await generateFlatUseCase({
        description,
        geminiFunctions,
      });

      hitlState.currentUseCase = baseline;

      return {
        content: [
          {
            type: "text" as const,
            text: `Baseline generated for: "${description}"\nName: ${baseline.name}\nFlows: ${baseline.flows.length}`,
          },
        ],
        structuredContent: { useCase: baseline },
      };
    },
  );

  // Tool 6: hitl_analyzeGaps
  server.registerTool(
    "hitl_analyzeGaps",
    {
      title: "Step 2: Analyze Gaps",
      description: "Analyze current use case for gaps and rank uncertainties",
      inputSchema: {},
    },
    async () => {
      if (!hitlState.currentUseCase || !hitlState.description) {
        return {
          content: [{ type: "text" as const, text: "Error: No active use case. Run hitl_generateBaseline first." }],
          isError: true,
        };
      }

      console.log(`Interactive HITL: Analyzing gaps (Iteration ${hitlState.iterationCount + 1})...`);

      const validation = await validateUseCaseWithFeedback(hitlState.currentUseCase);
      hitlState.lastValidation = validation;

      const gapAnalysis = await analyzeGaps(
        hitlState.currentUseCase,
        validation.score!,
        hitlState.description,
        hitlState.conversationHistory,
      );
      hitlState.lastGapAnalysis = gapAnalysis;

      const uncertaintyAnalysis = rankAllUncertainties(
        hitlState.currentUseCase,
        validation.score!,
        gapAnalysis,
      );
      hitlState.lastUncertaintyAnalysis = uncertaintyAnalysis;

      const shouldStop =
        uncertaintyAnalysis.overallConfidence > 0.85 &&
        uncertaintyAnalysis.highPriorityCount === 0;

      return {
        content: [
          {
            type: "text" as const,
            text: `Analysis Complete:\n- Gaps Found: ${gapAnalysis.gaps.length}\n- Confidence: ${(uncertaintyAnalysis.overallConfidence * 100).toFixed(1)}%\n- High Priority Issues: ${uncertaintyAnalysis.highPriorityCount}\n- Should Stop: ${shouldStop}`,
          },
        ],
        structuredContent: {
          gapCount: gapAnalysis.gaps.length,
          gaps: gapAnalysis.gaps,
          confidence: uncertaintyAnalysis.overallConfidence,
          highPriorityCount: uncertaintyAnalysis.highPriorityCount,
          shouldStop,
        },
      };
    },
  );

  // Tool 7: hitl_generateQuestions
  server.registerTool(
    "hitl_generateQuestions",
    {
      title: "Step 3: Generate Questions",
      description: "Generate adaptive questions for the user based on gap analysis",
      inputSchema: {
        maxQuestions: z.number().optional().default(6),
      },
    },
    async ({ maxQuestions }: { maxQuestions: number }) => {
      if (!hitlState.lastUncertaintyAnalysis) {
        return {
          content: [{ type: "text" as const, text: "Error: No analysis results. Run hitl_analyzeGaps first." }],
          isError: true,
        };
      }

      console.log(`Interactive HITL: Generating questions...`);

      const questions = await generateAdaptiveQuestions(
        hitlState.lastUncertaintyAnalysis.stepPriorities,
        hitlState.lastUncertaintyAnalysis.flowUncertainties,
        maxQuestions,
        hitlState.allQuestions, // Passes all previously asked questions for deduplication
      );

      hitlState.lastQuestions = questions;

      if (questions.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No new questions generated (all gaps covered or low priority)." }],
          structuredContent: { questions: [] },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Generated ${questions.length} questions:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`,
          },
        ],
        structuredContent: { questions },
      };
    },
  );

  // Tool 8: hitl_refineUseCase
  server.registerTool(
    "hitl_refineUseCase",
    {
      title: "Step 4: Refine Use Case",
      description: "Refine the use case using user answers",
      inputSchema: {
        answers: z.array(
          z.object({
            questionId: z.string(),
            answer: z.string(),
          })
        ),
      },
    },
    async ({ answers }: { answers: Array<{ questionId: string; answer: string }> }) => {
      if (!hitlState.currentUseCase || !hitlState.lastQuestions) {
        return {
          content: [{ type: "text" as const, text: "Error: No questions available. Run hitl_generateQuestions first." }],
          isError: true,
        };
      }

      console.log(`Interactive HITL: Refining use case with ${answers.length} answers...`);

      // 1. Convert simple answers to OpenEndedAnswer format (adding high confidence since it's a human)
      const openEndedAnswers: OpenEndedAnswer[] = answers.map((a: { questionId: string; answer: string }) => ({
        questionId: a.questionId,
        answer: a.answer,
        confidence: "high",
      }));

      // 2. Update conversation history (Dual-Vector Deduplication)
      const contextsToEmbed: string[] = [];
      const questionsToEmbed: string[] = [];
      const historyRecords: any[] = [];

      for (const q of hitlState.lastQuestions) {
        const a = openEndedAnswers.find((ans) => ans.questionId === q.id);
        if (!a) continue;

        const stepContext = q.context.step || "Global";
        const description = q.context.whyAsking;
        const contextString = `${stepContext} | ${description}`;

        contextsToEmbed.push(contextString);
        questionsToEmbed.push(q.question);

        const consolidatedMatch = q.id.match(/consolidated-([a-z_]+)-steps-([0-9-]+)/);
        const consolidatedGroupId = consolidatedMatch ? consolidatedMatch[1] : undefined;
        const consolidatedSteps = consolidatedMatch?.[2]
          ? consolidatedMatch[2].split("-").map((value) => parseInt(value))
          : undefined;
        historyRecords.push({
          stepContext,
          question: q.question,
          answer: a.answer,
          iteration: hitlState.iterationCount + 1,
          metadata: {
            stepIndex: q.id.match(/step-(\d+)/)
              ? parseInt(q.id.match(/step-(\d+)/)![1])
              : undefined,
            stepIndexes: consolidatedSteps,
            gapType: q.context.patternType as GapType,
            consolidatedGroupId,
            flowId: q.context.flowId || "MAIN",
          },
        });
      }

      if (contextsToEmbed.length > 0) {
        const contextVectors = await semanticService.embedBatch(contextsToEmbed);
        const questionVectors = await semanticService.embedBatch(questionsToEmbed);

        for (let i = 0; i < historyRecords.length; i++) {
          hitlState.conversationHistory.push({
            ...historyRecords[i],
            vector: contextVectors[i],
            questionVector: questionVectors[i],
          });
        }
      }

      // 3. Update allQuestions list
      hitlState.allQuestions.push(...hitlState.lastQuestions.map((q) => q.question));

      // 4. Refine the use case
      const updatedUseCase = await refineWithHybridAnswers(
        hitlState.description!,
        hitlState.currentUseCase,
        [], // No MC questions
        [],
        openEndedAnswers,
        geminiFunctions,
      );

      hitlState.currentUseCase = updatedUseCase;
      hitlState.iterationCount++;

      // Clear last cycle state
      hitlState.lastQuestions = null;
      hitlState.lastValidation = null;
      hitlState.lastGapAnalysis = null;
      hitlState.lastUncertaintyAnalysis = null;

      return {
        content: [
          {
            type: "text" as const,
            text: `Use case refined (Iteration ${hitlState.iterationCount}).\nFlows: ${updatedUseCase.flows.length}`,
          },
        ],
        structuredContent: { useCase: updatedUseCase },
      };
    },
  );
}
