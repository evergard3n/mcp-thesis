import z from "zod";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import {
  CONSOLIDATION_GROUPS,
  GapAnalysis,
  GapType,
} from "../analyzers/gap.analyzer.js";
import { BlueprintActivation } from "../analyzers/blueprint.detector.js";
import semanticService from "../services/semantic.service.js";

export const COVE_LLM_QUESTIONS: string[] = [
  "Is the use-case name meaningful and unambiguous?",
  "Does the name accurately summarize the main purpose of the use case?",
  "Is the name Actor-independent?",

  "Does the brief description clearly describe the primary goal of the use case?",
  "Is it clear from the brief description what the main purpose of the use case is?",
  "Is the 'observable result of value' obvious?",

  "Are associated Actors and information exchanged clearly defined?",
  "Is it clear who performs the actions in the use case?",
  "Is all information exchanged between the Actors and the system clearly specified?",
  "If a 'time' actor is used, are you sure you did not miss an important Actor and associated use cases (such as administrative or maintenance personnel who define schedule events)?",

  "Does each precondition represent a tangible state of the system (for example, the Withdraw Cash use case for an automated teller machine has a precondition that the user has an account)?",

  "Are the basic flow and alternative flows complete, correct, and consistent?",
  "Does each step in the scenario contain the same level of abstraction?",
  "Does each step in the scenario describe something that can actually happen and that the system can reasonably detect?",
  "Does each step make progress toward the goal?",
  "Are there any missing steps? Is it clear how to go from one step to the next? Does the sequence of communication between the Actors and the use cases conform to the users' expectations?",
  "Does each step describe how the step helps the Actors achieve their goals?",
  "Is each step technology-independent? Is it free of technical details and inadvertent design decisions?",

  "If Minimal Guarantees are present, do they always happen when the use case completes, regardless of success?",
  "If Success Guarantees are present, do they always happen when the use case completes successfully?",
  "Are applicable nonfunctional requirements captured?",
];

// ---------------------------------------------------------------------------
// Prompt builder functions
// ---------------------------------------------------------------------------

function buildGenerateLLMQuestionsPrompt(
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  questions: string[],
): string {
  return `
        <instructions>
        You are a validator in a team of software analysts. Your teammates have already created an use case based on the original user description, and validated it using a predefined algorithm.
        You are given the original description, the use case, the validation feedback, and a set of further validation questions.
        Your task is to read those four materials, and give FIVE SPECIFIC QUESTIONS ONLY that will help your teammates to improve the use case.
        REMEMBER, questions should be specific to the use case, the validation feedback, and most importantly, whether the use case accurately captures the original user requirements.
        You must return questions that your teammates can self-analyze if there are any mistakes in their original response
        You must return questions in an array of strings.
        </intructions>
        <originalDescription>
        ${originalDescription}
        </originalDescription>
        <usecase>
        ${JSON.stringify(useCase)}
        </usecase>
        <validationfeedback>
        ${formattedValidationFeedback}
        </validationfeedback>
        <questions>
        ${questions.join("\n")}</questions>
    `;
}

function buildAnswerLLMQuestionsPrompt(
  originalDescription: string,
  baseUseCase: GenUseCase,
  question: string,
): string {
  return `
      <instructions>
      You are a member in a team of software analysts. Your teammates have created a draft version of an use case, based on the original user description.
      Another member of yours has validated the use case, and asked you a question to improve the use case.
      Your task is to answer the questions, and provide some instructions to your teammates to improve the use case.
      You do not have to explain your reasons, just provide concise answers and instructions.
      Make sure the improved use case stays true to the original user requirements.
      </instructions>
      <originalDescription>
      ${originalDescription}
      </originalDescription>
      <question>
      ${question}
      </question>
      <draftUseCase>
      ${JSON.stringify(baseUseCase)}
      </draftUseCase>
    `;
}

function buildGenerateMultipleChoiceQuestionsPrompt(
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
): string {
  return `
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
}

function buildExpertAnswerMultipleChoicePrompt(
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    context: string;
  }>,
  detailedDescription: string,
  domain: string,
): string {
  return `
<role>
You are a Senior Business Analyst with expertise in ${domain}.
You have detailed knowledge about this use case.
</role>

<detailedDescription>
${detailedDescription}
</detailedDescription>

<questions>
${questions
  .map(
    (q, i) => `
Question ${i + 1} (ID: ${q.id}):
${q.question}

Options:
${q.options
  .map((opt, j) => `${String.fromCharCode(65 + j)}) ${opt}`)
  .join("\n")}
`,
  )
  .join("\n---\n")}
</questions>

<instructions>
For each question:
1. If answer is in the detailed description, select that option and cite it
2. Otherwise, use domain expertise to select most reasonable option
3. Provide brief reasoning (1-2 sentences)
</instructions>
  `;
}

function buildOpenEndedQuestionsFromGapsPrompt(
  originalDescription: string,
  useCase: GenUseCase,
  gapContext: string,
): string {
  return `
<task>
Generate 3-5 specific open-ended questions to discover exception flows and alternative paths.
These questions should help fill the gaps identified in the current use case.
</task>

<originalDescription>
${originalDescription}
</originalDescription>

<currentUseCase>
${JSON.stringify(useCase, null, 2)}
</currentUseCase>

<identifiedGaps>
${gapContext}
</identifiedGaps>

<guidelines>
Generate questions that:

