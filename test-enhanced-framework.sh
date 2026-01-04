#!/bin/bash

# Test the enhanced framework on HC1 and MO1 test cases

echo "=========================================="
echo "Testing Enhanced Framework"
echo "=========================================="
echo ""
echo "This will run the enhanced iterative HITL framework on HC1 and MO1 test cases."
echo "Expected: 80%+ discovery rate (6-7/8 flows for HC1, 3-4/4 flows for MO1)"
echo ""

cd /Users/arya/Documents/code/mcp-thesis/mcp-thesis

# Run the HITL comparison with the enhanced framework
echo "Running HITL comparison with iterative refinement..."
echo ""

# Note: This requires the MCP server to be running
# The test will use the dataset and run on HC1 and MO1

echo "Dataset: test-data/dataset-2026-01-04T08-04-45-215Z.json"
echo "Test cases: HC1, MO1"
echo ""
echo "To run this test, use the MCP tool 'runHITLComparison' with:"
echo "  datasetPath: test-data/dataset-2026-01-04T08-04-45-215Z.json"
echo "  testCaseIds: [\"HC1\", \"MO1\"]"
echo ""
echo "Then evaluate the results with 'evaluateResults' tool."
echo ""
echo "Expected enhancements:"
echo "  1. 7 new gap detection patterns"
echo "  2. Uncertainty × Criticality priority ranking"
echo "  3. Iterative refinement (2-5 iterations, 8-20 questions)"
echo "  4. Multi-flow and nested exception extraction"
echo "  5. Discovery rate: 80%+ (vs. baseline 25-50%)"
echo ""

