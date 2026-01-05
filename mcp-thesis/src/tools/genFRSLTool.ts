import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JsonProjectStore } from "../stores/projectStore.js";
import {
  formatValidationForLLM,
  scoreUseCaseTerms,
  validateUseCaseWithFeedback,
} from "../validators/flat.validator.js";
import { generateFlatUseCase, genFRSL } from "../services/usecase.service.js";
import { convertToFRSL } from "../model/convertToFRSL.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { generateLLMQuestions } from "../validators/llm.validator.js";

export function registerFrslTool(
  server: McpServer,
  projectStore: JsonProjectStore
) {
  // [ADD USE CASE] Step 3: convert to FRSL
  server.registerTool(
    "convertToFRSL",
    {
      title: "Convert Use Case to FRSL",
      description: `Third step in adding a use case to the project.
          Convert the validated use case into FRSL format for further processing.
          `,
      inputSchema: {
        extractedJsonString: z
          .string()
          .describe("Validated use case details in JSON format"),
      },
    },
    async ({ extractedJsonString }) => {
      const resultValid = genUseCaseSchema.safeParse(
        JSON.parse(extractedJsonString)
      );
      if (!resultValid.success) {
        return {
          content: [{ type: "text" as const, text: "Invalid use case format" }],
          isError: true,
        };
      }
      const extractedUseCase = resultValid.data;
      const frslUseCase = convertToFRSL(extractedUseCase);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(frslUseCase, null, 2),
          },
        ],
      };
    }
  );
}
