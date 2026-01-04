---
name: Implementation Plan HITL
overview: Step-by-step implementation plan for building test data preparation, COVE detailed input testing, and constrained HITL system with three-tier evaluation.
todos:
  - id: setup-files
    content: Create directory structure and new files (testingTools.ts, three-tier.evaluator.ts)
    status: pending
  - id: prep-tool
    content: Implement prepareTestData tool and register in index.ts
    status: pending
    dependencies:
      - setup-files
  - id: create-dataset
    content: Prepare 10 test cases with vague/detailed/groundTruth and validate
    status: pending
    dependencies:
      - prep-tool
  - id: cove-tool
    content: Implement runCOVEComparison tool in testingTools.ts
    status: pending
    dependencies:
      - create-dataset
  - id: run-phase1
    content: "Run Phase 1: COVE comparison on 10 test cases"
    status: pending
    dependencies:
      - cove-tool
  - id: mc-functions
    content: Add generateMultipleChoiceQuestions and expertAnswerMultipleChoice to llm.validator.ts
    status: pending
    dependencies:
      - create-dataset
  - id: constrained-refine
    content: Add refineWithConstrainedAnswers to usecase.service.ts
    status: pending
    dependencies:
      - mc-functions
  - id: hitl-tool
    content: Implement extractUseCaseWithConstrainedHITL tool in usecaseTools.ts
    status: pending
    dependencies:
      - constrained-refine
  - id: hitl-compare
    content: Implement runHITLComparison tool in testingTools.ts
    status: pending
    dependencies:
      - hitl-tool
  - id: run-phase2
    content: "Run Phase 2: HITL comparison on same 10 test cases"
    status: pending
    dependencies:
      - hitl-compare
      - run-phase1
  - id: eval-impl
    content: Implement three-tier evaluation in three-tier.evaluator.ts
    status: pending
    dependencies:
      - run-phase1
  - id: eval-tool
    content: Implement evaluateResults tool in testingTools.ts
    status: pending
    dependencies:
      - eval-impl
  - id: run-eval
    content: Run evaluation on Phase 1 and Phase 2 results, generate summary
    status: pending
    dependencies:
      - eval-tool
      - run-phase2
---

# Implementation Plan: HITL Research Framework

## Goal

Build a complete testing framework to compare COVE with detailed input against constrained HITL approach. Minimize API costs by keeping tests focused and reusing existing validation logic.---

## Part 1: Test Data Infrastructure

### 1.1 Create Testing Tools File

**File:** `mcp-thesis/src/tools/testingTools.ts` (NEW)**What to build:**

- `prepareTestData` tool - validates test cases and creates structured JSON dataset
- Basic file I/O helpers for reading/writing test results

**Implementation:**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { writeFile, readFile } from "fs/promises";

