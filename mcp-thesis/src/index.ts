#!/usr/bin/env node

import "dotenv/config";

import express from "express";
import swaggerUi from "swagger-ui-express";
import cors from "cors";
import { z } from "zod";
import { openApiSpec } from "./docs/openapi.js";
import { OPENROUTER_API_KEY } from "./helpers/env.js";
import {
  deleteProject,
  getProjectInfo,
  initProject,
  listAllProjects,
  loadProjectByName,
  switchToProject,
  viewProjectUseCases,
} from "./tools/projectTools.js";
import {
  classifyUseCaseDomainTool,
  embedDataset,
  evaluateResults,
  prepareTestData,
  runHITLComparison,
} from "./tools/testingTools.js";
import semanticService from "./services/semantic.service.js";
import { SessionManager } from "./session/session.manager.js";

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const loadProjectSchema = z.object({
  name: z.string().min(1),
});

const switchProjectSchema = z.object({
  projectId: z.string().min(1),
});

const deleteProjectSchema = z.object({
  projectId: z.string().min(1),
});

const prepareTestDataSchema = z.object({
  textBasedGroundTruth: z.string().min(1),
  testCaseId: z.string().optional(),
});

const embedDatasetSchema = z.object({
  datasetPath: z.string().min(1),
  testCaseIds: z.array(z.string()).optional(),
  forceReembed: z.boolean().optional(),
});

const runHitlComparisonSchema = z.object({
  datasetPath: z.string().min(1),
  testCaseIds: z.array(z.string()).optional(),
});

const evaluateResultsSchema = z.object({
  resultsPath: z.string().min(1),
  datasetPath: z.string().min(1),
});

const classifyDomainSchema = z.object({
  useCase: z.any(),
});

const startHitlSchema = z.object({
  vague: z.string().min(1),
  domain: z.string().optional(),
  maxIterations: z.number().int().positive().max(20).optional(),
  maxQuestions: z.number().int().positive().max(100).optional(),
});

const submitAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      answer: z.string().min(1),
    }),
  ),
});

function requireSession(
  sessionId: string,
  res: express.Response,
): ReturnType<SessionManager["getSession"]> {
  const session = sessions.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return session;
}

function setSSEHeaders(res: express.Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}

function writeSSE(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  throw new Error("GEMINI_API_KEY is not set");
}
if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is not set");
}

const sessions = new SessionManager(OPENROUTER_API_KEY, geminiApiKey);

const app = express();
app.use(express.json());

app.use(cors());

app.get("/openapi.json", async (_req, res) => {
  res.status(200).json(openApiSpec);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get("/ping", async (_req, res) => {
  res.status(200).send("pong");
});

app.post("/sessions", async (_req, res) => {
  const session = sessions.createSession();
  res
    .status(201)
    .json({ sessionId: session.sessionId, createdAt: session.createdAt });
});

app.delete("/sessions/:sessionId", async (req, res) => {
  const deleted = sessions.deleteSession(req.params.sessionId);
  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.status(204).send();
});

app.get("/sessions/:sessionId/state", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  res.status(200).json(session.hitl.getState());
});

app.get("/sessions/:sessionId/hitl/stream", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;

  setSSEHeaders(res);
  const unsubscribe = session.hitl.subscribe((event) => {
    writeSSE(res, event.type, event);
    if (event.type === "done" || event.type === "error") {
      unsubscribe();
      res.end();
    }
  });

  req.on("close", () => {
    unsubscribe();
  });
});

app.post("/sessions/:sessionId/hitl/start", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;

  const parsed = startHitlSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const started = await session.hitl.start(parsed.data);
  if (!started) {
    res.status(409).json({ error: "HITL loop already running" });
    return;
  }

  res.status(202).json({ status: "started", state: session.hitl.getState() });
});

app.post("/sessions/:sessionId/hitl/answers", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;

  const parsed = submitAnswersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const accepted = session.hitl.submitAnswers(parsed.data.answers);
  if (!accepted) {
    res.status(409).json({ error: "No pending question batch" });
    return;
  }

  res.status(202).json({ accepted: true, status: "answers_received" });
});

app.post("/sessions/:sessionId/hitl/cancel", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;

  session.hitl.cancel();
  res.status(200).json({ cancelled: true, state: session.hitl.getState() });
});

app.post("/sessions/:sessionId/projects/init", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await initProject(
      session.projectStore,
      parsed.data.name,
      parsed.data.description,
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/sessions/:sessionId/projects/load-by-name", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = loadProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await loadProjectByName(
      session.projectStore,
      parsed.data.name,
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/sessions/:sessionId/projects", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  try {
    const projects = await listAllProjects(session.projectStore);
    res.status(200).json({ projects });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/sessions/:sessionId/projects/current", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  try {
    const info = await getProjectInfo(session.projectStore);
    res.status(200).json({ project: info });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/sessions/:sessionId/projects/current/use-cases", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  try {
    const useCases = viewProjectUseCases(session.projectStore);
    res.status(200).json({ useCases });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/sessions/:sessionId/projects/switch", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = switchProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await switchToProject(
      session.projectStore,
      parsed.data.projectId,
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/sessions/:sessionId/projects/delete", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = deleteProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await deleteProject(
      session.projectStore,
      parsed.data.projectId,
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/sessions/:sessionId/testing/prepare-test-data", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = prepareTestDataSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await prepareTestData(session.geminiFunctions, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/sessions/:sessionId/testing/embed-dataset", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = embedDatasetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await embedDataset(parsed.data);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post(
  "/sessions/:sessionId/testing/run-hitl-comparison",
  async (req, res) => {
    const session = requireSession(req.params.sessionId, res);
    if (!session) return;
    const parsed = runHitlComparisonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await runHITLComparison(
        session.geminiFunctions,
        parsed.data,
      );
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

app.post("/sessions/:sessionId/testing/evaluate-results", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = evaluateResultsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await evaluateResults(session.geminiFunctions, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/sessions/:sessionId/testing/classify-domain", async (req, res) => {
  const session = requireSession(req.params.sessionId, res);
  if (!session) return;
  const parsed = classifyDomainSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await classifyUseCaseDomainTool(
      session.geminiFunctions,
      parsed.data.useCase,
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const port = parseInt(process.env.PORT || "3006", 10);

console.log("Initializing semantic model...");
await semanticService.waitForReady();

app
  .listen(port, () => {
    console.log(
      `${new Date().toISOString()} Backend server running on http://localhost:${port}`,
    );
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
