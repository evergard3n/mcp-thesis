# Evaluation Metrics: Precision, Recall, and F1 Score

**Document Purpose:** Detailed explanation of how precision, recall, and F1 score are calculated in the context of use case evaluation for the HITL research.

**Date:** January 3, 2026

---

## Overview

In our research, we evaluate generated use cases against ground truth using information retrieval metrics adapted for use case flows. These metrics help us measure:
- **Precision:** How many generated flows are correct?
- **Recall:** How many ground truth flows were discovered?
- **F1 Score:** Harmonic mean balancing precision and recall

---

## Context: Use Case Evaluation

### What We're Comparing

**Generated Use Case:**
- Produced by COVE or HITL
- Contains N flows (MAIN, ALTERNATIVE, EXCEPTION)
- Each flow has steps, actors, conditions

**Ground Truth Use Case:**
- Expert-created reference use case
- Contains M flows
- Represents the "correct" or "ideal" use case

### What We Measure

For each generated flow, we determine:
1. **Is it GROUNDED?** (explicitly in input description)
2. **Is it LOGICAL?** (not in input, but reasonable for domain)
3. **Is it a HALLUCINATION?** (neither grounded nor logical)
4. **Is it in GROUND TRUTH?** (matches a ground truth flow)

---

## Metric Definitions

### True Positives (TP)

**Definition:** Flows that are both generated AND correct

**In Our Context:**
A generated flow is a True Positive if it is either:
- **Grounded** (score 1.0), OR
- **Logical** (score 0.7)

**Why both count as TP:**
Both grounded and logical flows are considered "correct" additions. We're measuring quality, not just ground truth matching.

**Example:**
```
Generated: InvalidBoxID flow (not in input description)
Evaluation: LOGICAL (reasonable for logistics domain)
Result: True Positive ✓
```

### False Positives (FP)

**Definition:** Flows that are generated but incorrect

**In Our Context:**
A generated flow is a False Positive if it is:
- **Hallucination** (score 0.0)

**Example:**
```
Generated: AlienInvasion flow
Evaluation: HALLUCINATION (absurd, unrelated)
Result: False Positive ✗
```

### True Negatives (TN)

**Definition:** Flows that are correctly not generated

**In Our Context:**
Not directly measured in our evaluation, as we don't enumerate all possible flows that weren't generated. 

**Reason:** The space of "flows we didn't generate" is infinite. We focus on what was generated and what should have been.

### False Negatives (FN)

**Definition:** Flows that should be generated but weren't (missed flows)

**In Our Context:**
Ground truth flows that were NOT discovered by the generated use case.

**Calculation:**
```
FN = Total ground truth flows - Discovered flows
```

**Example:**
```
Ground Truth: 4 flows (MAIN, ALT-1, EXC-1, EXC-2)
Generated: 3 flows (matches MAIN and ALT-1, invented 1 logical flow)
Discovered: 2 (MAIN, ALT-1)
FN = 4 - 2 = 2 (missed EXC-1 and EXC-2)
```

---

## Precision Calculation

### Formula

```
Precision = TP / (TP + FP)
```

Or equivalently:
```
Precision = Correct Flows / Total Generated Flows
```

### In Our System

```
Precision = (Grounded + Logical) / Total Generated Flows
```

### Interpretation

**Precision answers:** "Of all the flows we generated, how many are correct?"

- **High Precision (0.9-1.0):** Most generated flows are correct, few hallucinations
- **Medium Precision (0.6-0.8):** Some hallucinations, but mostly correct
- **Low Precision (0.0-0.5):** Many hallucinations, unreliable output

### Example Calculation

**Scenario:**
```
Generated Use Case:
- Flow 1: MAIN → Grounded
- Flow 2: ALT-1 (InvalidID) → Logical
- Flow 3: EXC-1 (AlienInvasion) → Hallucination
```

**Calculation:**
```
TP = Grounded + Logical = 1 + 1 = 2
FP = Hallucinations = 1
Total Generated = 3

Precision = 2 / 3 = 0.667 (66.7%)
```

**Interpretation:** 67% of generated flows are correct, 33% are hallucinations.

---

## Recall Calculation

### Formula

```
Recall = TP / (TP + FN)
```

Or equivalently:
```
Recall = Discovered Flows / Total Ground Truth Flows
```

### In Our System

```
Recall = Flows Matching Ground Truth / Total Ground Truth Flows
```

