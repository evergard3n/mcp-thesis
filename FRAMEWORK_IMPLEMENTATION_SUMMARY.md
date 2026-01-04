# Framework Implementation Summary

## Implementation Completed: Gap-Based HITL Framework

Successfully implemented the redesigned research framework that uses **gap analysis** and **hybrid questions** to systematically discover exception flows from vague requirements.

---

## What Was Implemented

### 1. Gap Analysis Module ✅
**File**: `mcp-thesis/src/analyzers/gap.analyzer.ts`

**Purpose**: Systematically identifies missing components in extracted use cases

**Key Features**:
- Detects missing exception flows
- Detects missing alternative flows
- Identifies validation steps without failure handling
- Identifies system interactions without failure handling
- Detects incomplete actor participation
- Flags uncertain or missing conditions

**Core Function**:
```typescript
analyzeGaps(
  useCase: GenUseCase,
  validationFeedback: UseCaseTermScore,
  originalDescription: string
): Promise<GapAnalysis>
```

**Gap Types Detected**:
- `missing_exception_flows` - No error handling flows
- `missing_alternative_flows` - No alternative paths
- `missing_validation_handling` - Validation without failure flow
- `missing_system_failure_handling` - System interaction without failure flow
- `uncertain_conditions` - Weak branching conditions
- `incomplete_actors` - Declared but unused actors

**Prioritization**: Gaps are ordered by severity (high → medium → low) and importance

---

### 2. Hybrid Question Generation ✅
**File**: `mcp-thesis/src/validators/llm.validator.ts`

**Purpose**: Generates both MC and open-ended questions targeting specific gaps

**New Interfaces**:
```typescript
interface OpenEndedQuestion {
  id: string;
  question: string;
  context: {
    step?: string;
    patternType?: string;
    whyAsking: string;
  };
  answerGuidance: string;
}

interface HybridQuestions {
  mcQuestions: MultipleChoiceQuestion[];
  openEndedQuestions: OpenEndedQuestion[];
  metadata: {
    totalGaps: number;
    highPriorityGaps: number;
    completenessScore: number;
  };
}
```

**Core Functions**:
- `generateHybridQuestions()` - Combines MC and open-ended questions
- `generateOpenEndedQuestionsFromGaps()` - Targets exception flow discovery
- `expertAnswerOpenEndedQuestions()` - Simulates expert answers for testing

**Question Strategy**:
- **MC Questions**: For clarifications (when completeness < 80%)
- **Open-Ended Questions**: For exception flow discovery
  - Target validation failures
  - Target system unavailability
  - Target alternative paths
  - Provide answer guidance for structured responses

---

### 3. Hybrid Refinement Service ✅
**File**: `mcp-thesis/src/services/usecase.service.ts`

**Purpose**: Processes both MC and open-ended answers to refine use cases

**New Functions**:

#### Extract Flows from Answers
```typescript
extractFlowsFromOpenEndedAnswers(
  answers: OpenEndedAnswer[],
  baseUseCase: GenUseCase,
  geminiFunctions: GeminiOpenRouterFunctions
): Promise<GenFlow[]>
```
- Parses free-text answers into structured flows
- Identifies flow kind (EXCEPTION vs ALTERNATIVE)
- Determines branching point (fromStepIndex)
- Extracts branching condition
- Generates flow steps with actors

#### Hybrid Refinement
```typescript
refineWithHybridAnswers(
  originalDescription: string,
  baseUseCase: GenUseCase,
  mcQuestions: MultipleChoiceQuestion[],
  mcAnswers: MultipleChoiceAnswer[],
  openEndedAnswers: OpenEndedAnswer[],
  geminiFunctions: GeminiOpenRouterFunctions
): Promise<GenUseCase>
```
- Applies MC answers for clarifications
- Extracts exception flows from open-ended answers
- Integrates new flows into use case
- Returns complete, refined use case

---

### 4. Framework Comparison Tool ✅
**File**: `mcp-thesis/src/tools/testingTools.ts`

