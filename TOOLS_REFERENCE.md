# HITL Testing Tools - Quick Reference

## Tool Catalog

### 1. prepareTestData

**Purpose**: Validate test cases and create structured dataset JSON

**Input**:
```typescript
{
  testCases: Array<{
    testCaseId: string;
    domain: string;
    vagueSummary: string;
    detailedDescription: string;
    groundTruthJson: string; // JSON string of GenUseCase
    complexity?: "simple" | "medium" | "complex";
    notes?: string;
  }>
}
```

**Output**: Dataset file saved to `test-data/dataset-{timestamp}.json`

**Example**:
```json
{
  "testCases": [
    {
      "testCaseId": "TC001",
      "domain": "E-commerce",
      "vagueSummary": "User buys product online",
      "detailedDescription": "Customer browses catalog, adds items to cart, proceeds to checkout...",
      "groundTruthJson": "{\"name\": \"Purchase Product\", ...}",
      "complexity": "medium"
    }
  ]
}
```

---

### 2. runCOVEComparison

**Purpose**: Compare COVE with vague input vs detailed input (Phase 1 testing)

**Input**:
```typescript
{
  datasetPath: string;           // Path to dataset JSON file
  testCaseIds?: string[];        // Optional: specific test cases to run
}
```

**Output**: Results file saved to `test-data/results/phase1-cove-{timestamp}.json`

**Process**:
- Runs COVE (extract → validate → question → answer → improve) twice per test case
- Condition A: COVE + Vague input
- Condition B: COVE + Detailed input

---

### 3. extractUseCaseWithConstrainedHITL

**Purpose**: Single HITL extraction with multiple-choice constraints

**Input**:
```typescript
{
  vagueSummary: string;          // Vague description (what user provides)
  expertKnowledge: string;       // Detailed description (expert's knowledge)
  domain?: string;               // Default: "General"
}
```

**Output**:
```typescript
{
  finalUseCase: GenUseCase;
  questionsAsked: Array<{
    question: string;
    answer: string;
  }>;
}
```

**Workflow**:
1. Generator extracts from vague input
2. Validator generates MC questions
3. Expert answers questions
4. Constrained refinement applied

---

### 4. runHITLComparison

**Purpose**: Compare constrained HITL against COVE with detailed input (Phase 2 testing)

**Input**:
```typescript
{
  datasetPath: string;
  phase1ResultsPath?: string;    // Optional: reuse COVE-Detailed results
  testCaseIds?: string[];
}
```

**Output**: Results file saved to `test-data/results/phase2-hitl-{timestamp}.json`

**Process**:
- Retrieves or re-runs COVE + Detailed
- Runs full HITL workflow
- Compares results against ground truth

---

### 5. evaluateResults

**Purpose**: Run three-tier evaluation on test results

**Input**:
```typescript
{
  resultsPath: string;           // Path to Phase 1 or Phase 2 results
  datasetPath: string;           // Path to original dataset
}
```

**Output**: Evaluation file saved to `{resultsPath}-evaluated.json`

**Metrics Calculated**:
- **Quality Score**: (grounded × 1.0 + logical × 0.7) / totalFlows
- **Discovery Rate**: flows found in ground truth / total ground truth flows
- **Precision**: (grounded + logical) / totalFlows
- **F1 Score**: 2 × (precision × discovery) / (precision + discovery)

**Categories**:
- **Grounded (1.0)**: Explicitly mentioned in description
- **Logical (0.7)**: Reasonable for domain but not mentioned
- **Hallucination (0.0)**: Neither grounded nor logical

---

## Workflow Example

### Complete Test Run

