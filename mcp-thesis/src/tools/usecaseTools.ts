import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JsonProjectStore } from "../stores/projectStore.js";
import { useCaseSchema } from "../schemas/usecase.schema.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import saveUseCase from "../helpers/saveUseCase.js";
import { useCaseToUML } from "../helpers/helpers.js";
import { generateFlatUseCase } from "../services/usecase.service.js";
import {
  formatValidationForLLM,
  scoreUseCaseTerms,
  validateUseCaseWithFeedback,
} from "../validators/flat.validator.js";
import { generateLLMQuestions } from "../validators/llm.validator.js";

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
            <useCase>
            ${JSON.stringify(geminiResponse)}
            </useCase>
        `,
          },
        ],
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
        extractedJsonString: z
          .string()
          .describe("Extracted use case details in JSON format"),
      },
    },
    async ({ extractedJsonString }) => {
      const resultValid = genUseCaseSchema.safeParse(
        JSON.parse(extractedJsonString)
      );
      if (!resultValid.success) {
        // todo: call gemini to ensure the extracted use case is in the correct format
        return {
          content: [
            { type: "text" as const, text: "❌ Invalid use case format" },
          ],
          isError: true,
        };
      }
      const extractedUseCase = resultValid.data;
      const validationResult = await validateUseCaseWithFeedback(
        extractedUseCase,
        {
          projectStore: projectStore,
        }
      );
      if (
        validationResult.score?.overall &&
        validationResult.score.overall < 80
      ) {
        const formattedValidationFeedback =
          formatValidationForLLM(validationResult);
        const questions = await generateLLMQuestions(
          extractedUseCase,
          formattedValidationFeedback
        );
        return {
          content: [
            {
              type: "text" as const,
              text: questions.map((question) => `- ${question}`).join("\n"),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(validationResult, null, 2),
          },
        ],
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