**Note:** For recall, we specifically check if a generated flow matches/corresponds to a ground truth flow, regardless of whether it's grounded, logical, or hallucination.

### Interpretation

**Recall answers:** "Of all the flows in the ground truth, how many did we discover?"

- **High Recall (0.9-1.0):** Found almost all ground truth flows
- **Medium Recall (0.6-0.8):** Found most important flows, missed some
- **Low Recall (0.0-0.5):** Missed many ground truth flows

### Example Calculation

**Scenario:**
```
Ground Truth:
- MAIN
- ALT-1 (InvalidID)
- EXC-1 (FireAlarm)
- EXC-2 (ComputerDown)
Total = 4 flows

Generated Use Case:
- MAIN (matches ground truth MAIN) ✓
- ALT-1 (InvalidID, matches ground truth ALT-1) ✓
- ALT-2 (DamagedBox, NOT in ground truth) ✗
Total discovered = 2
```

**Calculation:**
```
Discovered (TP for recall) = 2
Total Ground Truth = 4
FN = 4 - 2 = 2 (missed EXC-1 and EXC-2)

Recall = 2 / 4 = 0.5 (50%)
```

**Interpretation:** Discovered 50% of ground truth flows, missed the two exception flows.

---

## Important: Precision vs Recall in Our Context

### Two Different "TP" Definitions

**For Precision:**
- TP = Grounded + Logical flows (correct regardless of ground truth)
- Measures: Quality of generated flows

**For Recall:**
- TP = Flows matching ground truth (discovery rate)
- Measures: Coverage of ground truth

### Why This Matters

A flow can be:
- **Logical but not in ground truth** → Counts for precision, NOT for recall
- **Hallucination but matches ground truth** → Unlikely, but would count for recall, NOT precision

**Example:**
```
Flow: DamagedBox
Evaluation: LOGICAL (reasonable edge case)
In Ground Truth: No
→ Contributes to Precision ✓
→ Does NOT contribute to Recall ✗
```

This is intentional - we want to credit reasonable additions that aren't in the ground truth.

---

## F1 Score Calculation

### Formula

```
F1 = 2 × (Precision × Recall) / (Precision + Recall)
```

Or equivalently:
```
F1 = 2TP / (2TP + FP + FN)
```

### Interpretation

**F1 Score answers:** "What's the balanced measure of quality and coverage?"

F1 is the **harmonic mean** of precision and recall, giving equal weight to both.

- **High F1 (0.9-1.0):** Excellent balance of quality and coverage
- **Medium F1 (0.6-0.8):** Good performance, some trade-offs
- **Low F1 (0.0-0.5):** Poor quality or coverage (or both)

### Why Harmonic Mean?

The harmonic mean penalizes extreme values. If either precision or recall is very low, F1 will be low.

**Example:**
```
Precision = 1.0, Recall = 0.1
Arithmetic Mean = (1.0 + 0.1) / 2 = 0.55 (misleadingly high)
Harmonic Mean (F1) = 2 × (1.0 × 0.1) / (1.0 + 0.1) = 0.18 (correctly low)
```

### Example Calculation

**Scenario:**
```
Generated:
- 5 total flows
- 3 Grounded
- 1 Logical
- 1 Hallucination

Ground Truth:
- 4 flows
- 3 discovered by generated use case
```

**Step 1: Calculate Precision**
```
Precision = (Grounded + Logical) / Total Generated
Precision = (3 + 1) / 5 = 4/5 = 0.8
```

**Step 2: Calculate Recall**
```
Recall = Discovered / Total Ground Truth
Recall = 3 / 4 = 0.75
```

**Step 3: Calculate F1**
```
F1 = 2 × (Precision × Recall) / (Precision + Recall)
F1 = 2 × (0.8 × 0.75) / (0.8 + 0.75)
F1 = 2 × 0.6 / 1.55
F1 = 1.2 / 1.55
F1 ≈ 0.774 (77.4%)
```

---

## Complete Example Walkthrough

### Scenario Setup

**Generated Use Case (COVE + Detailed):**
```
1. MAIN flow
2. ALT-1: InvalidBoxID
3. ALT-2: DamagedBox
4. EXC-1: NetworkFailure
```

**Ground Truth:**
```
1. MAIN flow
2. ALT-1: InvalidBoxID
3. EXC-1: FireAlarm
4. EXC-2: ComputerDown
```

