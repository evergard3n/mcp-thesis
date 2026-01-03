# MCP Thesis - Project Summary for Claude

## 🎯 Project Overview

**MCP Thesis** is a Model Context Protocol (MCP) server for managing UML projects, specifically focused on extracting, validating, and storing Use Cases using Large Language Models (Gemini 2.0 Flash via OpenRouter).

The system implements a **Human-in-the-Loop** approach where LLMs assist in:
1. Converting natural language descriptions into structured Use Cases
2. Validating Use Case quality with AI-driven feedback
3. Iteratively improving Use Cases through guided questions
4. Comparing generated Use Cases against reference/ground truth versions

## 🏗️ Architecture

### Transport & Session Management

- **Transport**: SSE (Server-Sent Events) over HTTP using Express.js
- **Session Isolation**: Each MCP session gets its own server instance with isolated project store
- **Session Scoping**: 
  - Each session has a unique `sessionId`
  - Session → Store → Projects (one-to-many)
  - Store data persisted in Firestore using `sessionId` as document ID

### Data Architecture

```
Firestore Collections:
├── stores/{sessionId}/
│   ├── id: string (sessionId)
│   ├── createdAt: string
│   ├── updatedAt: string
│   ├── currentProjectId: string | null
│   └── projects: {
│         [projectId]: {
│           id, name, description,
│           createdAt, updatedAt,
│           actors: Actor[],
│           useCases: UseCase[]
│         }
│       }
└── logs/{logId}/
    ├── sessionId: string
    ├── projectId: string
    ├── message: string
    └── timestamp: string
```

**Key Principle**: One Store per Session, Multiple Projects per Store, One Active Project at a time.

## 📂 Project Structure

```
mcp-thesis/
├── src/                          # TypeScript source
│   ├── index.ts                  # Main entry point, Express server, session handling
│   ├── stores/
│   │   └── projectStore.ts       # JsonProjectStore: session-scoped store management
│   ├── tools/
│   │   ├── projectTools.ts       # MCP tools for project management
│   │   └── usecaseTools.ts       # MCP tools for use case workflow
│   ├── services/
│   │   ├── firebase.service.ts   # Firestore integration
│   │   └── usecase.service.ts    # Use case generation & improvement logic
│   ├── helpers/
│   │   ├── env.ts                # Environment variable loading
│   │   ├── gemini.functions.ts   # Direct Gemini API calls
│   │   ├── gemini-openrouter.functions.ts  # Gemini via OpenRouter
│   │   ├── openrouter.function.ts # OpenRouter wrapper
│   │   └── helpers.ts            # UML conversion utilities
│   ├── validators/
│   │   ├── flat.validator.ts     # Algorithmic validation (rule-based)
│   │   └── llm.validator.ts      # LLM-driven validation & improvement
│   ├── schemas/
│   │   ├── genusecase.schema.ts  # Zod schema for GenUseCase format
│   │   ├── usecase.schema.ts     # Legacy use case schema
│   │   └── analysis.schema.ts    # Schema for use case comparison analysis
│   └── interfaces/
│       ├── store.interface.ts    # Store & Project interfaces
│       ├── usecase.interface.ts  # UseCase, Actor, Step interfaces
│       └── usecase.interface.new.ts # GenUseCase format interfaces
├── build/                        # Compiled JavaScript output
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Dependencies & scripts
├── .env                          # Environment variables (OPENROUTER_API_KEY, PORT)
└── env.example                   # Environment template
```

## 🔧 Core Components

### 1. Session Server (`src/index.ts`)

**Purpose**: Manages per-session MCP server instances with isolated state

```typescript
class SessionServer {
  private mcpServer: McpServer;
  private projectStore: JsonProjectStore;
  public sessionId: string;
  public geminiApiKey: string;
  public openrouterApiKey: string;
}
```

**Key Features**:
- Creates isolated `JsonProjectStore` per session
- Registers project and use case tools with session context
- Stores active sessions in memory: `sessions[sessionId]`

**API Endpoints**:
- `POST /mcp` - Main MCP endpoint (initialization & tool calls)
- `GET /mcp` - SSE endpoint for server-to-client notifications
- `GET /ping` - Health check

### 2. Project Store (`src/stores/projectStore.ts`)

**Purpose**: Session-scoped data management for projects and use cases

**Key Methods**:

#### Project Management
- `initProject(name, description)` - Create new project
- `switchToProject(projectId)` - Switch active project
- `loadProjectByName(name)` - Find & switch by name
- `listAllProjects()` - List all projects in session
- `deleteProject(projectId)` - Remove project

#### Use Case & Actor Management
- `addActor(actors[])` - Add actors to current project
- `getActor(actorId)` - Retrieve specific actor
- `getAllActors()` - List all actors
- `saveUseCase({...})` - Save/update use case
- `getUseCase(useCaseId)` - Retrieve specific use case
- `getAllUseCases()` - List all use cases
- `deleteUseCase(useCaseId)` - Remove use case

**State Management**:
- Uses `ensureStore()` to lazy-load from Firestore
- Automatic store initialization on first write
- All writes persist to Firestore immediately

