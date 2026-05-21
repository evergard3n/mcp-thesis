# AGENTS.md

## Scope
This is the default operating guide for agentic coding agents in this repository.
Primary codebase: `mcp-thesis/`.

## Repo Map
- App root: `mcp-thesis/`
- Entrypoint: `mcp-thesis/src/index.ts`
- Build output: `mcp-thesis/build/`
- Test scripts: `mcp-thesis/test-scripts/`
- Data/eval files: `mcp-thesis/test-data/`

## Cursor/Copilot Rules Check
The repository was checked for additional agent rules:
- `.cursorrules`: not found
- `.cursor/rules/`: not found
- `.github/copilot-instructions.md`: not found
No extra Cursor/Copilot instruction files are currently present.

## Setup
Run commands from `mcp-thesis/` unless explicitly noted.

```bash
cd mcp-thesis
npm install
```

## Environment
Current runtime expects environment variables for:
- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- Firebase config vars referenced by `src/helpers/env.ts`

Security rules:
- Never commit secrets.
- Never print API keys in logs.
- Treat `.env` as sensitive.

## Build/Lint/Test Commands

### Build
```bash
npm run build
```
- Compiles TypeScript via `tsc`.
- Produces `build/` artifacts.

### Dev Server
```bash
npm run dev
```
- Runs `tsx watch src/index.ts`.
- Starts backend server (default port `3006`).

### TypeScript Watch
```bash
npm run watch
```

### Lint
- No lint script is defined in `package.json`.
- Do not add ESLint/Prettier unless explicitly requested.

## Testing Model
This repository does not use Jest/Vitest/Mocha as primary workflow.
Testing is script-based and dataset/evaluation driven.

Important: many scripts import from `build/`.
Compile first:

```bash
npm run build
```

### Run a Single Test (recommended)
Fastest single test path:

```bash
node test-scripts/test-domain-simple.js
```

Other single-test scripts:

```bash
node test-scripts/test-domain-classification.js
node test-scripts/test-domain-detailed.js
node test-scripts/test-domain-filtering.js
```

### Run Full Batch Test
```bash
node test-scripts/test-all-datasets.js
```
- Runs all dataset files under `test-data/dataset-*.json`.
- Slower and API-costly.

## API-level Evaluation Endpoints
When server is running, testing endpoints in `src/index.ts` include:
- `POST /sessions/:sessionId/testing/prepare-test-data`
- `POST /sessions/:sessionId/testing/embed-dataset`
- `POST /sessions/:sessionId/testing/run-hitl-comparison`
- `POST /sessions/:sessionId/testing/evaluate-results`
- `POST /sessions/:sessionId/testing/classify-domain`

## Code Style Guidelines

### Language/Module Rules
- TypeScript strict mode is enabled.
- ESM project (`"type": "module"`).
- In TS source, local imports must include `.js` extension.

Example:
```ts
import { SessionManager } from "./session/session.manager.js";
```

### Imports
- Keep imports at top of file.
- Preferred order:
  1) built-in/external packages
  2) internal relative imports
- Prefer named imports/exports unless existing default export pattern is established.

### Formatting
- Match existing style:
  - 2-space indentation
  - semicolons
  - double-quoted strings
  - trailing commas where already used
- Keep functions focused; avoid sprawling methods unless consistent with file pattern.

### Types
- Type function params and return values for public/service boundaries.
- Prefer `interface` for object contracts.
- Use `type` for unions/compositions.
- Validate external input and LLM output with Zod before business logic.

### Naming
- variables/functions: `camelCase`
- classes/interfaces/types: `PascalCase`
- constants/env vars: `UPPER_SNAKE_CASE`
- keep existing file suffix patterns:
  - `*.service.ts`
  - `*.validator.ts`
  - `*.analyzer.ts`
  - `*.interface.ts`

### Error Handling
- Express handlers:
  - validate with `safeParse`
  - return structured `400/404/409` for expected request/state issues
  - use `try/catch` and return `500` for unexpected failures
- Service functions may throw `Error` with actionable context.
- Do not swallow exceptions silently.

### Async/Concurrency
- Prefer `async/await` over `.then()` chains.
- Avoid uncontrolled parallel LLM/API calls.
- Preserve deterministic loop behavior in HITL orchestration.

### State/Architecture
- Respect session isolation (`SessionManager`, session-scoped store/orchestrator).
- Do not share mutable state across sessions.
- Keep persistence routed through store/service abstractions.

### Logging
- Keep logs concise and diagnostic.
- Never log secrets.

## Agent Guardrails
Do:
- Make minimal, targeted edits.
- Preserve existing conventions and structure.
- Build before script tests that depend on `build/`.
- Report what changed and how verified.

Do not:
- Add new tooling/frameworks without request.
- Remove `.js` import extensions in TS source.
- Mix unrelated refactors into the same task.
- Commit credentials or sensitive files.

## Quick Commands
```bash
cd mcp-thesis
npm install
npm run build
npm run dev
node test-scripts/test-domain-simple.js
node test-scripts/test-all-datasets.js
```
