# HITL Server API Reference

Base URL: `http://localhost:3006`

All request bodies are `Content-Type: application/json` unless noted otherwise.

---

## Table of Contents

1. [Utility](#utility)
2. [Sessions](#sessions)
3. [HITL Loop](#hitl-loop) ← primary feature
4. [Projects](#projects)
5. [Data Types](#data-types)
6. [Error Handling](#error-handling)
7. [Frontend Integration Guide](#frontend-integration-guide)

---

## Utility

### `GET /ping`

Health check.

**Response:** `200` — plain text `pong`

### `GET /openapi.json`

**Response:** `200` — OpenAPI spec JSON

### `GET /docs`

Swagger UI (HTML).

---

## Sessions

Every operation requires a session. Create one first.

### `POST /sessions`

Create a new session.

**Request body:** none

**Response:** `201`

```json
{
  "sessionId": "a1b2c3d4-e5f6-...",
  "createdAt": "2026-04-10T06:00:00.000Z"
}
```

### `DELETE /sessions/:sessionId`

Destroy a session and cancel any running HITL loop.

**Response:**
- `204` — no body (success)
- `404` — `{ "error": "Session not found" }`

---

## HITL Loop

The Human-in-the-Loop system iteratively refines a use case by generating questions, collecting answers (from a human or LLM), and incorporating them.

### State Machine

```
IDLE
 │
 ▼
GENERATING_BASELINE
 │
 ▼
PROBING_BLUEPRINTS
 │
 ▼
┌──────────────────────────────────────────────┐
│  ANALYZING_GAPS                              │
│   │                                          │
│   ├─ (confidence reached / no questions)     │
│   │   → break out of loop                    │
│   │                                          │
│   ▼                                          │
│  WAITING_FOR_ANSWERS                         │
│   │     (user provides answers)              │
│   │                                          │
│   ▼                                          │
│  REFINING                                    │
│   │                                          │
│   └─ → back to ANALYZING_GAPS (next iter)    │
└──────────────────────────────────────────────┘
 │
 ▼
DONE   (or ERROR at any point)
```

### `GET /sessions/:sessionId/state`

Poll the current HITL state. Useful for reconnection after SSE drops.

**Response:** `200` — [HITLState](#hitlstate)

### `GET /sessions/:sessionId/hitl/stream`

**Server-Sent Events (SSE)** stream. Open this **before** calling `/hitl/start`.

**Headers sent by server:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Wire format** — each event is two lines:

```
event: <event_type>
data: <JSON payload>

```

The stream closes automatically on `done` or `error` events. If the client disconnects, the server cleans up the subscription.

#### SSE Event Types

**1. `state`** — emitted immediately on subscribe (snapshot)

```typescript
{
  type: "state";
  state: HITLState;
}
```

**2. `status_change`** — emitted on every phase transition

```typescript
{
  type: "status_change";
  status: HITLStatus;       // the new status
  iteration: number;        // current iteration (1-based)
  message: string;          // human-readable, e.g. "Validating and analyzing gaps"
  state: HITLState;         // full state snapshot
}
```

**3. `questions`** — emitted when questions are ready for answering

This is the critical event for interactive mode. The frontend must render these questions and collect answers from the user.

```typescript
{
  type: "questions";
  iteration: number;                // which iteration produced these
  questions: OpenEndedQuestion[];   // the questions to display
  state: HITLState;                 // state.status will be WAITING_FOR_ANSWERS (interactive)
}
```

**4. `done`** — loop completed

```typescript
{
  type: "done";
  state: HITLState;   // state.currentUseCase contains the final refined use case
}
```

**5. `error`** — unrecoverable failure

```typescript
{
  type: "error";
  message: string;
  state: HITLState;   // state.status === "ERROR"
}
```

### `POST /sessions/:sessionId/hitl/start`

Start the HITL loop. Returns immediately — progress is reported via SSE.

**Request body:**

```typescript
{
  vague: string;                              // required — high-level use case description
  domain?: string;                            // e.g. "Insurance/Claims"
  maxIterations?: number;                     // 1–20, default: 5
  maxQuestions?: number;                       // 1–100, default: 20
}
```

**Responses:**

- `202`

```json
{
  "status": "started",
  "state": { /* HITLState */ }
}
```

- `400` — validation error

```json
{ "error": { /* Zod flattened error */ } }
```

- `409` — loop already running

```json
{ "error": "HITL loop already running" }
```

### `POST /sessions/:sessionId/hitl/answers`

Submit answers to the current question batch. Only accepted when `state.status === "WAITING_FOR_ANSWERS"`.

**Request body:**

```typescript
{
  answers: Array<{
    questionId: string;    // must match an OpenEndedQuestion.id from the "questions" SSE event
    answer: string;        // the human's answer text
  }>;
}
```

**Responses:**

- `202`

```json
{ "accepted": true, "status": "answers_received" }
```

- `400` — validation error

```json
{ "error": { /* Zod flattened error */ } }
```

- `409` — no pending question batch

```json
{ "error": "No pending question batch" }
```

### `POST /sessions/:sessionId/hitl/cancel`

Cancel a running HITL loop. Safe to call at any time.

**Response:** `200`

```json
{
  "cancelled": true,
  "state": { /* HITLState — status will be "IDLE" */ }
}
```

---

## Projects

Session-scoped project management backed by Firestore.

### `POST /sessions/:sessionId/projects/init`

Create a new project and set it as the active project.

**Request body:**

```typescript
{
  name: string;
  description: string;
}
```

**Response:** `200`

```json
{ "projectId": "uuid-string" }
```

### `POST /sessions/:sessionId/projects/load-by-name`

Load an existing project by name from Firestore.

**Request body:**

```typescript
{
  name: string;
}
```

**Response:** `200`

```typescript
{
  found: boolean;
  summary: ProjectSummary | null;
}
```

### `GET /sessions/:sessionId/projects`

List all projects in the session's store.

**Response:** `200`

```typescript
{
  projects: ProjectSummary[];
}
```

### `GET /sessions/:sessionId/projects/current`

Get the currently active project.

**Response:** `200`

```typescript
{
  project: ProjectSummary | null;
}
```

### `GET /sessions/:sessionId/projects/current/use-cases`

Get all use cases for the current project.

**Response:** `200`

```typescript
{
  useCases: UseCase[];
}
```

### `POST /sessions/:sessionId/projects/switch`

Switch to a different project by ID.

**Request body:**

```typescript
{
  projectId: string;
}
```

**Response:** `200`

```typescript
{
  found: boolean;
  summary: ProjectSummary | null;
}
```

### `POST /sessions/:sessionId/projects/delete`

Delete a project by ID.

**Request body:**

```typescript
{
  projectId: string;
}
```

**Response:** `200`

```typescript
{
  deleted: boolean;
}
```

---

## Data Types

### HITLState

```typescript
interface HITLState {
  sessionId: string;
  status: HITLStatus;
  mode: "interactive";                    // always "interactive" for demo
  vague: string | null;
  detailed: string | null;
  domain: string | null;
  currentUseCase: GenUseCase | null;      // the latest refined use case
  baselineUseCase: GenUseCase | null;     // the initial use case before refinement
  conversationHistory: InteractionMemory[];
  allQuestions: string[];                 // flat list of all question texts asked so far
  iterationCount: number;
  totalQuestionsAsked: number;
  maxIterations: number;
  maxQuestions: number;
  lastGapAnalysis: GapAnalysis | null;
  lastUncertaintyAnalysis: UncertaintyAnalysis | null;
  lastQuestions: OpenEndedQuestion[] | null;
  confirmedBlueprintIds: string[];
  droppedBlueprintIds: string[];
  blueprintsProbed: boolean;
  error: string | null;
  startedAt: string | null;              // ISO 8601
  updatedAt: string;                     // ISO 8601
  completedAt: string | null;            // ISO 8601
}
```

### HITLStatus

```typescript
type HITLStatus =
  | "IDLE"
  | "GENERATING_BASELINE"
  | "PROBING_BLUEPRINTS"
  | "ANALYZING_GAPS"
  | "GENERATING_QUESTIONS"
  | "WAITING_FOR_ANSWERS"
  | "REFINING"
  | "DONE"
  | "ERROR";
```

### GenUseCase

The core data model — a structured use case with flows.

```typescript
interface GenUseCase {
  name: string;
  summary: string;
  mainActor: string;
  actors: string[];
  preconditions?: string[];
  postconditions?: string[];
  flows: GenFlow[];
  loops?: GenLoop[];
}
```

### GenFlow

A single flow (main, alternative, or exception).

```typescript
interface GenFlow {
  id: "MAIN" | string;                        // e.g. "MAIN", "ALT_3a", "EXT_1a"
  kind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
  parentFlow?: "MAIN" | string;                // which flow this branches from
  fromStepIndex?: number;                      // step index in the parent flow where this branches
  condition?: string;                          // natural-language trigger condition
  steps: GenStep[];
}
```

### GenStep

```typescript
interface GenStep {
  index: number;       // 1-based, unique within the flow
  actor: string;
  target?: string;
  description: string;
}
```

### GenLoop

```typescript
interface GenLoop {
  flowRef: "MAIN" | string;
  startIndex: number;
  endIndex: number;
  condition: string;
}
```

### OpenEndedQuestion

Delivered in the `"questions"` SSE event. The frontend should render these to the user.

```typescript
interface OpenEndedQuestion {
  id: string;                     // unique ID — use this as questionId when submitting answers
  question: string;               // the question text to display
  context: {
    step?: string;                // e.g. "Step 3" or "ALT_3a Step 1"
    steps?: string[];             // multiple steps if consolidated
    patternType?: string;         // gap type, e.g. "uncertain_conditions"
    whyAsking: string;            // explanation of why this question matters
    flowId?: string;              // related flow ID
  };
  answerGuidance: string;         // instructions for how to answer — display as helper text
}
```

### Project / Store

```typescript
interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  useCases: UseCase[];
  actors: Actor[];
}

interface Store {
  id: string;                                    // sessionId
  createdAt: string;
  updatedAt: string;
  projects: { [projectId: string]: Project };
  currentProjectId: string | null;
}
```

---

## Error Handling

All endpoints follow consistent error shapes:

| Status | When | Body |
|--------|------|------|
| `400` | Invalid request body | `{ "error": <ZodFlattenedError \| string> }` |
| `404` | Session not found | `{ "error": "Session not found" }` |
| `409` | Conflict (loop already running, no pending questions) | `{ "error": "<description>" }` |
| `500` | Unexpected server error | `{ "error": "<error message>" }` |

---

## Frontend Integration Guide

### Interactive Mode (Human-in-the-Loop)

The server generates questions, the human answers them, and the use case is iteratively refined.

```
Step 1:  POST /sessions                              → get sessionId
Step 2:  GET  /sessions/:id/hitl/stream               → open SSE connection
Step 3:  POST /sessions/:id/hitl/start                → { vague: "..." }
         ← 202 { status: "started" }

Step 4:  Listen to SSE events:

         ← event: state          (immediate snapshot)
         ← event: status_change  (GENERATING_BASELINE)
         ← event: status_change  (PROBING_BLUEPRINTS)
         ← event: status_change  (ANALYZING_GAPS)
         ← event: questions      ← RENDER THESE TO THE USER
         ← event: status_change  (WAITING_FOR_ANSWERS)

Step 5:  Collect user answers, then:
         POST /sessions/:id/hitl/answers
         {
           "answers": [
             { "questionId": "gap-uncertain_conditions-step-3", "answer": "When the agent..." },
             { "questionId": "missing-condition-ALT_3a", "answer": "This occurs when..." }
           ]
         }
         ← 202 { accepted: true }

Step 6:  Server continues automatically:

         ← event: status_change  (REFINING)
         ← event: status_change  (ANALYZING_GAPS)
         ← event: questions      ← MORE QUESTIONS (repeat step 5)
         ...

Step 7:  Loop ends:

         ← event: done
         → state.currentUseCase contains the final refined GenUseCase
         → SSE stream closes automatically
```

**Cancellation** — at any point during the loop:

```
POST /sessions/:id/hitl/cancel
← 200 { cancelled: true, state: { status: "IDLE", ... } }
```

**Reconnection** — if SSE drops:

```
GET /sessions/:id/state     → poll current HITLState
GET /sessions/:id/hitl/stream → re-open SSE (will emit "state" event immediately)
```

### UI Rendering Tips

**Question cards** — for each `OpenEndedQuestion`:
- Display `question` as the main prompt
- Show `answerGuidance` as helper text or placeholder
- Show `context.whyAsking` as a secondary explanation
- Use `context.step` or `context.flowId` to visually group questions by flow/step
- Use `id` as the `questionId` when submitting answers

**Use case visualization** — `GenUseCase` contains:
- `flows[0]` is always the MAIN flow (happy path)
- Other flows branch via `parentFlow` + `fromStepIndex`
- Each flow has ordered `steps` with actor, target, and description
- `condition` on non-MAIN flows describes what triggers the branch

**Progress tracking** — from `HITLState`:
- `iterationCount` / `maxIterations` for iteration progress
- `totalQuestionsAsked` / `maxQuestions` for question budget
- `status` for the current phase label
- `lastQuestions` for the most recent question batch (if polling instead of SSE)
