---
name: HITL Research Framework
overview: Build a cost-effective research framework to test COVE with detailed input and compare against constrained HITL approach, with proper dataset preparation and three-tier evaluation.
todos:
  - id: dataset-prep
    content: "Prepare test dataset: Create 10 test cases with vague/detailed/ground truth, validate with prepareTestData tool"
    status: pending
  - id: phase1-cove
    content: "Phase 1: Implement and run COVE comparison (vague vs detailed input) on 10 test cases"
    status: pending
    dependencies:
      - dataset-prep
  - id: hitl-mc-questions
    content: "Phase 2: Convert existing question generation to multiple-choice format in llm.validator.ts"
    status: pending
    dependencies:
      - dataset-prep
  - id: hitl-expert-answers
    content: "Phase 2: Implement expert answering with detailed knowledge (information asymmetry)"
    status: pending
    dependencies:
      - hitl-mc-questions
  - id: hitl-constrained-refine
    content: "Phase 2: Implement constrained refinement (only incorporate asked/answered items)"
    status: pending
    dependencies:
      - hitl-expert-answers
  - id: hitl-tool
    content: "Phase 2: Build extractUseCaseWithConstrainedHITL tool and comparison runner"
    status: pending
    dependencies:
      - hitl-constrained-refine
  - id: three-tier-eval
    content: "Phase 3: Implement three-tier evaluation (grounded/logical/hallucination) system"
    status: pending
    dependencies:
      - phase1-cove
      - hitl-tool
  - id: run-evaluation
    content: "Phase 3: Run evaluation on all test results (Phase 1 + Phase 2)"
    status: pending
    dependencies:
      - three-tier-eval
  - id: statistical-analysis
    content: "Phase 4: Calculate aggregate statistics and generate comparison tables for thesis"
    status: pending
    dependencies:
      - run-evaluation
---

# Research Framework: COVE vs Constrained HITL

## Overview

This plan implements a minimal, cost-effective research framework to answer two key questions:

1. **Does detailed input help or hurt COVE?** (might hallucinate more with too much info)
2. **Does constrained HITL beat COVE when branches are clear but steps are vague?**

Key innovation: HITL uses **information asymmetry** (Generator has vague input, Expert has detailed) and **constrained multiple-choice questions** to reduce hallucination compared to COVE's open-ended improvement.---

## Phase 0: Dataset Preparation (PRIORITY)

### Objective

Create a validated test dataset with proper structure for reproducible experiments.

### Tool: `prepareTestData`

**Location:** [`mcp-thesis/src/tools/testingTools.ts`](mcp-thesis/src/tools/testingTools.ts) (new file)**Implementation:**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { writeFile } from "fs/promises";

