import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JsonProjectStore } from "../stores/projectStore.js";
import { useCaseSchema } from "../schemas/usecase.schema.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import saveUseCase from "../helpers/saveUseCase.js";
import { useCaseToUML } from "../helpers/helpers.js";
import {
  generateFlatUseCase,
  improveUseCase,
} from "../services/usecase.service.js";
import {
  formatValidationForLLM,
  scoreUseCaseTerms,
  validateUseCaseWithFeedback,
} from "../validators/flat.validator.js";
import {
  answerLLMQuestions,
  generateLLMQuestions,
} from "../validators/llm.validator.js";

/**
 * Register all usecase-related tools to the MCP server
 */
export function registerUseCaseTools(
  server: McpServer,
  projectStore: JsonProjectStore
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
      const geminiResponse = await generateFlatUseCase({ description: input });
      // Now we can pass the JSON string directly - no need to parse first!
      const validationResult = await validateUseCaseWithFeedback(
        geminiResponse,
        {
          projectStore: projectStore,
        }
      );
      projectStore.log(`Gemini response: ${JSON.stringify(geminiResponse)}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `
            <instructions>This is the extracted use case details in JSON string format. Please validate it using the validateUseCase tool. Only pass the JSON string to the validateUseCase tool, do not add any other text or formatting.</instructions>
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
        useCase: genUseCaseSchema.describe("Extracted use case"),
      },
      outputSchema: {
        feedback: z.array(z.string()).describe("Validation feedback"),
      },
    },
    async ({ useCase }) => {
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
        extractedUseCase,
        formattedValidationFeedback
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
              }/100`,
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
    async ({ baseUseCase, improvementQuestions }) => {
      const answers = await answerLLMQuestions({
        baseUseCase: baseUseCase,
        questions: improvementQuestions,
      });
      const improvedUseCase = await improveUseCase({
        baseUseCase: baseUseCase,
        answers: answers,
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
          improvedUseCase,
          formattedValidationFeedback
        );
        return {
          content: [
            {
              type: "text" as const,
              text: questions.map((question) => `- ${question}`).join("\n"),
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
}