1. Target EXCEPTION FLOWS (error conditions, failures, invalid inputs)
   Example: "What happens if the box ID validation fails?"
   
2. Target ALTERNATIVE FLOWS (different valid paths, optional steps)
   Example: "Are there cases where the signature step can be skipped?"

3. Target SYSTEM FAILURES (unavailability, timeouts, crashes)
   Example: "What should happen if the registration system goes down?"

4. Are SPECIFIC and ANSWERABLE
   - Reference specific steps or actors
   - Ask about concrete scenarios
   - Guide toward describing flows, not just outcomes

5. Provide ANSWER GUIDANCE
   - Tell the expert HOW to structure their answer
   - Example: "Describe the exception flow: What does the actor do? How is it resolved?"

Format each question with:
- id: Unique identifier (e.g., "gap_exception_step2")
- question: The specific question
- context.whyAsking: Brief explanation of why this matters
- context.step: The related step description (if applicable)
- context.patternType: Type of gap (e.g., "validation_failure", "system_unavailability")
- answerGuidance: Instructions for how to answer


Prioritize high-severity gaps first. Return 3-5 questions maximum.
</guidelines>
  `;
}

function buildExpertAnswerOpenEndedQuestionsPrompt(
  questions: OpenEndedQuestion[],
  detailedDescription: string,
  domain: string,
): string {
  return `
<role>
You are a Senior Business Analyst with expertise in ${domain}.
You have complete knowledge about this use case from the detailed description.
</role>

<detailedDescription>
${detailedDescription}
</detailedDescription>

<questions>
${questions
  .map(
    (q, i) => `
Question ${i + 1} (ID: ${q.id}):
${q.question}

Context: ${q.context.whyAsking}
${q.context.step ? `Related to: ${q.context.step}` : ""}

How to answer: ${q.answerGuidance}
`,
  )
  .join("\n---\n")}
</questions>

<instructions>
For each question:
1. If the detailed description explicitly mentions this scenario, describe it completely
2. If not explicitly mentioned, use domain expertise to provide a reasonable answer
3. Structure your answer according to the guidance provided
4. For exception/alternative flows, describe:
   - What triggers this flow
   - What steps the actors take
   - How it ends (resumes, terminates, etc.)
5. If a question lists multiple steps, explicitly address EACH step separately.
   Do NOT answer with "same for all steps" unless you have checked each one and
   can confirm there are truly no differences. If you claim no differences, state
   that you verified each step explicitly.
6. Set confidence level:
   - "high" if answer is in detailed description
   - "medium" if inferred from domain knowledge
   - "low" if making reasonable assumption

Keep answers concise but complete (2-4 sentences for each flow).
</instructions>
  `;
}

function buildProbeBlueprintsWithExpertPrompt(
  activations: BlueprintActivation[],
  detailedDescription: string,
  domain: string,
): string {
  const blueprintList = activations
    .map(
      (a, i) =>
        `${i + 1}. Blueprint ID: "${a.blueprintId}" | Name: "${a.blueprintName}" | Domain: "${a.domainType ?? "unspecified"}"\n   Probe: ${a.probeQuestion}`,
    )
    .join("\n");

  return `You are a domain expert for a ${domain} system.

Below is a detailed description of a use case:
<description>
${detailedDescription}
</description>

The following process patterns (blueprints) were **automatically suggested** from the draft use case (embedding match). They may include false positives.

Each blueprint has a Domain field: "human-system" (people + systems) or "system-system" (automated).

Confirm a blueprint when:
1. The detailed description **reasonably supports** that process pattern (explicit detail OR clear implication from actors and steps — e.g. insurance claims often imply adjudication, assignment, policy checks, request changes, and approvals), AND
2. The blueprint's Domain is not clearly wrong for this use case (e.g. do not confirm heavy web-session persistence for a purely physical paper workflow).

**Bias toward recall:** If the description mentions related roles or steps (approvals, vendors, claim handling, APIs, locks, sessions, multi-party matching, etc.), prefer **confirming** the matching blueprint IDs rather than omitting them. Only exclude a blueprint when it is clearly irrelevant.

${blueprintList}