export function registerTestingTools(
  server: McpServer,
  projectStore: JsonProjectStore,
  geminiApiKey: string,
  openrouterApiKey: string
) {
  // Tool 1: prepareTestData
  server.registerTool(
    "prepareTestData",
    {
      title: "Prepare Test Dataset",
      description: "Validate test cases and create structured dataset JSON",
      inputSchema: {
        testCases: z.array(z.object({
          testCaseId: z.string(),
          domain: z.string(),
          vagueSummary: z.string(),
          detailedDescription: z.string(),
          groundTruthJson: z.string(),
          complexity: z.enum(["simple", "medium", "complex"]).optional(),
          notes: z.string().optional()
        }))
      }
    },
    async ({ testCases }) => {
      const validated = [];
      const dataset = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        testCases: []
      };

      for (const tc of testCases) {
        try {
          const groundTruth = JSON.parse(tc.groundTruthJson);
          const validatedTruth = genUseCaseSchema.parse(groundTruth);
          
          dataset.testCases.push({
            id: tc.testCaseId,
            domain: tc.domain,
            metadata: {
              complexity: tc.complexity || "medium",
              expectedFlows: validatedTruth.flows.length,
              notes: tc.notes
            },
            inputs: {
              vague: tc.vagueSummary,
              detailed: tc.detailedDescription
            },
            groundTruth: validatedTruth
          });
          
          validated.push({ id: tc.testCaseId, status: "valid" });
        } catch (error) {
          validated.push({ 
            id: tc.testCaseId, 
            status: "invalid", 
            errors: [error.message] 
          });
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = `test-data/dataset-${timestamp}.json`;
      await writeFile(outputPath, JSON.stringify(dataset, null, 2));

      return {
        content: [{
          type: "text",
          text: `Dataset prepared: ${validated.filter(v => v.status === "valid").length}/${testCases.length} valid\nSaved to: ${outputPath}`
        }],
        structuredContent: { validated, outputFile: outputPath }
      };
    }
  );
}
```



### 1.2 Register Testing Tools

**File:** `mcp-thesis/src/index.ts` (MODIFY)**What to do:**Add import and register testing tools in the SessionServer constructor

```typescript
import { registerTestingTools } from "./tools/testingTools.js";

// In SessionServer constructor, after existing tool registrations:
registerTestingTools(
  this.mcpServer,
  this.projectStore,
  geminiApiKey,
  openrouterApiKey
);
```



### 1.3 Create Directory Structure

**What to do:**Create folders for test data and results

```bash
mkdir -p mcp-thesis/test-data/results
```

---

## Part 2: COVE Comparison (Detailed vs Vague Input)

### 2.1 Add COVE Comparison Tool

**File:** `mcp-thesis/src/tools/testingTools.ts` (ADD to existing)**What to build:**`runCOVEComparison` tool that runs the same test cases through COVE with vague vs detailed input**Implementation:**

```typescript
server.registerTool(
  "runCOVEComparison",
  {
    title: "Run COVE Comparison",
    description: "Compare COVE with vague input vs detailed input",
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
      console.log(`Testing ${tc.id}...`);
      
      // Condition A: COVE + Vague
      const extractedVague = await generateFlatUseCase({
        description: tc.inputs.vague,
        apiKey: geminiApiKey,
        openrouterApiKey: openrouterApiKey
      });
      
      const validationVague = await validateUseCaseWithFeedback(
        extractedVague,
        { projectStore }
      );
      
      const questionsVague = await generateLLMQuestions(
        tc.inputs.vague,
        extractedVague,
        formatValidationForLLM(validationVague),
        geminiApiKey,
        openrouterApiKey
      );
      
      const answersVague = await answerLLMQuestions({
        originalDescription: tc.inputs.vague,
        baseUseCase: extractedVague,
        questions: questionsVague,
        apiKey: geminiApiKey,
        openrouterApiKey: openrouterApiKey
      });
      
      const improvedVague = await improveUseCase({
        originalDescription: tc.inputs.vague,
        baseUseCase: extractedVague,
        answers: answersVague,
        apiKey: geminiApiKey,
        openrouterApiKey: openrouterApiKey
      });
      
      // Condition B: COVE + Detailed (same process)
      const extractedDetailed = await generateFlatUseCase({
        description: tc.inputs.detailed,
        apiKey: geminiApiKey,
        openrouterApiKey: openrouterApiKey
      });
      
      const validationDetailed = await validateUseCaseWithFeedback(
        extractedDetailed,
        { projectStore }
      );
      
      const questionsDetailed = await generateLLMQuestions(
        tc.inputs.detailed,
        extractedDetailed,
        formatValidationForLLM(validationDetailed),
        geminiApiKey,
        openrouterApiKey
      );
      
      const answersDetailed = await answerLLMQuestions({
        originalDescription: tc.inputs.detailed,
        baseUseCase: extractedDetailed,
        questions: questionsDetailed,
        apiKey: geminiApiKey,
        openrouterApiKey: openrouterApiKey
      });
      
      const improvedDetailed = await improveUseCase({
        originalDescription: tc.inputs.detailed,
        baseUseCase: extractedDetailed,
        answers: answersDetailed,
        apiKey: geminiApiKey,
        openrouterApiKey: openrouterApiKey
      });
      
      results.push({
        testCaseId: tc.id,
        conditionA_COVEVague: improvedVague,
        conditionB_COVEDetailed: improvedDetailed,
        groundTruth: tc.groundTruth
      });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = `test-data/results/phase1-cove-${timestamp}.json`;
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    
    return {
      content: [{
        type: "text",
        text: `COVE comparison complete: ${results.length} test cases\nResults: ${outputPath}`
      }],
      structuredContent: { results, outputPath }
    };
  }
);
```

**Dependencies needed:**Import from existing files:

```typescript
import { generateFlatUseCase, improveUseCase } from "../services/usecase.service.js";
import { validateUseCaseWithFeedback, formatValidationForLLM } from "../validators/flat.validator.js";
import { generateLLMQuestions, answerLLMQuestions } from "../validators/llm.validator.js";
```

---

## Part 3: Constrained HITL Implementation

### 3.1 Add Multiple-Choice Question Generator

**File:** `mcp-thesis/src/validators/llm.validator.ts` (ADD new function)**What to build:**Convert existing open-ended questions into multiple-choice format

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
  
  const mcSchema = z.array(z.object({
    id: z.string(),
    question: z.string(),
    options: z.array(z.string()).min(2).max(5),
    context: z.string()
  }));

  const prompt = `
<task>
Convert validation feedback into 3-5 specific multiple-choice questions for use case clarification.
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

<guidelines>
Create questions with 2-4 concrete options each.

Good format:
Q: "When box ID validation fails, the Receiving Agent should:"
Options:
- Immediately reject the box and return to Transport Company
- Notify Department Supervisor and wait for instructions  
- Retry validation up to 3 times before escalating
- Quarantine box and continue with other deliveries

Focus on:
- Actor responsibilities (who does what)
- Flow branching (what happens when X)
- Step details (how is X performed)
- Exception handling (what if Y fails)

Return 3-5 questions maximum.
</guidelines>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: mcSchema
  });
}
```



### 3.2 Add Expert Answer Function

**File:** `mcp-thesis/src/validators/llm.validator.ts` (ADD new function)**What to build:**Expert LLM that has detailed knowledge answers multiple-choice questions

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
`).join('\n---\n')}
</questions>

