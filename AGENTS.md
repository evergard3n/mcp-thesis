# MCP Thesis - Agent Guidelines

This document provides coding guidelines for AI agents working on the MCP Thesis codebase.

## Project Overview

**MCP Thesis** is a Model Context Protocol server for UML use case management, focused on LLM-assisted use case extraction, validation, and iterative improvement. Uses Gemini 2.0 Flash via OpenRouter.

**Working Directory**: `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/`

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
export interface GenUseCase { }
export class JsonProjectStore { }
export async function generateUseCase() { }
```

### Type Definitions
Prefer interfaces for object shapes, types for unions/literals:

```typescript
// ✅ Preferred
export interface Gap { type: GapType; severity: "high" | "medium" | "low"; }
export type GapType = "missing_exception_flows" | "missing_alternative_flows";

// ✅ Always type params and returns
export async function analyzeGaps(useCase: GenUseCase): Promise<GapAnalysis> { }
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
      isError: true
    };
  }
}
```

**Services/Helpers** - Use try-catch with meaningful messages:
```typescript
export async function generateUseCase(description: string): Promise<GenUseCase> {
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
  const priorities = flow.steps.map(step => calculatePriority(step));
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
  systemInstructions: "You are a business analyst..."
});
```

### Zod Validation
Always validate LLM outputs with Zod:
```typescript
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
const validated = genUseCaseSchema.parse(llmOutput);
```

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
