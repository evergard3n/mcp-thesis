# MCP Thesis - Agent Guidelines

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Research Methodology: HITL Framework](#2-research-methodology-hitl-framework)
3. [Architecture & Data Structure](#3-architecture--data-structure)
4. [Code Style Guidelines](#4-code-style-guidelines)
5. [Testing & Evaluation Framework](#5-testing--evaluation-framework)
6. [MCP Tools Reference](#6-mcp-tools-reference)
7. [Build & Development Commands](#7-build--development-commands)
8. [DO NOTs](#8-do-nots)

---

## 1. Project Overview

**MCP Thesis** is a Model Context Protocol server for UML use case management, focused on LLM-assisted use case extraction, validation, and iterative improvement. It uses Gemini 2.0 Flash via OpenRouter.

**Working Directory**: `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/`

---

## 2. Research Methodology: HITL Framework

### 2.1 Core Concepts

The framework acts as an **interviewer** (like a Business Analyst) that asks the right questions to help domain experts articulate their knowledge. It is NOT a one-shot generator that magically infers everything from input.

### 2.2 Research Problem & Solution

**The Core Tension**: Previous approaches (COVE) often expanded use cases with "hallucinations"—plausible but incorrect flows. The challenge is distinguishing reasonable logical additions from pure fabrications.

**The Solution**:
1.  **Information Asymmetry**: Separating knowledge roles.
    *   **Generator**: Sees only the vague summary.
    *   **Expert**: Has the detailed ground truth.
2.  **Constrained Elicitation**: Using multiple-choice questions to limit invention.
3.  **Three-Tier Evaluation**: Distinguishing between Grounded (in input), Logical (reasonable domain knowledge), and Hallucination (wrong).

### 2.3 Data Structure & Information Separation

Each test case contains:
*   **vague**: High-level description (stakeholder input)
*   **detailed**: Domain knowledge (hidden from generator, used by expert simulator)
*   **groundTruth**: Ideal final use case

```
┌─────────────────────────────────────────────────────────────────────┐
│   FRAMEWORK SEES:              │   EXPERT HAS (hidden):            │
│   - Vague input                │   - Detailed input                │
│   - Current generated UC       │   - Domain knowledge              │
│   - Previous Q&A history       │                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.4 Iterative Flow

1.  **Generate UC**: Extract initial use case from vague input.
2.  **Gap Analyzer**: Detect missing information/ambiguities (sees vague + current UC).
3.  **Generate Qs**: Formulate targeted questions based on gaps.
4.  **Expert Answers**: Expert simulator answers using detailed input.
5.  **Update UC**: Refine use case with new, grounded knowledge.

---

## 3. Architecture & Data Structure

### 3.1 Session & Store Architecture

Each session has one store, and each store can contain multiple projects.

**Firestore Structure**:
```
stores/
  └── {sessionId}/
      ├── id: string (sessionId)
      ├── currentProjectId: string | null
      └── projects: {
            [projectId: string]: {
              id: string, name: string, description: string,
              useCases: UseCase[], actors: Actor[]
            }
          }
```

**Key Patterns**:
*   **Session Isolation**: `SessionServer`, `JsonProjectStore`, and `GeminiOpenRouterFunctions` are isolated per session.
*   **Store Pattern**: All data operations go through `JsonProjectStore`.
*   **Session-Scoped Singleton**: `GeminiOpenRouterFunctions` is instantiated once per session in `SessionServer` and passed to tools/services, replacing per-call instantiation.

### 3.2 Key Architectural Components

#### Semantic Embedding Service
Uses `@xenova/transformers` (MiniLM-L12-v2) for semantic matching instead of regex.
*   **Purpose**: Detect equivalent concepts ("matches" vs "validates").
*   **Usage**: `semanticService.embedBatch()` for efficiency.
*   **Application**: Gap analysis, flow comparison, duplicate detection.

#### LLM Interaction
*   All calls via `GeminiOpenRouterFunctions`.
*   **Batch Evaluation**: `evaluateUseCase` evaluates all flows in a single API call for performance.
*   **Zod Validation**: All LLM outputs must be validated with Zod schemas.

---

## 4. Code Style Guidelines

### 4.1 TypeScript Configuration
*   **Target**: ES2022, **Module**: Node16 with ES modules.
*   **Strict mode**: Enabled.

### 4.2 Import Conventions
**CRITICAL**: Always use `.js` extensions in imports.
```typescript
// ✅ Correct
import { JsonProjectStore } from "./stores/projectStore.js";
```
**Order**: Node built-ins → MCP SDK → local absolute → local relative.

### 4.3 Naming & Types
*   **Files**: `camelCase.ts`, `kebab-case.ts`, `*.interface.ts`, `*.service.ts`.
*   **Variables**: `camelCase`. Classes: `PascalCase`. Constants: `UPPER_SNAKE_CASE`.
*   **Types**: Prefer `interface` for shapes, `type` for unions. Always type params and returns.

### 4.4 Error Handling
*   **MCP Tools**: Return structured errors, NEVER throw.
*   **Services**: Use try-catch with meaningful error wrapping.

### 4.5 Async/Await
*   Always use `async/await`, never raw promises (`.then()`).

---

## 5. Testing & Evaluation Framework

### 5.1 Three-Tier Evaluation Metrics

We evaluate generated flows against Ground Truth (GT) using three categories:

1.  **GROUNDED (Score 1.0)**: Explicitly mentioned in the input description.
2.  **LOGICAL (Score 0.7)**: Not in input, but reasonable for the domain (not a hallucination).
3.  **HALLUCINATION (Score 0.0)**: Neither grounded nor logical; incorrect or absurd.

### 5.2 Key Metrics

*   **Precision**: `(Grounded + Logical) / Total Generated Flows` (How accurate is the output?)
*   **Recall (Discovery Rate)**: `Flows Matching GT / Total GT Flows` (How complete is the output?)
*   **F1 Score**: Harmonic mean of Precision and Recall.
*   **Quality Score**: Weighted average: `(Grounded×1.0 + Logical×0.7) / Total Flows`.

### 5.3 Current Problems (as of 2026-02-02)

#### 1. Gap Analyzer: Keyword Matching is Imprecise

The gap analyzer uses regex patterns to detect validation steps but misses semantic equivalents. Example: Step "Matches the loss to a policy" doesn't trigger `validat|check|verif|confirm` pattern, so policy match failures were never flagged.

#### 2. Gap Analyzer: No Vague Input Structure Parsing

The vague input may mention scenarios like "pause, save, resume" but the analyzer only does keyword detection, not semantic understanding. Results in generic questions instead of specific ones like "Can the clerk restart an interrupted entry?"

#### 3. Duplication in Question Generation (GitHub Issue #1)

The iterative HITL refinement process asks duplicate questions across iterations instead of exploring new areas. Evidence shows 18.75% of questions are exact duplicates and 62% of generated flows are duplicates.
**Root Cause**: Ineffective semantic filtering due to wording mismatch between gap context and actual questions, plus missing metadata-based deduplication.
**Link**: https://github.com/evergard3n/mcp-thesis/issues/1

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

---

## 6. MCP Tools Reference

### 6.1 Test Data Management
*   **`prepareTestData`**: Validates test cases and creates structured dataset JSON (`test-data/dataset-*.json`).

### 6.2 Comparison Tools
*   **`runCOVEComparison`**: Phase 1 testing. Compares COVE with Vague Input vs. COVE with Detailed Input.
*   **`runHITLComparison`**: Phase 2 testing. Compares Constrained HITL vs. COVE (Detailed).
*   **`evaluateResults`**: Runs the three-tier evaluation on results files.

### 6.3 HITL Workflow Tools
*   **`generateQuestionsFromBaseline`**: Step 1. Validates baseline and generates questions (with optional score awareness).
*   **`refineWithHumanAnswers`**: Step 2. Refines use case using provided answers (constrained to avoid hallucination).
*   **Note**: Replaces the old monolithic `extractUseCaseWithConstrainedHITL`.

### 6.4 Data Formats
*   **Dataset**: JSON containing `vague`, `detailed`, and `groundTruth` for each `testCaseId`.
*   **Results**: JSON mapping test cases to generated Use Cases under different conditions (e.g., `conditionA_COVEVague`, `conditionD_HITL`).

---

## 7. Build & Development Commands

```bash
npm install                    # Install dependencies
npm run dev                    # Run server in dev mode (tsx)
npm run watch                  # Compile TypeScript on file changes
npm run build                  # Build production bundle (tsc)
npm run inspector              # Run MCP inspector for debugging
```

### Environment Variables (.env)
```bash
OPENROUTER_API_KEY=...     # Server-side LLM access
GEMINI_API_KEY=...         # Session-specific
API_KEY=...                # Firebase config
# ... other Firebase vars
```

---

## 8. DO NOTs

*   ❌ Add linting/formatting configs (ESLint, Prettier).
*   ❌ Create unit test files (Jest, Mocha) - use MCP testing tools.
*   ❌ Use `.ts` extensions in import paths.
*   ❌ Throw errors in MCP tool handlers (return error objects).
*   ❌ Share state between sessions.
*   ❌ Use `require()` (ES module project).
*   ❌ Commit `.env` file.
*   ❌ Create documentation files unless specified.
*   ❌ Create separate files for new functions if they fit in existing topic files.
