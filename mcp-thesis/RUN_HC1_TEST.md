# Running HC1 Test with Enhanced HITL Framework

## Overview

The `runHITLComparison` tool now compares:
- **Baseline** (single LLM extraction from vague input)
- **Enhanced HITL** (iterative refinement with priority ranking)

**Cost-Efficient**: Uses rule-based validation (no API cost) instead of running COVE.

## Quick Start

### Invoke the MCP Tool

```json
{
  "datasetPath": "test-data/dataset-2026-01-04T08-04-45-215Z.json",
  "testCaseIds": ["HC1"]
}
```

### What Happens

#### Step 1: Generate Baseline
- LLM extracts use case from vague input
- This becomes **Condition A: Baseline**
- Typically discovers 1-2 flows (12-25%)

#### Step 2: Enhanced Iterative Refinement
Starting from the same baseline, the framework iterates:

**Each Iteration:**
1. **Rule-based validation** (no API cost)
   - Calculates overall score, branch coverage, etc.
   
2. **Gap analysis** (no API cost)
   - 7 new pattern detectors identify missing flows
   
3. **Uncertainty × Criticality ranking** (no API cost)
   - Scores each step's uncertainty (0-1)
   - Scores each step's criticality (0-1)
   - Priority = Uncertainty × Criticality
   
4. **Generate 4-6 adaptive questions** (API cost $$)
   - Targets highest priority steps first
   - Avoids repeating previous questions
   
5. **Expert answers** (API cost $$)
   - Simulated using detailed description
   
6. **Refine use case** (API cost $$)
   - Integrates new flows from answers
   
7. **Check stopping condition**
   - Confidence > 0.85 AND no high-priority items → STOP
   - OR total questions ≥ 20 → STOP
   - OR iteration ≥ 5 → STOP

**Final Output**: **Condition B: Enhanced HITL**

### Cost Breakdown

**Per Iteration:**
- Rule-based validation: FREE
- Gap analysis: FREE
- Uncertainty/priority ranking: FREE
- Generate 4-6 questions: ~$0.01-0.02
- Get answers: ~$0.02-0.05
- Refine use case: ~$0.05-0.10

**Estimated Total for HC1:**
- 2-3 iterations × ~$0.10/iteration = **~$0.20-0.30**
- Much cheaper than running full COVE comparison (~$1-2)

## Expected Results

### Baseline (Condition A)
```json
{
  "flows": 2,
  "discoveryRate": 0.25,
  "flows_found": ["MAIN", "EXT_2a_INVALID_POLICY"]
}
```

### Enhanced HITL (Condition B)
```json
{
  "flows": 7,
  "discoveryRate": 0.875,
  "iterations": 2,
  "totalQuestions": 9,
  "flows_found": [
    "MAIN",
    "EXT_ANY_SYSTEM_DOWN",
    "EXT_1a_INCOMPLETE_DATA",
    "EXT_1a2a_NO_RESPONSE",
    "EXT_2a_INVALID_POLICY",
    "EXT_3a_NO_AGENTS",
    "EXT_8a_REOPEN_CLAIM",
    "ALT_8_PAYMENT_CHECK"
  ]
}
```

**Improvement**: +62.5% discovery rate (from 25% to 87.5%)

## Output Files

### Raw Results
```
test-data/results/raw/enhanced-hitl-<timestamp>.json
```

Contains:
- `conditionA_Baseline`: The baseline use case
- `conditionB_EnhancedHITL`: The refined use case after iterations
- `iterativeRefinement`: Full iteration history
  - Questions asked per iteration
  - Answers received
  - Confidence progression
  - Priority counts
- `groundTruth`: The expected result

### Evaluate Results

Run `evaluateResults` with:
```json
{
  "resultsPath": "test-data/results/raw/enhanced-hitl-<timestamp>.json",
  "datasetPath": "test-data/dataset-2026-01-04T08-04-45-215Z.json"
}
```

Output:
```
test-data/results/evaluated/enhanced-hitl-<timestamp>.json
```

Contains:
- Discovery rate for baseline vs enhanced
- Quality scores
- Flow-by-flow comparison
- Grounded/logical/hallucination breakdown

## Verification

Check the iteration logs to verify:

### Priority Ranking Working
```json
{
  "iteration": 1,
  "highPriorityCount": 5,
  "questions": [
    "What happens if submitted data is incomplete at step 1?",
    "What happens if the policy is invalid at step 2?",
    "What happens if no agents are available at step 3?",
    ...
  ]
}
```
✓ Questions target steps 1-3 first (high criticality)

### Stopping Condition Working
```json
{
  "iteration": 2,
  "overallConfidence": 0.87,
  "highPriorityCount": 0
}
```
✓ Stopped because confidence > 0.85 and no high-priority items

### Discovery Improvement
```json
{
  "conditionA_Baseline": {
    "flows": [...]  // 2 flows
  },
  "conditionB_EnhancedHITL": {
    "flows": [...]  // 7 flows
  }
}
```
✓ Discovered 5 additional flows through iteration

## Troubleshooting

### If discovery rate is low (<60%):
1. Check `iterativeRefinement.iterations` - did it stop too early?
2. Check priority scores - are high-priority steps being questioned?
3. Check gap analysis - are patterns being detected?

### If too many iterations (>3):
1. Check confidence progression - is it increasing?
2. May need to adjust stopping threshold

### If questions seem random:
1. Review `stepPriorities` in iteration logs
2. Verify uncertainty × criticality is being calculated

## Summary

This test will:
✅ Compare baseline vs enhanced framework
✅ Use rule-based validation (saves API costs)
✅ Show iterative refinement in action
✅ Demonstrate 60%+ improvement in discovery rate
✅ Track iteration history for analysis

**Cost**: ~$0.20-0.30 per test case
**Time**: ~2-3 minutes for HC1
**Expected Discovery**: 75-87% (vs 25% baseline)

