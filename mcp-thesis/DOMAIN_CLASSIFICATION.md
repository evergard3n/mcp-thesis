# Domain Classification in MCP Thesis

## Overview

Domain classification is a **post-processing step** applied after baseline generation to annotate use cases with domain metadata. This approach maintains baseline purity while enabling domain-specific analysis.

## Design Rationale

### Why Post-Baseline Classification?

1. **Preserves Baseline Integrity**: Baseline remains a "naive" LLM extraction without framework logic
2. **Non-Invasive**: Adds metadata without modifying the baseline use case structure
3. **Enables Domain Analysis**: Compare framework performance across different domains
4. **Research Validity**: Fair comparison between baseline and framework

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Baseline Generation (No Framework)                │
│   vague input → generateFlatUseCase() → baseline UC        │
│   ❌ NO domain detection                                    │
│   ❌ NO blueprint matching                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Domain Classification (Metadata Only)             │
│   baseline UC → classifyUseCaseDomain() → domain metadata  │
│   ✅ Annotates flows with domain types                     │
│   ✅ Does NOT modify baseline structure                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 3: Framework Refinement (Full Framework)             │
│   baseline + domain → gap analysis → blueprint matching    │
│   → questions → refinement                                  │
└─────────────────────────────────────────────────────────────┘
```

## Domain Types

### 1. human-system

**Characteristics:**

- Human actors interact with systems
- Requires user input, decisions, approvals
- Error handling involves human judgment
- Examples: user registration, approval workflows, data entry

**Typical Actors:** User, Customer, Manager, Clerk, Admin, Agent, Operator

**Typical Actions:** fills form, reviews, approves, clicks, enters data, decides, selects

### 2. system-system

**Characteristics:**

- Automated system-to-system interactions
- No human intervention in the flow
- Focus on reliability, consistency, automated recovery
- Examples: API integration, data synchronization, batch processing, event-driven workflows

**Typical Actors:** System, API, Database, Service, Application, Bot, Gateway, Scheduler

**Typical Actions:** validates, processes, sends response, stores data, calculates, triggers, broadcasts, synchronizes

### 3. ambiguous

**Characteristics:**

- Cannot confidently determine domain
- Mixed or unclear actor types
- Generic descriptions without clear indicators

## Usage

### 1. Standalone Classification

```typescript
// Classify an existing use case
const useCase = await generateFlatUseCase({
  description: "Register arrival of a box from transport company",
  geminiFunctions,
});

const domainAnalysis = await classifyUseCaseDomain(useCase, geminiFunctions);

console.log(`Domain: ${domainAnalysis.dominantDomain}`);
console.log(`Confidence: ${domainAnalysis.overallConfidence}`);

// Per-flow analysis
domainAnalysis.flowClassifications.forEach((fc) => {
  console.log(`${fc.flowId}: ${fc.domainType} (${fc.confidence})`);
  console.log(`  ${fc.reasoning}`);
});
```

### 2. In Testing Framework

The `runHITLComparison` tool automatically classifies domain after baseline generation:

```typescript
const results = await runHITLComparison({
  datasetPath: "test-data/dataset-MO1.json",
  testCaseIds: ["MO1"],
});

// Results include domain metadata
results.forEach((r) => {
  console.log(`Baseline domain: ${r.conditionA_BaselineDomain.dominantDomain}`);
  console.log(`Detailed domain: ${r.conditionA_DetailedDomain.dominantDomain}`);
});
```

### 3. MCP Tool

```typescript
// Use the classifyUseCaseDomain tool
{
  "useCase": {
    "name": "Process Payment",
    "flows": [...],
    ...
  }
}
```

## Output Format

### UseCaseDomainAnalysis

```typescript
{
  "dominantDomain": "human-system",
  "overallConfidence": 0.85,
  "summary": "Human-initiated workflow with system processing steps",
  "flowClassifications": [
    {
      "flowId": "MAIN",
      "domainType": "human-system",
      "confidence": 0.9,
      "reasoning": "User submits payment details and system processes them",
      "actorTypes": [
        { "actor": "User", "type": "human" },
        { "actor": "Payment System", "type": "system" }
      ]
    },
    {
      "flowId": "EXC_1",
      "domainType": "system-system",
      "confidence": 0.8,
      "reasoning": "Automated retry logic between payment gateway and bank API",
      "actorTypes": [
        { "actor": "Payment Gateway", "type": "system" },
        { "actor": "Bank API", "type": "system" }
      ]
    }
  ]
}
```

## Evaluation by Domain

### Domain-Specific Metrics

You can analyze framework performance separately for each domain:

```typescript
// Group results by domain
const humanSystemCases = results.filter(
  (r) => r.conditionA_BaselineDomain.dominantDomain === "human-system",
);
const systemSystemCases = results.filter(
  (r) => r.conditionA_BaselineDomain.dominantDomain === "system-system",
);

// Compare metrics
console.log("Human-System Domain:");
console.log(`  Avg Discovery Rate: ${calculateAvgDiscovery(humanSystemCases)}`);

