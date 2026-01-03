# Research Discussion Summary: HITL vs COVE

**Document Purpose:** Comprehensive record of all research ideas, methodologies, and decisions discussed during the HITL research framework design.

**Date:** January 3, 2026

---

## Problem Statement

### Original Issue

The system (using COVE - Chain-of-Verification approach) tends to expand edge cases that might not be logically correct or are overly aggressive. The evaluation tool (GPT comparison) does not detect new branches as correct, flagging reasonable additions as hallucinations.

### Example Problem

**Input:** "RA receives box, validates ID, records arrival, unpacks bags"

**Base Use Case (extractUseCase):**

- 7 steps, 1 MAIN flow
- Clean, matches description

**Improved Use Case (improveUseCase):**

- 14 steps, 1 MAIN + 2 EXCEPTION flows
- Added: DamagedBox flow (not in description)
- Added: InvalidBoxID flow (not in description)
- Result: Rule-based score increased to 86, but LLM judge said "hallucinates too much"

### Core Tension

- **Completeness vs Accuracy:** COVE generates more comprehensive use cases but invents scenarios not in requirements
- **Evaluation Challenge:** How to distinguish between "reasonable logical additions" and "hallucinations"?

---

## Research Questions Evolution

### Initial Question (Abandoned)

"Does COVE improve use case quality?"

- **Status:** Already proven in previous thesis work (not thoroughly tested, but accepted)
- **Decision:** Move beyond this baseline question

### Refined Questions (Current)

**RQ1:** Does detailed input help or hurt COVE?

- Hypothesis: More information might cause more hallucination (over-elaboration)
- Test: Compare COVE with vague input vs detailed input
- Metric: Quality score, hallucination rate, discovery rate

**RQ2:** Can constrained HITL beat COVE when branches are clear but steps are vague?

- Hypothesis: Constrained information elicitation reduces hallucination vs open-ended improvement
- Test: Compare COVE (detailed input) vs HITL (with constraints)
- Metric: Precision, recall, F1, hallucination rate

---

## Methodological Challenges Discussed

### Challenge 1: Test Data Design Flaw

**Problem Identified:**
Original test setup was fundamentally flawed:

- **Input:** Vague summary (no exceptions mentioned)
- **Ground Truth:** Complete use case WITH exception flows (FireAlarm, ComputerDown, IDMismatch)
- **Generated:** Use case WITH different exceptions (DamagedBox, InvalidBoxID)
- **Evaluation:** Compared generated to ground truth → penalized for not matching undisclosed exceptions

**Why This Is Unfair:**
LLM cannot discover exceptions that weren't mentioned in the input. Comparing against hidden ground truth exceptions is like "comparing apples to undisclosed oranges."

**Resolution:**
Three-tier evaluation system that distinguishes:

1. **Grounded:** In the input (score 1.0)
2. **Logical:** Not in input but reasonable (score 0.7)
3. **Hallucination:** Neither (score 0.0)

### Challenge 2: Input Quality Levels

**Three Levels Identified:**

1. **Vague Summary** (User-level)

   - Example: "RA receives box, validates, unpacks"
   - Only MAIN flow described
   - Minimal detail

2. **Detailed Description** (Expert-level)

   - Example: "RA accepts boxes... If ID invalid, notify supervisor and return... If fire alarm, evacuate..."
   - Includes alternative/exception flows
   - More context and edge cases

3. **Ground Truth** (Oracle-level)
   - Complete GenUseCase JSON
   - All flows fully specified
   - Perfect information

**Test Strategy:**
Use different input levels for different experimental conditions to test information quality impact.

### Challenge 3: HITL Design - How to Differentiate from COVE?

**Core Problem:**
If both COVE and HITL use the same LLM with the same knowledge, what makes HITL meaningfully different?

**Ideas Explored:**

#### Idea 1: Interactive vs Batch (REJECTED - Too Costly)

- **COVE:** Generate all questions → answer all → improve once
- **HITL:** Generate question → answer → refine → repeat 2-3 rounds
- **Problem:** 3-4x more API calls, iterative process might not add value
- **Decision:** Too expensive for minimal expected gain

#### Idea 2: Constrained vs Open-ended (SELECTED)

