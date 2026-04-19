import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GeminiOpenRouterFunctions } from "./gemini-openrouter.service.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { parseConsolidatedId } from "../helpers/consolidated-id.js";

// ---------------------------------------------------------------------------
// Shared prompt fragments
// ---------------------------------------------------------------------------

const FLOW_ID_CONVENTION = `
<flowIdConvention>
Flow ID naming convention (MUST follow strictly):
- MAIN flow: always "MAIN"
- Non-MAIN flows: {TYPE}_{STEP}{letter}
  - TYPE: "EXT" for EXCEPTION, "ALT" for ALTERNATIVE
  - STEP: the fromStepIndex number from the parent flow
  - letter: auto-incrementing lowercase (a, b, c...) within same TYPE+STEP
  - If a flow is not tied to any specific step (temporal/global), use the next
    number after the last step in the parent flow
    (e.g., if MAIN has 6 steps, use 7, 8, etc.)
- Nested exceptions: append ".{STEP}{letter}" for each nesting level
  (e.g., EXT_1a.2a = exception from step 2 of EXT_1a)
- Check existing flow IDs before assigning a letter to avoid collisions
  (e.g., if EXT_1a exists, the next exception from step 1 is EXT_1b)
</flowIdConvention>`;

const USECASE_SCHEMA_BLOCK = `
GenUseCase:
{
  "name": string,
  "summary": string,
  "mainActor": string,
  "actors": string[],

  "preconditions"?: string[],
  "postconditions"?: string[],

  "flows": GenFlow[],
  "loops"?: GenLoop[]
}

GenFlow:
{
  "id": string, // Flow ID. Follow the <flowIdConvention> rules strictly.
  "kind": "MAIN" | "ALTERNATIVE" | "EXCEPTION",

  // For MAIN:
  //   - Do NOT include parentFlow or fromStepIndex.
  //
  // For ALTERNATIVE and EXCEPTION:
  //   - parentFlow must be "MAIN" (for now).
  //   - fromStepIndex is the step index in the MAIN flow where this branch starts.
  //
  // Example: fromStepIndex = 5 means "this flow branches from step 5 of MAIN".
  "parentFlow"?: "MAIN",
  "fromStepIndex"?: number,

  // For MAIN, condition is usually omitted or null.
  // For ALTERNATIVE/EXCEPTION, condition is the branching condition in natural language,
  // e.g. "If payment is declined".
  "condition"?: string,

  "steps": GenStep[]
}

GenStep:
{
  // 1-based step index within THIS flow (not global).
  "index": number,

  // Name of the actor performing the step, e.g. "User", "System", "Admin".
  "actor": string,

  // Optional receiver/target (e.g. "System", "PaymentGateway").
  "target"?: string,

  // Short, clear description of what happens in this step.
  "description": string
}

GenLoop:
{
  // Which flow this loop belongs to.
  // For now, this must be "MAIN" or the same kind of label you used in GenFlow.parentFlow.
  // In this version, ALWAYS use "MAIN".
  "flowRef": "MAIN",

  // Step indices (within the referenced flow) that are repeated.
  // Example: startIndex = 3, endIndex = 5 means "steps 3 to 5 of MAIN repeat".
  "startIndex": number,
  "endIndex": number,

  // Natural-language condition describing why the loop repeats,
  // e.g. "For each item in the cart" or "While the user keeps adding passengers".
  "condition": string
}`;

const USECASE_OUTPUT_RULES = `
1. Output ONLY a single JSON object that matches GenUseCase. No markdown, no comments, no explanations.
2. There must be EXACTLY ONE flow with "kind": "MAIN".
3. MAIN flow:
   - Represent the normal happy-path scenario.
   - Steps should start at index 1 and increment by 1 (1, 2, 3, …).
4. ALTERNATIVE and EXCEPTION flows:
   - OPTIONAL. Only create them when the description clearly talks about special cases or failures.
   - Use "parentFlow": "MAIN".
   - Set "fromStepIndex" to the step number in MAIN where that branch conceptually starts.
   - "condition" must describe the branch condition, e.g. "If credentials are invalid".
   - Their internal step indices also start at 1 and increase by 1.
5. Loops:
   - OPTIONAL.
   - Use them when the description clearly says things like "for each", "while", "until", or "repeatedly".
   - "flowRef" must be "MAIN".
   - "startIndex" and "endIndex" are inclusive indices in the MAIN flow.
   - "condition" is a short natural-language description of the repetition.
6. If preconditions or postconditions are not obvious, you may omit those arrays or keep them empty.
7. Use short, clear English for all descriptions and conditions, even if the original text is longer or noisier.`;

