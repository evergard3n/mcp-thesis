# Quick Start Guide: New Framework Testing

## Prerequisites

1. **Restart MCP Server** (required to load new tools)

   - Stop the current MCP server
   - Restart to pick up new `runFrameworkComparison` tool

2. **Ensure Project is Active**
   ```typescript
   // If needed, reinitialize project
   mcp_mcp -
     thesis_initProject({
       name: "Framework Testing",
       description: "Testing gap-based framework",
     });
   ```

## Step-by-Step Testing

### Step 1: Generate Baseline (One-Time Setup)

First, extract the baseline use case from the vague input. This ensures consistency across all test runs.

```typescript
mcp_mcp -
  thesis_extractUseCase({
    input: "Register arrival of a box from transport company",
  });
```

**Save the output** to `test-data/baseline-MO1.json`:

```json
{
  "useCase": {
    "name": "Register Arrival of a Box",
    "summary": "...",
    "flows": [...],
    ...
  }
}
```

### Step 2: Run Framework Comparison

This compares three conditions on the MO1 test case:

- **Baseline**: Pre-generated baseline (no framework applied)
- **Framework**: Same baseline → Gap Analysis → Hybrid Questions → Refinement
- **Oracle**: Detailed → LLM (upper bound)

```typescript
mcp_mcp -
  thesis_runFrameworkComparison({
    datasetPath: "test-data/dataset-2026-01-03T15-38-47-205Z.json",
    baselinePath: "test-data/baseline-MO1.json", // Pre-generated baseline
    includeIntermediateResults: true,
  });
```

**What to Expect**:

- Takes 3-5 minutes (fewer LLM calls, baseline pre-loaded)
- Outputs to `test-data/results/framework-comparison-[timestamp].json`
- Intermediate results show gap analysis and generated questions
- **Condition A and B start from the SAME baseline** (ensures fair comparison)

### Step 3: Evaluate Results

Run three-tier evaluation to get metrics:

```typescript
mcp_mcp -
  thesis_evaluateResults({
    resultsPath: "test-data/results/framework-comparison-[timestamp].json",
    datasetPath: "test-data/dataset-2026-01-03T15-38-47-205Z.json",
  });
```

**Key Metrics to Check**:

```json
{
  "conditionA_Baseline": {
    "avgQuality": ~0.90,      // Should be high
    "avgDiscovery": ~0.25,     // Expected: low (main flow only)
    "avgF1": ~0.40             // Low due to missing flows
  },
  "conditionB_Framework": {
    "avgQuality": ~0.85-0.90,  // Should maintain quality
    "avgDiscovery": ~0.75-1.0, // TARGET: High (with exception flows)
    "avgF1": ~0.80-1.0         // Should be significantly higher
  },
  "conditionC_Oracle": {
    "avgQuality": ~0.90-0.95,  // Highest quality
    "avgDiscovery": ~1.0,      // Complete (all flows)
    "avgF1": ~1.0              // Perfect
  }
}
```

**Success Criteria**:

- ✅ Framework discovery ≥ 0.75 (3x improvement over baseline)
- ✅ Framework F1 ≥ 0.80 (2x improvement over baseline)
- ✅ Framework approaches Oracle (within 20%)

### Step 4: Inspect Intermediate Results

Open the results JSON file and examine:

```json
{
  "testCaseId": "MO1",
  "intermediateData": {
    "gapAnalysis": {
      "missingExceptionFlows": true,    // Should detect this
      "totalGaps": 3-5,                  // Expected gap count
      "highPriorityGaps": 2-3,          // Validation + system failures
      "completenessScore": 0.3-0.5      // Low score triggers questions
    },
    "hybridQuestions": {
      "mcCount": 0-3,                    // Clarification questions
      "openEndedCount": 3-5,             // Exception discovery questions
      "questions": {
        "openEndedQuestions": [
          {
            "id": "gap_exception_step2",
            "question": "What happens if box ID validation fails?",
            "context": {
              "whyAsking": "Validation points need failure handling",
              "patternType": "validation_failure"
            }
          }
          // ... more questions
        ]
      }
    },
    "answers": {
      "openEndedAnswers": [
        {
          "questionId": "gap_exception_step2",
          "answer": "RA rejects box and notifies transport company...",
          "confidence": "high"
        }
        // ... more answers
      ]
    }
  }
}
```

## Understanding the Results

### What Framework Should Discover

For MO1, the framework should identify and generate questions for:

1. **Step 2 Validation Gap** (HIGH priority)

   - Detected: "RA validates box id" without exception flow
   - Question: "What happens if validation fails?"
   - Expected Answer: Rejection and notification flow

2. **Step 4 System Interaction Gap** (HIGH priority)

   - Detected: "RA registers into system" without failure handling
   - Question: "What if system is down?"
   - Expected Answer: Wait for system recovery flow

3. **General Exception Flows** (HIGH priority)
   - Detected: No exception flows at all
   - Question: "What exceptional scenarios should be handled?"
   - Expected Answer: Fire alarm interruption flow

### Comparing to Previous HITL

**Old HITL (MC only)**:

```json
{
  "conditionD_HITL": {
    "discovery": 0.25, // Only main flow
    "quality": 1.0 // Perfect quality but incomplete
  }
}
```

**New HITL (Hybrid)**:

```json
{
  "conditionD_HITL": {
    "discovery": 0.75-1.0,  // Should include exception flows
    "quality": 0.85-0.90     // Maintains quality
  }
}
```

## Troubleshooting

### Issue: Tool Not Found

**Symptom**: `runFrameworkComparison` not in available tools
**Solution**: Restart MCP server to load new tools

### Issue: Low Discovery Rate (< 60%)

**Symptom**: Framework not discovering exception flows
**Check**:

1. Gap analysis detected the gaps (check `intermediateData.gapAnalysis`)
2. Questions were generated (check `hybridQuestions.openEndedCount > 0`)
3. Answers describe flows (check `answers.openEndedAnswers`)
4. Flows were extracted (check `conditionB_Framework.flows` count)

**Debug**:

```typescript
// Check what questions were generated
const results = JSON.parse(readFile("test-data/results/..."));
console.log(results[0].intermediateData.hybridQuestions.openEndedQuestions);

// Check what gaps were detected
console.log(results[0].intermediateData.gapAnalysis);
```

### Issue: Low Quality Score (< 80%)

**Symptom**: Framework quality below baseline
**Check**:

1. Structural integrity (no duplicate IDs, valid indices)
2. Flow conditions are present
3. Steps are well-formed

**Fix**: Review extracted flows in framework output

## Advanced Usage

### Testing on Custom Test Cases

1. **Create Ground Truth**:

```json
{
  "testCaseId": "CUSTOM1",
  "domain": "Your Domain",
  "vagueSummary": "Brief description",
  "detailedDescription": "Complete description with exceptions",
  "groundTruthJson": "{...structured use case...}",
  "complexity": "medium"
}
```

2. **Add to Dataset**:

```typescript
mcp_mcp -
  thesis_prepareTestData({
    testCases: [
      // your custom test case
    ],
  });
```

3. **Run Comparison**:

```typescript
mcp_mcp -
  thesis_runFrameworkComparison({
    datasetPath: "test-data/dataset-[your-timestamp].json",
    testCaseIds: ["CUSTOM1"],
  });
```

## Expected Timeline

- Framework Comparison: ~5-10 minutes per test case
- Evaluation: ~2-3 minutes per test case
- Total for MO1: ~12-15 minutes

## Success Indicators

✅ **Gap Detection Works**:

- `missingExceptionFlows: true` for vague input
- `highPriorityGaps >= 2` for MO1
- `completenessScore < 0.5` triggers questions

✅ **Questions Target Gaps**:

- `openEndedCount >= 3` for MO1
- Questions mention "validation", "system failure", "exceptional"
- Questions reference specific steps

✅ **Flows Are Extracted**:

- Framework output has `flows.length >= 3` (main + 2-3 exceptions)
- Flows have proper `kind: "EXCEPTION"`
- Flows have branching conditions

✅ **Discovery Improves**:

- Framework discovery >= 0.75 (vs baseline ~0.25)
- Framework F1 >= 0.80 (vs baseline ~0.40)
- Framework approaches Oracle (within 20%)

## Next Steps After Testing

1. **Document Results** - Save evaluation output
2. **Analyze Questions** - Review what questions were generated
3. **Refine Gap Detection** - Add more patterns if needed
4. **Expand Dataset** - Test on more cases
5. **Write Paper** - Document methodology and findings

## Support

If you encounter issues:

1. Check `FRAMEWORK_IMPLEMENTATION_SUMMARY.md` for architecture details
2. Review `HITL_REDESIGN_SUMMARY.md` for background
3. Examine intermediate results in output JSON
4. Check console logs during execution