**New Tool**: `runFrameworkComparison`

**Purpose**: Compare Framework vs Baseline vs Oracle

**Comparison Conditions**:

| Condition | Method | Expected Discovery |
|-----------|--------|-------------------|
| **A: Baseline** | Vague → LLM extraction → Done | ~25% (main flow only) |
| **B: Framework** | Vague → Draft → Gap Analysis → Hybrid Questions → Refinement | ~80%+ (with exception flows) |
| **C: Oracle** | Detailed → LLM extraction → Done | ~100% (upper bound) |

**Process Flow**:
```
1. Load pre-generated baseline (ensures consistency)
2. Condition A: Use baseline as-is (no framework)
3. Condition B: Apply framework to SAME baseline
   - Validate and analyze gaps
   - Generate hybrid questions
   - Simulate expert answers
   - Refine with hybrid answers
4. Condition C: Extract oracle (from detailed)
5. Save results with intermediate data
```

**Key Design**: Both Baseline and Framework start from the SAME pre-generated use case, ensuring fair comparison. This eliminates variability from LLM generation.

**Output**: JSON file with all three conditions plus optional intermediate results (gap analysis, questions, answers)

---

### 5. Updated HITL Comparison ✅
**File**: `mcp-thesis/src/tools/testingTools.ts`

**Updated Tool**: `runHITLComparison`

**Changes**:
- ✅ Replaced MC-only approach with hybrid questions
- ✅ Added gap analysis step
- ✅ Integrated open-ended questions for exception discovery
- ✅ Updated results structure to include both MC and open-ended Q&A
- ✅ Includes gap analysis metadata

**New Results Structure**:
```typescript
{
  testCaseId: string;
  conditionC_COVEDetailed: GenUseCase;
  conditionD_HITL: GenUseCase;
  hitlQuestions: {
    mc: { question, answer }[];
    openEnded: { question, answer, confidence }[];
  };
  gapAnalysis: {
    missingExceptionFlows: boolean;
    missingAlternativeFlows: boolean;
    totalGaps: number;
    highPriorityGaps: number;
    completenessScore: number;
  };
  groundTruth: GenUseCase;
}
```

---

## Research Design

### Research Question
**"Can gap analysis systematically identify missing components in vague requirements and generate targeted questions that elicit complete use cases?"**

### Key Hypothesis
Starting from vague input:
1. Baseline extraction identifies main flow (~25% discovery)
2. Gap analysis detects missing exception flows
3. Hybrid questions (MC + open-ended) target specific gaps
4. Framework approaches oracle-level completeness (~80-100% discovery)

### Success Metrics
| Metric | Baseline | Framework | Oracle | Success Criteria |
|--------|----------|-----------|--------|------------------|
| Quality Score | ~90% | ~90% | ~90% | ≥85% maintained |
| Discovery Rate | ~25% | ~80%+ | ~100% | Framework ≥ 80% |
| F1 Score | ~40% | ~80%+ | ~100% | Framework >> Baseline |
| Question Count | 0 | ≤5 | 0 | Minimal overhead |

---

## Testing Instructions

### 1. Restart MCP Server
The new tools won't be available until the MCP server is restarted:
```bash
# Stop the current server
# Restart it to load new tools
```

### 2. Generate Baseline (One-Time)
Extract baseline from vague input to ensure consistency:
```typescript
mcp_mcp-thesis_extractUseCase({
  input: "Register arrival of a box from transport company"
})
// Save output as test-data/baseline-MO1.json
```

### 3. Run Framework Comparison
```typescript
mcp_mcp-thesis_runFrameworkComparison({
  datasetPath: "test-data/dataset-2026-01-03T15-38-47-205Z.json",
  baselinePath: "test-data/baseline-MO1.json",  // Pre-generated baseline
  includeIntermediateResults: true
})
```

**Key Benefit**: Conditions A and B start from the SAME baseline, ensuring fair comparison.

