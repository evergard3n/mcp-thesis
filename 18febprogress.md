---

## Goal

Improve the **Enhanced HITL (Human-in-the-Loop) framework** for use case elicitation in an MCP Thesis project. The framework generates use cases from vague descriptions and iteratively refines them by asking questions to a simulated expert. The core problem was an **extremely low discovery rate (10.5%) on the BOS test case** — the gap detection system only found system/data-level issues while missing business-process-level patterns. The user is building this for a thesis and wants to avoid LLM-dependent approaches in favor of algorithmic/semantic methods.

## Instructions

- **Always use context7 MCP tools** for code generation, setup, or library/API documentation**
- **Blueprint detection takes priority over gap centroids**: Blueprints run first; centroid gap analysis only runs as fallback on steps NOT covered by any blueprint
- **Single-activation for blueprints** (one match per blueprint per use case)
- **No domain-specific selection** — all blueprints are domain-agnostic business process patterns
- **Don't omit generated flows from analysis** — deprioritize centroid gaps on non-MAIN flows instead
- **Semantic embedding approach** (cosine similarity, centroids, thresholds) — no LLM classification calls for detection
- **Consolidation strategy**: Same-category centroid gaps across multiple steps should be grouped into a single consolidated question (e.g., "data_handling" groups `missing_data_quality_handling` + `missing_validation_handling`). Blueprint gaps are NEVER consolidated — they remain per-scenario.
- **Expert prompting**: Group questions must demand step-specific answers; the expert prompt enforces "no generic same-for-all" replies
- **Split-Merge Heuristic**: In consolidated `data_handling` questions, explicitly distinguish basic input errors vs business rule violations

## Discoveries

1. **Root cause of BOS failure**: The 7 existing gap centroids only cover system/data concerns. Zero of BOS's 18 GT extensions matched any centroid pattern. The GT extensions are about actor decisions, process modifications, partial fulfillment, multi-entity routing.

2. **Blueprint approach works**: After implementing blueprints, BOS discovery jumped from 10.5% to 52.6%, F1 from 0.129 to 0.619.

3. **Hallucination amplification loop**: Centroid analysis on GENERATED (non-MAIN) flow steps creates a snowball effect. A hallucinated flow generates new steps → centroids flag those steps → new hallucinated flows. In the latest BOS run, 5 of 6 hallucinations came from centroid questions on `ALT_8a` (a generated flow about "Receiver searching for missing information"). Fix implemented: three-tier ordering + severity cap. **BUT this is insufficient** — centroid-non-main questions still fill remaining slots.

4. **Flow extractor ignores "not applicable" signals**: When the expert says "doesn't apply" or gives low-confidence hypothetical reasoning, the flow extractor LLM still creates 3-4 flows from hypotheticals. In CC1, the expert denied the "missing info at step 3" scenario but phrased it as domain reasoning with hypotheticals → 4 hallucinated flows spawned. **Fix needed: confidence-gating in flow extraction.**

5. **Consolidation strategy reduced logical flow count**: The gap consolidation (grouping same-category centroid gaps into one question across multiple steps) successfully reduced logical flow noise. But hallucinations persisted because of causes #3 and #4.

6. **Evaluator false positive duplicates**: The original greedy single-best-match evaluator marked flows as "duplicate" when their best GT match was claimed, even if valid unclaimed GT flows existed. Fix implemented: structural-first matching with branch-point inference, best-available matching, and raised duplicate threshold to 0.75.

7. **Latest test results (post-consolidation)**:
   - **BOS** (`enhanced-hitl-2026-02-18T14-08-03-065Z`): 10 grounded, 10 logical, **6 hallucinations**, 1 duplicate. Discovery 57.9%, F1 0.66. All 6 hallucinations are from step 8 amplification loop.
   - **CC1** (`enhanced-hitl-2026-02-18T14-15-46-517Z`): 1 grounded, 9 logical, **5 hallucinations**, 0 duplicates. Discovery 75%, F1 0.71. 4 of 5 hallucinations from "missing info at step 3" that the expert denied.

## Accomplished

### Completed
- **Diagnosed BOS failure** — analyzed gap centroids, evaluated results, designed blueprint approach
- **Implemented `src/data/blueprints.json`** — 4 blueprints: `approval_chain`, `request_lifecycle`, `multi_party_selection`, `information_completeness`
- **Implemented `src/analyzers/blueprint.detector.ts`** — 5-phase detection with role matching, ordered assignment, scenario coverage, gap production
- **Integrated into `src/analyzers/gap.analyzer.ts`** — Phase 0 blueprint detection before centroid analysis
- **Implemented Fix 1**: Deprioritize centroid gaps on non-MAIN flows (severity cap to "low" in `uncertainty.ranker.ts`)
- **Implemented Fix 2**: Three-tier gap ordering in `generateAdaptiveQuestions` (blueprint → centroid-MAIN → centroid-non-MAIN)
- **Implemented Fix 3**: Step-aware deduplication in `isQuestionDuplicate`
- **Implemented evaluator fix**: Structural-first matching with branch-point inference, best-available matching, raised duplicate threshold (in `three-tier.evaluator.ts`)
- **Implemented gap consolidation strategy**:
  - Added `save_resume` gap centroid category with state-change detector heuristic
  - Added `CONSOLIDATION_GROUPS` (data_handling, infrastructure, save_resume) in `gap.analyzer.ts`
  - Added `buildConsolidatedGroups()` in `llm.validator.ts` to merge same-category centroid gaps into single multi-step questions
  - Updated `filterStaleGaps` to understand consolidated questions
  - Updated `extractFlowsFromOpenEndedAnswers` to handle consolidated question step distribution
  - Updated expert prompt to enforce step-specific answers
  - Updated `InteractionMemory.metadata` with `stepIndexes` and `consolidatedGroupId`