export function registerTestingTools(server: McpServer) {
  server.registerTool(
    "prepareTestData",
    {
      title: "Prepare Test Dataset",
      description: "Convert raw test cases into validated dataset format for experiments",
      inputSchema: {
        testCases: z.array(z.object({
          testCaseId: z.string(),
          domain: z.string(),
          vagueSummary: z.string().describe("Short user-level summary (MAIN flow only)"),
          detailedDescription: z.string().describe("Expert-level description with all flows"),
          groundTruthJson: z.string().describe("Complete GenUseCase JSON as string"),
          complexity: z.enum(["simple", "medium", "complex"]).optional(),
          notes: z.string().optional()
        }))
      },
      outputSchema: {
        validated: z.array(z.object({
          id: z.string(),
          status: z.enum(["valid", "invalid"]),
          errors: z.array(z.string()).optional()
        })),
        outputFile: z.string()
      }
    },
    async ({ testCases }) => {
      const validated = [];
      const testDataset = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        description: "Test dataset for COVE vs HITL research",
        testCases: []
      };

      for (const tc of testCases) {
        try {
          // Parse and validate ground truth
          let groundTruth;
          try {
            groundTruth = JSON.parse(tc.groundTruthJson);
          } catch (e) {
            throw new Error(`Invalid JSON in groundTruthJson: ${e.message}`);
          }

          // Validate against GenUseCase schema
          const validatedTruth = genUseCaseSchema.parse(groundTruth);

          // Create validated test case entry
          testDataset.testCases.push({
            id: tc.testCaseId,
            domain: tc.domain,
            metadata: {
              complexity: tc.complexity || "medium",
              expectedFlows: validatedTruth.flows.length,
              expectedSteps: validatedTruth.flows.reduce((sum, f) => sum + f.steps.length, 0),
              notes: tc.notes,
              createdAt: new Date().toISOString()
            },
            inputs: {
              vague: tc.vagueSummary,
              detailed: tc.detailedDescription
            },
            groundTruth: validatedTruth
          });

          validated.push({
            id: tc.testCaseId,
            status: "valid",
            errors: []
          });

        } catch (error) {
          validated.push({
            id: tc.testCaseId,
            status: "invalid",
            errors: [error.message]
          });
        }
      }

      // Write to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = `test-data/dataset-${timestamp}.json`;
      await writeFile(
        outputPath,
        JSON.stringify(testDataset, null, 2)
      );

      const validCount = validated.filter(v => v.status === "valid").length;
      const invalidCount = validated.filter(v => v.status === "invalid").length;

      return {
        content: [{
          type: "text",
          text: `✅ Test dataset prepared!
          
Valid: ${validCount}/${testCases.length}
Invalid: ${invalidCount}/${testCases.length}

Output: ${outputPath}

${invalidCount > 0 ? `\nInvalid cases:\n${validated.filter(v => v.status === "invalid").map(v => `- ${v.id}: ${v.errors.join(', ')}`).join('\n')}` : ''}`
        }],
        structuredContent: {
          validated,
          outputFile: outputPath
        }
      };
    }
  );
}
```

**File Structure:**

```javascript
mcp-thesis/
├── test-data/
│   ├── dataset-2026-01-03.json    # Validated test dataset
│   └── results/
│       ├── phase1-cove-comparison.json
│       └── phase2-hitl-comparison.json
```

**Dataset Format:**

```json
{
  "version": "1.0",
  "createdAt": "2026-01-03T...",
  "description": "Test dataset for COVE vs HITL research",
  "testCases": [
    {
      "id": "UC-001",
      "domain": "Logistics",
      "metadata": {
        "complexity": "medium",
        "expectedFlows": 4,
        "expectedSteps": 18,
        "notes": "Box receiving with exceptions"
      },
      "inputs": {
        "vague": "RA receives box, validates ID, unpacks bags",
        "detailed": "Receiving Agent accepts boxes... [full description with all flows]"
      },
      "groundTruth": { /* GenUseCase JSON */ }
    }
  ]
}
```

**Action Items:**

1. Register testing tools in [`mcp-thesis/src/index.ts`](mcp-thesis/src/index.ts)
2. Create [`test-data/`](test-data/) directory
3. Prepare 10 test cases from your existing data
4. Run `prepareTestData` tool to validate and structure dataset

---

## Phase 1: Test COVE with Detailed Input

### Research Question

Does providing detailed input to COVE improve quality, or does it cause more hallucination?

### Hypothesis

Detailed input might cause COVE to over-elaborate and invent more edge cases, despite having better information.

### Implementation

**No new tools needed** - use existing `extractUseCase` and `improveUseCase`

### Test Conditions

**Condition A: COVE + Vague Input (Baseline)**

- Input: `testCase.inputs.vague`
- Process: Extract → Validate → Improve
- Expected: Some hallucination, incomplete coverage

**Condition B: COVE + Detailed Input (Test)**

- Input: `testCase.inputs.detailed`
- Process: Extract → Validate → Improve
- Expected: Either better (leverages info) OR worse (over-elaborates)

### Execution Tool: `runCOVEComparison`

**Location:** [`mcp-thesis/src/tools/testingTools.ts`](mcp-thesis/src/tools/testingTools.ts)

```typescript
server.registerTool(
  "runCOVEComparison",
  {
    title: "Run COVE Comparison (Phase 1)",
    description: "Compare COVE with vague vs detailed input",
    inputSchema: {
      datasetPath: z.string().describe("Path to test dataset JSON"),
      testCaseIds: z.array(z.string()).optional().describe("Specific test case IDs, or all if omitted"),
      saveResults: z.boolean().default(true)
    }
  },
  async ({ datasetPath, testCaseIds, saveResults }) => {
    const dataset = JSON.parse(await readFile(datasetPath, 'utf-8'));
    const testCases = testCaseIds 
      ? dataset.testCases.filter(tc => testCaseIds.includes(tc.id))
      : dataset.testCases;
    
    const results = [];
    
    for (const tc of testCases) {
      console.log(`Processing ${tc.id}...`);
      
      // Condition A: COVE + Vague
      const extractedVague = await extractUseCase(tc.inputs.vague);
      const validationVague = await validateUseCase({
        originalDescription: tc.inputs.vague,
        useCase: extractedVague
      });
      const improvedVague = validationVague.needsImprovement
        ? await improveUseCase({
            originalDescription: tc.inputs.vague,
            baseUseCase: extractedVague,
            improvementQuestions: validationVague.feedback
          })
        : extractedVague;
      
      // Condition B: COVE + Detailed
      const extractedDetailed = await extractUseCase(tc.inputs.detailed);
      const validationDetailed = await validateUseCase({
        originalDescription: tc.inputs.detailed,
        useCase: extractedDetailed
      });
      const improvedDetailed = validationDetailed.needsImprovement
        ? await improveUseCase({
            originalDescription: tc.inputs.detailed,
            baseUseCase: extractedDetailed,
            improvementQuestions: validationDetailed.feedback
          })
        : extractedDetailed;
      
      results.push({
        testCaseId: tc.id,
        conditionA_COVEVague: improvedVague,
        conditionB_COVEDetailed: improvedDetailed,
        groundTruth: tc.groundTruth
      });
    }
    
    if (saveResults) {
      const outputPath = `test-data/results/phase1-${Date.now()}.json`;
      await writeFile(outputPath, JSON.stringify(results, null, 2));
    }
    
    return { results };
  }
);
```

---

## Phase 2: Constrained HITL Implementation

### Research Question

When branches are clear but steps are vague, does constrained HITL beat COVE's open-ended improvement?

### Key Innovation: Information Asymmetry + Constrained Questions

**Generator LLM:** Only has vague input, generates draft**Expert LLM:** Has detailed description, answers multiple-choice questions**Constraint:** Generator can ONLY incorporate what was explicitly asked and answered

### Implementation

#### Step 1: Convert Open Questions to Multiple Choice

**Location:** [`mcp-thesis/src/validators/llm.validator.ts`](mcp-thesis/src/validators/llm.validator.ts)**Modify existing `generateLLMQuestions` to support MC format:**

```typescript
export async function generateMultipleChoiceQuestions(
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  apiKey: string,
  openrouterApiKey: string
): Promise<Array<{
  id: string;
  question: string;
  options: string[];
  context: string;
}>> {
  const geminiFunctions = new GeminiOpenRouterFunctions(apiKey, openrouterApiKey);
  
  // Reuse existing COVE_LLM_QUESTIONS as inspiration
  const baseQuestions = COVE_LLM_QUESTIONS.map(q => `- ${q}`);
  
  const mcSchema = z.array(z.object({
    id: z.string(),
    question: z.string(),
    options: z.array(z.string()).min(2).max(5),
    context: z.string()
  }));

  const prompt = `
<task>
You are conducting a structured use case interview.
Convert the validation feedback into 3-5 SPECIFIC multiple-choice questions.
</task>

<originalDescription>
${originalDescription}
</originalDescription>

<currentUseCase>
${JSON.stringify(useCase, null, 2)}
</currentUseCase>

<validationFeedback>
${formattedValidationFeedback}
</validationFeedback>

<inspirationQuestions>
${baseQuestions.join('\n')}
</inspirationQuestions>

<guidelines>
Generate multiple-choice questions for ambiguities:

1. **Actor Responsibility**: "Who performs X?" with specific options
2. **Flow Branching**: "When Y happens, what should occur?" with 2-4 scenarios
3. **Step Details**: "How does the agent validate?" with specific methods
4. **Exception Handling**: "If Z fails, the agent should:" with clear alternatives

GOOD Question Format:
Q: "When box ID validation fails, the Receiving Agent should:"
A) Immediately reject the box and return it to Transport Company
B) Notify Department Supervisor and wait for instructions
C) Retry validation up to 3 times before escalating
D) Quarantine the box and continue with other deliveries

BAD Questions:
- Yes/no questions (too limiting)
- Open-ended "What happens if..." (defeats purpose of constraints)
- More than 5 options (overwhelming)

Generate 3-5 questions maximum. Each question should clarify ONE specific ambiguity.
</guidelines>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: mcSchema
  });
}
```



#### Step 2: Expert Answers Questions

**New function in [`mcp-thesis/src/validators/llm.validator.ts`](mcp-thesis/src/validators/llm.validator.ts):**

```typescript
export async function expertAnswerMultipleChoice(
  questions: Array<{id: string; question: string; options: string[]; context: string}>,
  detailedDescription: string,
  domain: string,
  apiKey: string,
  openrouterApiKey: string
): Promise<Array<{questionId: string; selectedOption: string; reasoning: string}>> {
  const geminiFunctions = new GeminiOpenRouterFunctions(apiKey, openrouterApiKey);
  
  const answerSchema = z.array(z.object({
    questionId: z.string(),
    selectedOption: z.string(),
    reasoning: z.string()
  }));

  const prompt = `
<role>
You are a Senior Business Analyst with expertise in ${domain}.
You have detailed knowledge about this use case.
</role>

<detailedDescription>
${detailedDescription}
</detailedDescription>

<questions>
${questions.map((q, i) => `
Question ${i+1} (ID: ${q.id}):
${q.question}

Options:
${q.options.map((opt, j) => `${String.fromCharCode(65 + j)}) ${opt}`).join('\n')}

Context: ${q.context}
`).join('\n---\n')}
</questions>

