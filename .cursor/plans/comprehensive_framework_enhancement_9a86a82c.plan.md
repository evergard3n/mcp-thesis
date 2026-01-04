---
name: Comprehensive Framework Enhancement
overview: Expand gap detection patterns, add confidence scoring system, and implement iterative Q-A refinement loop to improve exception flow discovery from 25-50% to 80%+ discovery rate.
todos:
  - id: mine-patterns
    content: Analyze evaluation results to extract exception pattern keywords and indicators
    status: pending
  - id: implement-detectors
    content: Add 7 new gap detection functions to gap.analyzer.ts
    status: pending
    dependencies:
      - mine-patterns
  - id: create-confidence-evaluator
    content: Build confidence scoring system in confidence.evaluator.ts
    status: pending
    dependencies:
      - mine-patterns
  - id: update-gap-analyzer
    content: Integrate enhanced pattern detection into analyzeGaps function
    status: pending
    dependencies:
      - implement-detectors
  - id: implement-iterative-loop
    content: Modify runHITLComparison to support multi-iteration refinement
    status: pending
    dependencies:
      - create-confidence-evaluator
      - update-gap-analyzer
  - id: adaptive-questions
    content: Create generateAdaptiveQuestions with confidence prioritization
    status: pending
    dependencies:
      - create-confidence-evaluator
  - id: enhance-flow-extraction
    content: Update extractFlowsFromOpenEndedAnswers to handle multi-flow answers
    status: pending
    dependencies:
      - implement-iterative-loop
  - id: test-validation
    content: Test enhanced framework against HC1 and MO1 cases, verify 80%+ discovery
    status: pending
    dependencies:
      - enhance-flow-extraction
---

# Comprehensive Framework Enhancement Plan

## Problem Analysis

Current framework achieves:

- **HC1**: 25% discovery rate (2/8 flows found)
- **MO1**: 50% discovery rate (2/4 flows found)

**Target**: 80%+ discovery rate through iterative refinement---

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
- detectTemporalExceptions(useCase, originalDescription)
- detectNestedExceptions(useCase, validationFeedback) 
- detectResourceAvailability(useCase, originalDescription)
- detectPostCompletionScenarios(useCase)
- detectDataQualityIssues(useCase, originalDescription)
- detectEnvironmentalInterruptions(useCase, originalDescription)
- detectTechnologyVariations(useCase, originalDescription)
```

---

## Phase 2: Implement Confidence Scoring System

### 2.1 Define Confidence Metrics

Score each flow/step on dimensions:

- **Clarity**: How well-defined are the actions? (0-1)
- **Completeness**: Are all actors/data specified? (0-1)  
- **Exception Coverage**: Does this step have failure handling? (0-1)
- **Condition Specificity**: For alt/exception flows, is condition clear? (0-1)

**Aggregate Flow Confidence** = weighted average**Confusion Score** = 1 - Confidence

### 2.2 Flow Confidence Evaluator

**New file**: `mcp-thesis/src/evaluators/confidence.evaluator.ts`

```typescript
interface FlowConfidence {
  flowId: string;
  clarityScore: number;
  completenessScore: number;
  exceptionCoverageScore: number;
  conditionSpecificityScore: number;
  overallConfidence: number;
  confusionAreas: string[]; // specific issues
}

function evaluateFlowConfidence(flow: GenFlow, context): FlowConfidence
function rankFlowsByConfusion(useCase: GenUseCase): FlowConfidence[]
```



### 2.3 Integration Points

- After baseline generation, score all flows
- Rank by confusion (lowest confidence first)
- Use rankings to prioritize which areas need questions

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



### 3.3 Adaptive Question Generation

**File**: [`mcp-thesis/src/validators/llm.validator.ts`](mcp-thesis/src/validators/llm.validator.ts)New function: `generateAdaptiveQuestions`

- Takes confidence scores + gap analysis
- Prioritizes lowest-confidence flows
- Avoids asking about already-covered topics
- Dynamically adjusts question count based on remaining gaps
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

1. ✅ **Gap Pattern Dictionary** (Priority: START HERE)

- Mine patterns from evaluation results
- Implement 7 new detection functions in `gap.analyzer.ts`
- Test against existing results

2. **Confidence Scoring** (Priority: NEXT)

- Create `confidence.evaluator.ts`
- Integrate into testing flow
- Validate scoring makes sense

3. **Iterative Loop** (Priority: AFTER 1&2)

- Modify `runHITLComparison` 
- Implement stopping conditions
- Test with HC1/MO1 cases

4. **Enhanced Flow Extraction** (Priority: PARALLEL WITH 3)

- Update extraction prompt
- Add multi-flow parsing
- Test with complex answers

---

## Success Metrics

**Before** (Current):

- Discovery Rate: 25-50%
- Single iteration
- Fixed 3-5 questions

**After** (Target):

- Discovery Rate: 80%+
- 2-3 iterations average