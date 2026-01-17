---
name: Comprehensive Framework Enhancement
overview: Expand gap detection patterns, implement three-layer uncertainty & priority ranking system (Validator → Gap Analyzer → Uncertainty×Criticality), and add iterative Q-A refinement loop to improve exception flow discovery from 25-50% to 80%+ discovery rate.
todos:
  - id: organize-results-folders
    content: Create test-data/results/raw and test-data/results/evaluated folders, update paths
    status: completed
  - id: mine-patterns
    content: Analyze evaluation results to extract exception pattern keywords and indicators
    status: completed
    dependencies:
      - organize-results-folders
  - id: implement-detectors
    content: Add 7 new gap detection functions to gap.analyzer.ts
    status: completed
    dependencies:
      - mine-patterns
  - id: update-gap-analyzer
    content: Integrate enhanced pattern detection into analyzeGaps function
    status: completed
    dependencies:
      - implement-detectors
  - id: create-uncertainty-ranker
    content: Build uncertainty.ranker.ts with step/flow uncertainty analysis for ALL flow types
    status: completed
    dependencies:
      - update-gap-analyzer
  - id: add-criticality-analyzer
    content: Add step criticality computation (structural + domain + impact)
    status: completed
    dependencies:
      - create-uncertainty-ranker
  - id: implement-priority-ranking
    content: Combine uncertainty × criticality into priority scores
    status: completed
    dependencies:
      - add-criticality-analyzer
  - id: implement-iterative-loop
    content: Modify runHITLComparison to support multi-iteration refinement
    status: completed
    dependencies:
      - implement-priority-ranking
  - id: adaptive-questions
    content: Create generateAdaptiveQuestions with priority-based ranking
    status: completed
    dependencies:
      - implement-priority-ranking
  - id: enhance-flow-extraction
    content: Update extractFlowsFromOpenEndedAnswers to handle multi-flow and nested exceptions
    status: completed
    dependencies:
      - implement-iterative-loop
  - id: test-validation
    content: Test enhanced framework against HC1 and MO1 cases, verify 80%+ discovery
    status: completed
    dependencies:
      - enhance-flow-extraction
---

# Comprehensive Framework Enhancement Plan

## Problem Analysis

Current framework achieves:

- **HC1**: 25% discovery rate (2/8 flows found)
- **MO1**: 50% discovery rate (2/4 flows found)

**Target**: 80%+ discovery rate through iterative refinement---

## System Architecture

### Three-Layer Analysis Pipeline

```javascript
┌─────────────────────────────────────────────────────────────────┐
│                     BASELINE USE CASE                           │
│                  (Generated from vague input)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
      ┌─────────▼────────┐      ┌────────▼────────┐
      │  LAYER 1:        │      │  LAYER 2:       │
      │  Validator       │      │  Gap Analyzer   │
      │  (existing)      │      │  (enhanced)     │
      │                  │      │                 │
      │ • overall score  │      │ • 7 new patterns│
      │ • branch coverage│      │ • gap list      │
      │ • process pattern│      │ • severity      │
      └─────────┬────────┘      └────────┬────────┘
                │                        │
                └────────────┬───────────┘
                             │
                   ┌─────────▼──────────┐
                   │  LAYER 3:          │
                   │  Uncertainty       │
                   │  Ranker            │
                   │                    │
                   │ Step Uncertainty:  │
                   │ • clarity          │
                   │ • completeness     │
                   │ • exception cov.   │
                   │                    │
                   │ Step Criticality:  │
                   │ • structural       │
                   │ • domain           │
                   │ • impact radius    │
                   └─────────┬──────────┘
                             │
                   ┌─────────▼──────────┐
                   │  PRIORITY =        │
                   │  Uncertainty ×     │
                   │  Criticality       │
                   └─────────┬──────────┘
                             │
                ┌────────────▼─────────────┐
                │  Question Generator      │
                │  (top 4-6 priorities)    │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  Expert Answers          │
                └────────────┬─────────────┘
                             │
                ┌────────────▼─────────────┐
                │  Refine Use Case         │
                │  (integrate new flows)   │
                └────────────┬─────────────┘
                             │
                      ┌──────▼──────┐
                      │ Iterate?    │
                      │ (avg priority│
                      │  < 0.3?)    │
                      └──┬────────┬─┘
                    YES  │        │ NO
                  ┌──────┘        └────────┐
                  │                        │
           ┌──────▼──────┐         ┌──────▼──────┐
           │ Next         │         │ COMPLETE    │
           │ Iteration    │         │ (80%+ flows)│
           └──────────────┘         └─────────────┘
```