```typescript
// Step 1: Prepare dataset
const dataset = await prepareTestData({
  testCases: [/* 10 test cases */]
});
// Output: test-data/dataset-2025-01-03-12-30-00.json

// Step 2: Phase 1 - COVE Comparison
const phase1Results = await runCOVEComparison({
  datasetPath: "test-data/dataset-2025-01-03-12-30-00.json"
});
// Output: test-data/results/phase1-cove-2025-01-03-12-35-00.json

// Step 3: Phase 2 - HITL Comparison
const phase2Results = await runHITLComparison({
  datasetPath: "test-data/dataset-2025-01-03-12-30-00.json",
  phase1ResultsPath: "test-data/results/phase1-cove-2025-01-03-12-35-00.json"
});
// Output: test-data/results/phase2-hitl-2025-01-03-13-00-00.json

// Step 4: Evaluate Phase 1
const phase1Eval = await evaluateResults({
  resultsPath: "test-data/results/phase1-cove-2025-01-03-12-35-00.json",
  datasetPath: "test-data/dataset-2025-01-03-12-30-00.json"
});
// Output: test-data/results/phase1-cove-2025-01-03-12-35-00-evaluated.json

// Step 5: Evaluate Phase 2
const phase2Eval = await evaluateResults({
  resultsPath: "test-data/results/phase2-hitl-2025-01-03-13-00-00.json",
  datasetPath: "test-data/dataset-2025-01-03-12-30-00.json"
});
// Output: test-data/results/phase2-hitl-2025-01-03-13-00-00-evaluated.json
```

---

## File Structure

```
test-data/
├── dataset-{timestamp}.json              # Test dataset
└── results/
    ├── phase1-cove-{timestamp}.json      # COVE comparison results
    ├── phase1-cove-{timestamp}-evaluated.json
    ├── phase2-hitl-{timestamp}.json      # HITL comparison results
    └── phase2-hitl-{timestamp}-evaluated.json
```

---

## Dataset Format

```json
{
  "version": "1.0",
  "createdAt": "2025-01-03T12:30:00.000Z",
  "testCases": [
    {
      "id": "TC001",
      "domain": "E-commerce",
      "metadata": {
        "complexity": "medium",
        "expectedFlows": 3,
        "notes": "Standard checkout flow"
      },
      "inputs": {
        "vague": "User buys product online",
        "detailed": "Customer browses catalog..."
      },
      "groundTruth": {
        "name": "Purchase Product",
        "flows": [...]
      }
    }
  ]
}
```

---

## Results Format

### Phase 1 (COVE Comparison)
```json
[
  {
    "testCaseId": "TC001",
    "conditionA_COVEVague": { /* GenUseCase */ },
    "conditionB_COVEDetailed": { /* GenUseCase */ },
    "groundTruth": { /* GenUseCase */ }
  }
]
```

### Phase 2 (HITL Comparison)
```json
[
  {
    "testCaseId": "TC001",
    "conditionC_COVEDetailed": { /* GenUseCase */ },
    "conditionD_HITL": { /* GenUseCase */ },
    "hitlQuestions": [
      {
        "question": "When validation fails, should the system...",
        "answer": "Retry up to 3 times before escalating"
      }
    ],
    "groundTruth": { /* GenUseCase */ }
  }
]
```

### Evaluation Format
```json
{
  "evaluations": [
    {
      "testCaseId": "TC001",
      "evaluations": {
        "conditionA_COVEVague": {
          "totalFlows": 3,
          "breakdown": { "grounded": 2, "logical": 1, "hallucinations": 0 },
          "scores": {
            "qualityScore": 0.9,
            "discoveryRate": 0.8,
            "precision": 1.0,
            "f1Score": 0.89
          }
        }
      }
    }
  ],
  "summary": {
    "conditionA_COVEVague": {
      "avgQuality": 0.85,
      "avgDiscovery": 0.75,
      "avgF1": 0.79
    },
    "conditionB_COVEDetailed": {
      "avgQuality": 0.92,
      "avgDiscovery": 0.88,
      "avgF1": 0.90
    }
  }
}
```

---

## Important Notes

1. **Cost Optimization**: Phase 2 can reuse COVE-Detailed results from Phase 1 by providing `phase1ResultsPath`

2. **Test Case Selection**: Both comparison tools support `testCaseIds` parameter to run subset of tests

3. **Ground Truth**: Must be valid GenUseCase JSON - validated during dataset preparation

4. **Timestamps**: All output files include timestamps to prevent overwrites

5. **Error Handling**: Invalid test cases are reported but don't stop processing

---

## Common Issues

### Issue: "Invalid use case format"
**Solution**: Ensure groundTruthJson is valid GenUseCase with all required fields

### Issue: "File not found"
**Solution**: Use absolute paths or paths relative to project root

### Issue: High API costs
**Solution**: Test with 1-2 cases first, then scale to full 10 cases

### Issue: Timeout errors
**Solution**: Process smaller batches or increase timeout settings