- **COVE:** Broad questions like "Is this complete?" → LLM freely elaborates
- **HITL:** Multiple-choice questions → forced choices → cannot invent beyond options
- **Advantage:** Constrains output, reduces hallucination
- **Cost:** Same as COVE (one round)
- **Decision:** ✅ This is the key differentiator

#### Idea 3: Different Models (CONSIDERED)

- **COVE:** Single model (Gemini) for all roles
- **HITL:** Model A generates, Model B answers (multi-agent)
- **Advantage:** Different model biases might improve diversity
- **Decision:** Not primary focus, but could be tested later

#### Idea 4: Information Asymmetry (SELECTED)

- **COVE:** Same model sees same context throughout
- **HITL:** Generator sees VAGUE, Expert sees DETAILED
- **Advantage:** Simulates knowledge elicitation from external source
- **Cost:** Same as COVE
- **Decision:** ✅ Combined with constrained questions

**Final HITL Design:**
Information Asymmetry + Constrained Multiple-Choice Questions

- Generator LLM: Only has vague summary
- Expert LLM: Has detailed description
- Constraint: Generator can ONLY add what was explicitly asked and answered

---

## Evaluation Methodology Evolution

### Approach 1: Ground Truth Matching (REJECTED)

**Method:** Compare generated use case to ground truth, measure similarity

**Problems:**

- Unfair when ground truth has flows not in input
- Penalizes reasonable additions that aren't in ground truth
- Can't measure "logical soundness" of invented flows

**Decision:** Insufficient for research goals

### Approach 2: Fidelity + Reasonableness Split (CONSIDERED)

**Method:** Two separate test types

- **Fidelity Test:** Detailed input + ground truth matching → measures adherence
- **Reasonableness Test:** Vague input + expert judgment → measures logical soundness

**Advantage:** Separates different quality dimensions

**Problem:** Doesn't solve the core issue of distinguishing good inventions from hallucinations

**Decision:** Partial use - led to three-tier approach

### Approach 3: Three-Tier Evaluation (SELECTED)

**Method:** Categorize each generated flow

**Categories:**

1. **GROUNDED (Score 1.0):**

   - Flow/scenario explicitly mentioned in input description
   - Example: "If ID invalid, notify supervisor" → InvalidID flow is GROUNDED

2. **LOGICAL (Score 0.7):**

   - NOT in description, but logically sound for domain
   - Criteria: Relates to mentioned actors, common edge case, business value clear
   - Example: "Receives box" mentioned → DamagedBox flow is LOGICAL (boxes can be damaged)

3. **HALLUCINATION (Score 0.0):**
   - Neither grounded nor logical
   - Unrelated, impossible, or absurd
   - Example: AlienInvasion flow for box receiving

**Advantages:**

- Recognizes value of logical additions
- Doesn't penalize reasonable domain knowledge
- Still flags true hallucinations
- Enables nuanced comparison

**Quality Score Calculation:**

```
Quality Score = (grounded_count × 1.0 + logical_count × 0.7 + hallucination_count × 0.0) / total_flows
```

---

## Experimental Design Evolution

### Design 1: Simple A/B Test (INITIAL)

- Condition A: Baseline extraction
- Condition B: COVE improvement
- **Problem:** Already proven, not novel

### Design 2: Input Quality Matrix (CONSIDERED)

```
           Vague Input    Detailed Input
Baseline        A1             A2
COVE            B1             B2
HITL            C1             C2
```

- 6 conditions total
- **Problem:** Too many conditions = expensive, diluted insights
- **Decision:** Focus on key comparisons

### Design 3: Two-Phase Testing (SELECTED)

**Phase 1: COVE Input Quality Test**

- Condition A: COVE + Vague input
- Condition B: COVE + Detailed input
- **Research Question:** Does detailed input help or hurt?
- **Cost:** 2 conditions × 10 cases = 20 runs

**Phase 2: HITL vs COVE**

- Condition C: COVE + Detailed (from Phase 1)
- Condition D: HITL + Constrained (vague input, expert has detailed)
- **Research Question:** Does constrained HITL beat COVE?
- **Cost:** 1 new condition × 10 cases = 10 runs

**Total:** 30 test runs (cost-effective)

---

## Data Structure Decisions

### Test Case Format (FINAL)