**Evaluation Results:**
```
Flow 1 (MAIN): Grounded, matches GT-1
Flow 2 (InvalidBoxID): Grounded, matches GT-2
Flow 3 (DamagedBox): Logical, NOT in ground truth
Flow 4 (NetworkFailure): Hallucination, NOT in ground truth
```

### Step-by-Step Calculation

**Step 1: Count Flow Types**
```
Grounded flows: 2 (MAIN, InvalidBoxID)
Logical flows: 1 (DamagedBox)
Hallucination flows: 1 (NetworkFailure)
Total generated: 4

Ground truth flows: 4
Discovered flows: 2 (MAIN, InvalidBoxID)
Missed flows: 2 (FireAlarm, ComputerDown)
```

**Step 2: Calculate Precision**
```
TP (for precision) = Grounded + Logical = 2 + 1 = 3
FP = Hallucinations = 1
Total Generated = 4

Precision = 3 / 4 = 0.75 (75%)
```

**Interpretation:** 75% of generated flows are correct (grounded or logical), 25% are hallucinations.

**Step 3: Calculate Recall**
```
TP (for recall) = Discovered = 2
Total Ground Truth = 4
FN = 4 - 2 = 2

Recall = 2 / 4 = 0.5 (50%)
```

**Interpretation:** Found 50% of ground truth flows, missed 50%.

**Step 4: Calculate F1**
```
F1 = 2 × (0.75 × 0.5) / (0.75 + 0.5)
F1 = 2 × 0.375 / 1.25
F1 = 0.75 / 1.25
F1 = 0.6 (60%)
```

**Interpretation:** Balanced measure shows 60% overall quality considering both correctness and coverage.

---

## Additional Metrics Used

### Quality Score

**Formula:**
```
Quality Score = (Grounded × 1.0 + Logical × 0.7 + Hallucination × 0.0) / Total Flows
```

**Purpose:** Weighted quality metric that values grounded flows fully, logical flows partially, and hallucinations not at all.

**Example:**
```
2 Grounded, 1 Logical, 1 Hallucination
Total = 4 flows

Quality Score = (2 × 1.0 + 1 × 0.7 + 1 × 0.0) / 4
Quality Score = (2.0 + 0.7 + 0.0) / 4
Quality Score = 2.7 / 4 = 0.675 (67.5%)
```

### Discovery Rate

**Formula:**
```
Discovery Rate = Discovered Flows / Total Ground Truth Flows
```

**Note:** This is identical to Recall in our system.

**Purpose:** More intuitive name for measuring how many ground truth flows were found.

### Hallucination Rate

**Formula:**
```
Hallucination Rate = Hallucination Flows / Total Generated Flows
```

**Purpose:** Direct measure of incorrect additions.

**Example:**
```
1 Hallucination out of 4 flows
Hallucination Rate = 1 / 4 = 0.25 (25%)
```

**Note:** Hallucination Rate = 1 - Precision (when only grounded/logical count as correct)

---

## Metric Relationships

### Visual Representation

```
                    All Possible Flows
                           |
        +------------------+------------------+
        |                                     |
  Generated Flows                    Ground Truth Flows
        |                                     |
    +---+---+                             +---+---+
    |       |                             |       |
  Correct Incorrect                   Discovered Missed
 (Grounded (Halluc.)                      |        |
 + Logical)                               |       FN
    |                                     |
   TP (precision)                        TP (recall)
    
Precision = TP / (TP + FP) = Correct / Generated
Recall = TP / (TP + FN) = Discovered / Ground Truth
F1 = Harmonic mean of Precision and Recall
```

### Trade-offs

**High Precision, Low Recall:**
- Conservative system
- Only generates highly confident flows
- Misses many ground truth flows
- Example: HITL with very constrained questions

**Low Precision, High Recall:**
- Aggressive system
- Generates many flows (including hallucinations)
- Finds most ground truth flows
- Example: COVE with detailed input (hypothesized)

**Balanced (High F1):**
- Good precision and recall
- Finds ground truth flows without many hallucinations
- Ideal performance

---

## Statistical Aggregation

### Per-Test-Case Metrics

For each test case, we calculate:
- Precision
- Recall
- F1
- Quality Score
- Hallucination Rate

### Aggregate Metrics

Across all test cases (e.g., 10 cases):

**Mean:**
```
Mean Precision = Σ(Precision_i) / N
```

**Standard Deviation:**
```
StdDev = sqrt(Σ(x_i - mean)² / N)
```