### Key Innovation: Priority = Uncertainty × Criticality

**Why this works**:

- **High uncertainty + High criticality** = CRITICAL priority - Example: Step 1 "Reports claim" (unclear input validation + entry point)
- **High uncertainty + Low criticality** = MEDIUM priority - Example: Step 7 "Displays result" (unclear but just feedback)
- **Low uncertainty + High criticality** = LOW priority - Already clear, even if important (no question needed)

---

## Phase 0: Organize Results Structure

### 0.1 Create Folder Structure

**Current structure**:

```javascript
test-data/
  results/
    framework-comparison-2026-01-04T08-07-33-776Z.json (raw)
    framework-comparison-2026-01-04T08-07-33-776Z-evaluated.json (evaluated)
    framework-comparison-2026-01-04T03-32-40-139Z.json (raw)
    framework-comparison-2026-01-04T03-32-40-139Z-evaluated.json (evaluated)
```

**New structure**:

```javascript
test-data/
  results/
    raw/
      framework-comparison-2026-01-04T08-07-33-776Z.json
      framework-comparison-2026-01-04T03-32-40-139Z.json
    evaluated/
      framework-comparison-2026-01-04T08-07-33-776Z.json
      framework-comparison-2026-01-04T03-32-40-139Z.json
```

**Benefits**:

- Easier to find unevaluated vs evaluated results
- Cleaner file naming (no `-evaluated` suffix)
- Clear separation of concerns

### 0.2 Update Testing Tools

**File**: [`mcp-thesis/src/tools/testingTools.ts`](mcp-thesis/src/tools/testingTools.ts)Update output paths in:

- `runFrameworkComparison`: Save raw results to `results/raw/`
- `runCOVEComparison`: Save raw results to `results/raw/`
- `runHITLComparison`: Save raw results to `results/raw/`
- `evaluateResults`: Save evaluated results to `results/evaluated/`

```typescript
// Before:
const resultsPath = `test-data/results/framework-comparison-${timestamp}.json`;
const evaluatedPath = `${resultsPath.replace(".json", "-evaluated.json")}`;

// After:
const resultsPath = `test-data/results/raw/framework-comparison-${timestamp}.json`;
const evaluatedPath = `test-data/results/evaluated/framework-comparison-${timestamp}.json`;
```

### 0.3 Migration

Move existing results:

```bash
mkdir -p test-data/results/raw
mkdir -p test-data/results/evaluated

# Move raw results
mv test-data/results/framework-comparison-*.json test-data/results/raw/
mv test-data/results/cove-comparison-*.json test-data/results/raw/
mv test-data/results/hitl-comparison-*.json test-data/results/raw/

# Move evaluated results (rename to remove -evaluated suffix)
for f in test-data/results/*-evaluated.json; do
  mv "$f" "test-data/results/evaluated/$(basename $f | sed 's/-evaluated//')"
done
```

---

## Phase 1: Expand Gap Pattern Detection Dictionary

### 1.1 Mine Exception Patterns from Results

Analyze missed flows to identify indicator words and patterns:**Temporal/Async Exceptions** (currently missed):

- Keywords: "at any time", "anytime", "during", "while", "throughout"
- Pattern: `EXT_ANY_SYSTEM_DOWN` - not tied to specific step
- Detection: No `fromStepIndex`, global condition

**Nested Exceptions** (currently missed):

- Pattern: `EXT_1a2a_NO_RESPONSE` - exception from another exception
- Detection: `parentFlow` references another exception flow
- Keywords in detailed descriptions: nested conditions, timeout after previous step

**Resource Availability** (currently missed):

- Keywords: "no agents", "unavailable", "not available", "insufficient", "capacity"
- Pattern: `EXT_3a_NO_AGENTS` - workflow blocked by resource constraints
- Related to: assignment, allocation, scheduling steps

**Post-Completion Scenarios** (currently missed):

- Keywords: "reopen", "reverse", "undo", "after close", "after completion"
- Pattern: `EXT_8a_REOPEN_CLAIM` - actions after final step
- Detection: `fromStepIndex` points to closing/final step

**Data Quality at Input** (currently missed):

- Keywords: "incomplete", "missing information", "invalid data", "malformed"
- Pattern: `EXT_1a_INCOMPLETE_DATA` - validation failures at step 1-2
- Detection: First few steps with data submission/collection

**Environmental/External Interruptions** (currently missed):

- Keywords: "fire alarm", "emergency", "evacuation", "power outage", "natural disaster"
- Pattern: `EXT_4a` - external events interrupting process
- Detection: Can occur at any step, environmental triggers

**Technology Variations** (currently missed):

