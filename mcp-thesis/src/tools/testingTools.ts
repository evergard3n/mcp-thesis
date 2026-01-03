import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { writeFile, readFile } from "fs/promises";
import { JsonProjectStore } from "../stores/projectStore.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import {
  generateFlatUseCase,
  improveUseCase,
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
} from "../validators/llm.validator.js";
import { refineWithConstrainedAnswers } from "../services/usecase.service.js";
import { evaluateUseCase } from "../evaluators/three-tier.evaluator.js";

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
            detailedDescription: z.string(),
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

  // Tool 2: runCOVEComparison
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
      const outputPath = `test-data/results/phase1-cove-${timestamp}.json`;
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
      title: "Run HITL vs COVE Comparison",
      description: "Compare constrained HITL against COVE with detailed input",
      inputSchema: {
        datasetPath: z.string(),
        phase1ResultsPath: z
          .string()
          .optional()
          .describe("Reuse COVE-Detailed results from Phase 1"),
        testCaseIds: z.array(z.string()).optional(),
      },
    },
    async ({ datasetPath, phase1ResultsPath, testCaseIds }) => {
      const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
      const testCases = testCaseIds
        ? dataset.testCases.filter((tc: any) => testCaseIds.includes(tc.id))
        : dataset.testCases;

      // Load COVE-Detailed results from Phase 1 if provided
      let phase1Results = null;
      if (phase1ResultsPath) {
        phase1Results = JSON.parse(await readFile(phase1ResultsPath, "utf-8"));
      }

      const results = [];

      for (const tc of testCases) {
        console.log(`Testing ${tc.id} with HITL...`);

        // Get COVE-Detailed from Phase 1 or re-run
        let coveDetailed;
        if (phase1Results) {
          const phase1Result = phase1Results.find(
            (r: any) => r.testCaseId === tc.id
          );
          coveDetailed = phase1Result?.conditionB_COVEDetailed;
        }

        if (!coveDetailed) {
          // Re-run if not found
          const extracted = await generateFlatUseCase({
            description: tc.inputs.detailed,
            geminiFunctions: geminiFunctions,
          });

          const validation = await validateUseCaseWithFeedback(extracted, {
            projectStore,
          });
          const questions = await generateLLMQuestions(
            tc.inputs.detailed,
            extracted,
            formatValidationForLLM(validation),
            geminiFunctions
          );
          const answers = await answerLLMQuestions({
            originalDescription: tc.inputs.detailed,
            baseUseCase: extracted,
            questions,
            geminiFunctions: geminiFunctions,
          });
          coveDetailed = await improveUseCase({
            originalDescription: tc.inputs.detailed,
            baseUseCase: extracted,
            answers,
            geminiFunctions: geminiFunctions,
          });
        }

        // Run HITL - Step 1: Generator extracts from vague input
        const draft = await generateFlatUseCase({
          description: tc.inputs.vague,
          geminiFunctions: geminiFunctions,
        });

        // Step 2: Validate and get MC questions with scores
        const validation = await validateUseCaseWithFeedback(draft, {
          projectStore,
        });
        const formattedFeedback = formatValidationForLLM(validation);

        const mcQuestions = await generateMultipleChoiceQuestionsWithScores(
          tc.inputs.vague,
          draft,
          formattedFeedback,
          validation.score!,
          geminiFunctions
        );

        // Step 3: Expert answers (simulating human)
        const answers = await expertAnswerMultipleChoice(
          mcQuestions,
          tc.inputs.detailed,
          tc.domain,
          geminiFunctions
        );

        // Step 4: Constrained refinement
        const hitlUseCase = await refineWithConstrainedAnswers(
          tc.inputs.vague,
          draft,
          mcQuestions,
          answers,
          geminiFunctions
        );

        results.push({
          testCaseId: tc.id,
          conditionC_COVEDetailed: coveDetailed,
          conditionD_HITL: hitlUseCase,
          hitlQuestions: mcQuestions.map((q, i) => ({
            question: q.question,
            answer: answers[i]?.selectedOption,
          })),
          groundTruth: tc.groundTruth,
        });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = `test-data/results/phase2-hitl-${timestamp}.json`;
      await writeFile(outputPath, JSON.stringify(results, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: `HITL comparison complete: ${results.length} test cases\nResults: ${outputPath}`,
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
            key === "hitlQuestions"
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

      const outputPath = resultsPath.replace(".json", "-evaluated.json");
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
