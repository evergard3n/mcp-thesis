# MCP Thesis - Agent Guidelines

This document provides coding guidelines for AI agents working on the MCP Thesis codebase.

## Project Overview

**MCP Thesis** is a Model Context Protocol server for UML use case management, focused on LLM-assisted use case extraction, validation, and iterative improvement. Uses Gemini 2.0 Flash via OpenRouter.

**Working Directory**: `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/`

## Research Methodology: Human-in-the-Loop (HITL) Framework

### Goal

The framework acts as an **interviewer** (like a Business Analyst) that asks the right questions to help domain experts articulate their knowledge. It is NOT a one-shot generator that magically infers everything from input.

### Data Structure

Each test case in `test-data/dataset-*.json` contains:

- **vague**: A high-level description (what a stakeholder initially provides)
- **detailed**: Domain knowledge the expert has (used to simulate expert answers)
- **groundTruth**: The ideal final use case after complete expert collaboration

### Information Separation (Critical)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   FRAMEWORK SEES:              │   EXPERT HAS (hidden):            │
│   - Vague input                │   - Detailed input                │
│   - Current generated UC       │   - Domain knowledge              │
│   - Previous Q&A history       │                                   │
│                                │                                   │
└─────────────────────────────────────────────────────────────────────┘
```

- **Gap Analyzer**: Only sees vague input + current generated use case
- **Question Generator**: Based on gaps detected from vague input + current UC
- **Answer Simulator**: Uses detailed input to answer questions (simulates expert)

### Iterative Flow

```
Vague Input
    │
    ▼
┌─────────────────┐
│ Generate UC     │◄──────────────────────────────┐
└────────┬────────┘                               │
         │                                        │
         ▼                                        │
┌─────────────────┐                               │
│ Gap Analyzer    │ (sees: vague + current UC)    │
└────────┬────────┘                               │
         │                                        │
         ▼                                        │
┌─────────────────┐                               │
│ Generate Qs     │                               │
└────────┬────────┘                               │
         │                                        │
         ▼                                        │
┌─────────────────┐     ┌──────────────────┐      │
│ Expert Answers  │◄────│ Detailed Input   │      │
└────────┬────────┘     │ (hidden domain   │      │
         │              │  knowledge)      │      │
         │              └──────────────────┘      │
         │                                        │
         ▼                                        │
┌─────────────────┐                               │
│ Update UC with  │───────────────────────────────┘
│ new knowledge   │
└─────────────────┘
         │
         ▼ (repeat until converged)
    Final Use Case
