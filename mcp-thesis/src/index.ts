#!/usr/bin/env node

import "dotenv/config";

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
import { JsonProjectStore } from "./stores/projectStore.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerUseCaseTools } from "./tools/usecaseTools.js";
import { registerProjectTools } from "./tools/projectTools.js";
import { registerFrslTool } from "./tools/genFRSLTool.js";

const server = new McpServer({
  name: "mcp-thesis",
  version: "1.0.0",
  icons: [{ src: "icon.png" }],
  title: "MCP Thesis",
  websiteUrl: "https://github.com/evergard3n/mcp-thesis",
});

const projectStore = new JsonProjectStore();

// Register project-related tools
registerProjectTools(server, projectStore);

// Register usecase-related tools
registerUseCaseTools(server, projectStore);

// Register FRSL tool
registerFrslTool(server, projectStore);

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
//         content: [{ type: "text" as const, text: "❌ No project loaded" }],
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
//             type: "text" as const,
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
//             type: "text" as const,
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
//             type: "text" as const,
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
//           type: "text" as const,
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
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3006");
app
  .listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
