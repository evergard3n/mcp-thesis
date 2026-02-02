import z from "zod";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GapAnalysis } from "../analyzers/gap.analyzer.js";

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

export const generateLLMQuestions = async (
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  geminiFunctions: GeminiOpenRouterFunctions,
) => {
  const questions = COVE_LLM_QUESTIONS.map((question) => `- ${question}`);
  const questionsSchema = z.array(z.string());

  const prompt = `
        <intructions>
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
      prompt: `
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
    `,
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

  const prompt = `
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
    patternType?: string;
    whyAsking: string;
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

/**
 * Combined hybrid questions structure
 */
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

  const prompt = `
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

  const prompt = `
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
5. Set confidence level:
   - "high" if answer is in detailed description
   - "medium" if inferred from domain knowledge
   - "low" if making reasonable assumption

Keep answers concise but complete (2-4 sentences for each flow).
</instructions>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: answerSchema,
  });
}

/**
 * Generates adaptive questions based on priority rankings
 * Combines step priorities, flow uncertainties, and gap analysis
 */
export async function generateAdaptiveQuestions(
  stepPriorities: Array<{
    stepIndex: number;
    flowId: string;
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
    }>;
  }>,
  flowUncertainties: Array<{
    flowId: string;
    flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
    conditionSpecificity: number;
    hasCondition: boolean;
    uncertaintyScore: number;
    uncertaintyReasons: string[];
  }>,
  previousQuestions: string[],
  maxQuestions: number = 6,
): Promise<OpenEndedQuestion[]> {
  const questions: OpenEndedQuestion[] = [];
  const askedAbout = new Set<string>();

  // Track what we've already asked about in previous iterations
  for (const prevQ of previousQuestions) {
    const stepMatch = prevQ.match(/step (\d+)/i);
    if (stepMatch) {
      askedAbout.add(`step-${stepMatch[1]}`);
    }
    const flowMatch = prevQ.match(/flow ([A-Z_0-9]+)/i);
    if (flowMatch) {
      askedAbout.add(`flow-${flowMatch[1]}`);
    }
  }

  // 1. Process top priority steps (CRITICAL and HIGH)
  const topSteps = stepPriorities
    .filter((p) => p.priorityRank === "CRITICAL" || p.priorityRank === "HIGH")
    .slice(0, 8); // Consider top 8

  for (const priority of topSteps) {
    if (questions.length >= maxQuestions) break;

    const stepKey = `step-${priority.stepIndex}`;
    if (askedAbout.has(stepKey)) continue;

    // Generate question based on uncertainty type
    if (priority.uncertaintyReasons.includes("Vague or unclear action")) {
      questions.push({
        id: `clarify-step-${priority.stepIndex}`,
        question: `How specifically is "${priority.description}" performed in step ${priority.stepIndex}? What are the detailed actions?`,
        context: {
          step: `Step ${priority.stepIndex}`,
          patternType: "clarification",
          whyAsking: `This step is critical (criticality: ${priority.criticalityScore.toFixed(
            2,
          )}) but lacks clarity. Specific details are needed.`,
        },
        answerGuidance:
          "Describe the specific actions, tools, or procedures used in this step.",
      });
      askedAbout.add(stepKey);
    } else if (
      priority.uncertaintyReasons.includes("No exception handling") &&
      priority.relatedGaps.length > 0
    ) {
      const gap = priority.relatedGaps[0];
      questions.push({
        id: `exception-step-${priority.stepIndex}`,
        question:
          gap.suggestedQuestion ||
          `What happens if step ${priority.stepIndex} fails or encounters an error? Describe all possible exception scenarios.`,
        context: {
          step: `Step ${priority.stepIndex}`,
          patternType: gap.type,
          whyAsking: `Critical step without exception handling. Gap severity: ${gap.severity}`,
        },
        answerGuidance:
          "Describe each exception scenario: what triggers it, what steps are taken, and how it resolves.",
      });
      askedAbout.add(stepKey);
    } else if (
      priority.uncertaintyReasons.includes("Missing actor or target")
    ) {
      questions.push({
        id: `complete-step-${priority.stepIndex}`,
        question: `For step ${priority.stepIndex} ("${priority.description}"): Who performs this action? What system or entity is the target?`,
        context: {
          step: `Step ${priority.stepIndex}`,
          patternType: "incomplete_step",
          whyAsking: "Missing actor or target information for a critical step",
        },
        answerGuidance:
          "Specify the actor performing the action and the target entity or system involved.",
      });
      askedAbout.add(stepKey);
    }
  }

  // 2. Process flow-level uncertainties (top 3)
  const uncertainFlows = flowUncertainties
    .filter((f) => f.uncertaintyScore > 0.5)
    .sort((a, b) => b.uncertaintyScore - a.uncertaintyScore)
    .slice(0, 3);

  for (const flowUnc of uncertainFlows) {
    if (questions.length >= maxQuestions) break;

    const flowKey = `flow-${flowUnc.flowId}`;
    if (askedAbout.has(flowKey)) continue;

    if (flowUnc.flowKind !== "MAIN" && flowUnc.conditionSpecificity < 0.5) {
      questions.push({
        id: `condition-${flowUnc.flowId}`,
        question: `When exactly does ${flowUnc.flowId} occur? Provide specific conditions and triggers.`,
        context: {
          patternType: "uncertain_conditions",
          whyAsking: `Flow ${flowUnc.flowId} has a vague condition. Need specific trigger details.`,
        },
        answerGuidance:
          "Specify the exact condition that triggers this flow, including any relevant values, states, or events.",
      });
      askedAbout.add(flowKey);
    } else if (flowUnc.flowKind !== "MAIN" && !flowUnc.hasCondition) {
      questions.push({
        id: `missing-condition-${flowUnc.flowId}`,
        question: `What triggers ${flowUnc.flowId}? Describe the condition that causes this flow to execute.`,
        context: {
          patternType: "uncertain_conditions",
          whyAsking: `Flow ${flowUnc.flowId} is missing a condition entirely.`,
        },
        answerGuidance:
          "Describe the condition that causes this flow to execute, including what triggers it and when it occurs.",
      });
      askedAbout.add(flowKey);
    }
  }

  // 3. Add gap-based questions for remaining slots
  const remainingGaps = stepPriorities
    .flatMap((p) => p.relatedGaps)
    .filter((g) => g.severity === "high" || g.severity === "medium")
    .filter((g) => {
      // Check if we haven't asked about this gap type yet
      const gapKey = `gap-${g.type}`;
      if (askedAbout.has(gapKey)) return false;
      askedAbout.add(gapKey);
      return true;
    })
    .slice(0, maxQuestions - questions.length);

  for (const gap of remainingGaps) {
    if (questions.length >= maxQuestions) break;

    if (gap.suggestedQuestion) {
      questions.push({
        id: `gap-${gap.type}`,
        question: gap.suggestedQuestion,
        context: {
          patternType: gap.type,
          whyAsking: gap.description,
        },
        answerGuidance:
          "Describe the scenario: what triggers it, what steps are taken, and how it resolves or integrates with the main flow.",
      });
    }
  }

  // Sort by priority (CRITICAL steps first, then HIGH)
  const priorityMap = new Map(
    stepPriorities.map((p) => [`step-${p.stepIndex}`, p.priorityScore]),
  );

  return questions
    .sort((a, b) => {
      const aStepMatch = a.id.match(/step-(\d+)/);
      const bStepMatch = b.id.match(/step-(\d+)/);

      if (aStepMatch && bStepMatch) {
        const aPriority = priorityMap.get(`step-${aStepMatch[1]}`) || 0;
        const bPriority = priorityMap.get(`step-${bStepMatch[1]}`) || 0;
        return bPriority - aPriority;
      }

      return 0;
    })
    .slice(0, maxQuestions);
}
