# HITL Use Case Elaboration System

A REST API backend implementing a **Human-in-the-Loop (HITL)** orchestration pipeline for use case elaboration. Given a vague use case description, the system iteratively detects gaps, generates targeted questions, collects expert answers, and produces a fully elaborated use case with complete exception and alternative flows.

## Architecture Overview

```
Client (Frontend / Test Script)
        │  SSE stream + REST answers
        ▼
  Express REST Server  (port 3006)
        │
  SessionManager  ──────────────────────────────────────────┐
        │                                                    │
  HITLOrchestrator                                   JsonProjectStore
        │                                             (Firebase-backed)
  HITLCore (orchestration loop)
        │
        ├── DomainClassifierService   (heuristic + semantic)
        ├── BlueprintDetector         (role-matching + family filter)
        ├── GapAnalyzer               (centroid / structural / pattern)
        ├── UncertaintyRanker         (clarity × criticality scoring)
        ├── QuestionBuilders          (phase 0–3 question generation)
        └── GeminiOpenRouterService   (LLM structured output)
```

### Key Design Decisions

- **Session-scoped isolation**: each client session gets its own store, orchestrator, and LLM client.
- **Semantic embeddings**: `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (MiniLM-L12, dim=384) loaded locally via `@xenova/transformers`.
- **Gap detection pipeline**: centroid matching → blueprint gap → structural/condition/actor checks.
- **Recall-first filtering**: prefer false positives over false negatives at every coarse filter stage.
- **Stale gap deduplication**: two-layer filter (metadata tuple + semantic similarity against conversation history).

## API Endpoints

### Session Management
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a new session |
| `DELETE` | `/sessions/:sessionId` | Destroy a session |
| `GET` | `/sessions/:sessionId/state` | Get current session state |

### HITL Core
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:sessionId/hitl/stream` | SSE stream for real-time HITL events |
| `POST` | `/sessions/:sessionId/hitl/start` | Start a HITL elaboration run |
| `POST` | `/sessions/:sessionId/hitl/answers` | Submit human answers for current iteration |
| `POST` | `/sessions/:sessionId/hitl/cancel` | Cancel the current run |

### Project Management
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/:sessionId/projects/init` | Initialize a new project |
| `POST` | `/sessions/:sessionId/projects/load-by-name` | Load project by name |
| `GET` | `/sessions/:sessionId/projects` | List all projects |
| `GET` | `/sessions/:sessionId/projects/current` | Get current project |
| `GET` | `/sessions/:sessionId/projects/current/use-cases` | List use cases in current project |
| `POST` | `/sessions/:sessionId/projects/switch` | Switch active project |
| `POST` | `/sessions/:sessionId/projects/delete` | Delete a project |

### Testing & Evaluation
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/:sessionId/testing/prepare-test-data` | Prepare dataset for evaluation |
| `POST` | `/sessions/:sessionId/testing/embed-dataset` | Embed dataset entries |
| `POST` | `/sessions/:sessionId/testing/evaluate-results` | Evaluate elaboration results |
| `POST` | `/sessions/:sessionId/testing/run-hitl-batch` | Run batch HITL over a dataset |

## Codebase Map

```
src/
├── index.ts                        # Express server entry point
├── orchestrator/
│   ├── hitl.core.ts                # Main HITL loop logic
│   ├── hitl.orchestrator.ts        # Session-level orchestrator wrapper
│   └── hitl.state.ts               # State machine types
├── analyzers/
│   ├── gap.analyzer.ts             # Gap analysis entry point + stale-gap filter
│   ├── gap-detector.types.ts       # GapDetectorConfig interface + factory functions
│   ├── gap-detectors.registry.ts   # Registry of all active gap detectors
│   ├── gap-detector.types.ts       # Shared types (Gap, EmbeddedText, etc.)
│   ├── blueprint.detector.ts       # Blueprint role-matching + gap detection
│   └── uncertainty.ranker.ts       # Step clarity × criticality scoring
├── services/
│   ├── semantic.service.ts         # MiniLM-L12 embedding singleton
│   ├── domain-classifier.service.ts# Heuristic + semantic domain classification
│   ├── blueprint-family.service.ts # Coarse family label prediction
│   ├── gemini-openrouter.service.ts# LLM structured output via OpenRouter
│   └── usecase.service.ts          # Use case CRUD
├── validators/
│   ├── llm.validator.ts            # LLM prompt builders + expert answer simulation
│   └── question-builders.ts        # Phase 0–3 question generation
├── helpers/
│   ├── consolidated-id.ts          # Consolidated question ID format
│   ├── memory.builder.ts           # InteractionMemory embedding builder
│   ├── usecase-text.ts             # Use case → text helpers
│   ├── usecase.prompts.ts          # LLM prompt fragments
│   └── env.ts                      # Environment variable exports
├── data/
│   ├── gap-centroids.json          # Gap category data (keywords, thresholds, question templates)
│   ├── gap-centroids.loader.ts     # JSON loader + centroid computation + cache
│   └── domain-keywords.ts          # Human/system actor keyword lists
├── session/
│   └── session.manager.ts          # Session lifecycle management
├── stores/
│   └── projectStore.ts             # Session-scoped project store (in-memory)
├── schemas/
│   └── genusecase.schema.ts        # Zod schema for GenUseCase
└── interfaces/
    ├── usecase.interface.new.ts    # GenUseCase / GenFlow / GenStep types
    ├── usecase.interface.ts        # Legacy use case types
    └── store.interface.ts          # Store / Project interfaces
```

## Recommended Environment

This project is primarily tested on Linux and macOS environments.

The local embedding model (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`) runs via `@xenova/transformers` which depends on ONNX Runtime native bindings. While native Windows support may work, these bindings can require additional setup and may behave inconsistently across Node.js versions and Windows configurations.

**For Windows users, WSL2 is strongly recommended.**

## Setup

### Prerequisites

- Node.js 18+
- OpenRouter API key

### Install & Run

**Backend only (core API):**

```bash
cd mcp-thesis
npm install
cp env.example .env
# Edit .env and set OPENROUTER_API_KEY
npm run dev        # dev server with hot reload (port 3006)
npm run build      # compile TypeScript → build/
```

**With interactive frontend:**

```bash
cd mcp-thesis-fe
npm install
npm run dev        # starts frontend (default port 5173)
```

The frontend connects to the backend at `http://localhost:3006`.

### Environment Variables

```bash
OPENROUTER_API_KEY=...
PORT=3006
```

## Testing

Start the server and open the Swagger UI to explore and test all endpoints interactively:

```
http://localhost:3006/docs
```

or use the frontend at 

```
http://localhost:5173
```

which consumes the same API.