<instructions>
For each question:
1. Check if the answer is explicitly in the detailed description
2. If yes, select that option and cite the relevant text
3. If not explicitly stated, use your domain expertise to select the most reasonable option
4. Provide brief reasoning (1-2 sentences)

Output format: Array of {questionId, selectedOption, reasoning}
</instructions>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: answerSchema
  });
}
```



#### Step 3: Constrained Refinement

**New function in [`mcp-thesis/src/services/usecase.service.ts`](mcp-thesis/src/services/usecase.service.ts):**

```typescript
export async function refineWithConstrainedAnswers(
  originalDescription: string,
  baseUseCase: GenUseCase,
  questions: Array<{id: string; question: string; options: string[]}>,
  answers: Array<{questionId: string; selectedOption: string; reasoning: string}>,
  apiKey: string,
  openrouterApiKey: string
): Promise<GenUseCase> {
  const geminiFunctions = new GeminiOpenRouterFunctions(apiKey, openrouterApiKey);
  
  const qaContext = questions.map(q => {
    const answer = answers.find(a => a.questionId === q.id);
    return `Q: ${q.question}\nA: ${answer.selectedOption}\nReason: ${answer.reasoning}`;
  }).join('\n\n');

  const prompt = `
<task>
Refine the use case by incorporating ONLY the information from the question-answer pairs.
</task>

<original_description>
${originalDescription}
</original_description>

<base_use_case>
${JSON.stringify(baseUseCase, null, 2)}
</base_use_case>

<clarifications>
${qaContext}
</clarifications>

<critical_constraints>
1. ONLY add or modify based on the clarifications provided
2. Do NOT invent scenarios beyond what was asked and answered
3. Do NOT elaborate beyond the selected options
4. If a flow/step was clarified, update it; otherwise keep it unchanged
5. Maintain consistency with the original description

Example:
- Question asked about "What happens if ID invalid?"
- Answer selected: "Notify supervisor"
- You may add: Alternative flow with "Notify supervisor" step
- You may NOT add: Additional steps like "Quarantine box", "Call security", etc.
</critical_constraints>

<output>
Return the refined GenUseCase JSON.
</output>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema
  });
}
```



#### Step 4: HITL Tool

**Location:** [`mcp-thesis/src/tools/usecaseTools.ts`](mcp-thesis/src/tools/usecaseTools.ts)

```typescript
server.registerTool(
  "extractUseCaseWithConstrainedHITL",
  {
    title: "Extract Use Case with Constrained HITL",
    description: "Interactive extraction with information asymmetry and multiple-choice constraints",
    inputSchema: {
      vagueSummary: z.string(),
      expertKnowledge: z.string().describe("Detailed description (expert has this, generator doesn't)"),
      domain: z.string().default("General")
    },
    outputSchema: {
      finalUseCase: genUseCaseSchema,
      questionsAsked: z.array(z.object({
        question: z.string(),
        selectedOption: z.string()
      }))
    }
  },
  async ({ vagueSummary, expertKnowledge, domain }) => {
    // Step 1: Generator (only has vague) creates draft
    const draft = await extractUseCase(vagueSummary);
    
    // Step 2: Validate and generate MC questions
    const validation = await validateUseCase({
      originalDescription: vagueSummary,
      useCase: draft
    });
    
    const formattedFeedback = formatValidationForLLM(validation);
    
    const mcQuestions = await generateMultipleChoiceQuestions(
      vagueSummary,
      draft,
      formattedFeedback,
      geminiApiKey,
      openrouterApiKey
    );
    
    // Step 3: Expert (has detailed knowledge) answers
    const answers = await expertAnswerMultipleChoice(
      mcQuestions,
      expertKnowledge,
      domain,
      geminiApiKey,
      openrouterApiKey
    );
    
    // Step 4: Generator refines with constraints
    const refined = await refineWithConstrainedAnswers(
      vagueSummary,
      draft,
      mcQuestions,
      answers,
      geminiApiKey,
      openrouterApiKey
    );
    
    return {
      content: [{
        type: "text",
        text: `✅ Use case extracted with constrained HITL
        
Questions asked: ${mcQuestions.length}
Refined use case ready for evaluation.`
      }],
      structuredContent: {
        finalUseCase: refined,
        questionsAsked: mcQuestions.map((q, i) => ({
          question: q.question,
          selectedOption: answers[i].selectedOption
        }))
      }
    };
  }
);
```



#### Step 5: Comparison Tool

**Location:** [`mcp-thesis/src/tools/testingTools.ts`](mcp-thesis/src/tools/testingTools.ts)

```typescript
server.registerTool(
  "runHITLComparison",
  {
    title: "Run HITL vs COVE Comparison (Phase 2)",
    description: "Compare constrained HITL against COVE with detailed input",
    inputSchema: {
      datasetPath: z.string(),
      testCaseIds: z.array(z.string()).optional()
    }
  },
  async ({ datasetPath, testCaseIds }) => {
    const dataset = JSON.parse(await readFile(datasetPath, 'utf-8'));
    const testCases = testCaseIds 
      ? dataset.testCases.filter(tc => testCaseIds.includes(tc.id))
      : dataset.testCases;
    
    const results = [];
    
    for (const tc of testCases) {
      // Condition C: COVE + Detailed (from Phase 1 or re-run)
      const coveResult = await extractAndImprove(tc.inputs.detailed);
      
      // Condition D: HITL + Constrained
      const hitlResult = await extractUseCaseWithConstrainedHITL({
        vagueSummary: tc.inputs.vague,
        expertKnowledge: tc.inputs.detailed,
        domain: tc.domain
      });
      
      results.push({
        testCaseId: tc.id,
        conditionC_COVEDetailed: coveResult,
        conditionD_HITL: hitlResult,
        groundTruth: tc.groundTruth
      });
    }
    
    const outputPath = `test-data/results/phase2-${Date.now()}.json`;
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    
    return { results, outputPath };
  }
);
```

---

## Phase 3: Three-Tier Evaluation System

### Evaluation Categories

**GROUNDED (Score 1.0):** Flow/step explicitly mentioned in input**LOGICAL (Score 0.7):** Not in input, but logically sound for domain**HALLUCINATION (Score 0.0):** Neither grounded nor logical

### Implementation

**Location:** [`mcp-thesis/src/evaluators/three-tier.evaluator.ts`](mcp-thesis/src/evaluators/three-tier.evaluator.ts) (new file)

```typescript
import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import { z } from "zod";

const flowEvaluationSchema = z.object({
  category: z.enum(["grounded", "logical", "hallucination"]),
  score: z.number(),
  reasoning: z.string(),
  inVagueSummary: z.boolean(),
  inDetailedDescription: z.boolean().optional(),
  inGroundTruth: z.boolean(),
  logicalJustification: z.string().optional()
});

export async function evaluateFlow(
  flow: GenFlow,
  context: {
    vagueSummary: string;
    detailedDescription?: string;
    groundTruth: GenUseCase;
    domain: string;
  },
  apiKey: string,
  openrouterApiKey: string
) {
  const geminiFunctions = new GeminiOpenRouterFunctions(apiKey, openrouterApiKey);
  
  const prompt = `
<task>
Evaluate if this generated flow is GROUNDED, LOGICAL, or HALLUCINATION.
</task>

<definitions>
1. GROUNDED (score 1.0): Flow explicitly mentioned in the description
2. LOGICAL (score 0.7): Not in description, but logically sound for ${context.domain}
3. HALLUCINATION (score 0.0): Neither grounded nor logical
</definitions>

<context>
Domain: ${context.domain}

Vague Summary:
${context.vagueSummary}

${context.detailedDescription ? `Detailed Description:\n${context.detailedDescription}\n` : ''}

Ground Truth Flows (for reference):
${context.groundTruth.flows.map(f => `- ${f.id} (${f.kind}): ${f.condition || 'Main flow'}`).join('\n')}
</context>

<generated_flow>
Flow ID: ${flow.id}
Flow Kind: ${flow.kind}
Condition: ${flow.condition || 'N/A'}
Steps (${flow.steps.length}): ${flow.steps.map(s => s.description).join('; ')}
</generated_flow>

<evaluation_process>
Step 1: Check if mentioned in vague OR detailed description
  → If YES: GROUNDED

Step 2: If not grounded, check logical soundness:
    - Are actors in this flow from the description?
    - Is scenario relevant to the core process?
    - Is this a common edge case in ${context.domain}?
  → If ALL YES: LOGICAL

Step 3: Otherwise: HALLUCINATION

Step 4: Check if this flow exists in ground truth (for reference only)
</evaluation_process>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: flowEvaluationSchema
  });
}