- **Code cleanup pass**: Extracted helper functions, converted types to interfaces, simplified logic

### NOT Yet Done — Three Proposed Fixes (User Approved, Not Yet Implemented)

1. **Confidence-gated flow extraction** — In `usecase.service.ts` `extractFlowsFromOpenEndedAnswers`, add logic to detect "not applicable" / low-confidence answers and cap flow extraction to 0-1 flows. Currently, the flow extractor creates 3-4 hypothetical flows from a single rejection answer. This is the #1 priority fix.

2. **Hard-block centroid-non-main questions** — In `llm.validator.ts` `generateAdaptiveQuestions`, remove the `centroid-non-main` group from `gapGroups` entirely (or cap to at most 1 per iteration). This stops the hallucination amplification loop where centroid analysis on generated flows spawns more hallucinated flows.

3. **Tighten `information_completeness` blueprint** — Either raise the role threshold for the data-entry role in `blueprints.json`, or add a negative filter in `blueprint.detector.ts` so short/simple steps like "Uses the resource" (CC1 step 3) don't trigger data completeness gaps.

### Additional Future Work
- **Run regression test on MO1** (`test-data/dataset-1010.json`) to confirm no degradation
- **Consider multi-activation** for `approval_chain` blueprint to catch BOS Step 4 (Authorizer validates)
- **Run comparison and evaluate after implementing the 3 fixes above**

## Relevant files / directories

### Created
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/data/blueprints.json` — 4 blueprint definitions
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/analyzers/blueprint.detector.ts` — Blueprint detection service (5-phase algorithm)

### Modified (all changes applied)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/data/gap-centroids.json` — Added `save_resume` category (8 categories total)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/analyzers/gap.analyzer.ts` — Phase 0 blueprint integration, `CONSOLIDATION_GROUPS`, `ConsolidationGroup` interface, save_resume heuristic detector, extended `InteractionMemory.metadata` with `stepIndexes`/`consolidatedGroupId`, consolidated staleness check in `filterStaleGaps`
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/analyzers/uncertainty.ranker.ts` — Deprioritize centroid gaps on non-MAIN flows, added `actor` field to `StepPriority`
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/validators/llm.validator.ts` — Three-tier gap ordering, `buildConsolidatedGroups()`, `isBlueprintGap()`, `formatStepLabel()`, step-aware dedup, expert prompt enforcing step-specific answers (instruction #5-6), `save_resume` answer guidance, `steps` field on `OpenEndedQuestion.context`
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/evaluators/three-tier.evaluator.ts` — Structural-first matching: `inferBranchStepIndex()`, `buildBranchInferenceContext()`, structural bonus in similarity matrix, best-available matching with fallback, raised duplicate threshold to 0.75
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/tools/testingTools.ts` — Updated conversation history to store consolidated question metadata (`consolidatedGroupId`, `stepIndexes`)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/services/usecase.service.ts` — `extractFlowsFromOpenEndedAnswers` updated with consolidated question step hints in prompt, step distribution instructions

### Key reference files (read, not modified — needed for context)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/interfaces/usecase.interface.new.ts` — `GenFlow`, `GenStep`, `GenUseCase` interfaces
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/services/semantic.service.ts` — Embedding service (MiniLM-L12-v2)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/src/schemas/genusecase.schema.ts` — Zod schema for use case
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/test-data/dataset-BOS.json` — BOS test case (19 GT flows)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/test-data/dataset-1010.json` — MO1 test case

### Evaluation results (read for analysis)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/test-data/results/evaluated/enhanced-hitl-2026-02-18T14-08-03-065Z.json` — Latest BOS evaluation (6 hallucinations, 10 logical, 10 grounded)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/test-data/results/evaluated/enhanced-hitl-2026-02-18T14-15-46-517Z.json` — CC1 evaluation (5 hallucinations, 9 logical, 1 grounded)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/test-data/results/raw/enhanced-hitl-2026-02-18T14-08-03-065Z.json` — BOS raw results (questions, answers, flows per iteration)
- `/Users/arya/Documents/code/mcp-thesis/mcp-thesis/test-data/results/raw/enhanced-hitl-2026-02-18T14-15-46-517Z.json` — CC1 raw results

---