console.log("System-System Domain:");
console.log(
  `  Avg Discovery Rate: ${calculateAvgDiscovery(systemSystemCases)}`,
);
```

### Expected Domain Differences

| Aspect                  | Human-System                             | System-System                                            |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------- |
| **Exception Types**     | User errors, invalid input, cancellation | Timeouts, service unavailable, data conflicts            |
| **Recovery Patterns**   | Human re-entry, approval escalation      | Retry logic, circuit breakers, compensating transactions |
| **Blueprint Match**     | Approval chains, request lifecycle       | API integration, data sync, event-driven                 |
| **Discovery Challenge** | Implicit business rules                  | Technical failure modes                                  |

## Research Applications

### 1. Comparative Analysis

Compare framework effectiveness across domains:

```markdown
**Research Question:** Does the framework perform better on human-system or system-system use cases?

**Hypothesis:** Human-system cases benefit more from HITL because human-centric exceptions are harder for LLMs to infer automatically.

**Metrics:**

- Discovery rate improvement (Framework vs Baseline) by domain
- Blueprint activation rate by domain
- Question effectiveness by domain
```

### 2. Blueprint Validation

Verify that blueprints activate correctly by domain:

```typescript
// Check blueprint domain matching
for (const result of results) {
  const domain = result.conditionA_BaselineDomain.dominantDomain;
  const gapAnalysis = result.iterativeRefinement.iterations[0].gapAnalysis;

  const blueprintGaps = gapAnalysis.gaps.filter((g) =>
    g.type.startsWith("blueprint_"),
  );

  // Verify domain alignment
  blueprintGaps.forEach((gap) => {
    const blueprintId = gap.type.split("_")[1];
    const expectedDomain = getBlueprintDomain(blueprintId);

    if (expectedDomain !== domain) {
      console.warn(
        `Domain mismatch: ${blueprintId} (${expectedDomain}) in ${domain} use case`,
      );
    }
  });
}
```

### 3. Ablation Study

Test framework components by domain:

```markdown
| Condition               | Human-System  | System-System |
| ----------------------- | ------------- | ------------- |
| Baseline (no framework) | 25% discovery | 30% discovery |
| Blueprint only          | 45% discovery | 60% discovery |
| HITL only               | 65% discovery | 55% discovery |
| Full Framework          | 85% discovery | 80% discovery |

**Insight:** Blueprints contribute more to system-system cases, HITL contributes more to human-system cases.
```

## Confidence Scoring

### Interpretation

- **High (0.8-1.0)**: Clear indicators, confident classification
- **Medium (0.5-0.8)**: Some ambiguity but reasonable inference
- **Low (0.0-0.5)**: Uncertain, may need manual review

### Low Confidence Indicators

- Generic actor names ("Handler", "Processor")
- Ambiguous actions ("processes the request")
- Mixed patterns within same flow
- Insufficient context in descriptions

## Future Enhancements

### 1. Actor Type Training Data

Build a semantic classifier for actor types:

```typescript
const humanActorCentroid = computeCentroid([
  "user clicks button",
  "customer fills form",
  "manager reviews request",
]);

const systemActorCentroid = computeCentroid([
  "system validates data",
  "API retrieves information",
  "database stores record",
]);
```

### 2. Domain-Specific Blueprint Filtering

Only apply relevant blueprints based on detected domain:

```typescript
const blueprints = await loadBlueprints();
const relevantBlueprints = blueprints.filter(
  (bp) => bp.domainType === detectedDomain || bp.domainType === "universal",
);
```

### 3. Cross-Domain Flow Detection

Identify flows that transition between domains:

```typescript
// Example: Human initiates (human-system) → Automated processing (system-system)
{
  "flowId": "MAIN",
  "domainTransitions": [
    { "stepRange": [1, 3], "domain": "human-system" },
    { "stepRange": [4, 7], "domain": "system-system" }
  ]
}
```

## Best Practices

### DO:

✅ Classify domain AFTER baseline generation  
✅ Use domain metadata for analysis/filtering  
✅ Compare framework performance by domain  
✅ Validate blueprint activation against detected domain

### DON'T:

❌ Modify baseline based on domain classification  
❌ Use domain info during baseline generation  
❌ Assume all flows in a use case have the same domain  
❌ Ignore low-confidence classifications without review

## Troubleshooting

### Issue: All flows classified as "ambiguous"

**Cause:** Generic actor names and descriptions in baseline  
**Solution:**

- Review baseline quality
- Add more specific actor name patterns to classification prompt
- Lower confidence threshold for classification

### Issue: Domain mismatch between vague and detailed inputs

**Cause:** Detailed input reveals different interaction patterns  
**Solution:**

- This is expected! It shows what information was missing from vague input
- Document as a finding: "Vague input led to wrong domain assumptions"

### Issue: Blueprint not activating for correct domain

**Cause:** Blueprint role keywords don't match use case vocabulary  
**Solution:**

- Expand role keywords in `blueprints.json`
- Use semantic matching instead of keyword matching (already implemented)
- Add domain-specific role definitions

## Summary

Domain classification is a powerful analysis tool that:

1. Maintains baseline integrity (post-processing)
2. Enables domain-specific evaluation
3. Validates blueprint applicability
4. Provides insights into framework strengths by domain type

Use it to understand **where** your framework adds most value!
