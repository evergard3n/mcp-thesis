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
import { MarkdownProjectStore } from "./stores/projectStore.js";

const server = new McpServer({
  name: "test_server",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

const projectStore = new MarkdownProjectStore();

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
    // projectPath: {
    //   type: "string",
    //   description:
    //     "Path where project will be created (e.g., ./my-uml-project)",
    // },
    // name: {
    //   type: "string",
    //   description: "Project name",
    // },
    // description: {
    //   type: "string",
    //   description: "Project description",
    // },
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

**Name:** ${summary.metadata?.name}
**Description:** ${summary.metadata?.description}
**Created:** ${summary.metadata?.createdAt}
**Path:** ${summary.path}

**Entities:**
- Actors: ${summary.entities.actors}
- Systems: ${summary.entities.systems}
- Classes: ${summary.entities.classes}

**Use Cases:** ${summary.useCases}

**Conventions:**
- Naming style: ${summary.metadata?.conventions.namingStyle}`,
        },
      ],
    };
  }
);

server.tool(
  "addUseCase",
  "Add a use case to the project. Returns instructions for the LLM to extract entities, then call saveUseCaseWithEntities to save.",
  {
    useCaseId: z.string().describe("Unique ID (e.g., 'login', 'checkout')"),
    title: z.string().describe("Use case title"),
    description: z.string().describe("Use case description/steps"),
  },
  async ({ useCaseId, title, description }) => {
    if (!projectStore.getProjectRoot()) {
      return {
        content: [{ type: "text", text: "❌ No project loaded" }],
        isError: true,
      };
    }

    // Return instructions for Claude to extract entities
    return {
      content: [
        {
          type: "text",
          text: `I need you to analyze this use case and extract entities, then call the saveUseCaseWithEntities tool.

**Use Case ID:** ${useCaseId}
**Title:** ${title}
**Description:**
${description}

Please identify:
1. **Actors**: Human users or external systems that interact (e.g., User, Admin, Customer)
2. **Systems**: Internal system components (e.g., AuthenticationSystem, PaymentGateway, Database)
3. **Classes**: Potential domain classes/objects (e.g., Account, Order, Product)

After analyzing, call the 'saveUseCaseWithEntities' tool with:
- useCaseId: "${useCaseId}"
- title: "${title}"
- description: "${description}"
- actors: [list of actors you identified]
- systems: [list of systems you identified]
- classes: [list of classes you identified]`,
        },
      ],
    };
  }
);
server.tool(
  "saveUseCaseWithEntities",
  "Save a use case with extracted entities to the project",
  {
    useCaseId: z.string().describe("Unique ID for the use case"),
    title: z.string().describe("Use case title"),
    description: z.string().describe("Use case description"),
    actors: z
      .array(z.string())
      .describe("List of actors (users, external systems)"),
    systems: z.array(z.string()).describe("List of system components"),
    classes: z.array(z.string()).describe("List of potential domain classes"),
  },
  async ({ useCaseId, title, description, actors, systems, classes }) => {
    if (!projectStore.getProjectRoot()) {
      return {
        content: [{ type: "text", text: "❌ No project loaded" }],
        isError: true,
      };
    }

    try {
      const extracted = { actors, systems, classes };

      // Save use case as markdown
      await projectStore.saveUseCase(useCaseId, title, description, extracted);

      // Update entity lists
      for (const actor of actors) {
        await projectStore.addEntity("actors", actor);
      }
      for (const system of systems) {
        await projectStore.addEntity("systems", system);
      }
      for (const cls of classes) {
        await projectStore.addEntity("classes", cls);
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ Use case saved: **${title}**

**File:** use-cases/${useCaseId}.md

**Extracted entities:**
- Actors (${actors.length}): ${actors.join(", ")}
- Systems (${systems.length}): ${systems.join(", ")}
- Classes (${classes.length}): ${classes.join(", ")}

All entities have been added to the project's entity lists in the entities/ folder.`,
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

server.tool(
  "allUseCasesToPlantUML",
  "Convert all stored use cases to PlantUML format",
  {},
  async () => {
    const useCases = await projectStore.readAllUseCases();
    if (!useCases || useCases.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No use cases found to convert.",
          },
        ],
      };
    }
    const useCasesContent = useCases.reduce(
      (prev, curr) => prev + `## ${curr.id}\n\n${curr.content}\n\n`,
      ""
    );
    return {
      content: [
        {
          type: "text",
          text: `I have all these use cases joined into a single file. Please convert these use cases to PlantUML format:

${useCasesContent}

Requirements:
- Use @startuml and @enduml tags
- Identify all actors
- If reference use cases inside a rectangle, those use cases need to be declared inside the rectangle block — not outside and then referenced later.
  Otherwise, PlantUML can’t find them in scope.
- Show relationships with proper syntax
- Output only the PlantUML code`,
        },
      ],
    };
  }
);

server.tool(
  "get_forecast",
  "Get weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(
      4
    )},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    // Get forecast data
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No forecast periods available",
          },
        ],
      };
    }

    // Format forecast periods
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${
          period.temperatureUnit || "F"
        }`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n")
    );

    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join(
      "\n"
    )}`;

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  }
);

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
