import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JsonProjectStore } from "../stores/projectStore.js";

/**
 * Register all project-related tools to the MCP server
 */
export function registerProjectTools(
  server: McpServer,
  projectStore: JsonProjectStore
) {
  // Initialize project tool
  server.registerTool(
    "initProject",
    {
      title: "Initialize Project",
      description: "Initialize a new UML project with markdown-based storage",
      inputSchema: {
        name: z.string().describe("Project name"),
        description: z.string().describe("Project description"),
      },
    },
    async ({ name, description }) => {
      try {
        const path = await projectStore.initProject(name, description);

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Project initialized successfully!

**Project ID:** ${path}
**Name:** ${name}

Project has been created in Firestore. You can now add use cases with the 'addUseCase' tool.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
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
  server.registerTool(
    "loadProjectByName",
    {
      title: "Load Project",
      description: "Load an existing project by its name",
      inputSchema: {
        name: z.string().describe("Project name to load"),
      },
    },
    async ({ name }) => {
      try {
        const success = await projectStore.loadProjectByName(name);

        if (success) {
          const summary = await projectStore.getProjectSummary();
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Project "${name}" loaded successfully!\n\n📊 Summary:\n- Use Cases: ${summary?.stats.totalUseCases}\n- Actors: ${summary?.stats.totalActors}\n- Steps: ${summary?.stats.totalSteps}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text" as const,
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
              type: "text" as const,
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
  server.registerTool(
    "findProjectByName",
    {
      title: "Find Project",
      description:
        "Given a project name, list all projects, then find the project with the closest name or description.",
      inputSchema: {
        name: z.string().describe("Project name to search for"),
      },
    },
    async ({ name }) => {
      const projects = await projectStore.listAllProjects();

      if (projects.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
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
            type: "text" as const,
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
  server.registerTool(
    "listAllProjects",
    {
      title: "List All Projects",
      description: "List all available projects in the projects directory",
    },
    async () => {
      try {
        const projects = await projectStore.listAllProjects();

        if (projects.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
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
              ).toLocaleDateString()}\n   - ID: ${p.id}\n   - Description: ${
                p.description
              }`
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `📂 **Available Projects** (${projects.length}):\n\n${projectList}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
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

  // Get current project info
  server.registerTool(
    "getProjectInfo",
    {
      title: "Get Project Info",
      description: "Get information about the current project",
    },
    async () => {
      const summary = await projectStore.getProjectSummary();

      if (!summary) {
        return {
          content: [
            {
              type: "text" as const,
              text: "❌ No project loaded. Use 'initProject' or 'loadProject' first.",
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `📊 **Project Information**

**Name:** ${summary.name}
**Description:** ${summary.description}
**Created:** ${summary.createdAt}
**Updated:** ${summary.updatedAt}
**Project ID:** ${summary.id}

**Statistics:**
- Total Use Cases: ${summary.stats.totalUseCases}
- Total Actors: ${summary.stats.totalActors}
- Total Steps: ${summary.stats.totalSteps}`,
          },
        ],
      };
    }
  );

  // View project use cases
  server.registerTool(
    "viewProjectUseCases",
    {
      title: "View Project Use Cases",
      description:
        "View all use cases in the current project. Can be used to search for id of a use case.",
    },
    async () => {
      if (!projectStore.getStore()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "❌ No project loaded. Use 'initProject' or 'loadProject' first.",
            },
          ],
          isError: true,
        };
      }
      const useCases = projectStore.getAllUseCases();
      if (useCases.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No use cases found in the current project.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `📋 **Use Cases in Current Project in JSON format**:\n\n${JSON.stringify(
              useCases
            )}`,
          },
        ],
      };
    }
  );

  // Switch to project
  server.registerTool(
    "switchToProject",
    {
      title: "Switch to Project",
      description: "Switch to a different project within the current session",
      inputSchema: {
        projectId: z.string().describe("Project ID to switch to"),
      },
    },
    async ({ projectId }) => {
      try {
        const success = await projectStore.switchToProject(projectId);

        if (success) {
          const summary = await projectStore.getProjectSummary();
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Switched to project "${summary?.name}"!\n\n📊 Summary:\n- Use Cases: ${summary?.stats.totalUseCases}\n- Actors: ${summary?.stats.totalActors}\n- Steps: ${summary?.stats.totalSteps}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Project with ID "${projectId}" not found. Use 'listAllProjects' to see available projects.`,
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
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

  // Delete project
  server.registerTool(
    "deleteProject",
    {
      title: "Delete Project",
      description: "Delete a project from the current session",
      inputSchema: {
        projectId: z.string().describe("Project ID to delete"),
      },
    },
    async ({ projectId }) => {
      try {
        const success = await projectStore.deleteProject(projectId);

        if (success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Project deleted successfully!`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Project with ID "${projectId}" not found.`,
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
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
}
