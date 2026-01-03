import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { useCaseToUML } from "../helpers/helpers.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import {
  generateFlatUseCase,
  improveUseCase,
  refineWithConstrainedAnswers,
} from "../services/usecase.service.js";
import { JsonProjectStore } from "../stores/projectStore.js";
import {
  formatValidationForLLM,
  validateUseCaseWithFeedback,
} from "../validators/flat.validator.js";
import {
  answerLLMQuestions,
  compareUseCases,
  generateLLMQuestions,
  generateMultipleChoiceQuestions,
  generateMultipleChoiceQuestionsWithScores,
  expertAnswerMultipleChoice,
} from "../validators/llm.validator.js";
import { analysisSchema } from "../schemas/analysis.schema.js";

/**
 * Register all usecase-related tools to the MCP server
 */
export function registerUseCaseTools(
  server: McpServer,
  projectStore: JsonProjectStore,
  geminiFunctions: GeminiOpenRouterFunctions
) {
  // [ADD USE CASE] Step 1: extract
  server.registerTool(
    "extractUseCase",
    {
      title: "Extract Use Case",
      description:
        "Extract use case details from the user's input into a structured format",
      inputSchema: {
        input: z
          .string()
          .describe(
            "User's input about the use case. Just put the user's input here, do not add any other text or formatting."
          ),
      },
      outputSchema: {
        useCase: genUseCaseSchema.describe("Extracted use case"),
      },
    },
    async ({ input }) => {
      const geminiResponse = await generateFlatUseCase({
        description: input,
        geminiFunctions: geminiFunctions,
      });
      // Now we can pass the JSON string directly - no need to parse first!
      // const validationResult = await validateUseCaseWithFeedback(
      //   geminiResponse,
      //   {
      //     projectStore: projectStore,
      //   }
      // );
      projectStore.log(`Gemini response: ${JSON.stringify(geminiResponse)}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `
            This is the extracted use case details in JSON string format.
            ${JSON.stringify(geminiResponse, null, 2)}
        `,
          },
        ],
        structuredContent: {
          useCase: geminiResponse,
        },
      };
    }
  );

  // [ADD USE CASE] Step 2: validate
  server.registerTool(
    "validateUseCase",
    {
      title: "Validate Use Case",
      description: `Second step in adding a use case to the project. test changes.
        Validate and score the extracted use case to find possible mistakes and improvements.
        Call Gemini to generate further improvement questions if needed.
        `,
      inputSchema: {
        originalDescription: z
          .string()
          .describe(
            "The original user description/requirement that was used to generate the use case"
          ),
        useCase: genUseCaseSchema.describe("Extracted use case"),
      },
      outputSchema: {
        feedback: z.array(z.string()).describe("Validation feedback"),
      },
    },
    async ({ originalDescription, useCase }) => {
      const resultValid = genUseCaseSchema.safeParse(useCase);
      if (!resultValid.success) {
        // todo: call gemini to ensure the extracted use case is in the correct format
        return {
          content: [
            { type: "text" as const, text: "❌ Invalid use case format" },
          ],
          structuredContent: {
            feedback: ["Invalid use case format"],
          },
        };
      }
      const extractedUseCase = resultValid.data;
      const validationResult = await validateUseCaseWithFeedback(
        extractedUseCase,
        {
          projectStore: projectStore,
        }
      );
      const formattedValidationFeedback =
        formatValidationForLLM(validationResult);
      const questions = await generateLLMQuestions(
        originalDescription,
        extractedUseCase,
        formattedValidationFeedback,
        geminiFunctions
      );
      if (
        validationResult.score?.overall &&
        validationResult.score.overall < 70
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: `This use case can be improved with 'improveUseCase' tool. Please call the tool to improve the use case. This tool takes the base use case and the improvement questions as input. Current score: ${
                validationResult.score?.overall ?? 0
              }/100
              Feedback questions: ${questions.map((q) => `- ${q}`).join("\n")}
              `,
            },
          ],
          structuredContent: {
            feedback: questions,
          },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(extractedUseCase, null, 2),
          },
        ],
        structuredContent: {
          feedback: formattedValidationFeedback
            ? [formattedValidationFeedback]
            : ["Use case is valid"],
        },
      };
    }
  );

  server.registerTool(
    "improveUseCase",
    {
      title: "Improve Use Case",
      description: `Improve the use case based on the validation feedback and the improvement questions.
        `,
      inputSchema: {
        originalDescription: z
          .string()
          .describe(
            "The original user description/requirement that was used to generate the use case"
          ),
        baseUseCase: genUseCaseSchema.describe("Base use case to improve"),
        improvementQuestions: z
          .array(z.string())
          .describe("Improvement questions to improve the use case"),
      },
      outputSchema: {
        newUseCase: genUseCaseSchema.describe("Improved use case"),
        newScore: z.number().describe("Score of the improved use case"),
      },
    },
    async ({ originalDescription, baseUseCase, improvementQuestions }) => {
      const answers = await answerLLMQuestions({
        originalDescription,
        baseUseCase: baseUseCase,
        questions: improvementQuestions,
        geminiFunctions: geminiFunctions,
      });
      const improvedUseCase = await improveUseCase({
        originalDescription,
        baseUseCase: baseUseCase,
        answers: answers,
        geminiFunctions: geminiFunctions,
      });
      const validationResult = await validateUseCaseWithFeedback(
        improvedUseCase,
        {
          projectStore: projectStore,
        }
      );
      if (
        validationResult.score?.overall &&
        validationResult.score.overall < 70
      ) {
        const formattedValidationFeedback =
          formatValidationForLLM(validationResult);
        const questions = await generateLLMQuestions(
          originalDescription,
          improvedUseCase,
          formattedValidationFeedback,
          geminiFunctions
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `The improved use case is: ${JSON.stringify(
                improvedUseCase,
                null,
                2
              )}`,
            },
          ],
          structuredContent: {
            newUseCase: improvedUseCase,
            newScore: validationResult.score?.overall ?? 0,
          },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(validationResult, null, 2),
          },
        ],
        structuredContent: {
          newUseCase: improvedUseCase,
          newScore: validationResult.score?.overall ?? 0,
        },
      };
    }
  );

  // // [ADD USE CASE] Step 3: save
  // server.registerTool(
  //   "saveUseCase",

  //   {
  //     title: "Save use case tool",
  //     description:
  //       "Last step in adding a use case to the project. Receives a validated JSON use case, then save the use case to the project store",
  //     inputSchema: {
  //       useCaseJson: z.string().describe("Validated JSON use case"),
  //     },
  //   },
  //   async ({ useCaseJson }) => {
  //     const useCase = useCaseSchema.parse(JSON.parse(useCaseJson));
  //     const resultValid = useCaseSchema.safeParse(useCase);
  //     if (!resultValid.success) {
  //       // todo: call gemini to ensure the extracted use case is in the correct format
  //       return {
  //         content: [
  //           { type: "text" as const, text: "❌ Invalid use case format" },
  //         ],
  //         isError: true,
  //       };
  //     }
  //     const extractedUseCase = resultValid.data;

  //     await saveUseCase(extractedUseCase, projectStore);
  //     return {
  //       content: [
  //         {
  //           type: "text" as const,
  //           text: `
  //       Use case saved successfully:
  //       **Use Case ID:** ${extractedUseCase.id || "auto-generated"}
  //       **Name:** ${extractedUseCase.name}
  //       **Description:** ${extractedUseCase.description}
  //       **Main Actor:** ${extractedUseCase.mainActor}
  //       **Actors:** ${extractedUseCase.actors
  //         .map((a) => `${a.name} (${a.actor_id})`)
  //         .join(", ")}
  //       **First Step ID:** ${extractedUseCase.firstStepId || "not specified"}
  //       **Steps:** ${extractedUseCase.steps.length} step(s)
  //       `,
  //         },
  //       ],
  //     };
  //   }
  // );

  server.registerTool(
    "useCaseToUML",
    {
      title: "Use Case to UML",
      description: "Convert a saved use case to PlantUML format",
      inputSchema: {
        useCaseId: z.string().describe("Use case ID"),
      },
    },
    async ({ useCaseId }) => {
      if (!projectStore.getStore()) {
        return {
          content: [{ type: "text" as const, text: "❌ No project loaded" }],
          isError: true,
        };
      }
      const useCase = projectStore.getUseCase(useCaseId);
      if (!useCase) {
        return {
          content: [{ type: "text" as const, text: "❌ Use case not found" }],
          isError: true,
        };
      }

      const uml = await useCaseToUML(useCase, projectStore);
      return {
        content: [
          {
            type: "text" as const,
            text: `Use case converted to PlantUML format: ${uml}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "compareUseCases",
    {
      title: "Compare Use Cases",
      description:
        "Compare two use cases and provide a detailed analysis with scoring. Takes a reference use case (ground truth) and a generated use case to evaluate.",
      inputSchema: {
        originalDescription: z
          .string()
          .describe(
            "The original user description/requirement that was used to generate the use case"
          ),
        referenceUseCase: genUseCaseSchema.describe(
          "Reference use case (ground truth/golden standard)"
        ),
        generatedUseCase: genUseCaseSchema.describe(
          "Generated use case to evaluate"
        ),
      },
      outputSchema: {
        analysis: analysisSchema.describe(
          "Detailed use case comparison analysis"
        ),
      },
    },
    async ({ originalDescription, referenceUseCase, generatedUseCase }) => {
      const analysis = await compareUseCases({
        originalDescription,
        refUseCase: referenceUseCase,
        newUseCase: generatedUseCase,
      });
      const averageScore =
        0.2 * analysis.scores.semantic_coverage +
        0.2 * analysis.scores.entity_alignment +
        0.2 * analysis.scores.factuality +
        0.4 * analysis.scores.structure;
      return {
        content: [
          {
            type: "text" as const,
            text: `
## Use Case Comparison Analysis

**Verdict:** ${analysis.verdict}
**Weighted Average Score:** ${averageScore}/10

### Scores
- Semantic Coverage: ${analysis.scores.semantic_coverage}/10
- Entity Alignment: ${analysis.scores.entity_alignment}/10
- Factuality: ${analysis.scores.factuality}/10
- Structure: ${analysis.scores.structure}/10

### Explanation (Vietnamese)
${analysis.explanation_vi}

### Chain of Thought Analysis
**Actor Comparison:** ${analysis.analysis_chain_of_thought.actor_comparison}

**Flow Mapping:** ${analysis.analysis_chain_of_thought.flow_mapping}

**Hallucination Check:** ${analysis.analysis_chain_of_thought.hallucination_check}
            `,
          },
        ],
        structuredContent: {
          analysis,
        },
      };
    }
  );

  server.registerTool(
    "generateQuestionsFromBaseline",
    {
      title: "Generate MC Questions from Baseline",
      description:
        "Generate multiple-choice questions from baseline use case and validation feedback",
      inputSchema: {
        baselineUseCase: genUseCaseSchema.describe(
          "Baseline use case extracted from vague input"
        ),
        originalDescription: z.string().describe("Original vague description"),
        includeScores: z
          .boolean()
          .default(true)
          .describe(
            "Include rule-based validation scores in question generation"
          ),
      },
    },
    async ({ baselineUseCase, originalDescription, includeScores }) => {
      // Validate baseline
      const validation = await validateUseCaseWithFeedback(baselineUseCase, {
        projectStore,
      });
      const formattedFeedback = formatValidationForLLM(validation);

      let questions;
      if (includeScores && validation.score) {
        questions = await generateMultipleChoiceQuestionsWithScores(
          originalDescription,
          baselineUseCase,
          formattedFeedback,
          validation.score,
          geminiFunctions
        );
      } else {
        questions = await generateMultipleChoiceQuestions(
          originalDescription,
          baselineUseCase,
          formattedFeedback,
          geminiFunctions
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Generated ${questions.length} multiple-choice questions for human review`,
          },
        ],
        structuredContent: {
          questions,
          validationScore: validation.score,
          baseline: baselineUseCase,
        },
      };
    }
  );

  server.registerTool(
    "refineWithHumanAnswers",
    {
      title: "Refine Use Case with Human Answers",
      description:
        "Refine use case based on human answers to multiple-choice questions",
      inputSchema: {
        baselineUseCase: genUseCaseSchema.describe("Baseline use case"),
        originalDescription: z.string().describe("Original description"),
        questions: z
          .array(
            z.object({
              id: z.string(),
              question: z.string(),
              options: z.array(z.string()),
            })
          )
          .describe("Questions that were asked"),
        humanAnswers: z
          .array(
            z.object({
              questionId: z.string(),
              selectedOption: z.string(),
              reasoning: z
                .string()
                .optional()
                .describe("Optional human reasoning"),
            })
          )
          .describe("Answers provided by human expert"),
      },
    },
    async ({
      baselineUseCase,
      originalDescription,
      questions,
      humanAnswers,
    }) => {
      const refined = await refineWithConstrainedAnswers(
        originalDescription,
        baselineUseCase,
        questions,
        humanAnswers,
        geminiFunctions
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Use case refined based on ${humanAnswers.length} human answers`,
          },
        ],
        structuredContent: {
          refinedUseCase: refined,
          appliedAnswers: humanAnswers.length,
        },
      };
    }
  );
}
