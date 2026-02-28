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
    - **Generator**: Sees only the vague summary.
    - **Expert**: Has the detailed ground truth.
2.  **Constrained Elicitation**: Using multiple-choice questions to limit invention.
3.  **Three-Tier Evaluation**: Distinguishing between Grounded (in input), Logical (reasonable domain knowledge), and Hallucination (wrong).

### 2.3 Data Structure & Information Separation

Each test case contains:

- **vague**: High-level description (stakeholder input)
- **detailed**: Domain knowledge (hidden from generator, used by expert simulator)
- **groundTruth**: Ideal final use case

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

- **Session Isolation**: `SessionServer`, `JsonProjectStore`, and `GeminiOpenRouterFunctions` are isolated per session.
- **Store Pattern**: All data operations go through `JsonProjectStore`.
- **Session-Scoped Singleton**: `GeminiOpenRouterFunctions` is instantiated once per session in `SessionServer` and passed to tools/services, replacing per-call instantiation.

### 3.2 Key Architectural Components

#### Semantic Embedding Service

Uses `@xenova/transformers` (MiniLM-L12-v2) for semantic matching instead of regex.

- **Purpose**: Detect equivalent concepts ("matches" vs "validates").
- **Usage**: `semanticService.embedBatch()` for efficiency.
- **Application**: Gap analysis, flow comparison, duplicate detection.

#### LLM Interaction

- All calls via `GeminiOpenRouterFunctions`.
- **Batch Evaluation**: `evaluateUseCase` evaluates all flows in a single API call for performance.
- **Zod Validation**: All LLM outputs must be validated with Zod schemas.

#### Gap Analyzer Pipeline (6 phases)

Runs inside `analyzeGaps()` in `src/analyzers/gap.analyzer.ts`:

1. Embed all step descriptions and flow conditions.
2. Blueprint detection (domain-gated — only blueprints whose domain matches the use case's detected domain run; prioritized; covered steps skipped in phase 3).
3. Compare step embeddings against semantic centroids; flag steps without exception handling.
4. Analyze condition quality (vagueness, relevance to anchor step).
5. Structural checks (missing exception/alternative flows, unused actors).
6. Keyword-based detectors (temporal, nested, environmental, technology). Filter stale gaps via metadata + semantic deduplication against conversation history.

#### Blueprints (`src/data/blueprints.json`)

Pattern-based gap detector for multi-role interaction patterns. Four blueprints:

- `approval_chain` — submitter + approver; scenarios: reject, conditional approval, delegate
- `request_lifecycle` — initiator + fulfiller; scenarios: cancel, modify, partial/wrong/late fulfillment
- `multi_party_selection` — selector; scenarios: split, merge, no match
- `information_completeness` — provider; scenarios: missing info, fill later

Each blueprint is tagged with a domain (`human_machine` or `machine_machine`). The current four are all `human_machine`. At gap analysis time, only blueprints whose domain matches the use case's detected domain are activated. Use cases with no domain set run all blueprints (backward compatibility).

Blueprints activate by matching steps against role centroids (threshold 0.45), then check scenario coverage against existing flows (threshold 0.65). Uncovered scenarios become gaps with interpolated question templates.

#### Semantic Centroids (`src/data/gap-centroids.json`)

Eight centroid categories trigger gap types when a step's embedding similarity >= 0.5 and the step has no exception handling:

| Category | Gap Type |
|---|---|
| `validation` | `missing_validation_handling` |
| `search_lookup` | `missing_search_handling` |
| `data_input` | `missing_data_quality_handling` |
| `resource_assignment` | `missing_resource_availability` |
| `system_interaction` | `missing_system_failure_handling` |
| `completion` | `missing_post_completion_scenarios` |
| `save_resume` | `missing_save_resume_handling` |
| `vague_condition` | `uncertain_conditions` (no exception check) |

Each centroid category is tagged with applicable domain(s): `human_machine`, `machine_machine`, or both. Only categories that include the use case's detected domain are used for step/condition analysis. Use cases with no domain set use all categories (backward compatibility).

#### Domain Detection

The use case's domain is decided from the vague input during **baseline generation** (the first extraction from the user's vague description). A classifier (e.g. prompt or lightweight model) outputs a single label: `human_machine` (primary interaction is human actors with the system — forms, approvals, requests, selection) or `machine_machine` (primary interaction is system-to-system — protocols, APIs, resource locking, timers). The result is stored on the use case so gap analysis can read it. When domain is missing (e.g. older runs), all blueprints and centroids run (current behavior).

