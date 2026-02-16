import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GenFlow } from "../interfaces/usecase.interface.new.js";
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
} from "../validators/flat.validator.js";
import {
  generateLLMQuestions,
  answerLLMQuestions,
  generateMultipleChoiceQuestions,
  expertAnswerMultipleChoice,
  generateHybridQuestions,
  expertAnswerOpenEndedQuestions,
  generateAdaptiveQuestions,
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
} from "../analyzers/gap.analyzer.js";
import { rankAllUncertainties } from "../analyzers/uncertainty.ranker.js";
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

export function registerTestingTools(
  server: McpServer,
  projectStore: JsonProjectStore,
  geminiFunctions: GeminiOpenRouterFunctions,
) {
  // Tool 1: prepareTestData
  server.registerTool(
    "prepareTestData",
    {
      title: "Prepare Test Dataset",
      description: "Validate test cases and create structured dataset JSON",
      inputSchema: {
        testCases: z.array(
          z.object({
            testCaseId: z.string(),
            domain: z.string(),
            vagueSummary: z.string(),
            detailedDescription: z
              .string()
              .describe(
                "Expert-level description, just contain flows, not detailed steps",
              ),
            textBasedGroundTruth: z
              .string()
              .describe(
                "Text describing the ground truth use case, from which we will generate the structured flows",
              ),
            complexity: z.enum(["simple", "medium", "complex"]).optional(),
            notes: z.string().optional(),
          }),
        ),
      },
    },
    async ({ testCases }) => {
      const validated = [];
      const dataset: {
        version: string;
        createdAt: string;
        testCases: Array<{
          id: string;
          domain: string;
          metadata: {
            complexity: "simple" | "medium" | "complex";
            expectedFlows: number;
            notes?: string;
          };
          inputs: {
            vague: string;
            detailed: string;
          };
          groundTruth: any;
        }>;
      } = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        testCases: [],
      };

      for (const tc of testCases) {
        try {
          const groundTruth = generateFlatUseCase({
            description: tc.textBasedGroundTruth,
            geminiFunctions,
          });
          const validatedTruth = genUseCaseSchema.parse(groundTruth);

          dataset.testCases.push({
            id: tc.testCaseId,
            domain: tc.domain,
            metadata: {
              complexity: tc.complexity || "medium",
              expectedFlows: validatedTruth.flows.length,
              notes: tc.notes,
            },
            inputs: {
              vague: tc.vagueSummary,
              detailed: tc.detailedDescription,
            },
            groundTruth: validatedTruth,
          });

          validated.push({ id: tc.testCaseId, status: "valid" });
        } catch (error: any) {
          validated.push({
            id: tc.testCaseId,
            status: "invalid",
            errors: [error.message],
          });
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = `test-data/dataset-${timestamp}.json`;
      await writeFile(outputPath, JSON.stringify(dataset, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: `Dataset prepared: ${
              validated.filter((v) => v.status === "valid").length
            }/${testCases.length} valid\nSaved to: ${outputPath}`,
          },
        ],
        structuredContent: { validated, outputFile: outputPath },
      };
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
}
