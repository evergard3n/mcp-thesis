import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JsonProjectStore } from "../stores/projectStore.js";
import { useCaseSchema } from "../schemas/usecase.schema.js";
import saveUseCase from "../helpers/saveUseCase.js";
import { useCaseToUML } from "../helpers/helpers.js";
import { generateFlatUseCase } from "../helpers/usecase.service.js";
import {
  scoreUseCaseTerms,
  validateUseCaseWithFeedback,
} from "../validators/flat.validator.js";

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
      const existingActors = await projectStore.getAllActors();
      const actorNames = existingActors.map((a) => a.name);
      // Now we can pass the JSON string directly - no need to parse first!
      const validationResult = validateUseCaseWithFeedback(
        geminiResponse,
        actorNames
      );
      projectStore.log(`Gemini response: ${geminiResponse}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `
          ${geminiResponse}
          Score: ${JSON.stringify(validationResult)}
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
      description:
        "Second step in adding a use case to the project. Validate the extracted use case details to see if its already present in the project store, or having mismatch actors or actions",
      inputSchema: {
        extractedJsonString: z
          .string()
          .describe("Extracted use case details in JSON format"),
      },
    },
    async ({ extractedJsonString }) => {
      const resultValid = useCaseSchema.safeParse(
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
      // todo: add a validation to see if the extracted use case is in the correct format
      const name = extractedUseCase.name;
      const description = extractedUseCase.description;
      const mainActor = extractedUseCase.mainActor;
      const actors = extractedUseCase.actors;
      const steps = extractedUseCase.steps;
      if (!projectStore.getStore()) {
        return {
          content: [{ type: "text" as const, text: "❌ No project loaded" }],
          isError: true,
        };
      }

      const useCases = projectStore.getAllUseCases();
      if (useCases.length === 0) {
        await saveUseCase(extractedUseCase, projectStore);
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Use case saved successfully:
        **Use Case ID:** ${extractedUseCase.id || "auto-generated"}
        **Name:** ${name}
        **Description:** ${description}
        **Main Actor:** ${mainActor}
        **Actors:** ${actors.map((a) => `${a.name} (${a.actor_id})`).join(", ")}
        **Steps:** ${steps.length} step(s)`,
            },
          ],
        };
      } else {
        const existingActors = await projectStore.getAllActors();
        return {
          content: [
            {
              type: "text" as const,
              text: `The user has provided a use case description. 
            Here is the use case with extracted details: ${JSON.stringify(
              extractedUseCase
            )}
            Here is the list of actors in the project store: ${JSON.stringify(
              existingActors
            )}
            Here is the list of use cases in the project store: ${JSON.stringify(
              useCases
            )}
            Your job is to validate the use case details to see if its already present in the project store, or having mismatch actors or actions.
            If its already present in the project store, notify the user and return the use case id.
            If its not present in the project, but the actors from the newUseCase has different names or descriptions, modify the new use case. 
            You MUST return the modified use case details as a JSON in the following format:
          {
            "name": "Use case name",
            "description": "Use case description",
            "mainActor": "main_actor_id",
            "actors": [
              {
                "actor_id": "Actor id",
                "name": "Actor name",
                "description": "Actor description",
              }
            ],
            "firstStepId": "optional_id_of_first_step",
            "steps": [
              {
                "id": "step_id",
                "description": "Optional step description",
                "prev": "optional_previous_step_id",
                "next": "optional_next_step_id",
                ... (step-specific fields based on type: Action, ConditionBlock, or LoopBlock)
              }
            ]
          }
          For Action steps, include: "from", "to", "message", and optionally "type" ("request" | "response")
          For ConditionBlock steps, include: "condition", "ifSteps", and optionally "elseSteps"
          For LoopBlock steps, include: "loopCondition", "steps"
          
            Do not add any other text or formatting. Just return the JSON.
            After that, call the 'saveUseCase' tool with the modified use case details to save the use case to the project store.
  `,
            },
          ],
        };
      }
    }
  );

  // [ADD USE CASE] Step 3: save
  server.registerTool(
    "saveUseCase",

    {
      title: "Save use case tool",
      description:
        "Last step in adding a use case to the project. Receives a validated JSON use case, then save the use case to the project store",
      inputSchema: {
        useCaseJson: z.string().describe("Validated JSON use case"),
      },
    },
    async ({ useCaseJson }) => {
      const useCase = useCaseSchema.parse(JSON.parse(useCaseJson));
      const resultValid = useCaseSchema.safeParse(useCase);
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

      await saveUseCase(extractedUseCase, projectStore);
      return {
        content: [
          {
            type: "text" as const,
            text: `
        Use case saved successfully:
        **Use Case ID:** ${extractedUseCase.id || "auto-generated"}
        **Name:** ${extractedUseCase.name}
        **Description:** ${extractedUseCase.description}
        **Main Actor:** ${extractedUseCase.mainActor}
        **Actors:** ${extractedUseCase.actors
          .map((a) => `${a.name} (${a.actor_id})`)
          .join(", ")}
        **First Step ID:** ${extractedUseCase.firstStepId || "not specified"}
        **Steps:** ${extractedUseCase.steps.length} step(s)
        `,
          },
        ],
      };
    }
  );

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