---

## 4. Code Style Guidelines

### 4.1 TypeScript Configuration

- **Target**: ES2022, **Module**: Node16 with ES modules.
- **Strict mode**: Enabled.

### 4.2 Import Conventions

**CRITICAL**: Always use `.js` extensions in imports.

```typescript
// ✅ Correct
import { JsonProjectStore } from "./stores/projectStore.js";
```

**Order**: Node built-ins → MCP SDK → local absolute → local relative.

### 4.3 Naming & Types

- **Files**: `camelCase.ts`, `kebab-case.ts`, `*.interface.ts`, `*.service.ts`.
- **Variables**: `camelCase`. Classes: `PascalCase`. Constants: `UPPER_SNAKE_CASE`.
- **Types**: Prefer `interface` for shapes, `type` for unions. Always type params and returns.

### 4.4 Error Handling

- **MCP Tools**: Return structured errors, NEVER throw.
- **Services**: Use try-catch with meaningful error wrapping.

### 4.5 Async/Await

- Always use `async/await`, never raw promises (`.then()`).

---

## 5. Testing & Evaluation Framework

### 5.1 Three-Tier Evaluation Metrics

We evaluate generated flows against Ground Truth (GT) using three categories:

1.  **GROUNDED (Score 1.0)**: Explicitly mentioned in the input description.
2.  **LOGICAL (Score 0.7)**: Not in input, but reasonable for the domain (not a hallucination).
3.  **HALLUCINATION (Score 0.0)**: Neither grounded nor logical; incorrect or absurd.

### 5.2 Key Metrics

- **Precision**: `(Grounded + Logical) / Total Generated Flows` (How accurate is the output?)
- **Recall (Discovery Rate)**: `Flows Matching GT / Total GT Flows` (How complete is the output?)
- **F1 Score**: Harmonic mean of Precision and Recall.
- **Quality Score**: Weighted average: `(Grounded×1.0 + Logical×0.7) / Total Flows`.

### 5.3 Latest Test Results (as of 2026-02-21)

**Test file**: `enhanced-hitl-2026-02-18T14-15-46-517Z` — CC1 only

| Condition | Quality | Discovery | Precision | F1 |
|---|---|---|---|---|
| Baseline (vague) | 1.0 | 0.125 | 1.0 | 0.222 |
| Detailed Baseline | 1.0 | 1.0 | 1.0 | 1.0 |
| **Enhanced HITL** | **0.487** | **0.75\*** | **0.667** | **0.706** |

\* **Discovery rate is artificially inflated.** The evaluator's semantic matching conflated generic system-failure flows with domain-specific resource lock policies. True discovery is closer to ~2/8 (25%) — only MAIN and EXT_9a were genuinely matched. The remaining 4 "discovered" GT flows were false positives (e.g., "client retries request" matched as "applies selection policy to suspended clients").

### 5.4 Known Problems

#### 1. Gap Analyzer: Semantic Centroids Are Business-Process-Biased

Current centroids (`validation`, `data_input`, `resource_assignment`, `completion`, `save_resume`) are tuned for insurance/claims/form-submission domains. They systematically miss domain concepts from systems/concurrency domains.