export async function evaluateUseCase(
  useCase: GenUseCase,
  context: {
    vagueSummary: string;
    detailedDescription?: string;
    groundTruth: GenUseCase;
    domain: string;
  },
  apiKey: string,
  openrouterApiKey: string
) {
  const flowEvaluations = [];
  
  // Evaluate each flow
  for (const flow of useCase.flows) {
    const eval = await evaluateFlow(flow, context, apiKey, openrouterApiKey);
    flowEvaluations.push({
      flowId: flow.id,
      ...eval
    });
  }
  
  // Calculate metrics
  const grounded = flowEvaluations.filter(f => f.category === "grounded");
  const logical = flowEvaluations.filter(f => f.category === "logical");
  const hallucinations = flowEvaluations.filter(f => f.category === "hallucination");
  
  const qualityScore = flowEvaluations.length > 0
    ? (grounded.length * 1.0 + logical.length * 0.7 + hallucinations.length * 0.0) / flowEvaluations.length
    : 0;
  
  // Discovery metrics
  const discoveredFlows = flowEvaluations.filter(f => f.inGroundTruth);
  const discoveryRate = context.groundTruth.flows.length > 0
    ? discoveredFlows.length / context.groundTruth.flows.length
    : 0;
  
  // Precision & Recall
  const precision = flowEvaluations.length > 0
    ? (grounded.length + logical.length) / flowEvaluations.length
    : 0;
  const recall = discoveryRate;
  const f1Score = (precision + recall) > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;
  
  return {
    totalFlows: flowEvaluations.length,
    breakdown: {
      grounded: grounded.length,
      logical: logical.length,
      hallucinations: hallucinations.length
    },
    scores: {
      qualityScore,
      discoveryRate,
      precision,
      recall,
      f1Score
    },
    flowDetails: flowEvaluations
  };
}
```



### Evaluation Tool

**Location:** [`mcp-thesis/src/tools/testingTools.ts`](mcp-thesis/src/tools/testingTools.ts)

```typescript
server.registerTool(
  "evaluateResults",
  {
    title: "Evaluate Test Results",
    description: "Run three-tier evaluation on test results",
    inputSchema: {
      resultsPath: z.string().describe("Path to results JSON from runCOVEComparison or runHITLComparison")
    }
  },
  async ({ resultsPath }) => {
    const results = JSON.parse(await readFile(resultsPath, 'utf-8'));
    const evaluations = [];
    
    for (const result of results) {
      const testCase = /* load from dataset */;
      
      // Evaluate each condition
      const conditionEvals = {};
      
      for (const [conditionName, useCase] of Object.entries(result)) {
        if (conditionName === 'testCaseId' || conditionName === 'groundTruth') continue;
        
        conditionEvals[conditionName] = await evaluateUseCase(
          useCase,
          {
            vagueSummary: testCase.inputs.vague,
            detailedDescription: testCase.inputs.detailed,
            groundTruth: testCase.groundTruth,
            domain: testCase.domain
          },
          geminiApiKey,
          openrouterApiKey
        );
      }
      
      evaluations.push({
        testCaseId: result.testCaseId,
        evaluations: conditionEvals
      });
    }
    
    // Calculate aggregate statistics
    const summary = calculateAggregateStats(evaluations);
    
    const outputPath = resultsPath.replace('.json', '-evaluated.json');
    await writeFile(outputPath, JSON.stringify({ evaluations, summary }, null, 2));
    
    return { evaluations, summary, outputPath };
  }
);
```

---

## Phase 4: Statistical Analysis

### Metrics to Report

**For Phase 1 (COVE Comparison):**

- Quality Score: A vs B
- Hallucination Rate: A vs B
- Discovery Rate: A vs B
- Statistical significance (paired t-test)

**For Phase 2 (HITL vs COVE):**

- Quality Score: C vs D
- Hallucination Rate: C vs D
- Precision/Recall/F1: C vs D
- Effect size (Cohen's d)

### Analysis Helper

**Location:** [`mcp-thesis/src/evaluators/statistics.ts`](mcp-thesis/src/evaluators/statistics.ts) (new file)

```typescript
export function calculateAggregateStats(evaluations: any[]) {
  const conditionNames = Object.keys(evaluations[0].evaluations);
  const stats = {};
  
  for (const condition of conditionNames) {
    const scores = evaluations.map(e => e.evaluations[condition].scores);
    
    stats[condition] = {
      qualityScore: {
        mean: mean(scores.map(s => s.qualityScore)),
        std: std(scores.map(s => s.qualityScore))
      },
      hallucinationRate: {
        mean: mean(evaluations.map(e => 
          e.evaluations[condition].breakdown.hallucinations / e.evaluations[condition].totalFlows
        )),
        std: std(evaluations.map(e => 
          e.evaluations[condition].breakdown.hallucinations / e.evaluations[condition].totalFlows
        ))
      },
      discoveryRate: {
        mean: mean(scores.map(s => s.discoveryRate)),
        std: std(scores.map(s => s.discoveryRate))
      },
      f1Score: {
        mean: mean(scores.map(s => s.f1Score)),
        std: std(scores.map(s => s.f1Score))
      }
    };
  }
  
  return stats;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / arr.length);
}
```

---

## Cost Optimization

### Minimal Test Run

- **10 test cases**
- **Phase 1:** 2 conditions × 10 cases = 20 extractions + 20 improvements = 40 calls
- **Phase 2:** 1 condition (HITL) × 10 cases = 10 extractions + 10 refinements = 20 calls
- **Evaluation:** 30 use cases × 3-5 flows each × 1 eval per flow ≈ 120 calls
- **Total: ~180 API calls**

### Further Optimization

- Use cheaper model (Gemini Flash) for evaluation
- Cache Phase 1 results for Phase 2
- Batch API calls where possible

---

## Implementation Checklist

**Phase 0: Dataset Preparation**

- [ ] Create `src/tools/testingTools.ts`
- [ ] Implement `prepareTestData` tool
- [ ] Register in `src/index.ts`
- [ ] Create `test-data/` directory structure
- [ ] Prepare 10 test cases with vague + detailed + ground truth
- [ ] Validate all test cases using the tool

**Phase 1: COVE Testing**

- [ ] Implement `runCOVEComparison` tool
- [ ] Run on 10 test cases (Condition A vs B)
- [ ] Save results to `test-data/results/`

**Phase 2: HITL Implementation**

- [ ] Add `generateMultipleChoiceQuestions` to `llm.validator.ts`
- [ ] Add `expertAnswerMultipleChoice` to `llm.validator.ts`
- [ ] Add `refineWithConstrainedAnswers` to `usecase.service.ts`
- [ ] Implement `extractUseCaseWithConstrainedHITL` tool
- [ ] Implement `runHITLComparison` tool
- [ ] Run on same 10 test cases (Condition C vs D)

**Phase 3: Evaluation**

- [ ] Create `src/evaluators/three-tier.evaluator.ts`
- [ ] Implement `evaluateFlow` function
- [ ] Implement `evaluateUseCase` function
- [ ] Implement `evaluateResults` tool
- [ ] Run evaluation on both Phase 1 and Phase 2 results

**Phase 4: Analysis**

- [ ] Create `src/evaluators/statistics.ts`
- [ ] Implement aggregate statistics calculation
- [ ] Generate comparison tables (A vs B, C vs D)
- [ ] Document findings for thesis

---

## Expected Outcomes

### If COVE-Detailed > COVE-Vague:

✅ Detailed input helps COVE leverage context✅ Opens research question: Can HITL do even better?

### If COVE-Detailed ≈ COVE-Vague:

✅ Input quality doesn't significantly affect COVE✅ HITL must provide different value (constraint, not just info)

### If HITL > COVE-Detailed:

✅ Constrained elicitation reduces hallucination✅ Information asymmetry + MC questions = winning combination✅ Strong thesis contribution

### If HITL ≈ COVE-Detailed:

✅ COVE sufficient when input is good✅ HITL valuable only for vague inputs or cost constraints---