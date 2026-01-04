import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { writeFile, readFile } from "fs/promises";
import { JsonProjectStore } from "../stores/projectStore.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import {
  generateFlatUseCase,
  improveUseCase,
  refineWithConstrainedAnswers,
  refineWithHybridAnswers,
  extractFlowsFromOpenEndedAnswers,
} from "../services/usecase.service.js";
import {
  validateUseCaseWithFeedback,
  formatValidationForLLM,
} from "../validators/flat.validator.js";
import {
  generateLLMQuestions,
  answerLLMQuestions,
  generateMultipleChoiceQuestions,
  generateMultipleChoiceQuestionsWithScores,
  expertAnswerMultipleChoice,
  generateHybridQuestions,
  expertAnswerOpenEndedQuestions,
  generateAdaptiveQuestions,
} from "../validators/llm.validator.js";
import { evaluateUseCase } from "../evaluators/three-tier.evaluator.js";
import { analyzeGaps } from "../analyzers/gap.analyzer.js";
import { rankAllUncertainties } from "../evaluators/uncertainty.ranker.js";

export function registerTestingTools(
  server: McpServer,
  projectStore: JsonProjectStore,
  geminiFunctions: GeminiOpenRouterFunctions
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
                "Expert-level description, just contain flows, not detailed description"
              ),
            groundTruthJson: z.string(),
            complexity: z.enum(["simple", "medium", "complex"]).optional(),
            notes: z.string().optional(),
          })
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
          const groundTruth = JSON.parse(tc.groundTruthJson);
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
    }
  );

  // Tool 2: runFrameworkComparison (NEW: Framework vs Baseline)
  server.registerTool(
    "runFrameworkComparison",
    {
      title: "Framework vs Baseline Comparison",
      description:
        "Compare framework (gap analysis + hybrid questions) against baseline LLM extraction and oracle. When being called, will generate a new baseline and use it for both conditions A and B",
      inputSchema: {
        datasetPath: z.string(),
        // baseline: genUseCaseSchema.describe(
        //   "The baseline we get from extractUseCase tool"
        // ),
        testCaseIds: z.array(z.string()).optional(),
        includeIntermediateResults: z.boolean().optional(),
      },
    },
    async ({ datasetPath, testCaseIds, includeIntermediateResults }) => {
      const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
      const testCases = testCaseIds
        ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
        : dataset.testCases;

      const results = [];

      for (const tc of testCases) {
        console.log(`Testing ${tc.id}...`);

        // Condition A: Baseline (Pre-generated, no framework)
        console.log(`  Using pre-generated baseline...`);
        // baseline is already loaded above

        // Condition B: Framework (Same baseline → Gap Analysis → Hybrid Questions → Refinement)
        console.log(`  Framework with gap analysis...`);

        // Step 1: Use the SAME baseline as Condition A (no regeneration)
        const draft = await generateFlatUseCase({
          description: tc.inputs.vague,
          geminiFunctions: geminiFunctions,
        });

        // Step 2: Validate and analyze gaps
        const validation = await validateUseCaseWithFeedback(draft, {
          projectStore,
        });
        const gapAnalysis = await analyzeGaps(
          draft,
          validation.score!,
          tc.inputs.vague
        );

        // Step 3: Generate hybrid questions (MC + open-ended)
        const hybridQuestions = await generateHybridQuestions(
          gapAnalysis,
          draft,
          tc.inputs.vague,
          formatValidationForLLM(validation),
          geminiFunctions
        );

        // Step 4: Expert answers questions (simulated using detailed description)
        const mcAnswers =
          hybridQuestions.mcQuestions.length > 0
            ? await expertAnswerMultipleChoice(
                hybridQuestions.mcQuestions,
                tc.inputs.detailed,
                tc.domain,
                geminiFunctions
              )
            : [];

        const openEndedAnswers =
          hybridQuestions.openEndedQuestions.length > 0
            ? await expertAnswerOpenEndedQuestions(
                hybridQuestions.openEndedQuestions,
                tc.inputs.detailed,
                tc.domain,
                geminiFunctions
              )
            : [];

        // Step 5: Refine with hybrid answers
        const framework = await refineWithHybridAnswers(
          tc.inputs.vague,
          draft,
          hybridQuestions.mcQuestions,
          mcAnswers,
          openEndedAnswers,
          geminiFunctions
        );

        // Condition C: Oracle (Detailed → LLM → Done, upper bound)
        // console.log(`  Oracle extraction...`);
        // const oracle = await generateFlatUseCase({
        //   description: tc.inputs.detailed,
        //   geminiFunctions: geminiFunctions,
        // });

        // as oracle is just the ground truth, we don't need to generate it

        results.push({
          testCaseId: tc.id,
          conditionA_Baseline: draft,
          conditionB_Framework: framework,
          conditionC_Oracle: tc.groundTruth,
          groundTruth: tc.groundTruth,
          intermediateData: includeIntermediateResults
            ? {
                gapAnalysis: {
                  missingExceptionFlows: gapAnalysis.missingExceptionFlows,
                  missingAlternativeFlows: gapAnalysis.missingAlternativeFlows,
                  totalGaps: gapAnalysis.gaps.length,
                  highPriorityGaps: gapAnalysis.gaps.filter(
                    (g) => g.severity === "high"
                  ).length,
                  completenessScore: gapAnalysis.completenessScore,
                },
                hybridQuestions: {
                  mcCount: hybridQuestions.mcQuestions.length,
                  openEndedCount: hybridQuestions.openEndedQuestions.length,
                  questions: hybridQuestions,
                },
                answers: {
                  mcAnswers,
                  openEndedAnswers,
                },
              }
            : undefined,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = `test-data/results/raw/framework-comparison-${timestamp}.json`;
      await writeFile(outputPath, JSON.stringify(results, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: `Framework comparison complete: ${results.length} test cases\nResults: ${outputPath}`,
          },
        ],
        structuredContent: { results, outputPath },
      };
    }
  );

  // Tool 3: runCOVEComparison (KEEP for backward compatibility)
  server.registerTool(
    "runCOVEComparison",
    {
      title: "Run COVE Comparison",
      description: "Compare COVE with vague input vs detailed input",
      inputSchema: {
        datasetPath: z.string(),
        testCaseIds: z.array(z.string()).optional(),
      },
    },
    async ({ datasetPath, testCaseIds }) => {
      const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
      const testCases = testCaseIds
        ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
        : dataset.testCases;

      const results = [];

      for (const tc of testCases) {
        console.log(`Testing ${tc.id}...`);

        // Condition A: COVE + Vague
        const extractedVague = await generateFlatUseCase({
          description: tc.inputs.vague,
          geminiFunctions: geminiFunctions,
        });

        const validationVague = await validateUseCaseWithFeedback(
          extractedVague,
          { projectStore }
        );

        const questionsVague = await generateLLMQuestions(
          tc.inputs.vague,
          extractedVague,
          formatValidationForLLM(validationVague),
          geminiFunctions
        );

        const answersVague = await answerLLMQuestions({
          originalDescription: tc.inputs.vague,
          baseUseCase: extractedVague,
          questions: questionsVague,
          geminiFunctions: geminiFunctions,
        });

        const improvedVague = await improveUseCase({
          originalDescription: tc.inputs.vague,
          baseUseCase: extractedVague,
          answers: answersVague,
          geminiFunctions: geminiFunctions,
        });

        // Condition B: COVE + Detailed (same process)
        const extractedDetailed = await generateFlatUseCase({
          description: tc.inputs.detailed,
          geminiFunctions: geminiFunctions,
        });

        const validationDetailed = await validateUseCaseWithFeedback(
          extractedDetailed,
          { projectStore }
        );

        const questionsDetailed = await generateLLMQuestions(
          tc.inputs.detailed,
          extractedDetailed,
          formatValidationForLLM(validationDetailed),
          geminiFunctions
        );

        const answersDetailed = await answerLLMQuestions({
          originalDescription: tc.inputs.detailed,
          baseUseCase: extractedDetailed,
          questions: questionsDetailed,
          geminiFunctions: geminiFunctions,
        });

        const improvedDetailed = await improveUseCase({
          originalDescription: tc.inputs.detailed,
          baseUseCase: extractedDetailed,
          answers: answersDetailed,
          geminiFunctions: geminiFunctions,
        });

        results.push({
          testCaseId: tc.id,
          conditionA_COVEVague: improvedVague,
          conditionB_COVEDetailed: improvedDetailed,
          groundTruth: tc.groundTruth,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = `test-data/results/raw/phase1-cove-${timestamp}.json`;
      await writeFile(outputPath, JSON.stringify(results, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: `COVE comparison complete: ${results.length} test cases\nResults: ${outputPath}`,
          },
        ],
        structuredContent: { results, outputPath },
      };
    }
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

        console.log(`  Baseline generated, starting iterative refinement...`);

        // Clone baseline for iterative refinement
        let currentUseCase = JSON.parse(JSON.stringify(baseline));

        const MAX_QUESTIONS = 20;
        const MAX_ITERATIONS = 5;
        let iteration = 0;
        let totalQuestionsAsked = 0;
        const allQuestions: string[] = [];
        const allIterations: any[] = [];

        // Iterative refinement loop
        while (
          iteration < MAX_ITERATIONS &&
          totalQuestionsAsked < MAX_QUESTIONS
        ) {
          iteration++;
          console.log(`  Iteration ${iteration}...`);

          // Step 2: Validate and analyze gaps
          const validation = await validateUseCaseWithFeedback(currentUseCase, {
            projectStore,
          });

          const gapAnalysis = await analyzeGaps(
            currentUseCase,
            validation.score!,
            tc.inputs.vague
          );

          // Step 3: Uncertainty analysis and priority ranking
          const uncertaintyAnalysis = rankAllUncertainties(
            currentUseCase,
            validation.score!,
            gapAnalysis
          );

          // Stopping condition: high confidence and no high-priority gaps
          if (
            uncertaintyAnalysis.overallConfidence > 0.85 &&
            uncertaintyAnalysis.highPriorityCount === 0
          ) {
            console.log(
              `  Stopping: High confidence (${uncertaintyAnalysis.overallConfidence.toFixed(
                2
              )}) and no high-priority items`
            );
            break;
          }

          // Step 4: Generate adaptive questions based on priorities
          const adaptiveQuestions = await generateAdaptiveQuestions(
            uncertaintyAnalysis.stepPriorities,
            uncertaintyAnalysis.flowUncertainties,
            allQuestions,
            Math.min(6, MAX_QUESTIONS - totalQuestionsAsked)
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
            geminiFunctions
          );

          // Step 6: Refine use case with answers
          currentUseCase = await refineWithHybridAnswers(
            tc.inputs.vague,
            currentUseCase,
            [], // No MC questions in iterative mode
            [],
            answers,
            geminiFunctions
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
          `  Completed ${iteration} iterations, ${totalQuestionsAsked} total questions`
        );

        const hitlUseCase = currentUseCase;

        results.push({
          testCaseId: tc.id,
          conditionA_Baseline: baseline,
          conditionB_EnhancedHITL: hitlUseCase,
          iterativeRefinement: {
            totalIterations: iteration,
            totalQuestionsAsked,
            iterations: allIterations,
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
    }
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
          (tc: any) => tc.id === result.testCaseId
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
            geminiFunctions
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
        JSON.stringify({ evaluations, summary }, null, 2)
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Evaluation complete\n${JSON.stringify(
              summary,
              null,
              2
            )}\nSaved: ${outputPath}`,
          },
        ],
        structuredContent: { evaluations, summary, outputPath },
      };
    }
  );
}