```

### What This Tests

1. **Question Quality**: Does the gap analyzer ask relevant, useful questions?
2. **Question Diversity**: Does it cover different aspects (validation, errors, resources, etc.)?
3. **Iterative Improvement**: Does each Q&A round discover new scenarios?
4. **Convergence**: Does the use case improve toward completeness?

### What This Does NOT Test

- Perfect one-shot extraction from detailed input
- Matching ground truth in minimum iterations
- Inferring domain knowledge not mentioned anywhere

### Evaluation Metrics

- **Discovery Rate**: How many ground truth flows were eventually discovered
- **Quality Score**: Ratio of grounded/logical flows vs hallucinations
- **F1 Score**: Balance of precision and recall against ground truth
- **Iteration Efficiency**: Knowledge gained per Q&A round

### Key Files

- `src/analyzers/gap.analyzer.ts` - Detects gaps in generated use case
- `src/analyzers/uncertainty.ranker.ts` - Prioritizes which gaps to ask about
- `src/tools/testingTools.ts` - HITL comparison and evaluation tools
- `src/evaluators/three-tier.evaluator.ts` - Categorizes flows as grounded/logical/hallucination
- `src/services/semantic.service.ts` - Text embeddings for semantic matching (addresses string matching problems)

### Current Problems (as of 2026-02-02)

#### 1. Gap Analyzer: Keyword Matching is Imprecise

The gap analyzer uses regex patterns to detect validation steps but misses semantic equivalents. Example: Step "Matches the loss to a policy" doesn't trigger `validat|check|verif|confirm` pattern, so policy match failures were never flagged.

#### 2. Gap Analyzer: No Vague Input Structure Parsing

The vague input may mention scenarios like "pause, save, resume" but the analyzer only does keyword detection, not semantic understanding. Results in generic questions instead of specific ones like "Can the clerk restart an interrupted entry?"

#### 3. QA Loop Gets Stuck on Same Topics

The iterative process may keep asking about the same topic repeatedly (e.g., iterations 3-5 all asked "When does ALT_8a occur?") instead of exploring new areas like policy identification or claim line changes. Evidence: 62% of generated flows (18/29) are duplicates.

#### 4. No Diminishing Returns Mechanism

The uncertainty ranker scores by `uncertainty × criticality`. When a question is answered and new flows generated, those new flows may also have high uncertainty, causing the same topic to be prioritized again instead of moving to unexplored aspects.

#### 5. Limited Coverage of Common Real-World Scenarios

The gap analyzer has specific detectors (temporal, nested, resource, etc.) but doesn't cover all common patterns:
- Policy/data matching failures
- User restart/resume interrupted work
- Data changes after validation
- Different processing paths based on data type

Evidence: Only 8/23 ground truth flows discovered (34.78% discovery rate).

#### Problem Summary

| Problem | Component | Impact | Solution |
|---------|-----------|--------|----------|
| Keyword matching imprecise | Gap Analyzer | Misses validation steps with synonyms | **SemanticService** - Use embeddings for semantic matching |
| No vague input parsing | Gap Analyzer | Can't extract implied scenarios | **SemanticService** - Semantic clustering of vague input |
| QA loop stuck | Uncertainty Ranker | Limited breadth exploration (62% duplicates) | TBD |
| No diminishing returns | Uncertainty Ranker | Same topics repeated | TBD |
| Limited scenario coverage | Gap Analyzer | Missing common BA questions (34.78% discovery) | TBD |

#### Fixed Problems

- ~~Evaluation: Semantic matching too permissive~~ - Fixed with one-to-one GT flow claiming
- ~~Evaluation: Duplicate flows inflate metrics~~ - Fixed with `isDuplicate` tracking and deduplication

## Build & Development Commands

```bash
npm install                    # Install dependencies
npm run dev                    # Run server in dev mode (tsx)
npm run watch                  # Compile TypeScript on file changes
npm run build                  # Build production bundle (tsc)
npm run inspector              # Run MCP inspector for debugging
```

**Testing**: No Jest/Mocha/Vitest. Testing via MCP tools: `runHITLComparison` and `evaluateResults`. Test data: `test-data/dataset-*.json`. No single test command available.

## Code Style Guidelines

### TypeScript Configuration

- **Target**: ES2022, **Module**: Node16 with ES modules
- **Strict mode**: Enabled, **Output**: `build/` directory

### Import Conventions

**CRITICAL**: Always use `.js` extensions in imports (ES module requirement):

```typescript
// ✅ Correct
import { JsonProjectStore } from "./stores/projectStore.js";

// ❌ Wrong
import { JsonProjectStore } from "./stores/projectStore";
import { JsonProjectStore } from "./stores/projectStore.ts";
```

**Import order**: Node built-ins → MCP SDK → local absolute → local relative

```typescript
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { validateUseCase } from "./validators.js";
```

### Naming Conventions

- **Files**: `camelCase.ts` (single-purpose), `kebab-case.ts` (multi-word), `*.interface.ts`, `*.schema.ts`, `*.service.ts`, `*Tools.ts`
- **Variables/Functions**: `camelCase`
- **Classes/Interfaces/Types**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`

```typescript
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export interface GenUseCase {}
export class JsonProjectStore {}
export async function generateUseCase() {}
```

### Type Definitions

Prefer interfaces for object shapes, types for unions/literals:

```typescript
// ✅ Preferred
export interface Gap {
  type: GapType;
  severity: "high" | "medium" | "low";
}
export type GapType = "missing_exception_flows" | "missing_alternative_flows";

// ✅ Always type params and returns
export async function analyzeGaps(useCase: GenUseCase): Promise<GapAnalysis> {}
```

### Error Handling

**MCP Tools** - Return structured errors, never throw:

```typescript
async (args) => {
  try {
    const result = await doSomething(args);
    return { content: [{ type: "text" as const, text: `Success: ${result}` }] };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: `Error: ${error.message}` }],
      isError: true,
    };
  }
};
```

**Services/Helpers** - Use try-catch with meaningful messages:

```typescript
export async function generateUseCase(
  description: string,
): Promise<GenUseCase> {
  try {
    const result = await llmCall(description);
    if (!result) throw new Error("LLM returned empty result");
    return result;
  } catch (error) {
    throw new Error(`Generation failed: ${error.message}`);
  }
}
```