**Evidence from CC1**: None of the 7 domain-specific GT flows were asked about:
- "Client already has access" → conversion policy (ALT_6a) — no centroid
- "Resource already in use" → compatibility policy (ALT_7a) — no centroid
- "Time limit for holding" → holding timer (ALT_8a) — no centroid
- "Timer expires before client finishes" → exception/fail (EXT_9a) — no centroid
- "Client has nested locks" → reference count decrement (ALT_10a) — no centroid
- "Other clients waiting for resource" → selection policy (ALT_11a) — no centroid
- "Timer still running at cleanup" → cancel timer (ALT_12a) — no centroid

#### 2. `information_completeness` Blueprint Misfires on System Actors

The blueprint activates when a step matches the "provider" role centroid (threshold 0.45). In CC1, step 3 "Service Client uses the resource" matched close enough to trigger the blueprint, generating questions about "missing information at step 3". This produced 4 of the 5 hallucinations (EXT_3a, ALT_3a, EXT_3b, EXT_3c). The concept of "missing form fields" is inapplicable to a system-to-system locking protocol.

**Root cause**: No activation guard to suppress the blueprint when the matched actor is a system component rather than a human user.

#### 3. QA Loop Gets Stuck on Its Own Hallucinations

Iteration 2 followed up on hallucinated flows from iteration 1 (e.g., "can step 1 'proceeds with partial info' be saved as draft?"). Because the refiner incorporated those flows into the UC, the next gap analysis treated them as real steps and generated more irrelevant questions. The loop never pivoted to unexplored territory.

#### 4. Evaluator Semantic Matching Too Permissive for Domain-Specific Flows

GT flows encoding narrow domain policies (e.g., "applies compatibility policy") were matched to vaguely similar generated flows (e.g., "Resource Lock fails, client times out"). This inflated the discovery rate by ~50 percentage points in CC1. One-to-one claiming prevents double counting but does not prevent wrong-concept matching.

#### 5. Gap Analyzer: Keyword Matching Still Imprecise

Several keyword detectors use regex patterns (temporal, nested, environmental, technology). These miss semantic equivalents and remain independent of the semantic embedding pipeline.

#### 6. No Diminishing Returns Mechanism

The uncertainty ranker scores by `uncertainty × criticality`. When a question is answered and new flows are generated, those new flows also have high uncertainty scores, causing the same conceptual area to be re-prioritized instead of moving to unexplored aspects.

#### Problem Summary Table

| Problem | Component | Impact | Status |
|---|---|---|---|
| Centroids biased toward business processes | Gap Analyzer | Entire domain classes missed (CC1: 0/7 domain flows discovered) | **IN PROGRESS** — domain-scoped activation is the designed solution |
| `information_completeness` blueprint fires on system actors | Blueprint Detector | 4/5 hallucinations in CC1 trace directly to this | **IN PROGRESS** — domain-scoped activation is the designed solution |
| QA loop follows hallucinated flows | Refiner + Gap Analyzer | Compounds errors across iterations | **OPEN** |
| Evaluator matches wrong concepts | Evaluator | Inflated discovery rate hides true failure | **OPEN** |
| Keyword detectors not semantic | Gap Analyzer | Misses synonyms and paraphrases | **PARTIAL** — semantic centroids integrated, keyword detectors remain |
| QA loop asks duplicates | Uncertainty Ranker | 18.75% exact duplicates, 62% duplicate flows in prior runs | **PARTIAL** — metadata dedup interface exists, logic incomplete |
| No diminishing returns | Uncertainty Ranker | Same topics repeated across iterations | **OPEN** |

#### Fixed Problems

- ~~Evaluation: Semantic matching too permissive~~ — Fixed with one-to-one GT flow claiming
- ~~Evaluation: Duplicate flows inflate metrics~~ — Fixed with `isDuplicate` tracking and deduplication
- ~~Performance: High API costs~~ — Fixed with batch flow evaluation (~66% reduction)
- ~~Gap detection all regex-based~~ — Replaced with semantic centroid embeddings for core categories

### 5.5 Planned Improvements (Priority Order)

#### Immediate (address CC1-class failures)