// ---------------------------------------------------------------------------
// Prompt builder functions
// ---------------------------------------------------------------------------

function buildGenerateUseCasePrompt(description: string): string {
  return `<instruction>You are a part of a team of professional software analysts. Your task is to read a natural-language description of a use case and figure out steps, actors and flows involved, and present them in a JSON object.
  The <description> section contains the use case description in natural language. The description maybe ambiguous or incomplete; do your best to figure out reasonable missing steps, possible flows and actors involved.
  The JSON schema is defined in <schema> below. 
  Follow the rules in <rules> carefully to ensure the output is valid and complete.
</instruction>
<schema>
${USECASE_SCHEMA_BLOCK}
</schema>
<rules>
Rules:
${USECASE_OUTPUT_RULES}

${FLOW_ID_CONVENTION}
</rules>

<description>
${description}
</description>


`;
}

function buildImproveUseCasePrompt(
  originalDescription: string,
  baseUseCase: GenUseCase,
  answers: string[],
): string {
  return `
  <instructions>
  You are a member in a team of software analysts. Your teammates have created a draft version of an use case, based on the original user description.
  Another member of yours has validated the use case, and gave you some instructions to improve the use case.
  Your task is to read the original user description, the draft use case, and the instructions to improve the use case, then create a new version based on these instructions.
  You must return in the JSON schema defined in <schema> below.
  Follow the rules in <rules> carefully to ensure the output is valid and complete.
  IMPORTANT: Make sure the improved use case stays faithful to the original user requirements and description.
  </instructions>
  <originalDescription>
  ${originalDescription}
  </originalDescription>
  <schema>
${USECASE_SCHEMA_BLOCK}
</schema>
<rules>
Rules:
${USECASE_OUTPUT_RULES}
8. Preserve existing flow IDs. When adding new flows, follow the naming convention and auto-increment letters based on what already exists in the draft.

${FLOW_ID_CONVENTION}
</rules>
  <draftUseCase>
  ${JSON.stringify(baseUseCase)}
  </draftUseCase>
  <instructionsToImprove>
  ${answers.join("\n")}
  </instructionsToImprove>
  `;
}

function buildRefineWithConstrainedAnswersPrompt(
  originalDescription: string,
  baseUseCase: GenUseCase,
  qaContext: string,
): string {
  return `
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
5. Follow the flow ID naming convention in <flowIdConvention>
6. Preserve existing flow IDs when not modifying them

${FLOW_ID_CONVENTION}
</constraints>
  `;
}