### Async/Await

Always use async/await, never raw promises:

```typescript
// ✅ Correct
const useCase = await extractUseCase(description);

// ❌ Avoid
extractUseCase(description).then(...);
```

### Comments

JSDoc for public APIs, inline comments for complex logic:

```typescript
/**
 * Analyzes use case for gaps and missing flows
 * @param useCase - Use case to analyze
 * @returns Prioritized gap analysis
 */
export async function analyzeGaps(useCase: GenUseCase): Promise<GapAnalysis> {
  // Calculate uncertainty × criticality for each step
  const priorities = flow.steps.map((step) => calculatePriority(step));
}
```

## Architecture Patterns

### Session Isolation

Each MCP session gets isolated instances: `SessionServer`, `JsonProjectStore`, `GeminiOpenRouterFunctions`. Never share state between sessions.

### Store Pattern

All data operations through `JsonProjectStore`:

```typescript
await projectStore.initProject(name, description);
await projectStore.saveUseCase(useCase);
const useCases = await projectStore.getAllUseCases();
```

### LLM Interaction Pattern

All LLM calls through `GeminiOpenRouterFunctions`:

```typescript
const result = await geminiFunctions.generateObject({
  schema: genUseCaseSchema,
  prompt: "...",
  systemInstructions: "You are a business analyst...",
});
```

### Zod Validation

Always validate LLM outputs with Zod:

```typescript
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
const validated = genUseCaseSchema.parse(llmOutput);
```

### Semantic Embedding Service

The `SemanticService` provides text embeddings to tackle string matching problems. Uses `@xenova/transformers` with multilingual MiniLM-L12-v2 model (384-dimensional embeddings).

**Purpose**: Replace keyword/regex matching with semantic similarity to detect equivalent concepts (e.g., "matches" vs "validates", "checks" vs "confirms").

**Usage Pattern**:

```typescript
import semanticService from "../services/semantic.service.js";

// Single text embedding
const embedding = await semanticService.embed("Matches the loss to a policy");

// Batch embedding (more efficient)
const embeddings = await semanticService.embedBatch([
  "validates policy",
  "checks policy match",
  "confirms policy"
]);

// Compute similarity (cosine similarity, returns -1 to 1)
const similarity = await semanticService.cosineSimilarity(embedding1, embedding2);

// Compute centroid for multiple related texts
const centroid = await semanticService.computeCentroid(embeddings);
```

**Key Features**:
- **Singleton**: Auto-initialized on import, use `await semanticService.waitForReady()` if needed
- **Normalized embeddings**: All embeddings are L2-normalized (magnitude = 1)
- **Batch processing**: Use `embedBatch()` for multiple texts (more efficient)
- **Cosine similarity**: Returns dot product (since vectors are normalized)

**Use Cases**:
- Gap analyzer: Detect validation steps semantically instead of regex patterns
- Flow comparison: Match semantically similar steps across use cases
- Duplicate detection: Identify duplicate flows using embedding similarity
- Vague input parsing: Extract implied scenarios through semantic clustering

**Performance Notes**:
- Model loads on first import (~100MB, quantized)
- Embeddings are cached implicitly by the model pipeline
- Batch operations are more efficient than sequential single embeddings

## Environment Variables

Required in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...    # Server-side LLM access
GEMINI_API_KEY=...                  # Session-specific (via HTTP header)
API_KEY=...                          # Firebase config
AUTH_DOMAIN=...
PROJECT_ID=...
STORAGE_BUCKET=...
MESSAGING_SENDER_ID=...
APP_ID=...
MEASUREMENT_ID=...
```

## DO NOT

- ❌ Add linting/formatting configs (ESLint, Prettier, etc.)
- ❌ Create unit test files (Jest, Mocha, Vitest)
- ❌ Use `.ts` extensions in import paths
- ❌ Throw errors in MCP tool handlers
- ❌ Share state between sessions
- ❌ Use `require()` - ES module project
- ❌ Commit `.env` file
- ❌ Use `any` type (except for legitimate unknown types)
- Dont create scripts for running MCP tools directly. Return an error message if you can't find the specified error.
- Don't create documentation files (unless specified)
- Don't create separate files for new functions. Search if there's a file containing similar or topic functions, edit into it. Don't comment too much on the code.