```json
{
  "id": "UC-001",
  "domain": "Logistics",
  "metadata": {
    "complexity": "medium",
    "expectedFlows": 4,
    "notes": "Box receiving scenario"
  },
  "inputs": {
    "vague": "Short user summary",
    "detailed": "Expert description with all flows"
  },
  "groundTruth": {
    "name": "...",
    "flows": [...]
  }
}
```

**Key Design Decisions:**

- Store BOTH vague and detailed in same test case
- Ground truth for reference, not direct comparison
- Metadata tracks expected complexity

### Evaluation Result Format

```json
{
  "testCaseId": "UC-001",
  "totalFlows": 3,
  "breakdown": {
    "grounded": 2,
    "logical": 1,
    "hallucinations": 0
  },
  "scores": {
    "qualityScore": 0.9,
    "discoveryRate": 0.67,
    "precision": 1.0,
    "recall": 0.67,
    "f1Score": 0.8
  },
  "flowDetails": [...]
}
```

---

## Implementation Decisions

### Tool Architecture

**New Tools Created:**

1. `prepareTestData` - Validate and structure test dataset
2. `runCOVEComparison` - Execute Phase 1 tests
3. `extractUseCaseWithConstrainedHITL` - HITL workflow
4. `runHITLComparison` - Execute Phase 2 tests
5. `evaluateResults` - Three-tier evaluation

**Modified Functions:**

1. `generateMultipleChoiceQuestions` - Convert open questions to MC
2. `expertAnswerMultipleChoice` - Expert with detailed knowledge answers
3. `refineWithConstrainedAnswers` - Constrained refinement

### Reuse vs New Implementation

**Reused from Existing System:**

- Rule-based validation (`validateUseCaseWithFeedback`)
- Base question generation logic (COVE_LLM_QUESTIONS)
- Use case extraction (`generateFlatUseCase`)
- Use case improvement framework

**Built New:**

- MC question formatting
- Information asymmetry implementation
- Constrained refinement logic
- Three-tier evaluation system
- Test execution framework

---

## Cost Optimization Strategies

### Original Concern

API costs are high - need minimal test approach

### Strategies Implemented

**1. Minimal Test Set**

- 10 test cases (not 30+)
- Still statistically viable for paired comparisons
- Each case tests multiple conditions

**2. Result Reuse**

- Phase 2 reuses COVE-Detailed results from Phase 1
- No redundant API calls

**3. Cheaper Evaluation**

- Use Gemini Flash for evaluation (cheaper)
- Batch evaluation calls

**4. Single COVE Version**

- Don't create multiple COVE variants
- One general-purpose implementation
- Reduces development and testing time

**5. Focused Comparison**

- Only 4 conditions total (A, B, C, D)
- Not testing every possible combination

**Total Estimated Cost:**

- 10 cases × 4 conditions × ~6 calls per condition = ~240 API calls
- With cheaper eval model: ~180 paid calls + 60 cheap evals

---

## Ideas Considered But Not Implemented

### 1. Excel/CSV Import Tool

**Idea:** Build tool to parse Excel files and convert to test data
**Reason Rejected:** User decided to manually prepare test data with MCP tool instead
**Status:** Abandoned

### 2. Multiple COVE Modes

**Idea:**

- `strict_grounding` mode - minimize invention
- `logical_exploration` mode - allow logical additions

**Reason Rejected:**

- Too complex
- Hard to justify different modes
- Better to have one general-purpose COVE

**Status:** Abandoned in favor of single COVE implementation

### 3. Iterative HITL (Multi-Round)

**Idea:** HITL asks questions → gets answers → refines → asks more questions (repeat 3x)
**Reason Rejected:** 3-4x cost increase for minimal expected gain
**Status:** Abandoned - using single-round constrained approach

### 4. Real Human Testing

**Idea:** Actual human experts answer questions
**Reason Rejected:**

- Expensive (human time)
- Not scalable
- Research focuses on LLM capabilities
- Simulated expert sufficient for thesis

**Status:** Out of scope - using LLM-simulated expert

### 5. Large-Scale Testing (50+ cases)

**Idea:** Test on 50+ use cases for robust statistics
**Reason Rejected:** API cost too high
**Status:** Scaled down to 10 cases (minimal viable)

### 6. Oracle Mode as Primary Condition

**Idea:** Give simulated expert the full ground truth to answer questions
**Reason Rejected:**