function buildExtractFlowsPrompt(
  baseUseCase: GenUseCase,
  answersContext: string,
): string {
  return `
<task>
Extract exception and alternative flows from the expert's answers.
IMPORTANT: A single answer may describe MULTIPLE flows or NESTED exceptions.
Carefully analyze each answer to identify all distinct scenarios.
</task>

<baseUseCase>
${JSON.stringify(baseUseCase, null, 2)}
</baseUseCase>

<expertAnswers>
${answersContext}
</expertAnswers>

<instructions>
For each answer:
1. Identify if it describes one or MULTIPLE scenarios
2. For each scenario, determine if it's an EXCEPTION flow (error, failure) or ALTERNATIVE flow (different valid path)
3. Generate a unique flow ID following the convention (e.g., "EXT_2a", "ALT_3a").
4. Determine which flow step this branches from (fromStepIndex and parentFlow)
5. Extract the branching condition from the answer
6. Break down the scenario into sequential steps with actors and descriptions

 Consolidated question handling:
 - If the answer references multiple steps (see "Covered steps"), map scenarios to the appropriate step.
 - If the answer is generic (no step-specific details), apply the scenario to EACH covered step by creating separate flows with the correct fromStepIndex.
 - If the answer explicitly states differences by step, keep them separated and assign the correct step.

CRITICAL PATTERNS TO DETECT:

1. **Multi-Flow Answers**: Look for phrases like:
   - "First scenario..., Second scenario..."
   - "If X happens..., but if Y happens..."
   - "Another exception is..."
   - Multiple distinct conditions mentioned

2. **Nested Exceptions**: Look for exceptions within exception handling:
   - "If the retry fails..."
   - "If no response within timeout..."
   - "If the alternative also fails..."
   - For nested exceptions, set parentFlow to the parent EXCEPTION flow ID

3. **Temporal Exceptions**: Look for "at any time" scenarios:
   - "At any time, system goes down..."
   - "Throughout the process, if X happens..."
   - For these, omit fromStepIndex (global exceptions)

4. **Post-Completion Scenarios**: Look for actions after completion:
   - "After closing, if..."
   - "Claim can be reopened when..."
   - Set fromStepIndex to the final step

5. **Conditional Chaining**: Look for sequential conditions:
   - "After step X, if Y, then if Z..."
   - Create separate flows with appropriate parent references

Guidelines:
- Steps within each flow start at index 1
- Each step must have: index, actor, description
- Add target if actor interacts with another actor or system
- Keep descriptions concise (1 sentence per step)
- Condition should clearly state when this flow is taken
- For nested exceptions, parentFlow should reference the parent exception ID (not "MAIN")
- For temporal exceptions, omit fromStepIndex

${FLOW_ID_CONVENTION}

Example 1 - Simple Exception:
{
  "id": "EXT_2a",
  "kind": "EXCEPTION",
  "parentFlow": "MAIN",
  "fromStepIndex": 2,
  "condition": "Box ID does not match transport company registered IDs",
  "steps": [
    {
      "index": 1,
      "actor": "Receiving Agent",
      "target": "Transport Company",
      "description": "Rejects the box and notifies transport company of mismatch"
    }
  ]
}

Example 2 - Nested Exception:
{
  "id": "EXT_1a.2a",
  "kind": "EXCEPTION",
  "parentFlow": "EXT_1a",
  "fromStepIndex": 2,
  "condition": "Claimant does not supply information within time period",
  "steps": [
    {
      "index": 1,
      "actor": "Adjuster",
      "target": "System",
      "description": "Closes claim due to non-response"
    }
  ]
}

Example 3 - Temporal Exception (no fromStepIndex):
{
  "id": "EXT_7a",
  "kind": "EXCEPTION",
  "parentFlow": "MAIN",
  "condition": "At any time, System goes down",
  "steps": [
    {
      "index": 1,
      "actor": "System",
      "description": "System group repairs system"
    },
    {
      "index": 2,
      "actor": "System",
      "description": "System resumes operation"
    }
  ]
}

Return an array of ALL flows extracted from the answers.
If an answer doesn't describe a clear flow, skip it.
IMPORTANT: Extract ALL distinct flows from each answer, not just one.
</instructions>
  `;
}

function buildRefineWithHybridAnswersPrompt(
  originalDescription: string,
  refined: GenUseCase,
  qaContext: string,
): string {
  return `
<task>
You are a software analyst refining a use case based on expert answers to targeted questions.
Your job is to produce a COMPLETE, updated use case that:
1. PRESERVES every existing flow and step — do NOT remove or change existing flows.
2. ADDS new ALTERNATIVE or EXCEPTION flows that are explicitly described in the expert answers.
3. UPDATES the "actors" array to include every actor name that appears in any step across all flows.
4. UPDATES "summary", "preconditions", and "postconditions" only if the answers provide new information.

Do NOT fabricate scenarios not mentioned in any answer.
If an answer describes a concrete scenario (specific trigger condition + actor actions + outcome), generate a new ALTERNATIVE or EXCEPTION flow for it regardless of confidence tag. Do not skip a flow just because the answer is not written in structured format — extract the scenario and model it as a flow.
Only skip an answer if it is purely hypothetical with no concrete steps (e.g. "there could potentially be issues" with no specifics).
Do NOT hallucinate actors, steps, or conditions.
</task>

<original_description>
${originalDescription}
</original_description>

<current_use_case>
${JSON.stringify(refined, null, 2)}
</current_use_case>

<expert_answers>
${qaContext}
</expert_answers>

<constraints>
1. Output ONLY a single JSON object matching the GenUseCase schema below.
2. MAIN flow should be rebuilt from the original description and expert answers. You MUST preserve existing steps but MAY add new steps, insert actors into existing steps, or enrich step descriptions if the answers reveal a richer sequence. Do NOT remove or reorder existing steps. The rebuilt MAIN must remain consistent with the original description.
3. When adding new flows, follow the flow ID convention strictly.
4. The "actors" array must reflect all actors mentioned in ALL steps (existing + new).
5. Preserve existing flow IDs exactly.

${FLOW_ID_CONVENTION}
</constraints>
`;
}

