# Expected HC1 Test Results

## Test Case: HC1 - Insurance Claims Handling

### Input Summary
**Vague**: "A Customer reports a claim to a Clerk who finds the policy and assigns an Adjuster..."
**Ground Truth**: 8 flows (1 MAIN + 7 exception/alternative flows)

## Expected Execution Flow

### Iteration 1
**Starting State**:
- Baseline use case generated from vague input
- Likely has MAIN flow + 1-2 basic exceptions
- Overall confidence: ~0.4-0.5

**Priority Analysis**:
- Step 1 (Customer reports claim): HIGH priority
  - Criticality: 1.0 (input step)
  - Uncertainty: 0.6 (missing data quality handling)
  - Priority Score: 0.6
  
- Step 2 (Clerk finds policy): HIGH priority
  - Criticality: 0.9 (validation step)
  - Uncertainty: 0.7 (missing invalid policy handling)
  - Priority Score: 0.63

- Step 3 (Adjuster investigates): MEDIUM priority
  - Criticality: 0.6 (business logic)
  - Uncertainty: 0.5
  - Priority Score: 0.3

**Questions Generated** (5-6 questions):
1. "What happens if submitted data is incomplete at step 1?" → EXT_1a_INCOMPLETE_DATA
2. "What happens if the policy is invalid at step 2?" → EXT_2a_INVALID_POLICY
3. "What happens if no agents are available at step 3?" → EXT_3a_NO_AGENTS
4. "Can the system go down at any time during the process?" → EXT_ANY_SYSTEM_DOWN
5. "What happens if claimant doesn't respond to information requests?" → EXT_1a2a_NO_RESPONSE

**Expected Discoveries**: 4-5 flows
**Confidence After**: ~0.65

---

### Iteration 2
**Starting State**:
- Use case now has 5-6 flows
- Confidence: ~0.65

**Priority Analysis**:
- Step 8 (Settles and closes claim): HIGH priority
  - Criticality: 0.8 (exit point)
  - Uncertainty: 0.6 (missing post-completion handling)
  - Priority Score: 0.48

- Step 8 (Settlement payment): MEDIUM priority
  - Criticality: 0.6
  - Uncertainty: 0.4 (missing technology variations)
  - Priority Score: 0.24

**Questions Generated** (3-4 questions):
1. "Can a claim be reopened after step 8 closes it?" → EXT_8a_REOPEN_CLAIM
2. "Are there different methods for settlement payment at step 8?" → ALT_8_PAYMENT_CHECK
3. "What additional exception scenarios exist in the claims process?"

**Expected Discoveries**: 2-3 flows
**Confidence After**: ~0.85

---

### Iteration 3 (if needed)
**Starting State**:
- Use case now has 7-8 flows
- Confidence: ~0.85

**Stopping Condition Met**:
- Overall confidence > 0.85: ✓
- High priority count = 0: ✓
- **STOP**

---

## Final Expected Results

### Discovery Metrics
```json
{
  "totalFlows": 8,
  "discoveredFlows": 7,
  "discoveryRate": 0.875,
  "iterations": 2,
  "totalQuestions": 9,
  "finalConfidence": 0.87
}
```

### Flow Breakdown
| Flow ID | Type | Pattern | Expected Discovery |
|---------|------|---------|-------------------|
| MAIN | MAIN | - | ✓ (baseline) |
| EXT_ANY_SYSTEM_DOWN | EXCEPTION | Temporal | ✓ (iteration 1) |
| EXT_1a_INCOMPLETE_DATA | EXCEPTION | Data Quality | ✓ (iteration 1) |
| EXT_1a2a_NO_RESPONSE | EXCEPTION | Nested | ✓ (iteration 1) |
| EXT_2a_INVALID_POLICY | EXCEPTION | Validation | ✓ (iteration 1) |
| EXT_3a_NO_AGENTS | EXCEPTION | Resource | ✓ (iteration 1) |
| EXT_8a_REOPEN_CLAIM | EXCEPTION | Post-Completion | ✓ (iteration 2) |
| ALT_8_PAYMENT_CHECK | ALTERNATIVE | Technology Var | ✓ (iteration 2) |

### Quality Metrics
```json
{
  "qualityScore": 0.85,
  "precision": 0.90,
  "f1Score": 0.88,
  "grounded": 7,
  "logical": 0,
  "hallucinations": 0
}
```

## Comparison with Baseline

### Baseline (Current Framework)
- Discovery Rate: 25% (2/8 flows)
- Iterations: 1
- Questions: 4
- Flows Found: MAIN, EXT_2a_INVALID_POLICY

### Enhanced Framework (Expected)
- Discovery Rate: 87.5% (7/8 flows)
- Iterations: 2-3
- Questions: 8-12
- Flows Found: All except possibly one nested exception

**Improvement**: +62.5% discovery rate

## Key Success Indicators

✅ **Discovery Rate ≥ 75%**: Target is 6-7 flows (75-87%)
✅ **Iterations ≤ 3**: Efficient convergence
✅ **Questions ≤ 15**: Not over-questioning
✅ **Precision ≥ 0.85**: Low hallucination rate
✅ **Early Priority Focus**: Step 1-3 questioned first

## What Makes This Work

1. **Priority = Uncertainty × Criticality**
   - Step 1 gets highest priority (input + unclear)
   - Step 8 addressed in iteration 2 (exit + post-completion)

2. **7 New Gap Detectors**
   - Temporal: Catches EXT_ANY_SYSTEM_DOWN
   - Nested: Catches EXT_1a2a_NO_RESPONSE
   - Resource: Catches EXT_3a_NO_AGENTS
   - Post-Completion: Catches EXT_8a_REOPEN_CLAIM
   - Data Quality: Catches EXT_1a_INCOMPLETE_DATA
   - Technology: Catches ALT_8_PAYMENT_CHECK

3. **Enhanced Flow Extraction**
   - Multi-flow answers parsed correctly
   - Nested exceptions properly linked
   - Temporal exceptions (no fromStepIndex) handled

4. **Adaptive Stopping**
   - Stops when confidence high enough
   - Doesn't waste questions on low-priority items