### 3. MCP Tools

#### Project Tools (`src/tools/projectTools.ts`)
- `initProject` - Create new project
- `loadProjectByName` - Switch projects
- `findProjectByName` - Fuzzy search
- `listAllProjects` - List all projects
- `getProjectInfo` - Current project stats
- `viewProjectUseCases` - View use cases
- `switchToProject` - Switch by ID
- `deleteProject` - Delete project

#### Use Case Tools (`src/tools/usecaseTools.ts`)

**Use Case Creation Workflow**:

1. **`extractUseCase`** - Extract structured use case from natural language
   - Input: `input` (user description)
   - Output: `useCase` (GenUseCase format)
   - Uses: Gemini via OpenRouter to generate structured data

2. **`validateUseCase`** - Validate and score use case quality
   - Input: `originalDescription`, `useCase`
   - Output: `feedback[]` (improvement questions)
   - Process:
     - Rule-based validation (flat.validator)
     - Score calculation (0-100)
     - If score < 70: Generate improvement questions via LLM
     - Returns questions for iterative improvement

3. **`improveUseCase`** - Improve use case based on feedback
   - Input: `originalDescription`, `baseUseCase`, `improvementQuestions[]`
   - Output: `newUseCase`, `newScore`
   - Process:
     - Answer improvement questions via LLM
     - Generate improved use case
     - Re-validate and score
     - Repeat if score still < 70

4. **`useCaseToUML`** - Convert saved use case to PlantUML
   - Input: `useCaseId`
   - Output: PlantUML diagram string

5. **`compareUseCases`** - Compare generated vs reference use case
   - Input: `originalDescription`, `referenceUseCase`, `generatedUseCase`
   - Output: `analysis` (detailed scoring & feedback)
   - Metrics:
     - Semantic Coverage (20%)
     - Entity Alignment (20%)
     - Factuality (20%)
     - Structure (40%)

### 4. Validation System

#### Flat Validator (`src/validators/flat.validator.ts`)
- **Rule-based validation** against predefined criteria
- Checks: naming, actors, preconditions, flows, consistency
- Returns structured feedback with scores

#### LLM Validator (`src/validators/llm.validator.ts`)

**Key Functions**:

1. **`generateLLMQuestions`** - Generate 5 specific improvement questions
   - Uses COVE (Chain-of-Verification) methodology
   - 38 predefined validation questions from literature
   - Returns targeted questions based on validation feedback

2. **`answerLLMQuestions`** - Answer improvement questions
   - Takes questions and base use case
   - Returns concise answers and improvement instructions

3. **`compareUseCases`** - Comprehensive use case comparison
   - Senior BA persona prompt (20 years experience)
   - Step-by-step analysis process
   - Multi-dimensional scoring (semantic, entity, factuality, structure)
   - Detects hallucinations and missing logic

## 📊 Data Models

### GenUseCase Format (Primary)

```typescript
{
  name: string,
  summary: string,
  mainActor: string,
  actors: string[],
  preconditions?: string[],
  postconditions?: string[],
  flows: GenFlow[],    // MAIN, ALTERNATIVE, EXCEPTION
  loops?: GenLoop[]
}

GenFlow {
  id: string,
  kind: "MAIN" | "ALTERNATIVE" | "EXCEPTION",
  parentFlow?: string,
  fromStepIndex?: number,
  condition?: string,
  steps: GenStep[]
}

GenStep {
  index: number,
  actor: string,
  target?: string,
  description: string
}
```

### Legacy UseCase Format

```typescript
{
  id?: string,
  name: string,
  description: string,
  mainActor: string,
  actors: string[],
  steps: Step[]
}

Step {
  id?: string,
  actor: string,
  description: string,
  nextStep?: string
}
```

### Store & Project

```typescript
Store {
  id: string,              // sessionId
  createdAt: string,
  updatedAt: string,
  projects: { [projectId]: Project },
  currentProjectId: string | null
}

Project {
  id: string,
  name: string,
  description: string,
  createdAt: string,
  updatedAt: string,
  actors: Actor[],
  useCases: UseCase[]
}

Actor {
  actor_id: string,
  name: string,
  type: string,
  description?: string
}
```

## 🔑 Authentication & Configuration

### API Keys (Dual Authentication)

1. **Gemini API Key** (Per-Session)
   - Passed via HTTP header: `x-gemini-api-key`
   - Validated on initialization
   - Stored per session instance
   - Not persisted to disk

2. **OpenRouter API Key** (Server-Side)
   - Configured in `.env` file
   - Shared across all sessions
   - Used for all LLM operations

### Environment Variables

```bash
OPENROUTER_API_KEY=sk-or-v1-...    # Required
PORT=3006                           # Optional (default: 3006)
```

### Client Configuration

#### Claude Desktop
```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp",
      "headers": {
        "x-gemini-api-key": "YOUR_GEMINI_API_KEY"
      }
    }
  }
}
```

