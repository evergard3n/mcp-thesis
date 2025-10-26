#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NWS_API_BASE } from "./helpers/env.js";
import {
  AlertsResponse,
  ForecastPeriod,
  ForecastResponse,
  formatAlert,
  makeNWSRequest,
  PointsResponse,
} from "./helpers/weatherHelpers.js";
import { JsonProjectStore } from "./stores/projectStore.js";
import { UseCase } from "./interfaces/usecase.interface.js";
import { useCaseSchema } from "./schemas/usecase.schema.js";
import saveUseCase from "./helpers/saveUseCase.js";
import { useCaseToUML } from "./helpers/helpers.js";

const server = new McpServer({
  name: "test_server",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

const projectStore = new JsonProjectStore();

// Register weather tools
server.tool(
  "get_alerts",
  "Get weather alerts for a state",
  {
    state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
  },
  async ({ state }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join(
      "\n"
    )}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  }
);

// init project tool
server.tool(
  "initProject",
  "Initialize a new UML project with markdown-based storage",
  {
    name: z.string().describe("Project name"),
    description: z.string().describe("Project description"),
  },
  async ({ name, description }) => {
    try {
      const path = await projectStore.initProject(name, description);

      return {
        content: [
          {
            type: "text",
            text: `✅ Project initialized successfully!

**Path:** ${path}
**Name:** ${name}
**Log Path:** ${projectStore.logPath}

Project structure created:
- README.md (project documentation)
- project.json (metadata)
- use-cases/ (store use case descriptions)
- diagrams/ (generated PlantUML diagrams)
- entities/ (actors, systems, classes)

You can now add use cases with the 'addUseCase' tool.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Load project by name
server.tool(
  "loadProjectByName",
  "Load an existing project by its name",
  {
    name: z.string().describe("Project name to load"),
  },
  async ({ name }) => {
    try {
      const success = await projectStore.loadProjectByName(name);

      if (success) {
        const summary = await projectStore.getProjectSummary();
        return {
          content: [
            {
              type: "text",
              text: `✅ Project "${name}" loaded successfully!\n\n📊 Summary:\n- Use Cases: ${summary?.stats.totalUseCases}\n- Actors: ${summary?.stats.totalActors}\n- Actions: ${summary?.stats.totalActions}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `❌ Project "${name}" not found. Use 'listAllProjects' to see available projects.`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Find project by name
server.tool(
  "findProjectByName",
  "Given a project name, list all projects, then find the project with the closest name or description.",
  {
    name: z.string().describe("Project name to search for"),
  },
  async ({ name }) => {
    const projects = await projectStore.listAllProjects();

    if (projects.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "📂 No projects found. Create one with 'initProject'.",
          },
        ],
      };
    }
    const projectNamesAndDescriptions = projects.map((p) => ({
      name: p.name,
      description: p.description,
    }));
    return {
      content: [
        {
          type: "text",
          text: `
        You are given a project name - ${name} - that the user is looking for. Here are the steps to find the project:
        1. ${JSON.stringify(
          projectNamesAndDescriptions
        )}. Here is the list of projects with their names and descriptions.
        2. Find the project with the closest name or description. You can use the 'name' property to find the project with the closest name.
        3. Retrieve the closest existing project name. Then call tool 'loadProjectByName' to load the project. Pass the closest existing project name to the tool.
        `,
        },
      ],
    };
  }
);

// List all projects
server.tool(
  "listAllProjects",
  "List all available projects in the projects directory",
  {},
  async () => {
    try {
      const projects = await projectStore.listAllProjects();

      if (projects.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "📂 No projects found. Create one with 'initProject'.",
            },
          ],
        };
      }

      const projectList = projects
        .map(
          (p, idx) =>
            `${idx + 1}. **${p.name}**\n   - Created: ${new Date(
              p.createdAt
            ).toLocaleDateString()}\n   - Path: ${p.path}\n - Description: ${
              p.description
            }`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `📂 **Available Projects** (${projects.length}):\n\n${projectList}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// get current project info
server.tool(
  "getProjectInfo",
  "Get information about the current project",
  {},
  async () => {
    const summary = await projectStore.getProjectSummary();

    if (!summary) {
      return {
        content: [
          {
            type: "text",
            text: "❌ No project loaded. Use 'initProject' or 'loadProject' first.",
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `📊 **Project Information**

**Name:** ${summary.name}
**Description:** ${summary.description}
**Created:** ${summary.createdAt}
**Updated:** ${summary.updatedAt}
**Path:** ${summary.path}

**Statistics:**
- Total Use Cases: ${summary.stats.totalUseCases}
- Total Actors: ${summary.stats.totalActors}
- Total Actions: ${summary.stats.totalActions}`,
        },
      ],
    };
  }
);

server.tool(
  "extractUseCase",
  "First step in adding a use case to the project. Extract use case details from the user's input into a structured format",
  {
    input: z
      .string()
      .describe(
        "User's input about the use case. Just put the user's input here, do not add any other text or formatting."
      ),
  },
  async ({ input }) => {
    return {
      content: [
        {
          type: "text",
          instructions: "",
          text: `The user has provided a use case description. You need to extract the use case details from the user's input into a structured format. Here is the user's input:
          ${input}
          You MUST return the extracted details as a JSON in the following format:
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
            "actions": [
              {
                "id": "Action id",
                "order": 1,
                "from": "actor_id_who_initiates",
                "to": "actor_id_who_receives",
                "action": "Description of the action performed by the actor who initiates the action",
              }
            ]
          }
            Do not add any other text or formatting. Just return the JSON.
          After that, call the 'validateUseCase' tool with the extracted JSON to validate the use case details.`,
        },
      ],
    };
  }
);

server.tool(
  "validateUseCase",
  "Second step in adding a use case to the project. Validate the extracted use case details to see if its already present in the project store, or having mismatch actors or actions",
  {
    extractedJsonString: z
      .string()
      .describe("Extracted use case details in JSON format"),
  },
  async ({ extractedJsonString }) => {
    const resultValid = useCaseSchema.safeParse(
      JSON.parse(extractedJsonString)
    );
    if (!resultValid.success) {
      // todo: call gemini to ensure the extracted use case is in the correct format
      return {
        content: [{ type: "text", text: "❌ Invalid use case format" }],
        isError: true,
      };
    }
    const extractedUseCase = resultValid.data;
    // todo: add a validation to see if the extracted use case is in the correct format
    const name = extractedUseCase.name;
    const description = extractedUseCase.description;
    const mainActor = extractedUseCase.mainActor;
    const actors = extractedUseCase.actors;
    const actions = extractedUseCase.actions;
    if (!projectStore.getStore()) {
      return {
        content: [{ type: "text", text: "❌ No project loaded" }],
        isError: true,
      };
    }

    const useCases = projectStore.getAllUseCases();
    if (useCases.length === 0) {
      await saveUseCase(extractedUseCase, projectStore);
      return {
        content: [
          {
            type: "text",
            text: `✅ Use case saved successfully:
        **Use Case ID:** ${extractedUseCase.id || "auto-generated"}
        **Name:** ${name}
        **Description:** ${description}
        **Main Actor:** ${mainActor}
        **Id of Actors:** ${actors.map((a) => a.actor_id).join(", ")}
        **Actions:** ${actions.map((a) => a.action).join(", ")}`,
          },
        ],
      };
    } else {
      const existingActors = await projectStore.getAllActors();
      return {
        content: [
          {
            type: "text",
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
            "actions": [
              {
                "id": "Action id",
                "order": 1,
                "from": "actor_id_who_initiates",
                "to": "actor_id_who_receives",
                "action": "Description of the action performed by the actor who initiates the action",
              }
            ]
          }
            Do not add any other text or formatting. Just return the JSON.
            After that, call the 'saveUseCase' tool with the modified use case details to save the use case to the project store.
  `,
          },
        ],
      };
    }
  }
);