// ---------------------------------------------------------------------------
// normalizeFlowIds (non-exported helper)
// ---------------------------------------------------------------------------

export function normalizeFlowIds(useCase: GenUseCase): GenUseCase {
  const normalized = JSON.parse(JSON.stringify(useCase)) as GenUseCase;
  const flows = normalized.flows;
  const mainFlow = flows.find((f) => f.kind === "MAIN");
  const mainStepCount = mainFlow?.steps.length ?? 0;
  
  const renames = new Map<string, string>();
  renames.set("MAIN", "MAIN");
  
  const assignedCounts = new Map<string, number>();
  const nextUnboundSlots = new Map<string, number>();

  function getTopologicalLevel(flowId: string, visited = new Set<string>()): number {
    if (visited.has(flowId)) return 999;
    visited.add(flowId);
    
    const flow = flows.find((f) => f.id === flowId);
    if (!flow || !flow.parentFlow || flow.parentFlow === "MAIN") return 0;
    
    return 1 + getTopologicalLevel(flow.parentFlow, visited);
  }

  function determineStepIndex(flow: import("../interfaces/usecase.interface.new.js").GenFlow, parentId: string): number {
    if (typeof flow.fromStepIndex === "number") {
      return flow.fromStepIndex;
    }
    
    const currentSlot = nextUnboundSlots.get(parentId) || (
      parentId === "MAIN" 
        ? mainStepCount + 1 
        : (flows.find(f => f.id === flow.parentFlow)?.steps.length ?? 0) + 1
    );
    nextUnboundSlots.set(parentId, currentSlot + 1);
    return currentSlot;
  }

  function generateCountKey(parentId: string, type: string, stepIndex: number): string {
    if (parentId === "MAIN") {
      return `${parentId}_${type}_${stepIndex}`;
    }
    return `${parentId}_${stepIndex}`;
  }

  function buildFlowId(parentId: string, type: string, stepIndex: number, letter: string): string {
    if (parentId === "MAIN") {
      return `${type}_${stepIndex}${letter}`;
    }
    return `${parentId}.${stepIndex}${letter}`;
  }

  const sortedFlows = [...flows].sort((a, b) => {
    if (a.kind === "MAIN") return -1;
    if (b.kind === "MAIN") return 1;
    return getTopologicalLevel(a.id) - getTopologicalLevel(b.id);
  });

  for (const flow of sortedFlows) {
    if (flow.kind === "MAIN") continue;

    const oldId = flow.id;
    const oldParentId = flow.parentFlow || "MAIN";
    const newParentId = renames.get(oldParentId) || "MAIN";
    
    flow.parentFlow = newParentId;

    const type = flow.kind === "ALTERNATIVE" ? "ALT" : "EXT";
    const stepIndex = determineStepIndex(flow, newParentId);
    flow.fromStepIndex = stepIndex;
    const countKey = generateCountKey(newParentId, type, stepIndex);
    
    const count = assignedCounts.get(countKey) || 0;
    const letter = String.fromCharCode(97 + count);
    assignedCounts.set(countKey, count + 1);

    const newId = buildFlowId(newParentId, type, stepIndex, letter);
    
    renames.set(oldId, newId);
    flow.id = newId;
  }

  if (normalized.loops) {
    for (const loop of normalized.loops) {
      if (loop.flowRef && renames.has(loop.flowRef)) {
        loop.flowRef = renames.get(loop.flowRef)!;
      }
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

export async function generateFlatUseCase({
  description,
  geminiFunctions,
}: {
  description: string;
  geminiFunctions: GeminiOpenRouterFunctions;
}) {
  const prompt = buildGenerateUseCasePrompt(description);
  const raw = await geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });
  return normalizeFlowIds(raw);
}

export async function improveUseCase({
  originalDescription,
  baseUseCase,
  answers,
  geminiFunctions,
}: {
  originalDescription: string;
  baseUseCase: GenUseCase;
  answers: string[];
  geminiFunctions: GeminiOpenRouterFunctions;
}) {
  const prompt = buildImproveUseCasePrompt(originalDescription, baseUseCase, answers);
  const improvedUseCase = await geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });
  return normalizeFlowIds(improvedUseCase);
}