**Expected Output**:
- Baseline (A): ~25% discovery (1 of 4 flows - main flow only)
- Framework (B): ~75-100% discovery (3-4 of 4 flows with exception flows)
- Oracle (C): ~100% discovery (all 4 flows)

### 4. Run Evaluation
```typescript
mcp_mcp-thesis_evaluateResults({
  resultsPath: "test-data/results/framework-comparison-[timestamp].json",
  datasetPath: "test-data/dataset-2026-01-03T15-38-47-205Z.json"
})
```

### 5. Run Updated HITL Comparison
```typescript
mcp_mcp-thesis_runHITLComparison({
  datasetPath: "test-data/dataset-2026-01-03T15-38-47-205Z.json"
})
```

---

## Key Improvements Over Previous Design

### Previous Issues:
❌ Detailed input proves nothing (any LLM can extract)
❌ MC questions miss exception flows (25% discovery)
❌ No systematic gap detection
❌ No mechanism for exception flow discovery

### New Solutions:
✅ Compare against baseline (proves framework value)
✅ Gap analysis systematically identifies missing components
✅ Hybrid questions target exception flows specifically
✅ Open-ended questions allow free-form flow descriptions
✅ Expected 80%+ discovery rate (3-4x improvement)

---

## Architecture Comparison

### Old HITL (MC Only):
```
Vague → Extract → MC Questions → Refine
Result: 25% discovery (misses exception flows)
```

### New Framework (Gap-Based):
```
Vague → Extract → Gap Analysis → Hybrid Questions → Refine
                     ↓
              Detects missing:
              - Exception flows
              - Alternative flows  
              - Validation handling
              - System failures
                     ↓
              Generates targeted questions:
              - MC for clarifications
              - Open-ended for exceptions
                     ↓
              Result: 80%+ discovery
```

---

## Files Modified

### New Files Created:
1. `src/analyzers/gap.analyzer.ts` - Gap detection logic

### Files Modified:
2. `src/validators/llm.validator.ts` - Added hybrid question generation
3. `src/services/usecase.service.ts` - Added hybrid refinement
4. `src/tools/testingTools.ts` - Added framework comparison, updated HITL

### Files Unchanged:
- `src/evaluators/three-tier.evaluator.ts` - Works with new flows
- `src/schemas/genusecase.schema.ts` - Core schema unchanged
- `src/validators/flat.validator.ts` - Validation unchanged

---

## Next Steps

1. **Test the Framework**: Run comparison on MO1 test case
2. **Analyze Results**: Check if framework achieves 80%+ discovery
3. **Iterate on Gap Detection**: Add more patterns if needed
4. **Expand Test Dataset**: Add more test cases with different complexities
5. **Write Research Paper**: Document findings and methodology

---

## Expected MO1 Results

### Baseline (Condition A):
- **Flows Discovered**: 1 (MAIN only)
- **Discovery Rate**: 25% (1/4)
- **Quality**: High (~90%)
- **Missing**: 3 exception flows (validation failure, fire alarm, system down)

### Framework (Condition B):
- **Gaps Detected**:
  - Missing exception flows (HIGH severity)
  - Step 2 validation without failure handling (HIGH)
  - Step 4 system interaction without failure handling (HIGH)
- **Questions Generated**:
  - Q1: "What happens if box ID validation fails?"
  - Q2: "What happens if the registration system goes down?"
  - Q3: "Are there any other exceptional scenarios?"
- **Flows Discovered**: 3-4 (MAIN + 2-3 exceptions)
- **Discovery Rate**: 75-100% (3-4/4)
- **Quality**: High (~85-90%)

### Oracle (Condition C):
- **Flows Discovered**: 4 (MAIN + 3 exceptions)
- **Discovery Rate**: 100% (4/4)
- **Quality**: Very High (~90-95%)

---

## Conclusion

The framework has been successfully implemented with:
- ✅ Systematic gap detection
- ✅ Hybrid question generation
- ✅ Exception flow extraction
- ✅ Framework comparison tool
- ✅ Updated HITL comparison
- ✅ Clean build (no errors)

**Ready for testing after MCP server restart!**