- Circular reasoning (feeding answer back)
- Not realistic (BAs don't have perfect answers)
- Can't prove HITL value (it's cheating)

**Status:** Considered as upper-bound reference only, not primary test

### 7. Prompt Strategy Comparison Framework

**Idea:** Test multiple prompting strategies (baseline, strict, few-shot, CoT, retrieval-augmented)
**Reason Rejected:** Scope creep - not core research question
**Status:** Mentioned as future work, not implemented

### 8. Metric Tracking Dashboard

**Idea:** Real-time dashboard showing metrics across experiments
**Reason Rejected:** Over-engineering for 10 test cases
**Status:** Use simple JSON output and manual analysis

---

## Key Research Contributions

### Theoretical Contributions

1. **Three-Tier Evaluation Framework**

   - Novel categorization: Grounded / Logical / Hallucination
   - Recognizes value of domain knowledge
   - More nuanced than binary "correct/incorrect"

2. **Information Asymmetry in HITL**

   - Generator and Expert have different contexts
   - Simulates real requirements elicitation
   - Testable approach for LLM-based HITL

3. **Constrained Elicitation Method**
   - Multiple-choice questions limit invention
   - Measurable difference from open-ended improvement
   - Practical approach to reduce hallucination

### Practical Contributions

1. **Reproducible Test Framework**

   - Structured dataset format
   - Automated test execution
   - Standardized evaluation

2. **Cost-Effective Research Design**

   - Minimal test set (10 cases)
   - Reusable results between phases
   - Strategic tool architecture

3. **Reusable COVE Implementation**
   - General-purpose validation
   - Not over-engineered with modes
   - Extensible for future work

---

## Open Questions & Future Work

### Unresolved Questions

1. **Will detailed input actually help COVE?**

   - Could go either way
   - Need Phase 1 results to know

2. **How much does information asymmetry matter?**

   - Expert has detailed, Generator has vague
   - Is this the key, or is it the constraint?
   - Could test by giving both same context

3. **Are multiple-choice questions too restrictive?**
   - Might miss nuances
   - Could compare MC vs open-ended with same info asymmetry

### Future Research Directions

1. **Multi-Agent Diversity**

   - Test different model combinations
   - GPT generator + Gemini expert vs vice versa

2. **Optimal Question Count**

   - Current: 3-5 questions per use case
   - Could test 1-2 vs 5-7 vs 10+

3. **Domain-Specific Adaptation**

   - Healthcare, Finance, E-commerce
   - Domain-specific question templates

4. **Real Human Validation**

   - Small-scale human study
   - Compare human vs LLM expert answers

5. **Hybrid Approaches**
   - COVE first, then HITL refinement
   - Best of both worlds?

---

## Lessons Learned

### Methodology Lessons

1. **Test Design Is Critical**

   - Original test was fundamentally flawed
   - Ground truth must align with input scope
   - Evaluation method shapes what you can claim

2. **Cost Constraints Drive Design**

   - 10 cases vs 50 cases changes everything
   - Need focused research questions
   - Reuse and optimization crucial

3. **Differentiation Requires Thought**
   - "HITL with same LLM" isn't obviously different
   - Need clear mechanism (info asymmetry + constraint)
   - Implementation details matter for research claims

### Technical Lessons

1. **Reuse Existing Infrastructure**

   - Don't rebuild validation from scratch
   - Extend existing question generation
   - Leverage working extraction pipeline

2. **Keep Tools Separate**

   - Don't mix COVE and HITL logic
   - Separate tools = clearer experiments
   - Easier to compare and debug

3. **Structure Test Data Early**
   - Good dataset format saves time later
   - Validation upfront prevents errors
   - Metadata helps with analysis

---

## Timeline & Milestones

### Completed

- [x] Problem identification and analysis
- [x] Research question refinement
- [x] Experimental design
- [x] Evaluation methodology design
- [x] Implementation plan creation

### Next Steps

1. Prepare 10 test cases
2. Implement Phase 1 (COVE comparison)
3. Run Phase 1 tests
4. Implement Phase 2 (HITL)
5. Run Phase 2 tests
6. Evaluate all results
7. Statistical analysis
8. Document findings for thesis

---

## Document Revision History

- **2026-01-03:** Initial comprehensive summary created
- Captures all discussion points from planning session
- Includes abandoned ideas for future reference