1. **Domain-scoped blueprints and centroids** — Detect use case domain (`human_machine` vs `machine_machine`) from vague input at baseline generation; store label on use case. Tag each blueprint and centroid category with applicable domain(s). At gap analysis, activate only blueprints and centroids that match the use case's domain. Backward compat: missing domain → run all patterns. See [.github/ISSUE-domain-scoped-blueprints-centroids.md](.github/ISSUE-domain-scoped-blueprints-centroids.md).

2. **Add `concurrent_access` centroid** — covers "resource already in use", "client already has access", "serialized / exclusive access" scenarios. Question template: "What happens if another client already has access, or the resource is already in use? Are there different access modes?"

3. **Add `timer_lifecycle` centroid** — covers "starts a timer", "timer expires", "time limit", "holding period", "timeout triggers cleanup". Question template: "Is there a time limit for this step? What happens when it expires?"

4. **Tighten evaluator semantic matching** — add a domain-concept verification step or raise threshold for low-specificity flows, to prevent generic failure flows matching domain-specific policy flows.

#### Short-term (breadth improvements)

5. **Add `nested_operations` centroid** — covers reference counting, lock levels, re-entrant operations. Relevant to any system managing stacked or nested state.

6. **Add `queue_suspension` centroid** — covers waiting/suspended entities needing service after a resource is released. Relevant to queuing, scheduling, and access management domains.

7. **Complete metadata deduplication logic** — the `filterStaleGaps` function has the interface but the step/type tuple dedup is not fully enforced across iterations.

#### Medium-term

8. **Diminishing returns mechanism** — after a topic area is answered, reduce its priority score multiplicatively so the ranker explores new territory.

9. **Previously deferred centroids** — evaluate after items 1–4 are measured. Add only if the specific GT flow cluster remains at 0% discovery:
    - `user_decision` (cancel/override/force-proceed flows)
    - `data_modification` (change data after downstream processing)
    - Session keyword detector (`pause`, `save`, `resume`, `restart` in vague input — this is a bug fix and can be added independently)

**Explicitly excluded**:
- `business_scope` — 1 GT flow, domain-specific ("not our company")
- `exception_resolution` — structural pattern requiring new analysis phase, not a step-level centroid
- `system_timeout_fallback` — 1 GT flow, coverable by enriching `resource_assignment` template

---

## 6. MCP Tools Reference

### 6.1 Test Data Management

- **`prepareTestData`**: Validates test cases and creates structured dataset JSON (`test-data/dataset-*.json`).

### 6.2 Comparison Tools

- **`runCOVEComparison`**: Phase 1 testing. Compares COVE with Vague Input vs. COVE with Detailed Input.
- **`runHITLComparison`**: Phase 2 testing. Compares Constrained HITL vs. COVE (Detailed).
- **`evaluateResults`**: Runs the three-tier evaluation on results files.

### 6.3 HITL Workflow Tools

- **`generateQuestionsFromBaseline`**: Step 1. Validates baseline and generates questions (with optional score awareness).
- **`refineWithHumanAnswers`**: Step 2. Refines use case using provided answers (constrained to avoid hallucination).
- **Note**: Replaces the old monolithic `extractUseCaseWithConstrainedHITL`.

### 6.4 Data Formats

- **Dataset**: JSON containing `vague`, `detailed`, and `groundTruth` for each `testCaseId`.
- **Results**: JSON mapping test cases to generated Use Cases under different conditions (e.g., `conditionA_COVEVague`, `conditionD_HITL`).

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

- ❌ Add linting/formatting configs (ESLint, Prettier).
- ❌ Create unit test files (Jest, Mocha) - use MCP testing tools.
- ❌ Use `.ts` extensions in import paths.
- ❌ Throw errors in MCP tool handlers (return error objects).
- ❌ Share state between sessions.
- ❌ Use `require()` (ES module project).
- ❌ Commit `.env` file.
- ❌ Create documentation files unless specified.
- ❌ Create separate files for new functions if they fit in existing topic files.
- When I explicitly say use a specific testing tool (runHITLComparison), just run that tool. DO NOT edit the code unless I command it.