- Keywords: "by check", "electronic", "paper", "digital", "manual"
- Pattern: `ALT_8_PAYMENT_CHECK` - different implementation methods
- Detection: Steps mentioning technology or method options

### 1.2 Update Gap Analyzer

**File**: [`mcp-thesis/src/analyzers/gap.analyzer.ts`](mcp-thesis/src/analyzers/gap.analyzer.ts)Add new detection functions:

```typescript
-detectTemporalExceptions(useCase, originalDescription) -
  detectNestedExceptions(useCase, validationFeedback) -
  detectResourceAvailability(useCase, originalDescription) -
  detectPostCompletionScenarios(useCase) -
  detectDataQualityIssues(useCase, originalDescription) -
  detectEnvironmentalInterruptions(useCase, originalDescription) -
  detectTechnologyVariations(useCase, originalDescription);
```

---

## Phase 2: Implement Three-Layer Uncertainty & Priority Ranking

### Architecture Overview

```javascript
Layer 1: Existing Validator (scoreUseCaseTerms)
         ↓ provides aggregate metrics
Layer 2: Enhanced Gap Analyzer (analyzeGapsEnhanced)
         ↓ detects missing patterns
Layer 3: Uncertainty Ranker + Criticality Analyzer
         ↓ ranks steps/flows by priority
Question Generator (uses priority rankings)
```

### 2.1 Leverage Existing Validator

**File**: [`mcp-thesis/src/validators/flat.validator.ts`](mcp-thesis/src/validators/flat.validator.ts) (NO CHANGES)**Already provides**:

- `overall`: 0-100 aggregate score
- `actorParticipation`: 0-1
- `summaryCoverage`: 0-1
- `processPatternCoverage`: 0-1
- `branchAnchoringCoverage`: 0-1 (% of MAIN steps with branches)
- `branchConditionCoverage`: 0-1 (% of alt/exc flows with conditions)
- `hasExceptionFlow`: boolean
- `hasAlternativeFlow`: boolean

**Use these as inputs** to uncertainty ranker (no new file needed).

### 2.2 Uncertainty Ranker

**New file**: `mcp-thesis/src/evaluators/uncertainty.ranker.ts`Analyzes **ALL flows** (MAIN, ALTERNATIVE, EXCEPTION) at two levels:

#### Step-Level Uncertainty

```typescript
interface StepUncertainty {
  stepIndex: number;
  flowId: string;
  flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
  description: string;

  // Dimensions (0-1, lower = more uncertain)
  clarityScore: number; // "validates" = 0.4, "scans barcode" = 0.9
  completeness: number; // actor/target/description present
  exceptionCoverage: number; // does THIS step have exceptions?

  // From gap analyzer
  relatedGaps: Gap[];
  gapSeverity: "high" | "medium" | "low";

  // Aggregate
  uncertaintyScore: number; // weighted combination
  uncertaintyReasons: string[];
}

function analyzeStepUncertainty(
  step: GenStep,
  parentFlow: GenFlow,
  allFlows: GenFlow[],
  gapAnalysis: GapAnalysis
): StepUncertainty;
```

**Key feature**: Exception flow steps can have nested exceptions!

#### Flow-Level Uncertainty

```typescript
interface FlowUncertainty {
  flowId: string;
  flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";

  // ALL flow types
  stepsClarityAvg: number;
  stepsCompletenessAvg: number;

  // ALT/EXCEPTION specific
  conditionSpecificity: number; // "error" = 0.3, "box ID mismatch" = 0.9
  hasCondition: boolean;
  hasResolution: boolean;

  // EXCEPTION specific
  hasNestedExceptions: boolean;
  nestedExceptionCoverage: number;

  // Aggregate
  uncertaintyScore: number;
  uncertaintyReasons: string[];
}

function analyzeFlowUncertainty(
  flow: GenFlow,
  useCase: GenUseCase,
  gapAnalysis: GapAnalysis
): FlowUncertainty;
```

### 2.3 Criticality Analyzer

**Same file**: `mcp-thesis/src/evaluators/uncertainty.ranker.ts`Computes step importance based on:

```typescript
interface StepCriticality {
  structuralImportance: number; // position: entry=1.0, exit=0.8, middle=0.5
  domainImportance: number; // type: input=1.0, validation=0.9, logic=0.6
  impactRadius: number; // # of downstream flows that depend on it
}

function computeStepCriticality(
  step: GenStep,
  stepIndex: number,
  flow: GenFlow,
  allFlows: GenFlow[]
): number; // 0-1
```

**Domain Importance Rules**:

- Input/Data collection: 1.0 (keywords: report, submit, enter, provide)
- Validation/Authentication: 0.9 (keywords: validate, verify, check, find policy)
- Assignment/Allocation: 0.85 (keywords: assign, allocate, schedule)
- System interactions: 0.7 (target matches: system, database, service, API)
- Business logic: 0.6 (keywords: calculate, evaluate, investigate, process)
- Feedback/Display: 0.4 (keywords: display, show, notify, inform)

### 2.4 Priority Calculation

**Priority = Uncertainty × Criticality**

```typescript
interface StepPriority {
  stepIndex: number;
  flowId: string;
  description: string;

  uncertaintyScore: number; // 0-1 (how unclear?)
  criticalityScore: number; // 0-1 (how important?)
  priorityScore: number; // uncertainty × criticality
  priorityRank: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

function rankStepPriorities(
  stepUncertainties: StepUncertainty[],
  useCase: GenUseCase
): StepPriority[];
```

**Why this works**:

- High uncertainty + High criticality = CRITICAL priority (e.g., Step 1 input validation)
- High uncertainty + Low criticality = MEDIUM priority (e.g., Step 7 display feedback)
- Low uncertainty + High criticality = LOW priority (already clear, even if important)

### 2.5 Integration Points

```typescript
// After baseline generation:
const validation = await validateUseCaseWithFeedback(useCase); // Layer 1
const gapAnalysis = await analyzeGapsEnhanced(useCase, validation.score); // Layer 2

// Layer 3: Uncertainty + Criticality
const { stepUncertainties, flowUncertainties } = rankAllUncertainties(
  useCase,
  validation.score,
  gapAnalysis
);

const stepPriorities = rankStepPriorities(stepUncertainties, useCase);

// Use priorities for question generation
const questions = generateAdaptiveQuestions(stepPriorities, flowUncertainties);
```

---

## Phase 3: Iterative Q-A Refinement Loop

### 3.1 Loop Architecture

```javascript
Iteration 1:
    1. Generate baseline use case
    2. Score confidence for all flows/steps
    3. Perform gap analysis with enhanced patterns
    4. Generate questions (target: low-confidence + gaps)
    5. Collect answers
    6. Refine use case (integrate new flows)

Iteration 2+:
    1. Re-score confidence on refined use case
    2. Re-run gap analysis
    3. Generate NEW questions (avoid repeats)
    4. Collect answers
    5. Refine use case

Stop when:
    - Average confidence > 0.85 AND no high-priority gaps
    - OR total questions asked >= MAX_QUESTIONS (e.g., 20)
```

### 3.2 Update Testing Framework

**File**: [`mcp-thesis/src/tools/testingTools.ts`](mcp-thesis/src/tools/testingTools.ts)Modify `runHITLComparison` to implement loop:

```typescript
// Current (single iteration):
draft → gaps → questions → answers → refined

// New (iterative):
let iteration = 0;
let currentUseCase = draft;
let allQuestions = [];
let totalQuestionsAsked = 0;

while (totalQuestionsAsked < MAX_QUESTIONS) {
  iteration++;

  // Score confidence
  const confidence = evaluateUseCaseConfidence(currentUseCase);

  // Gap analysis with enhanced patterns
  const gaps = await analyzeGapsEnhanced(currentUseCase, validation, originalDesc);

  // Stopping condition
  if (confidence.overall > 0.85 && gaps.highPriorityGaps.length === 0) {
    break; // No confusions left
  }

  // Generate questions (prioritize low-confidence areas + gaps)
  const questions = await generateAdaptiveQuestions(
    gaps, confidence, currentUseCase, allQuestions
  );

  if (questions.length === 0) break; // No more questions

  // Collect answers
  const answers = await collectAnswers(questions, detailedDesc);

  // Refine
  currentUseCase = await refineIteratively(currentUseCase, questions, answers);

  totalQuestionsAsked += questions.length;
  allQuestions.push(...questions);
}
```

### 3.3 Priority-Based Question Generation

**File**: [`mcp-thesis/src/validators/llm.validator.ts`](mcp-thesis/src/validators/llm.validator.ts)New function: `generateAdaptiveQuestions`