#### VS Code
```json
{
  "mcpServers": {
    "mcp-thesis": {
      "url": "http://localhost:3006/mcp",
      "headers": {
        "x-gemini-api-key": "YOUR_GEMINI_API_KEY"
      }
    }
  }
}
```

## 🚀 Usage Workflow

### Typical Session Flow

1. **Initialize MCP Connection**
   - Client sends initialization request with `x-gemini-api-key` header
   - Server creates session-scoped `SessionServer` instance
   - Store automatically loaded/created from Firestore

2. **Create/Load Project**
   ```typescript
   // Create new project
   await initProject("E-commerce System", "Online shopping platform")
   
   // Or load existing
   await loadProjectByName("E-commerce System")
   ```

3. **Extract Use Case**
   ```typescript
   await extractUseCase({
     input: "User wants to add items to cart and checkout"
   })
   // Returns: structured GenUseCase
   ```

4. **Validate & Improve**
   ```typescript
   // Validate
   const { feedback } = await validateUseCase({
     originalDescription: "User wants to add items...",
     useCase: extractedUseCase
   })
   
   // If score < 70, improve
   const { newUseCase, newScore } = await improveUseCase({
     originalDescription: "User wants to add items...",
     baseUseCase: extractedUseCase,
     improvementQuestions: feedback
   })
   ```

5. **Generate UML**
   ```typescript
   await useCaseToUML({ useCaseId: "123..." })
   ```

6. **Compare with Reference**
   ```typescript
   await compareUseCases({
     originalDescription: "...",
     referenceUseCase: groundTruth,
     generatedUseCase: aiGenerated
   })
   ```

## 🧪 Validation Methodology

### COVE (Chain-of-Verification) Approach

1. **Extract** - Generate initial use case from description
2. **Validate** - Rule-based + LLM scoring
3. **Question** - Generate 5 specific improvement questions
4. **Answer** - LLM answers questions with improvement guidance
5. **Improve** - Regenerate use case with improvements
6. **Re-validate** - Score improved version
7. **Iterate** - Repeat until score ≥ 70

### 38 Validation Questions (Literature-Based)

Categories:
- **Naming** - Meaningful, unambiguous, actor-independent
- **Description** - Clear goal, observable value
- **Actors** - Clearly defined, information exchanged
- **Preconditions** - Tangible system states
- **Flows** - Complete, consistent, correct abstraction
- **Guarantees** - Minimal & success guarantees
- **NFRs** - Nonfunctional requirements captured

## 📦 Dependencies

### Core
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `express` - HTTP server
- `firebase` - Firestore database
- `zod` - Schema validation
- `dotenv` - Environment configuration

### AI/LLM
- `@google/genai` - Direct Gemini API access
- `@openrouter/sdk` - OpenRouter API wrapper

### Development
- `typescript` - Type safety
- `tsx` - TypeScript execution
- `nodemon` - Auto-reload

## 🔄 Development Commands

```bash
# Install dependencies
npm install

# Development with auto-reload
npm run dev

# Watch mode (compile on change)
npm run watch

# Build for production
npm run build

# Run MCP inspector
npm run inspector
```

## 🎓 Research Context

This project implements concepts from:
- **Human-in-the-Loop AI** - Iterative improvement with human guidance
- **Chain-of-Verification** - Multi-stage validation approach
- **Use Case Quality** - Literature-based validation criteria
- **LLM-Assisted Requirements Engineering** - AI augmentation for BA tasks

## 🔍 Key Design Decisions

1. **Why Session-Scoped Stores?**
   - Isolation between MCP sessions
   - Prevents data leakage
   - Simplified state management

2. **Why OpenRouter + Gemini?**
   - Unified API access
   - Better rate limiting
   - Cost tracking
   - Easy model switching

3. **Why Two API Keys?**
   - Server-side: OpenRouter (infrastructure)
   - Client-side: Gemini (per-user quota)
   - Separation of concerns

4. **Why Firestore?**
   - Real-time sync capability
   - Document-based (matches Store structure)
   - Serverless scaling
   - Simple session-based querying

5. **Why GenUseCase Format?**
   - Explicit flow types (MAIN, ALT, EXCEPTION)
   - Loop structure support
   - Better alignment with UML semantics
   - Clearer actor-action relationships

## 🚧 Current Limitations

1. **In-Memory Sessions** - Sessions lost on server restart
2. **No Authentication** - API keys only, no user management
3. **No Rate Limiting** - Relies on OpenRouter's limits
4. **Single Server** - No horizontal scaling
5. **Manual UML** - PlantUML string generation only (no visual rendering)

## 🎯 Typical Use Cases

1. **Requirements Analysis** - Convert stakeholder descriptions to structured use cases
2. **Use Case Review** - Validate existing use cases against best practices
3. **Quality Assurance** - Compare AI-generated use cases with manually created references
4. **Teaching Tool** - Demonstrate use case modeling with AI assistance
5. **Research Platform** - Evaluate different LLM prompting strategies for requirements engineering

---

**Last Updated**: January 3, 2026
**Project Version**: 0.1.0
**MCP SDK Version**: 1.19.1

