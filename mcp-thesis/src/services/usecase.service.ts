import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";

export async function generateFlatUseCase({
  description,
  geminiFunctions,
}: {
  description: string;
  geminiFunctions: GeminiOpenRouterFunctions;
}) {
  const prompt = `<instruction>You are a part of a team of professional software analysts. Your task is to read a natural-language description of a use case and figure out steps, actors and flows involved, and present them in a JSON object.
  The <description> section contains the use case description in natural language. The description maybe ambiguous or incomplete; do your best to figure out reasonable missing steps, possible flows and actors involved.
  The JSON schema is defined in <schema> below. 
  Follow the rules in <rules> carefully to ensure the output is valid and complete.
</instruction>
<schema>

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
  "id": "MAIN" | string, // if the flow is the main flow, use "MAIN"; otherwise, use any unique string ID. You must have a meaningful ID for each flow.
  "kind": "MAIN" | "ALTERNATIVE" | "EXCEPTION",

  // For MAIN:
  //   - Do NOT include parentFlow or fromStepIndex.
  //
  // For ALTERNATIVE and EXCEPTION:
  //   - parentFlow must be "MAIN" (for now).
  //   - fromStepIndex is the step index in the MAIN flow where this branch starts.
  //
  // Example: fromStepIndex = 5 means “this flow branches from step 5 of MAIN”.
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
}
</schema>
<rules>
Rules:

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
7. Use short, clear English for all descriptions and conditions, even if the original text is longer or noisier.
</rules>

<description>
${description}
</description>


`;
  return geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });
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
  const prompt = `
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
"id": "MAIN" | string, // if the flow is the main flow, use "MAIN"; otherwise, use any unique string ID. You must have a meaningful ID for each flow.
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
}
</schema>
<rules>
Rules:

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
7. Use short, clear English for all descriptions and conditions, even if the original text is longer or noisier.
</rules>
  <draftUseCase>
  ${JSON.stringify(baseUseCase)}
  </draftUseCase>
  <instructionsToImprove>
  ${answers.join("\n")}
  </instructionsToImprove>
  `;
  const improvedUseCase = await geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });
  return improvedUseCase;
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
  geminiFunctions: GeminiOpenRouterFunctions
): Promise<GenUseCase> {
  const qaContext = questions
    .map((q) => {
      const answer = answers.find((a) => a.questionId === q.id);
      return `Q: ${q.question}\nA: ${answer?.selectedOption}\nReason: ${
        answer?.reasoning || "Not provided"
      }`;
    })
    .join("\n\n");

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
  geminiFunctions: GeminiOpenRouterFunctions
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
        })
      ),
    })
  );

  const answersContext = answers
    .map(
      (a, i) => `
Answer ${i + 1} (ID: ${a.questionId}):
${a.answer}
Confidence: ${a.confidence || "medium"}
`
    )
    .join("\n---\n");

  const prompt = `
<task>
Extract exception and alternative flows from the expert's answers.
Each answer describes a scenario that should become a new flow in the use case.
</task>

<baseUseCase>
${JSON.stringify(baseUseCase, null, 2)}
</baseUseCase>

<expertAnswers>
${answersContext}
</expertAnswers>

<instructions>
For each answer:
1. Identify if it describes an EXCEPTION flow (error, failure) or ALTERNATIVE flow (different valid path)
2. Generate a unique flow ID (e.g., "EXT_2a" for exception from step 2, "ALT_3a" for alternative from step 3)
3. Determine which MAIN flow step this branches from (fromStepIndex)
4. Extract the branching condition from the answer
5. Break down the answer into sequential steps with actors and descriptions

Guidelines:
- Steps within each flow start at index 1
- Each step must have: index, actor, description
- Add target if actor interacts with another actor or system
- Keep descriptions concise (1 sentence per step)
- Condition should clearly state when this flow is taken

Example flow structure:
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

Return an array of flows extracted from the answers.
If an answer doesn't describe a clear flow, skip it.
</instructions>
  `;

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
  geminiFunctions: GeminiOpenRouterFunctions
): Promise<GenUseCase> {
  // Step 1: Apply MC answers for clarifications (if any)
  let refined = baseUseCase;
  if (mcQuestions.length > 0 && mcAnswers.length > 0) {
    refined = await refineWithConstrainedAnswers(
      originalDescription,
      baseUseCase,
      mcQuestions,
      mcAnswers,
      geminiFunctions
    );
  }

  // Step 2: Extract new flows from open-ended answers
  const newFlows = await extractFlowsFromOpenEndedAnswers(
    openEndedAnswers,
    refined,
    geminiFunctions
  );

  // Step 3: Integrate new flows
  const combinedFlows = [...refined.flows, ...newFlows];

  // Return refined use case with all flows
  return {
    ...refined,
    flows: combinedFlows,
  };
}