```typescript
function generateAdaptiveQuestions(
  stepPriorities: StepPriority[],
  flowUncertainties: FlowUncertainty[],
  previousQuestions: string[]
): Question[] {
  const questions = [];

  // Top 5 highest priority steps
  for (const priority of stepPriorities.slice(0, 5)) {
    // Skip if already asked about this area
    if (alreadyCovered(priority, previousQuestions)) continue;

    // Generate question based on uncertainty type
    if (priority.clarityScore < 0.6) {
      questions.push({
        type: "clarification",
        priority: priority.priorityScore,
        question: `How specifically is "${priority.description}" performed?`,
      });
    }

    if (priority.exceptionCoverage < 0.3 && priority.relatedGaps.length > 0) {
      questions.push({
        type: "exception_discovery",
        priority: priority.priorityScore,
        question: `What happens if step ${priority.stepIndex} fails or encounters an error?`,
      });
    }

    if (questions.length >= 6) break;
  }

  // Top 3 uncertain flows
  for (const flowUnc of flowUncertainties.slice(0, 3)) {
    if (flowUnc.conditionSpecificity < 0.5) {
      questions.push({
        type: "condition_clarification",
        priority: flowUnc.uncertaintyScore * 0.7, // slightly lower priority than steps
        question: `When exactly does ${flowUnc.flowId} occur? Be specific.`,
      });
    }
  }

  // Sort by priority, take top 4-6
  return questions.sort((a, b) => b.priority - a.priority).slice(0, 6);
}
```

**Key features**:

- Prioritizes by `priorityScore` (uncertainty × criticality)
- Avoids repeat questions across iterations
- Adaptive count based on remaining priorities
- Target: 4-6 questions per iteration

---

## Phase 4: Enhanced Flow Extraction

### 4.1 Multi-Flow Answer Parser

**File**: [`mcp-thesis/src/services/usecase.service.ts`](mcp-thesis/src/services/usecase.service.ts)Update `extractFlowsFromOpenEndedAnswers`:

```typescript
// Current: expects 1 flow per answer
// New: detect when answer describes multiple flows

For each answer:
    1. Use LLM to split into distinct scenarios if multiple
    2. Extract each scenario as separate flow
    3. Handle nested exceptions (parent references)
    4. Detect conditional chaining
```

Improve prompt with:

- Examples of nested exceptions
- Examples of temporal exceptions
- Guidance on detecting multiple flows in one answer

---

## Implementation Order

1.  ✅ **Organize Results Structure** (Priority: START HERE - Quick Win)

                                                - Create `test-data/results/raw/` and `test-data/results/evaluated/` folders
                                                - Update paths in `testingTools.ts`
                                                - Move existing results to new folders
                                                - Test that evaluation pipeline still works

2.  **Gap Pattern Dictionary** (Priority: NEXT)

                                                - Mine patterns from evaluation results
                                                - Implement 7 new detection functions in `gap.analyzer.ts`
                                                - Test pattern detection against existing results

3.  **Uncertainty Ranker** (Priority: AFTER 2)

                                                - Create `uncertainty.ranker.ts`
                                                - Implement step-level uncertainty analysis (ALL flow types)
                                                - Implement flow-level uncertainty analysis
                                                - Test uncertainty scoring makes sense

4.  **Criticality Analyzer** (Priority: AFTER 3)

                                                - Add step criticality computation (structural + domain + impact)
                                                - Implement priority calculation (uncertainty × criticality)
                                                - Validate priorities match ground truth importance

5.  **Iterative Loop** (Priority: AFTER 4)

                                                - Modify `runHITLComparison` for multi-iteration
                                                - Implement stopping conditions (avg priority < threshold OR max questions)
                                                - Integrate priority-based question generation
                                                - Test with HC1/MO1 cases

6.  **Enhanced Flow Extraction** (Priority: PARALLEL WITH 5)

                                                - Update extraction prompt with nested exception examples
                                                - Add multi-flow parsing from single answer
                                                - Test with complex answers

---

## Success Metrics

**Before** (Current):

- Discovery Rate: 25-50%
- Single iteration
- Fixed 3-5 questions
- Questions based on gaps only
- No prioritization (all gaps equal)

**After** (Target):

- Discovery Rate: 80%+
- 2-3 iterations average
- Adaptive questions (8-20 total across iterations)
- Priority-driven (uncertainty × criticality)
- Stops when: avg priority < 0.3 OR max questions reached

**Example Improvement (HC1)**:Before:

```javascript
Questions asked: 4
Flows discovered: 2/8 (25%)
Priority ordering: Random (gap severity only)
```

After:

```javascript
Iteration 1: 5 questions (Step 1,2,3 - high priority)
  → Discovered: EXT_1a, EXT_2a, EXT_3a
Iteration 2: 4 questions (Step 7,8,9 - medium priority)
  → Discovered: EXT_7a, ALT_8a, EXT_9a
Total: 9 questions, 6/8 flows (75%)
Iteration 3: 3 questions (remaining uncertainties)
  → Discovered: EXT_8a_REOPEN, ALT_8b
Total: 12 questions, 8/8 flows (100%)

```
