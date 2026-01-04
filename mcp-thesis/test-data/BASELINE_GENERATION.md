# Baseline Generation Instructions

## Purpose

Generate a baseline use case from vague input that will be used consistently across all framework comparison tests.

## Why Pre-Generate?

1. **Consistency**: All test conditions (Baseline and Framework) start from the SAME use case
2. **Reproducibility**: Same baseline across multiple test runs
3. **Fair Comparison**: Tests if framework improves a specific extraction, not just any extraction
4. **Speed**: No redundant LLM calls during testing

## How to Generate

### Step 1: Extract Use Case

```typescript
mcp_mcp-thesis_extractUseCase({
  input: "Register arrival of a box from transport company"
})
```

### Step 2: Save the Output

Copy the generated use case and save it as `test-data/baseline-MO1.json`:

```json
{
  "useCase": {
    "name": "Register Arrival of a Box",
    "summary": "Receiving Agent receives a box from transport company and registers its arrival",
    "mainActor": "Receiving Agent",
    "actors": ["Receiving Agent", "Transport Company", "System"],
    "preconditions": [
      "Transport company has delivered the box",
      "System is operational"
    ],
    "postconditions": [
      "Box arrival is registered in system"
    ],
    "flows": [
      {
        "id": "MAIN",
        "kind": "MAIN",
        "steps": [
          {
            "index": 1,
            "actor": "Receiving Agent",
            "target": "Transport Company",
            "description": "Receives box from transport company"
          },
          {
            "index": 2,
            "actor": "Receiving Agent",
            "target": "System",
            "description": "Validates box ID"
          },
          {
            "index": 3,
            "actor": "Receiving Agent",
            "target": "System",
            "description": "Registers arrival into system"
          }
        ]
      }
    ]
  }
}
```

**Note**: The baseline will typically only have the MAIN flow (no exception flows). This is expected - the framework's job is to discover the missing exception flows.

### Step 3: Verify Baseline Quality

Check that the baseline:
- ✅ Has valid MAIN flow with 3-5 steps
- ✅ Includes main actors
- ✅ Has reasonable step descriptions
- ✅ Follows the use case schema
- ❌ Should NOT have exception flows (framework will add these)

### Step 4: Use in Testing

```typescript
mcp_mcp-thesis_runFrameworkComparison({
  datasetPath: "test-data/dataset-2026-01-03T15-38-47-205Z.json",
  baselinePath: "test-data/baseline-MO1.json",  // Your pre-generated baseline
  includeIntermediateResults: true
})
```

## Expected Baseline Characteristics

For MO1 test case, the baseline should:

- **Main Flow**: 3-5 steps covering:
  1. Receive box from transport company
  2. Validate box ID
  3. Register arrival
  4. (Maybe) Sign paper form
  5. (Maybe) Take to registration operator

- **Actors**: Receiving Agent, Transport Company, System

- **Missing Components** (to be discovered by framework):
  - Exception flow for validation failure
  - Exception flow for system unavailability
  - Exception flow for fire alarm interruption
  - Proper preconditions/postconditions

## Multiple Test Cases

For multiple test cases, generate separate baseline files:

```
test-data/
  baseline-MO1.json    # Box registration
  baseline-UC2.json    # Login use case
  baseline-UC3.json    # Order processing
  ...
```

## Regenerating Baseline

If you need to regenerate:
1. Delete the old baseline file
2. Run `extractUseCase` again
3. Save new output
4. **Important**: Previous test results used the old baseline and are not directly comparable

## Troubleshooting

### Issue: Baseline has exception flows
**Problem**: extractUseCase included exception flows from vague input
**Solution**: This is actually fine - it shows the baseline LLM can sometimes infer exceptions. The framework should still improve upon it.

### Issue: Baseline quality is poor
**Problem**: Baseline has < 3 steps or invalid structure
**Solution**: Regenerate with clearer vague input or manually fix the baseline JSON

### Issue: Can't load baseline during testing
**Problem**: File path incorrect or JSON malformed
**Solution**: 
- Check file path: `test-data/baseline-MO1.json`
- Validate JSON syntax
- Ensure `useCase` wrapper is present (or tool accepts both formats)