export async function refineWithConstrainedAnswers(
  originalDescription: string,
  baseUseCase: GenUseCase,
  questions: Array<{ id: string; question: string; options: string[] }>,
  answers: Array<{
    questionId: string;
    selectedOption: string;
    reasoning?: string;
  }>,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<GenUseCase> {
  const qaContext = questions
    .map((q) => {
      const answer = answers.find((a) => a.questionId === q.id);
      return `Q: ${q.question}\nA: ${answer?.selectedOption}\nReason: ${
        answer?.reasoning || "Not provided"
      }`;
    })
    .join("\n\n");

  const prompt = buildRefineWithConstrainedAnswersPrompt(originalDescription, baseUseCase, qaContext);

  return geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });
}

/**
 * Extracts exception and alternative flows from open-ended answers.
 * Uses LLM to parse free-text answers into structured flows.
 *
 * @param answers - The open-ended answers from human expert
 * @param baseUseCase - The base use case to add flows to
 * @param geminiFunctions - Gemini functions for LLM calls
 * @returns Array of new flows extracted from answers
 */
export async function extractFlowsFromOpenEndedAnswers(
  answers: Array<{ questionId: string; answer: string; confidence?: string }>,
  baseUseCase: GenUseCase,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<import("../interfaces/usecase.interface.new.js").GenFlow[]> {
  const { z } = await import("zod");
  const flowSchema = z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["MAIN", "ALTERNATIVE", "EXCEPTION"]),
      parentFlow: z.string().optional(),
      fromStepIndex: z.number().optional(),
      condition: z.string().optional(),
      steps: z.array(
        z.object({
          index: z.number(),
          actor: z.string(),
          target: z.string().optional(),
          description: z.string(),
        }),
      ),
    }),
  );

  const questionStepMap = new Map<string, number[]>();

  for (const answer of answers) {
    // F3: use shared parser instead of inline regex
    const parsed = parseConsolidatedId(answer.questionId);
    if (!parsed) continue;
    if (parsed.stepIndexes.length > 0) {
      questionStepMap.set(answer.questionId, parsed.stepIndexes);
    }
  }

  const answersContext = answers
    .map(
      (a, i) => {
        const stepIndexes = questionStepMap.get(a.questionId);
        const stepHint = stepIndexes
          ? `Covered steps: ${stepIndexes.join(", ")}`
          : "";
        return `
Answer ${i + 1} (ID: ${a.questionId}):
${a.answer}
${stepHint}
Confidence: ${a.confidence || "medium"}
`;
      },
    )
    .join("\n---\n");

  const prompt = buildExtractFlowsPrompt(baseUseCase, answersContext);

  return geminiFunctions.generateStructured({
    prompt,
    schema: flowSchema,
  });
}

/**
 * Refines a use case using hybrid answers (both MC and open-ended).
 * Applies MC answers for clarifications and integrates new flows from open-ended answers.
 *
 * @param originalDescription - Original vague description
 * @param baseUseCase - The base use case to refine
 * @param mcQuestions - Multiple choice questions
 * @param mcAnswers - Multiple choice answers
 * @param openEndedAnswers - Open-ended answers for exception flows
 * @param geminiFunctions - Gemini functions for LLM calls
 * @returns Refined use case with integrated flows
 */
export async function refineWithHybridAnswers(
  originalDescription: string,
  baseUseCase: GenUseCase,
  mcQuestions: Array<{
    id: string;
    question: string;
    options: string[];
    context: string;
  }>,
  mcAnswers: Array<{
    questionId: string;
    selectedOption: string;
    reasoning?: string;
  }>,
  openEndedAnswers: Array<{
    questionId: string;
    answer: string;
    confidence?: string;
  }>,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<GenUseCase> {
  // Step 1: Apply MC answers for clarifications (if any)
  let refined = baseUseCase;
  if (mcQuestions.length > 0 && mcAnswers.length > 0) {
    refined = await refineWithConstrainedAnswers(
      originalDescription,
      baseUseCase,
      mcQuestions,
      mcAnswers,
      geminiFunctions,
    );
  }

  // Step 2: Full LLM rebuild — preserve all existing flows, add new flows from answers,
  // update actors list to include every actor appearing in any step.
  // Confidence tags are included so the LLM can skip speculative/hedged answers.
  const qaContext = openEndedAnswers
    .map((a) => `Answer [${a.questionId}] (confidence: ${a.confidence ?? "high"}):\n${a.answer}`)
    .join("\n\n");

  const prompt = buildRefineWithHybridAnswersPrompt(originalDescription, refined, qaContext);

  const rebuiltUseCase = await geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });

  return normalizeFlowIds(rebuiltUseCase);
}