Return ONLY a JSON array of blueprint ID strings for the blueprints that are confirmed.
Example: ["approval_chain", "session_persistence"]
If none apply, return [].`;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export const generateLLMQuestions = async (
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  geminiFunctions: GeminiOpenRouterFunctions,
) => {
  const questions = COVE_LLM_QUESTIONS.map((question) => `- ${question}`);
  const questionsSchema = z.array(z.string());

  const prompt = buildGenerateLLMQuestionsPrompt(
    originalDescription,
    useCase,
    formattedValidationFeedback,
    questions,
  );
  return geminiFunctions.generateStructured({
    prompt: prompt,
    schema: questionsSchema,
  });
};
export async function answerLLMQuestions({
  originalDescription,
  baseUseCase,
  questions,
  geminiFunctions,
}: {
  originalDescription: string;
  baseUseCase: GenUseCase;
  questions: string[];
  geminiFunctions: GeminiOpenRouterFunctions;
}) {
  const answers: string[] = [];
  for (const question of questions) {
    const llmAnswer = await geminiFunctions.generate({
      prompt: buildAnswerLLMQuestionsPrompt(originalDescription, baseUseCase, question),
    });
    console.log(new Date().toISOString() + ": " + llmAnswer + "\n");
    answers.push(llmAnswer);
  }
  return answers;
}

export async function generateMultipleChoiceQuestions(
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<
  Array<{
    id: string;
    question: string;
    options: string[];
    context: string;
  }>
> {
  const mcSchema = z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      options: z.array(z.string()).min(2).max(5),
      context: z.string(),
    }),
  );

  const prompt = buildGenerateMultipleChoiceQuestionsPrompt(
    originalDescription,
    useCase,
    formattedValidationFeedback,
  );

  return geminiFunctions.generateStructured({
    prompt,
    schema: mcSchema,
  });
}

export async function expertAnswerMultipleChoice(
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    context: string;
  }>,
  detailedDescription: string,
  domain: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<
  Array<{ questionId: string; selectedOption: string; reasoning: string }>
> {
  const answerSchema = z.array(
    z.object({
      questionId: z.string(),
      selectedOption: z.string(),
      reasoning: z.string(),
    }),
  );

  const prompt = buildExpertAnswerMultipleChoicePrompt(
    questions,
    detailedDescription,
    domain,
  );

  return geminiFunctions.generateStructured({
    prompt,
    schema: answerSchema,
  });
}

/**
 * Interface for open-ended questions targeting exception flow discovery
 */
export interface OpenEndedQuestion {
  id: string;
  question: string;
  context: {
    step?: string;
    steps?: string[];
    patternType?: string;
    whyAsking: string;
    flowId?: string;
  };
  answerGuidance: string;
}

/**
 * Interface for open-ended answer
 */
export interface OpenEndedAnswer {
  questionId: string;
  answer: string;
  confidence?: string;
}

export interface RawHumanAnswer {
  questionId: string;
  answer: string;
}

export function normalizeHumanAnswers(
  rawAnswers: RawHumanAnswer[],
): OpenEndedAnswer[] {
  return rawAnswers.map((raw) => {
    const text = raw.answer.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const isYesNo =
      /^(yes|no|yeah|nope|yep|nah|ok|okay|sure|correct|incorrect|true|false)\.?$/i.test(
        text,
      );
    return {
      questionId: raw.questionId,
      answer: text,
      confidence: isYesNo || wordCount <= 3 ? "low" : "high",
    };
  });
}

export interface HybridQuestions {
  mcQuestions: Array<{
    id: string;
    question: string;
    options: string[];
    context: string;
  }>;
  openEndedQuestions: OpenEndedQuestion[];
  metadata: {
    totalGaps: number;
    highPriorityGaps: number;
    completenessScore: number;
  };
}

/**
 * Generates hybrid questions combining multiple choice for clarifications
 * and open-ended questions for exception flow discovery.
 *
 * @param gapAnalysis - The gap analysis identifying what's missing
 * @param useCase - The current use case
 * @param originalDescription - Original description
 * @param validationFeedback - Formatted validation feedback
 * @param geminiFunctions - Gemini functions for LLM calls
 * @returns Hybrid questions with both MC and open-ended
 */
export async function generateHybridQuestions(
  gapAnalysis: GapAnalysis,
  useCase: GenUseCase,
  originalDescription: string,
  validationFeedback: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<HybridQuestions> {
  // 1. Generate MC questions for general clarifications (if needed)
  const mcQuestions =
    gapAnalysis.completenessScore < 0.8
      ? await generateMultipleChoiceQuestions(
          originalDescription,
          useCase,
          validationFeedback,
          geminiFunctions,
        )
      : [];

  // 2. Generate open-ended questions targeting specific gaps
  const openEndedQuestions = await generateOpenEndedQuestionsFromGaps(
    gapAnalysis,
    useCase,
    originalDescription,
    geminiFunctions,
  );

  return {
    mcQuestions,
    openEndedQuestions,
    metadata: {
      totalGaps: gapAnalysis.gaps.length,
      highPriorityGaps: gapAnalysis.gaps.filter((g) => g.severity === "high")
        .length,
      completenessScore: gapAnalysis.completenessScore,
    },
  };
}

/**
 * Generates open-ended questions specifically targeting exception flow discovery
 * based on gap analysis.
 *
 * @param gapAnalysis - The gap analysis result
 * @param useCase - The current use case
 * @param originalDescription - Original description
 * @param geminiFunctions - Gemini functions for LLM calls
 * @returns Array of open-ended questions
 */
async function generateOpenEndedQuestionsFromGaps(
  gapAnalysis: GapAnalysis,
  useCase: GenUseCase,
  originalDescription: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<OpenEndedQuestion[]> {
  const openEndedSchema = z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      context: z.object({
        step: z.string().optional(),
        steps: z.array(z.string()).optional(),
        patternType: z.string().optional(),
        whyAsking: z.string(),
      }),
      answerGuidance: z.string(),
    }),
  );

  // Build gap context for the LLM
  const gapContext = gapAnalysis.gaps
    .filter((g) => g.severity === "high" || g.severity === "medium")
    .map((gap, i) => {
      let gapDesc = `${i + 1}. [${gap.severity.toUpperCase()}] ${
        gap.description
      }`;
      if (gap.relatedStep !== undefined) {
        const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
        const step = mainFlow?.steps.find((s) => s.index === gap.relatedStep);
        if (step) {
          gapDesc += `\n   Related step: "${step.description}"`;
        }
      }
      return gapDesc;
    })
    .join("\n");

  const prompt = buildOpenEndedQuestionsFromGapsPrompt(
    originalDescription,
    useCase,
    gapContext,
  );

  return geminiFunctions.generateStructured({
    prompt,
    schema: openEndedSchema,
  });
}

/**
 * Simulates an expert answering open-ended questions using detailed knowledge.
 * Used for testing the framework with ground truth data.
 *
 * @param questions - The open-ended questions to answer
 * @param detailedDescription - The detailed description with full knowledge
 * @param domain - The domain context
 * @param geminiFunctions - Gemini functions for LLM calls
 * @returns Array of answers with confidence levels
 */
export async function expertAnswerOpenEndedQuestions(
  questions: OpenEndedQuestion[],
  detailedDescription: string,
  domain: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<OpenEndedAnswer[]> {
  const answerSchema = z.array(
    z.object({
      questionId: z.string(),
      answer: z.string(),
      confidence: z.string(),
    }),
  );

  const prompt = buildExpertAnswerOpenEndedQuestionsPrompt(
    questions,
    detailedDescription,
    domain,
  );

  const answers = await geminiFunctions.generateStructured({
    prompt,
    schema: answerSchema,
  });

  const speculativePattern = /\b(likely|typically|could|might|may|hypothetically|assume|assumption|not explicitly|not specified|not mentioned|not described|not covered|does not mention|does not describe|does not cover|general knowledge)\b/i;

  return answers.map((answer) => {
    if (speculativePattern.test(answer.answer)) {
      return {
        ...answer,
        confidence: "low",
      };
    }

    return answer;
  });
}

/**
 * Checks if a question is a duplicate of previously asked questions.
 *
 * L1 — exact text match only (removed substring overlap: too many false positives
 *       when similar gap types fire on different steps or with rephrased context).
 * L2 — semantic similarity; threshold raised to 0.92 so only near-paraphrase
 *       questions are suppressed, allowing related-but-distinct follow-ups through.
 */
async function isQuestionDuplicate(
  newQuestion: string,
  previousQuestions: string[],
  threshold: number = 0.92,
): Promise<boolean> {
  if (previousQuestions.length === 0) return false;

  const normalizedNew = newQuestion.toLowerCase().replace(/\s+/g, " ").trim();
  const newStepMatch = normalizedNew.match(/step\s+(\d+)/i);
  const newStepIndex = newStepMatch ? Number(newStepMatch[1]) : null;

  // Layer 1: Exact text match only
  for (const prev of previousQuestions) {
    const normalizedPrev = prev.toLowerCase().replace(/\s+/g, " ").trim();
    const prevStepMatch = normalizedPrev.match(/step\s+(\d+)/i);
    const prevStepIndex = prevStepMatch ? Number(prevStepMatch[1]) : null;
    if (newStepIndex !== null && prevStepIndex !== null) {
      if (newStepIndex !== prevStepIndex) continue;
    }
    if (normalizedNew === normalizedPrev) {
      console.log(`[DEDUP L1] Exact match — skipping: "${newQuestion.slice(0, 80)}..." ~ "${prev.slice(0, 80)}..."`);
      return true;
    }
  }

  // Layer 2: Semantic similarity check (only against same-step previous questions)
  const eligiblePrevious = previousQuestions.filter((prev) => {
    const normalizedPrev = prev.toLowerCase().replace(/\s+/g, " ").trim();
    const prevStepMatch = normalizedPrev.match(/step\s+(\d+)/i);
    const prevStepIndex = prevStepMatch ? Number(prevStepMatch[1]) : null;
    if (newStepIndex !== null && prevStepIndex !== null) {
      return newStepIndex === prevStepIndex;
    }
    return true;
  });

  if (eligiblePrevious.length === 0) return false;

  const allTexts = [newQuestion, ...eligiblePrevious];
  const embeddings = await semanticService.embedBatch(allTexts);
  const newVec = embeddings[0];

  for (let i = 1; i < embeddings.length; i++) {
    const sim = await semanticService.cosineSimilarity(newVec, embeddings[i]);
    if (sim >= threshold) {
      console.log(`[DEDUP L2] Semantic match (sim=${sim.toFixed(3)}) — skipping: "${newQuestion.slice(0, 80)}..." ~ "${eligiblePrevious[i - 1].slice(0, 80)}..."`);
      return true;
    }
  }

  return false;
}

/**
 * Gets category-specific answer guidance for gap-based questions
 */
function getAnswerGuidanceForGapType(gapType: string): string {
  switch (gapType) {
    case "missing_validation_handling":
      return "Describe: (1) what specific data condition triggers the failure, (2) who detects it, (3) what the actor does in response, (4) how the process resumes or terminates.";
    case "missing_search_handling":
      return "Describe: (1) what the actor searches for and what goes wrong, (2) whether they can proceed with partial information, (3) how the process continues.";
    case "missing_data_quality_handling":
      return "Describe: (1) what specific data problem occurs, (2) whether the system or actor detects it, (3) what correction or fallback is available.";
    case "missing_resource_availability":
      return "Describe: (1) why the resource is unavailable, (2) whether a default or fallback is assigned automatically, (3) what happens if no assignment occurs within a time limit.";
    case "missing_system_failure_handling":
      return "Describe: (1) the nature of the failure, (2) whether work in progress is preserved, (3) what the actor does while waiting or after the failure.";
    case "missing_post_completion_scenarios":
      return "Describe: (1) what minimum information is required to finish, (2) what the system does if requirements aren't met, (3) whether the actor can save and return later.";
    case "missing_save_resume_handling":
      return "Describe: (1) whether progress can be saved, (2) what data is preserved, (3) how resume works and whether re-validation is required.";
    case "missing_eligibility_failure_handling":
      return "Describe: (1) the exact validation failure trigger, (2) whether the claim is declined immediately, (3) what claimant notifications and records are required, (4) whether the process terminates or allows retry/appeal.";
    case "missing_assignment_unavailability_handling":
      return "Describe: (1) what happens when no assignee is available, (2) whether the case is queued/on hold, (3) who is notified, (4) how and when assignment resumes.";
    case "missing_policy_outcome_branching":
      return "Describe: (1) how severe vs minor policy violations are distinguished, (2) which path declines/terminates, (3) which path allows negotiation or adjusted payout, (4) who decides each outcome.";
    default:
      return "Describe the scenario: what triggers it, what steps are taken, and how it resolves or integrates with the main flow.";
  }
}

function isBlueprintGap(gapType: string): boolean {
  return gapType.startsWith("blueprint_");
}

function formatStepLabel(flowId: string, stepIndex: number): string {
  if (flowId !== "MAIN") {
    return `${flowId} Step ${stepIndex}`;
  }
  return `Step ${stepIndex}`;
}

interface StepPriorityShape {
  stepIndex: number;
  flowId: string;
  actor: string;
  description: string;
  uncertaintyScore: number;
  criticalityScore: number;
  priorityScore: number;
  priorityRank: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  uncertaintyReasons: string[];
  relatedGaps: Array<{
    type: string;
    severity: string;
    description: string;
    suggestedQuestion?: string;
    blueprintConfidence?: number;
  }>;
}

interface ConsolidatedGapGroup {
  groupId: string;
  question: string;
  answerGuidance: string;
  steps: Array<{
    index: number;
    flowId: string;
    actor: string;
    description: string;
  }>;
  memberGapTypes: GapType[];
}

function buildConsolidatedGroups(
  gapSteps: StepPriorityShape[],
  groupFilter: (gapType: string, flowId: string) => boolean,
): { consolidated: ConsolidatedGapGroup[]; remaining: StepPriorityShape[] } {
  const consolidated: ConsolidatedGapGroup[] = [];
  const remaining: StepPriorityShape[] = [];
  const consumed = new Set<string>();

  for (const group of CONSOLIDATION_GROUPS) {
    const memberGapTypes = new Set(group.memberGapTypes);
    const stepMap = new Map<
      number,
      { flowId: string; actor: string; description: string }
    >();

    for (const priority of gapSteps) {
      const hasMatchingGap = priority.relatedGaps.some(
        (gap) =>
          memberGapTypes.has(gap.type as GapType) &&
          groupFilter(gap.type, priority.flowId),
      );
      if (!hasMatchingGap) continue;
      if (stepMap.has(priority.stepIndex)) continue;

      stepMap.set(priority.stepIndex, {
        flowId: priority.flowId,
        actor: priority.actor,
        description: priority.description,
      });
    }

    const steps = Array.from(stepMap.entries())
      .map(([index, meta]) => ({
        index,
        flowId: meta.flowId,
        actor: meta.actor,
        description: meta.description,
      }))
      .sort((a, b) => a.index - b.index);

    if (steps.length >= 2) {
      const question = group.questionTemplate(steps);
      consolidated.push({
        groupId: group.groupId,
        question,
        answerGuidance: group.answerGuidance,
        steps,
        memberGapTypes: group.memberGapTypes,
      });

      for (const step of steps) {
        for (const gapType of group.memberGapTypes) {
          consumed.add(`${step.flowId}|${step.index}|${gapType}`);
        }
      }
    }
  }

  for (const priority of gapSteps) {
    const filteredGaps = priority.relatedGaps.filter(
      (gap) => !consumed.has(`${priority.flowId}|${priority.stepIndex}|${gap.type}`),
    );

    if (filteredGaps.length === 0) continue;

    remaining.push({
      ...priority,
      relatedGaps: filteredGaps,
    });
  }

  return { consolidated, remaining };
}

/**
 * Single LLM call that presents all activated blueprint probeQuestions to the expert
 * and returns the IDs of blueprints the expert confirms apply to this use case.
 */
export async function probeBlueprintsWithExpert(
  activations: BlueprintActivation[],
  detailedDescription: string,
  domain: string,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<string[]> {
  if (activations.length === 0) return [];

  const activationSummary = activations
    .map(
      (a) =>
        `${a.blueprintId}(${(a.confidence * 100).toFixed(0)}%/${a.domainType ?? "?"})`,
    )
    .join(", ");
  console.log(
    `[Probe] domain=${domain} | activations=${activations.length}: ${activationSummary}`,
  );
  console.log(
    `[Probe] detailedDescription length=${detailedDescription.length} chars`,
  );

  const prompt = buildProbeBlueprintsWithExpertPrompt(
    activations,
    detailedDescription,
    domain,
  );

  const schema = z.array(z.string());

  try {
    const result = await geminiFunctions.generateStructured({ prompt, schema });
    // Filter to only valid IDs from the activations list
    const validIds = new Set(activations.map((a) => a.blueprintId));
    const confirmed = result.filter((id) => validIds.has(id));
    const dropped = activations
      .filter((a) => !confirmed.includes(a.blueprintId))
      .map((a) => a.blueprintId);
    console.log(`[Probe] confirmed (${confirmed.length}): [${confirmed.join(", ")}]`);
    console.log(`[Probe] not confirmed (${dropped.length}): [${dropped.join(", ")}]`);
    return confirmed;
  } catch (err) {
    console.error("[probeBlueprintsWithExpert] LLM call failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// generateAdaptiveQuestions — private phase helpers
// ---------------------------------------------------------------------------

/**
 * Phase 0: Coverage seed questions — ask about critical eligibility, assignment, and
 * policy-outcome branches on the first pass before any gaps are known.
 */
async function buildSeedQuestions(
  stepPriorities: StepPriorityShape[],
  previousQuestions: string[],
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [];

  const mainSteps = stepPriorities
    .filter((p) => p.flowId === "MAIN")
    .sort((a, b) => a.stepIndex - b.stepIndex);

  const findMainStep = (matcher: (description: string) => boolean) =>
    mainSteps.find((step) => matcher(step.description.toLowerCase()));

  const eligibilityStep = findMainStep(
    (description) =>
      (description.includes("policy") &&
        (description.includes("valid") ||
          description.includes("verify") ||
          description.includes("align"))) ||
      (description.includes("eligib") && description.includes("verify")),
  );

  const assignmentStep = findMainStep(
    (description) =>
      description.includes("assign") &&
      (description.includes("agent") ||
        description.includes("review") ||
        description.includes("adjuster")),
  );

  const guidelineStep = findMainStep(
    (description) =>
      description.includes("guideline") ||
      (description.includes("policy") &&
        (description.includes("within") || description.includes("violat"))),
  );

  const seedQuestions: Array<{ question: string; step?: StepPriorityShape }> = [];

  if (eligibilityStep) {
    seedQuestions.push({
      step: eligibilityStep,
      question: `If eligibility/policy validation fails at MAIN step ${eligibilityStep.stepIndex} ("${eligibilityStep.description}"), what exact actions occur (decline, notify claimant, record details, terminate), and is any retry or appeal path allowed?`,
    });
  }

  if (assignmentStep) {
    seedQuestions.push({
      step: assignmentStep,
      question: `What happens if no reviewer/agent is available at MAIN step ${assignmentStep.stepIndex} ("${assignmentStep.description}")? Is the case queued or put on hold, who is notified, and when does processing resume?`,
    });
  }

  if (guidelineStep) {
    seedQuestions.push({
      step: guidelineStep,
      question: `At MAIN step ${guidelineStep.stepIndex} ("${guidelineStep.description}"), how are major policy violations handled versus minor violations? Does one path terminate the claim while another allows negotiation or adjusted payment?`,
    });
  }

  for (const seed of seedQuestions) {
    const allPrevious = [...previousQuestions, ...asked];
    if (await isQuestionDuplicate(seed.question, allPrevious)) continue;

    questions.push({
      id: `coverage-${seed.step?.stepIndex ?? "general"}`,
      question: seed.question,
      context: {
        step: seed.step ? `Step ${seed.step.stepIndex}` : undefined,
        patternType: "coverage_first",
        whyAsking:
          "Coverage-first safeguard: ensure critical eligibility, availability, and policy-outcome branches are captured before deeper probing.",
        flowId: "MAIN",
      },
      answerGuidance:
        "State explicit trigger, actor actions, and end state (resume, terminate, or negotiate). If not specified in source description, say so explicitly.",
    });
    asked.push(seed.question);
  }

  return { questions, asked };
}

/**
 * Phase 1: Gap-based exception questions (highest value).
 * Discovers missing flows by asking about detected gaps.
 */
async function buildGapExceptionQuestions(
  stepPriorities: StepPriorityShape[],
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
  blueprintOnly: boolean,
  blueprintCap: number,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[]; blueprintEmitted: number }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];
  let blueprintQuestionsEmitted = 0;

  const gapSteps = stepPriorities
    .filter((p) => p.relatedGaps.length > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  // When blueprintOnly=true: only emit blueprint gaps, capped at 2, sorted by blueprintConfidence
  const activeGapGroups = blueprintOnly
    ? [
        {
          label: "blueprint",
          filter: (gapType: string, _flowId: string) => isBlueprintGap(gapType),
        },
      ]
    : [
        {
          label: "blueprint",
          filter: (gapType: string, _flowId: string) => isBlueprintGap(gapType),
        },
        {
          label: "centroid-main",
          filter: (gapType: string, flowId: string) =>
            !isBlueprintGap(gapType) && flowId === "MAIN",
        },
        {
          label: "centroid-non-main",
          filter: (gapType: string, flowId: string) =>
            !isBlueprintGap(gapType) && flowId !== "MAIN",
        },
      ];

  for (const group of activeGapGroups) {
    if (currentCount + questions.length >= maxQuestions) break;

    const shouldConsolidate = group.label === "centroid-main";
    const { consolidated, remaining } = shouldConsolidate
      ? buildConsolidatedGroups(gapSteps, group.filter)
      : { consolidated: [], remaining: gapSteps };

    for (const consolidatedGroup of consolidated) {
      if (currentCount + questions.length >= maxQuestions) break;

      const questionText = consolidatedGroup.question;
      const allPrevious = [...previousQuestions, ...asked];
      if (await isQuestionDuplicate(questionText, allPrevious)) {
        console.log(`[DEDUP SKIPPED] Consolidated group "${consolidatedGroup.groupId}": "${questionText.slice(0, 100)}..."`);
        continue;
      }

      const stepLabels = consolidatedGroup.steps.map((step) =>
        formatStepLabel(step.flowId, step.index),
      );

      questions.push({
        id: `consolidated-${consolidatedGroup.groupId}-steps-${consolidatedGroup.steps
          .map((step) => step.index)
          .join("-")}`,
        question: questionText,
        context: {
          step: stepLabels.join(", "),
          steps: stepLabels,
          patternType: consolidatedGroup.groupId,
          whyAsking: `Consolidated gaps across ${consolidatedGroup.steps.length} steps: ${consolidatedGroup.memberGapTypes.join(", ")}. Provide step-specific handling (do not respond with a generic statement).`,
          flowId: consolidatedGroup.steps[0]?.flowId ?? "MAIN",
        },
        answerGuidance: consolidatedGroup.answerGuidance,
      });

      asked.push(questionText);
    }

    for (const priority of remaining) {
      if (currentCount + questions.length >= maxQuestions) break;

      const filteredGaps = priority.relatedGaps.filter((gap) =>
        group.filter(gap.type, priority.flowId),
      );

      if (filteredGaps.length === 0) continue;

      // Sort blueprint gaps by blueprintConfidence descending so highest-confidence
      // blueprints get their questions asked first
      const sortedGaps =
        group.label === "blueprint"
          ? [...filteredGaps].sort(
              (a, b) => (b.blueprintConfidence ?? 0) - (a.blueprintConfidence ?? 0),
            )
          : filteredGaps;

      for (const gap of sortedGaps) {
        if (currentCount + questions.length >= maxQuestions) break;
        if (!gap.suggestedQuestion) continue;

        // Apply blueprint cap
        if (group.label === "blueprint") {
          if (blueprintQuestionsEmitted >= blueprintCap) break;
        }

        const questionText = gap.suggestedQuestion;
        const allPrevious = [...previousQuestions, ...asked];

        if (await isQuestionDuplicate(questionText, allPrevious)) {
          console.log(`[DEDUP SKIPPED] Gap type "${gap.type}" step ${priority.stepIndex}: "${questionText.slice(0, 100)}..."`);
          continue;
        }

        questions.push({
          id: `gap-${gap.type}-step-${priority.stepIndex}`,
          question: questionText,
          context: {
            step: `Step ${priority.stepIndex}`,
            patternType: gap.type,
            whyAsking: `Gap detected: ${gap.description} (Severity: ${gap.severity})`,
            flowId: priority.flowId,
          },
          answerGuidance: getAnswerGuidanceForGapType(gap.type),
        });
        asked.push(questionText);

        if (group.label === "blueprint") {
          blueprintQuestionsEmitted++;
        }
      }
    }
  }

  return { questions, asked, blueprintEmitted: blueprintQuestionsEmitted };
}

/**
 * Phase 2: Missing flow condition questions (medium value).
 * Only ask if a baseline flow is completely missing a condition.
 */
async function buildMissingConditionQuestions(
  flowUncertainties: Array<{
    flowId: string;
    flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
    conditionSpecificity: number;
    hasCondition: boolean;
    uncertaintyScore: number;
    uncertaintyReasons: string[];
  }>,
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
  baselineFlowIds?: Set<string>,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];

  const missingConditions = flowUncertainties
    .filter((f) => f.flowKind !== "MAIN" && !f.hasCondition && (!baselineFlowIds || baselineFlowIds.has(f.flowId)))
    .sort((a, b) => b.uncertaintyScore - a.uncertaintyScore);

  for (const flowUnc of missingConditions) {
    if (currentCount + questions.length >= maxQuestions) break;

    const questionText = `What triggers ${flowUnc.flowId}? Describe the condition that causes this flow to execute.`;
    const allPrevious = [...previousQuestions, ...asked];

    if (await isQuestionDuplicate(questionText, allPrevious)) continue;

    questions.push({
      id: `missing-condition-${flowUnc.flowId}`,
      question: questionText,
      context: {
        patternType: "uncertain_conditions",
        whyAsking: `Flow ${flowUnc.flowId} is missing a condition entirely.`,
        flowId: flowUnc.flowId,
      },
      answerGuidance:
        "Describe the condition that causes this flow to execute, including what triggers it and when it occurs.",
    });
    asked.push(questionText);
  }

  return { questions, asked };
}

/**
 * Phase 3: Clarification questions (lowest value — only if slots remain).
 * Only for CRITICAL steps with vague descriptions.
 */
async function buildClarificationQuestions(
  stepPriorities: StepPriorityShape[],
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];

  const vagueSteps = stepPriorities
    .filter(
      (p) =>
        p.priorityRank === "CRITICAL" &&
        p.uncertaintyReasons.includes("Vague or unclear action"),
    )
    .sort((a, b) => b.criticalityScore - a.criticalityScore);

  for (const priority of vagueSteps) {
    if (currentCount + questions.length >= maxQuestions) break;

    const questionText = `How specifically is "${priority.description}" performed in step ${priority.stepIndex}? What are the detailed actions?`;
    const allPrevious = [...previousQuestions, ...asked];

    if (await isQuestionDuplicate(questionText, allPrevious)) continue;

    questions.push({
      id: `clarify-step-${priority.stepIndex}`,
      question: questionText,
      context: {
        step: `Step ${priority.stepIndex}`,
        patternType: "clarification",
        whyAsking: `Critical step lacks clarity. Specific details are needed.`,
        flowId: priority.flowId,
      },
      answerGuidance:
        "Describe the specific actions, tools, or procedures used in this step.",
    });
    asked.push(questionText);
  }

  return { questions, asked };
}

/**
 * Phase 4: Global gap questions — gaps with no relatedStep (structural, keyword-based).
 * These never appear in stepPriorities and would otherwise be silently dropped.
 */
async function buildGlobalGapQuestions(
  globalGaps: Array<{ type: string; severity: string; description: string; suggestedQuestion?: string }>,
  previousQuestions: string[],
  askedInThisBatch: string[],
  maxQuestions: number,
  currentCount: number,
): Promise<{ questions: OpenEndedQuestion[]; asked: string[] }> {
  const questions: OpenEndedQuestion[] = [];
  const asked: string[] = [...askedInThisBatch];

  // Sort: high severity first, then medium
  const sorted = [...globalGaps].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2);
  });

  for (const gap of sorted) {
    if (currentCount + questions.length >= maxQuestions) break;
    if (!gap.suggestedQuestion) continue;

    const questionText = gap.suggestedQuestion;
    const allPrevious = [...previousQuestions, ...asked];

    if (await isQuestionDuplicate(questionText, allPrevious)) {
      console.log(`[DEDUP SKIPPED] Global gap "${gap.type}": "${questionText.slice(0, 100)}..."`);
      continue;
    }

    questions.push({
      id: `global-gap-${gap.type}`,
      question: questionText,
      context: {
        patternType: gap.type,
        whyAsking: gap.description,
        flowId: "MAIN",
      },
      answerGuidance: getAnswerGuidanceForGapType(gap.type),
    });
    asked.push(questionText);
  }

  return { questions, asked };
}

/**
 * Generates adaptive questions based on priority rankings.
 * Combines step priorities, flow uncertainties, and global gap analysis.
 */
export async function generateAdaptiveQuestions(
  stepPriorities: StepPriorityShape[],
  flowUncertainties: Array<{
    flowId: string;
    flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
    conditionSpecificity: number;
    hasCondition: boolean;
    uncertaintyScore: number;
    uncertaintyReasons: string[];
  }>,
  maxQuestions: number = 6,
  previousQuestions: string[] = [],
  blueprintOnly: boolean = false,
  confirmedBlueprintCount: number = 1,
  baselineFlowIds?: Set<string>,
  globalGaps: Array<{ type: string; severity: string; description: string; suggestedQuestion?: string }> = [],
): Promise<OpenEndedQuestion[]> {
  const allQuestions: OpenEndedQuestion[] = [];
  let askedInThisBatch: string[] = [];

  // Phase 0: Coverage seed questions (first pass only, non-blueprint mode)
  if (!blueprintOnly && previousQuestions.length === 0 && confirmedBlueprintCount <= 1) {
    const { questions: seedQs, asked: seedAsked } = await buildSeedQuestions(
      stepPriorities,
      previousQuestions,
    );
    for (const q of seedQs) {
      if (allQuestions.length >= maxQuestions) break;
      allQuestions.push(q);
    }
    askedInThisBatch = [...seedAsked];
  }

  // Phase 1: Gap-based exception questions (step-level)
  const BLUEPRINT_CAP = blueprintOnly ? Math.max(confirmedBlueprintCount * 2, 2) : Infinity;
  const { questions: gapQs, asked: gapAsked } = await buildGapExceptionQuestions(
    stepPriorities,
    previousQuestions,
    askedInThisBatch,
    maxQuestions,
    allQuestions.length,
    blueprintOnly,
    BLUEPRINT_CAP,
  );
  for (const q of gapQs) {
    if (allQuestions.length >= maxQuestions) break;
    allQuestions.push(q);
  }
  askedInThisBatch = gapAsked;

  // Phase 2 & 3 are skipped when blueprintOnly=true
  if (blueprintOnly) return allQuestions;

  // Phase 2: Missing flow conditions
  const { questions: condQs, asked: condAsked } = await buildMissingConditionQuestions(
    flowUncertainties,
    previousQuestions,
    askedInThisBatch,
    maxQuestions,
    allQuestions.length,
    baselineFlowIds,
  );
  for (const q of condQs) {
    if (allQuestions.length >= maxQuestions) break;
    allQuestions.push(q);
  }
  askedInThisBatch = condAsked;

  // Phase 3: Clarification questions
  const { questions: clarQs, asked: clarAsked } = await buildClarificationQuestions(
    stepPriorities,
    previousQuestions,
    askedInThisBatch,
    maxQuestions,
    allQuestions.length,
  );
  for (const q of clarQs) {
    if (allQuestions.length >= maxQuestions) break;
    allQuestions.push(q);
  }
  askedInThisBatch = clarAsked;

  // Phase 4: Global gap questions (no relatedStep — structural, keyword, actor gaps)
  if (globalGaps.length > 0) {
    const { questions: globalQs } = await buildGlobalGapQuestions(
      globalGaps,
      previousQuestions,
      askedInThisBatch,
      maxQuestions,
      allQuestions.length,
    );
    for (const q of globalQs) {
      if (allQuestions.length >= maxQuestions) break;
      allQuestions.push(q);
    }
  }

  return allQuestions;
}