**Reporting Format:**
```
Condition A: Precision = 0.75 ± 0.12 (mean ± std)
Condition B: Precision = 0.82 ± 0.09
```

### Comparison Between Conditions

**Paired t-test:**
Used to determine if difference between conditions is statistically significant.

**Effect Size (Cohen's d):**
```
d = (Mean_A - Mean_B) / Pooled_StdDev
```

Interpretation:
- d < 0.2: Small effect
- d = 0.5: Medium effect
- d > 0.8: Large effect

---

## Practical Examples from Research

### Example 1: COVE-Vague vs COVE-Detailed

**Hypothetical Results:**

| Metric | COVE-Vague | COVE-Detailed | Change |
|--------|------------|---------------|--------|
| Precision | 0.70 | 0.65 | -5% |
| Recall | 0.40 | 0.60 | +20% |
| F1 | 0.51 | 0.62 | +11% |
| Hallucination Rate | 0.30 | 0.35 | +5% |

**Interpretation:**
- Detailed input improves discovery (recall +20%)
- But also increases hallucinations slightly (precision -5%)
- Overall F1 improves (+11%), suggesting net positive

### Example 2: COVE vs HITL

**Hypothetical Results:**

| Metric | COVE-Detailed | HITL | Change |
|--------|---------------|------|--------|
| Precision | 0.65 | 0.85 | +20% |
| Recall | 0.60 | 0.55 | -5% |
| F1 | 0.62 | 0.67 | +5% |
| Hallucination Rate | 0.35 | 0.15 | -20% |

**Interpretation:**
- HITL significantly reduces hallucinations (precision +20%)
- Slightly lower discovery rate (recall -5%)
- Better overall F1 (+5%)
- Constrained approach successfully limits invention

---

## Implementation in Code

### Flow Evaluation

```typescript
interface FlowEvaluation {
  flowId: string;
  category: "grounded" | "logical" | "hallucination";
  score: number; // 1.0, 0.7, or 0.0
  inGroundTruth: boolean;
}
```

### Metric Calculation

```typescript
function calculateMetrics(
  flowEvaluations: FlowEvaluation[],
  groundTruthFlowCount: number
) {
  const grounded = flowEvaluations.filter(f => f.category === "grounded").length;
  const logical = flowEvaluations.filter(f => f.category === "logical").length;
  const hallucinations = flowEvaluations.filter(f => f.category === "hallucination").length;
  const discovered = flowEvaluations.filter(f => f.inGroundTruth).length;
  
  const totalGenerated = flowEvaluations.length;
  
  // Precision: correct flows / generated flows
  const precision = totalGenerated > 0
    ? (grounded + logical) / totalGenerated
    : 0;
  
  // Recall: discovered flows / ground truth flows
  const recall = groundTruthFlowCount > 0
    ? discovered / groundTruthFlowCount
    : 0;
  
  // F1: harmonic mean
  const f1Score = (precision + recall) > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;
  
  // Quality: weighted score
  const qualityScore = totalGenerated > 0
    ? (grounded * 1.0 + logical * 0.7) / totalGenerated
    : 0;
  
  return {
    precision,
    recall,
    f1Score,
    qualityScore,
    hallucinationRate: totalGenerated > 0 ? hallucinations / totalGenerated : 0
  };
}
```

---

## Summary

### Key Points

1. **Precision** measures quality: how many generated flows are correct?
2. **Recall** measures coverage: how many ground truth flows were found?
3. **F1** balances both: harmonic mean giving equal weight to precision and recall
4. **Quality Score** weights grounded (1.0) > logical (0.7) > hallucination (0.0)

### When to Use Each

- **Precision:** When hallucinations are costly (critical systems)
- **Recall:** When completeness is important (brainstorming, exploration)
- **F1:** When balanced performance matters (most research contexts)
- **Quality Score:** When logical additions should be valued but not as much as grounded ones

### Research Application

In our HITL research:
- **Precision** tells us if constrained approach reduces hallucinations
- **Recall** tells us if we're missing important ground truth flows
- **F1** gives overall performance comparison between COVE and HITL
- **Quality Score** accounts for the value of logical domain knowledge

---

## References

- Standard information retrieval metrics
- Adapted for use case flow evaluation
- Three-tier categorization (grounded/logical/hallucination) is novel to this research

---

## Document Revision History

- **2026-01-03:** Initial documentation created
- Comprehensive explanation with examples
- Context-specific adaptations explained