server.tool(
  "saveUseCase",
  "Last step in adding a use case to the project. Receives a validated JSON use case, then save the use case to the project store",
  {
    useCaseJson: z.string().describe("Validated JSON use case"),
  },
  async ({ useCaseJson }) => {
    const useCase = useCaseSchema.parse(JSON.parse(useCaseJson));
    const resultValid = useCaseSchema.safeParse(useCase);
    if (!resultValid.success) {
      // todo: call gemini to ensure the extracted use case is in the correct format
      return {
        content: [{ type: "text", text: "❌ Invalid use case format" }],
        isError: true,
      };
    }
    const extractedUseCase = resultValid.data;

    await saveUseCase(extractedUseCase, projectStore);
    return {
      content: [
        {
          type: "text",
          text: `
        Use case saved successfully:
        **Use Case ID:** ${extractedUseCase.id || "auto-generated"}
        **Name:** ${extractedUseCase.name}
        **Description:** ${extractedUseCase.description}
        **Main Actor:** ${extractedUseCase.mainActor}
        **Id of Actors:** ${extractedUseCase.actors.join(", ")}
        **Actions:** ${extractedUseCase.actions.map((a) => a.action).join(", ")}
        `,
        },
      ],
    };
  }
);

server.tool(
  "useCaseToUML",
  "Convert a saved use case to PlantUML format",
  {
    useCaseId: z.string().describe("Use case ID"),
  },
  async ({ useCaseId }) => {
    if (!projectStore.getStore()) {
      return {
        content: [{ type: "text", text: "❌ No project loaded" }],
        isError: true,
      };
    }
    const useCase = projectStore.getUseCase(useCaseId);
    if (!useCase) {
      return {
        content: [{ type: "text", text: "❌ Use case not found" }],
        isError: true,
      };
    }

    const uml = await useCaseToUML(useCase, projectStore);
    return {
      content: [
        { type: "text", text: `Use case converted to PlantUML format: ${uml}` },
      ],
    };
  }
);

