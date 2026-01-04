# Testing Enhanced Framework with HC1

## Test Procedure

### Step 1: Run HITL Comparison on HC1

The MCP tool `runHITLComparison` should be invoked with:

```json
{
  "datasetPath": "test-data/dataset-2026-01-04T08-04-45-215Z.json",
  "testCaseIds": ["HC1"]
}
```

### Expected Behavior

The enhanced framework will:

1. **Generate baseline** from vague input
2. **Iterative refinement** (up to 5 iterations):
   - Validate and analyze gaps (7 new pattern detectors)
   - Compute uncertainty × criticality priorities
   - Generate 4-6 adaptive questions targeting highest priorities
   - Get expert answers from detailed description
   - Refine use case by integrating new flows
   - Check stopping condition (confidence > 0.85 OR 20 questions)

### Expected Results for HC1

**Ground Truth**: 8 flows total

- MAIN flow
- EXT_ANY_SYSTEM_DOWN (temporal exception)
- EXT_1a_INCOMPLETE_DATA (data quality)
- EXT_1a2a_NO_RESPONSE (nested exception)
- EXT_2a_INVALID_POLICY (validation)
- EXT_3a_NO_AGENTS (resource availability)
- EXT_8a_REOPEN_CLAIM (post-completion)
- ALT_8_PAYMENT_CHECK (technology variation)

**Target**: Discover 6-7 flows (75-87% discovery rate)

**Baseline Performance**: 2 flows (25%)

### Step 2: Evaluate Results

After completion, the results will be saved to:

```
test-data/results/raw/phase2-hitl-<timestamp>.json
```

Then run `evaluateResults` with:

```json
{
  "resultsPath": "test-data/results/raw/phase2-hitl-<timestamp>.json",
  "datasetPath": "test-data/dataset-2026-01-04T08-04-45-215Z.json"
}
```

This will produce:

```
test-data/results/evaluated/phase2-hitl-<timestamp>.json
```

### Step 3: Review Results

Check the evaluated results for:

- **Discovery Rate**: Should be 75%+ (6-7 out of 8 flows)
- **Total Iterations**: Should be 2-3
- **Total Questions**: Should be 8-15
- **Flow Categories**:
  - Grounded flows (from detailed description)
  - Logical flows (reasonable domain inferences)
  - Hallucinations (should be minimal)

## Manual Verification Steps

If you want to manually verify the implementation before running:

1. Check gap analyzer has 7 new detectors:

   ```bash
   grep -c "^function detect" src/analyzers/gap.analyzer.ts
   # Should show 7
   ```

2. Check uncertainty ranker exists:

   ```bash
   ls -lh src/evaluators/uncertainty.ranker.ts
   # Should show ~17KB file
   ```

3. Check iterative loop is implemented:
   ```bash
   grep -A5 "while (iteration < MAX_ITERATIONS" src/tools/testingTools.ts
   # Should show the iterative loop
   ```

## Troubleshooting

### If discovery rate is below 75%:

- Check iteration logs in results JSON
- Verify priority scores are calculated correctly
- Check if stopping condition triggered too early

### If too many iterations:

- Check confidence score progression
- Verify gap detection is working
- May need to adjust MAX_ITERATIONS or confidence threshold

### If questions don't target high-priority steps:

- Review stepPriorities array in iteration logs
- Check criticality computation
- Verify uncertainty scoring
