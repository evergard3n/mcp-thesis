export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MCP Thesis API",
    version: "0.1.0",
    description: "HTTP API for session-scoped HITL orchestration, project management, and testing.",
  },
  servers: [{ url: "http://localhost:3006" }],
  tags: [
    { name: "Health" },
    { name: "Sessions" },
    { name: "HITL" },
    { name: "Projects" },
    { name: "Testing" },
  ],
  paths: {
    "/ping": {
      get: {
        tags: ["Health"],
        summary: "Ping server",
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "text/plain": {
                schema: { type: "string", example: "pong" },
              },
            },
          },
        },
      },
    },
    "/sessions": {
      post: {
        tags: ["Sessions"],
        summary: "Create a session",
        responses: {
          "201": {
            description: "Session created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionCreated" },
              },
            },
          },
        },
      },
    },
    "/sessions/{sessionId}": {
      delete: {
        tags: ["Sessions"],
        summary: "Delete a session",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "204": { description: "Session deleted" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/sessions/{sessionId}/state": {
      get: {
        tags: ["Sessions"],
        summary: "Get session HITL state",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "200": {
            description: "Session state",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/sessions/{sessionId}/hitl/stream": {
      get: {
        tags: ["HITL"],
        summary: "Subscribe to HITL events (SSE)",
        description:
          "Streams HITL events until `done` or `error`. Swagger UI may not render streaming events continuously.",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "200": {
            description: "SSE stream opened",
            content: {
              "text/event-stream": {
                schema: { type: "string" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/sessions/{sessionId}/hitl/start": {
      post: {
        tags: ["HITL"],
        summary: "Start HITL loop",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StartHitlRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "HITL started",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "started" },
                    state: { type: "object", additionalProperties: true },
                  },
                  required: ["status", "state"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/sessions/{sessionId}/hitl/answers": {
      post: {
        tags: ["HITL"],
        summary: "Submit answers for HITL questions",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SubmitAnswersRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Answers accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    accepted: { type: "boolean", example: true },
                    status: { type: "string", example: "answers_received" },
                  },
                  required: ["accepted", "status"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/sessions/{sessionId}/hitl/cancel": {
      post: {
        tags: ["HITL"],
        summary: "Cancel active HITL loop",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "200": {
            description: "HITL cancelled",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cancelled: { type: "boolean", example: true },
                    state: { type: "object", additionalProperties: true },
                  },
                  required: ["cancelled", "state"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/sessions/{sessionId}/projects/init": {
      post: {
        tags: ["Projects"],
        summary: "Initialize a project",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProjectRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/projects/load-by-name": {
      post: {
        tags: ["Projects"],
        summary: "Load project by name",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoadProjectRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/projects": {
      get: {
        tags: ["Projects"],
        summary: "List all projects",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/projects/current": {
      get: {
        tags: ["Projects"],
        summary: "Get current project",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/projects/current/use-cases": {
      get: {
        tags: ["Projects"],
        summary: "List use cases in current project",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/projects/switch": {
      post: {
        tags: ["Projects"],
        summary: "Switch current project",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SwitchProjectRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/projects/delete": {
      post: {
        tags: ["Projects"],
        summary: "Delete a project",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeleteProjectRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/testing/prepare-test-data": {
      post: {
        tags: ["Testing"],
        summary: "Prepare test data",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PrepareTestDataRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/testing/embed-dataset": {
      post: {
        tags: ["Testing"],
        summary: "Embed dataset",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EmbedDatasetRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/testing/run-hitl-comparison": {
      post: {
        tags: ["Testing"],
        summary: "Run HITL comparison",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RunHitlComparisonRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
    "/sessions/{sessionId}/testing/evaluate-results": {
      post: {
        tags: ["Testing"],
        summary: "Evaluate test results",
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EvaluateResultsRequest" },
            },
          },
        },
        responses: {
          "200": { $ref: "#/components/responses/GenericSuccess" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/InternalServerError" },
        },
      },
    },
  },
  components: {
    parameters: {
      SessionId: {
        name: "sessionId",
        in: "path",
        required: true,
        schema: { type: "string", minLength: 1 },
        description: "Session identifier created via POST /sessions",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
          },
        },
        required: ["error"],
      },
      SessionCreated: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["sessionId", "createdAt"],
      },
      CreateProjectRequest: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
        },
        required: ["name", "description"],
      },
      LoadProjectRequest: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
        },
        required: ["name"],
      },
      SwitchProjectRequest: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
        },
        required: ["projectId"],
      },
      DeleteProjectRequest: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
        },
        required: ["projectId"],
      },
      StartHitlRequest: {
        type: "object",
        properties: {
          vague: { type: "string", minLength: 1 },
          mode: {
            type: "string",
            enum: ["interactive", "automated"],
            default: "interactive",
          },
          detailed: { type: "string" },
          domain: { type: "string" },
          maxIterations: { type: "integer", minimum: 1, maximum: 20 },
          maxQuestions: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["vague"],
      },
      SubmitAnswersRequest: {
        type: "object",
        properties: {
          answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                questionId: { type: "string", minLength: 1 },
                answer: { type: "string", minLength: 1 },
              },
              required: ["questionId", "answer"],
            },
          },
        },
        required: ["answers"],
      },
      PrepareTestDataRequest: {
        type: "object",
        properties: {
          textBasedGroundTruth: { type: "string", minLength: 1 },
          testCaseId: { type: "string" },
        },
        required: ["textBasedGroundTruth"],
      },
      EmbedDatasetRequest: {
        type: "object",
        properties: {
          datasetPath: { type: "string", minLength: 1 },
          testCaseIds: {
            type: "array",
            items: { type: "string" },
          },
          forceReembed: { type: "boolean" },
        },
        required: ["datasetPath"],
      },
      RunHitlComparisonRequest: {
        type: "object",
        properties: {
          datasetPath: { type: "string", minLength: 1 },
          testCaseIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["datasetPath"],
      },
      EvaluateResultsRequest: {
        type: "object",
        properties: {
          resultsPath: { type: "string", minLength: 1 },
          datasetPath: { type: "string", minLength: 1 },
        },
        required: ["resultsPath", "datasetPath"],
      },
      GenericObject: {
        type: "object",
        additionalProperties: true,
      },
    },
    responses: {
      GenericSuccess: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/GenericObject" },
          },
        },
      },
      BadRequest: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Conflict: {
        description: "Request conflicts with current state",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      InternalServerError: {
        description: "Unexpected server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  },
} as const;