// rebuild the project store, now with new possible way to find actions related to one actor.

// server.tool(
//   "saveUseCaseWithEntities",
//   "Save a use case with extracted entities to the project",
//   {
//     useCaseId: z.string().describe("Unique ID for the use case"),
//     title: z.string().describe("Use case title"),
//     description: z.string().describe("Use case description"),
//     actors: z
//       .array(z.string())
//       .describe("List of actors (users, external systems)"),
//     systems: z.array(z.string()).describe("List of system components"),
//     classes: z.array(z.string()).describe("List of potential domain classes"),
//   },
//   async ({ useCaseId, title, description, actors, systems, classes }) => {
//     if (!projectStore.getProjectRoot()) {
//       return {
//         content: [{ type: "text", text: "❌ No project loaded" }],
//         isError: true,
//       };
//     }

//     try {
//       // Convert actors to Actor objects
//       const actorObjects = actors.map((actor) => ({
//         actor_id: actor.toLowerCase().replace(/\s+/g, "_"),
//         name: actor,
//         description: actor,
//       }));

//       // Save use case with empty actions - will be populated by actionsRefining tool
//       // mainActor will default to first actor, actions will default to []
//       await projectStore.saveUseCase(
//         useCaseId,
//         title,
//         description,
//         actorObjects
//       );

//       return {
//         content: [
//           {
//             type: "text",
//             text: `✅ Use case saved: **${title}**

// **File:** use-cases/${useCaseId}.md

// **Extracted entities:**
// - Actors (${actors.length}): ${actors.join(", ")}
// - Systems (${systems.length}): ${systems.join(", ")}
// - Classes (${classes.length}): ${classes.join(", ")}

// All entities have been added to the project's entity lists in the entities/ folder.`,
//           },
//         ],
//       };
//     } catch (error) {
//       return {
//         content: [
//           {
//             type: "text",
//             text: `Error: ${
//               error instanceof Error ? error.message : String(error)
//             }`,
//           },
//         ],
//         isError: true,
//       };
//     }
//   }
// );

// server.tool(
//   "allUseCasesToPlantUML",
//   "Convert all stored use cases to PlantUML format",
//   {},
//   async () => {
//     const useCases = projectStore.getAllUseCases();
//     if (!useCases || useCases.length === 0) {
//       return {
//         content: [
//           {
//             type: "text",
//             text: "No use cases found to convert.",
//           },
//         ],
//       };
//     }
//     const useCasesContent = useCases.reduce(
//       (prev: string, curr) =>
//         prev +
//         `## ${curr.useCase_id}: ${curr.title}\n\n${
//           curr.description
//         }\n\n**Actors:** ${curr.actors
//           .map((a) => a.description)
//           .join(", ")}\n\n`,
//       ""
//     );
//     return {
//       content: [
//         {
//           type: "text",
//           text: `I have all these use cases joined into a single file. Please convert these use cases to PlantUML format:

// ${useCasesContent}

// Requirements:
// - Use @startuml and @enduml tags
// - Identify all actors
// - If reference use cases inside a rectangle, those use cases need to be declared inside the rectangle block — not outside and then referenced later.
//   Otherwise, PlantUML can’t find them in scope.
// - Show relationships with proper syntax
// - Output only the PlantUML code`,
//         },
//       ],
//     };
//   }
// );

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