<instructions>
For each question:
1. If answer is in the detailed description, select that option and cite it
2. Otherwise, use domain expertise to select most reasonable option
3. Provide brief reasoning (1-2 sentences)
</instructions>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: answerSchema
  });
}
```



### 3.3 Add Constrained Refinement Function

**File:** `mcp-thesis/src/services/usecase.service.ts` (ADD new function)**What to build:**Refine use case using ONLY the information from Q&A pairs (no free elaboration)

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
    return `Q: ${q.question}\nA: ${answer?.selectedOption}\nReason: ${answer?.reasoning}`;
  }).join('\n\n');

  const prompt = `
<task>
Refine the use case incorporating ONLY the clarifications provided.
DO NOT add anything beyond what was asked and answered.
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

<constraints>
1. ONLY modify based on the Q&A pairs
2. Do NOT elaborate beyond selected options
3. Do NOT invent additional scenarios
4. Keep unchanged elements as-is
</constraints>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema
  });
}
```



### 3.4 Create HITL Tool

**File:** `mcp-thesis/src/tools/usecaseTools.ts` (ADD new tool)**What to build:**Complete HITL workflow tool

```typescript
server.registerTool(
  "extractUseCaseWithConstrainedHITL",
  {
    title: "Extract with Constrained HITL",
    description: "Interactive extraction with multiple-choice constraints",
    inputSchema: {
      vagueSummary: z.string(),
      expertKnowledge: z.string(),
      domain: z.string().default("General")
    }
  },
  async ({ vagueSummary, expertKnowledge, domain }) => {
    // Step 1: Generator extracts from vague input
    const draft = await generateFlatUseCase({
      description: vagueSummary,
      apiKey: geminiApiKey,
      openrouterApiKey: openrouterApiKey
    });
    
    // Step 2: Validate and get MC questions
    const validation = await validateUseCaseWithFeedback(draft, { projectStore });
    const formattedFeedback = formatValidationForLLM(validation);
    
    const mcQuestions = await generateMultipleChoiceQuestions(
      vagueSummary,
      draft,
      formattedFeedback,
      geminiApiKey,
      openrouterApiKey
    );
    
    // Step 3: Expert answers
    const answers = await expertAnswerMultipleChoice(
      mcQuestions,
      expertKnowledge,
      domain,
      geminiApiKey,
      openrouterApiKey
    );
    
    // Step 4: Constrained refinement
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
        text: `HITL extraction complete\nQuestions: ${mcQuestions.length}\nRefined use case ready`
      }],
      structuredContent: {
        finalUseCase: refined,
        questionsAsked: mcQuestions.map((q, i) => ({
          question: q.question,
          answer: answers[i]?.selectedOption
        }))
      }
    };
  }
);
```

**Dependencies:**Import the new functions:

```typescript
import { 
  generateMultipleChoiceQuestions, 
  expertAnswerMultipleChoice 
} from "../validators/llm.validator.js";
import { refineWithConstrainedAnswers } from "../services/usecase.service.js";
```



### 3.5 Add HITL Comparison Tool

**File:** `mcp-thesis/src/tools/testingTools.ts` (ADD to existing)**What to build:**Run HITL vs COVE comparison on test dataset

```typescript
server.registerTool(
  "runHITLComparison",
  {
    title: "Run HITL vs COVE Comparison",
    description: "Compare constrained HITL against COVE with detailed input",
    inputSchema: {
      datasetPath: z.string(),
      phase1ResultsPath: z.string().optional().describe("Reuse COVE-Detailed results from Phase 1"),
      testCaseIds: z.array(z.string()).optional()
    }
  },
  async ({ datasetPath, phase1ResultsPath, testCaseIds }) => {
    const dataset = JSON.parse(await readFile(datasetPath, 'utf-8'));
    const testCases = testCaseIds 
      ? dataset.testCases.filter(tc => testCaseIds.includes(tc.id))
      : dataset.testCases;
    
    // Load COVE-Detailed results from Phase 1 if provided
    let phase1Results = null;
    if (phase1ResultsPath) {
      phase1Results = JSON.parse(await readFile(phase1ResultsPath, 'utf-8'));
    }
    
    const results = [];
    
    for (const tc of testCases) {
      console.log(`Testing ${tc.id} with HITL...`);
      
      // Get COVE-Detailed from Phase 1 or re-run
      let coveDetailed;
      if (phase1Results) {
        const phase1Result = phase1Results.find(r => r.testCaseId === tc.id);
        coveDetailed = phase1Result?.conditionB_COVEDetailed;
      }
      
      if (!coveDetailed) {
        // Re-run if not found
        const extracted = await generateFlatUseCase({
          description: tc.inputs.detailed,
          apiKey: geminiApiKey,
          openrouterApiKey: openrouterApiKey
        });
        // ... (run full COVE process)
        coveDetailed = extracted; // simplified
      }
      
      // Run HITL
      const hitlResult = await extractUseCaseWithConstrainedHITL({
        vagueSummary: tc.inputs.vague,
        expertKnowledge: tc.inputs.detailed,
        domain: tc.domain
      });
      
      results.push({
        testCaseId: tc.id,
        conditionC_COVEDetailed: coveDetailed,
        conditionD_HITL: hitlResult.finalUseCase,
        hitlQuestions: hitlResult.questionsAsked,
        groundTruth: tc.groundTruth
      });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = `test-data/results/phase2-hitl-${timestamp}.json`;
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    
    return {
      content: [{
        type: "text",
        text: `HITL comparison complete: ${results.length} test cases\nResults: ${outputPath}`
      }],
      structuredContent: { results, outputPath }
    };
  }
);
```

---

## Part 4: Three-Tier Evaluation

### 4.1 Create Evaluation Module

**File:** `mcp-thesis/src/evaluators/three-tier.evaluator.ts` (NEW)**What to build:**Evaluate flows as grounded (1.0), logical (0.7), or hallucination (0.0)

```typescript
import { GenFlow, GenUseCase } from "../interfaces/usecase.interface.new.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import { z } from "zod";

const flowEvalSchema = z.object({
  category: z.enum(["grounded", "logical", "hallucination"]),
  score: z.number(),
  reasoning: z.string(),
  inVagueSummary: z.boolean(),
  inDetailedDescription: z.boolean().optional(),
  inGroundTruth: z.boolean()
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
Evaluate this flow as GROUNDED (1.0), LOGICAL (0.7), or HALLUCINATION (0.0).

Domain: ${context.domain}
Vague: ${context.vagueSummary}
${context.detailedDescription ? `Detailed: ${context.detailedDescription}` : ''}

Flow: ${flow.id} (${flow.kind}): ${flow.condition || 'Main'}
Steps: ${flow.steps.map(s => s.description).join('; ')}

Rules:
- GROUNDED: Explicitly mentioned in description
- LOGICAL: Not mentioned, but reasonable for domain/actors
- HALLUCINATION: Neither

Also check if in ground truth (reference only).
  `;
  
  return geminiFunctions.generateStructured({ prompt, schema: flowEvalSchema });
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
  const flowEvals = [];
  
  for (const flow of useCase.flows) {
    const eval = await evaluateFlow(flow, context, apiKey, openrouterApiKey);
    flowEvals.push({ flowId: flow.id, ...eval });
  }
  
  const grounded = flowEvals.filter(f => f.category === "grounded").length;
  const logical = flowEvals.filter(f => f.category === "logical").length;
  const hallucinations = flowEvals.filter(f => f.category === "hallucination").length;
  
  const qualityScore = (grounded * 1.0 + logical * 0.7) / flowEvals.length;
  const discoveryRate = flowEvals.filter(f => f.inGroundTruth).length / context.groundTruth.flows.length;
  const precision = (grounded + logical) / flowEvals.length;
  const f1Score = 2 * (precision * discoveryRate) / (precision + discoveryRate);
  
  return {
    totalFlows: flowEvals.length,
    breakdown: { grounded, logical, hallucinations },
    scores: { qualityScore, discoveryRate, precision, f1Score },
    flowDetails: flowEvals
  };
}
```



### 4.2 Add Evaluation Tool

**File:** `mcp-thesis/src/tools/testingTools.ts` (ADD to existing)**What to build:**Tool to run three-tier evaluation on test results

```typescript
import { evaluateUseCase } from "../evaluators/three-tier.evaluator.js";

server.registerTool(
  "evaluateResults",
  {
    title: "Evaluate Test Results",
    description: "Run three-tier evaluation on COVE or HITL results",
    inputSchema: {
      resultsPath: z.string(),
      datasetPath: z.string()
    }
  },
  async ({ resultsPath, datasetPath }) => {
    const results = JSON.parse(await readFile(resultsPath, 'utf-8'));
    const dataset = JSON.parse(await readFile(datasetPath, 'utf-8'));
    
    const evaluations = [];
    
    for (const result of results) {
      const testCase = dataset.testCases.find(tc => tc.id === result.testCaseId);
      if (!testCase) continue;
      
      const conditionEvals = {};
      
      // Evaluate each condition in the result
      for (const [key, useCase] of Object.entries(result)) {
        if (key === 'testCaseId' || key === 'groundTruth' || key === 'hitlQuestions') continue;
        
        conditionEvals[key] = await evaluateUseCase(
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
    
    // Calculate aggregate stats
    const summary = {};
    const conditions = Object.keys(evaluations[0].evaluations);
    
    for (const cond of conditions) {
      const scores = evaluations.map(e => e.evaluations[cond].scores);
      summary[cond] = {
        avgQuality: scores.reduce((sum, s) => sum + s.qualityScore, 0) / scores.length,
        avgDiscovery: scores.reduce((sum, s) => sum + s.discoveryRate, 0) / scores.length,
        avgF1: scores.reduce((sum, s) => sum + s.f1Score, 0) / scores.length
      };
    }
    
    const outputPath = resultsPath.replace('.json', '-evaluated.json');
    await writeFile(outputPath, JSON.stringify({ evaluations, summary }, null, 2));
    
    return {
      content: [{
        type: "text",
        text: `Evaluation complete\n${JSON.stringify(summary, null, 2)}\nSaved: ${outputPath}`
      }],
      structuredContent: { evaluations, summary, outputPath }
    };
  }
);
```

---

## Implementation Order

1. **Setup** (5 min)

- Create `test-data/` and `test-data/results/` directories
- Create `mcp-thesis/src/tools/testingTools.ts`
- Create `mcp-thesis/src/evaluators/three-tier.evaluator.ts`

2. **Dataset Prep** (30 min)

- Implement `prepareTestData` tool in testingTools.ts
- Register in index.ts
- Prepare 10 test cases manually
- Run prepareTestData to validate

3. **Phase 1: COVE** (1 hour)

- Implement `runCOVEComparison` tool
- Test on 1-2 cases first
- Run full 10 cases
- Review results

4. **Phase 2: HITL** (2 hours)

- Add `generateMultipleChoiceQuestions` to llm.validator.ts
- Add `expertAnswerMultipleChoice` to llm.validator.ts
- Add `refineWithConstrainedAnswers` to usecase.service.ts
- Implement `extractUseCaseWithConstrainedHITL` tool
- Implement `runHITLComparison` tool
- Test on 1-2 cases
- Run full 10 cases

5. **Phase 3: Evaluation** (1 hour)

- Implement three-tier evaluator
- Implement `evaluateResults` tool
- Run on Phase 1 results
- Run on Phase 2 results
- Compare metrics

6. **Analysis** (30 min)

- Extract summary statistics
- Create comparison tables
- Document findings

---

## Key Files Modified/Created

**New Files:**

- `mcp-thesis/src/tools/testingTools.ts` - All test execution tools
- `mcp-thesis/src/evaluators/three-tier.evaluator.ts` - Evaluation logic

**Modified Files:**

- `mcp-thesis/src/index.ts` - Register testing tools
- `mcp-thesis/src/validators/llm.validator.ts` - Add MC question functions
- `mcp-thesis/src/services/usecase.service.ts` - Add constrained refinement
- `mcp-thesis/src/tools/usecaseTools.ts` - Add HITL tool

**Data Files Created:**

- `test-data/dataset-TIMESTAMP.json` - Test dataset
- `test-data/results/phase1-cove-TIMESTAMP.json` - COVE results
- `test-data/results/phase2-hitl-TIMESTAMP.json` - HITL results
- `test-data/results/*-evaluated.json` - Evaluation results

---

## Testing Strategy

**Start Small:**

- Test each tool with 1 case first
- Verify output format
- Check for errors
- Then scale to 10 cases

**Monitor Costs:**

- Each test case = ~6 API calls (extract + validate + questions + answers + improve + eval)
- 10 cases × 2 conditions = 120 calls for Phase 1
- 10 cases × 1 condition = 60 calls for Phase 2
- 20 results × 3 flows avg × 1 eval = 60 calls for evaluation
- **Total: ~240 API calls**