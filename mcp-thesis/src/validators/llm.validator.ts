import z from "zod";
import { GeminiOpenRouterFunctions } from "../helpers/gemini-openrouter.functions.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import {
  genUseCaseSchema,
  GenUseCaseSchemaType,
} from "../schemas/genusecase.schema.js";
import openrouterFunction from "../helpers/openrouter.function.js";
import { analysisSchema } from "../schemas/analysis.schema.js";
import { UseCaseTermScore } from "./flat.validator.js";

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

const extraQuestions: string[] = [
  "If there are two actors of the same type existing in an use case, is it necessary to create a new role for each of them, or we can merge into one type that have multiple instances?",
];

export const generateLLMQuestions = async (
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  geminiFunctions: GeminiOpenRouterFunctions
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

export async function compareUseCases({
  originalDescription,
  refUseCase,
  newUseCase,
}: {
  originalDescription: string;
  refUseCase: GenUseCaseSchemaType;
  newUseCase: GenUseCaseSchemaType;
}) {
  const score = await openrouterFunction.generateStructured({
    prompt: `
    <role>
    You are a Senior Business Analyst and Quality Assurance Specialist with 20 years of experience in Software Engineering. Your task is to evaluate the quality of a "Generated Use Case" (produced by an AI) by comparing it against a "Reference Use Case" (Ground Truth/Golden Standard).
    </role>

    <input>
      <original_description>
      ${originalDescription}
      </original_description>
      <reference>
      ${JSON.stringify(refUseCase, null, 2)}
      </reference>
      <generated>
      ${JSON.stringify(newUseCase, null, 2)}
      </generated>
    </input>
    <instructions>
      <criteria>
      You must score the Generated Use Case on a scale of 0 to 10 for each of the following dimensions. Be strict and objective.
      
      **Important:** Use the Original Description as the source of truth for the user's intent. Both the Reference and Generated Use Cases should align with this description.

      **1. Semantic Coverage**
         - Does each step description have the same meaning, or convey the same scenario?
         - Are the Pre-conditions and Post-conditions logically consistent with the Reference?
         - Does the Generated Use Case capture all the key requirements from the Original Description?
         - **Crucial:** Do NOT penalize for different wording/synonyms (e.g., "User logs in" vs. "Customer signs in") if the meaning is identical.
         - **Check:** Are the temporal dependencies correct? (e.g., Step A must happen before Step B).

      **2. Entity & Actor Alignment**
         - Are the Actors correctly identified? (e.g., "Admin" vs "User").
         - Note that different naming is acceptable if the role and responsibilities match.
         - Verify that actors mentioned in the Original Description are properly represented.

      **3. Factuality & Hallucination**
         - Does the Generated Use Case omit any critical steps present in the Reference or Original Description?
         - Be careful: there might be steps that do not exist in the Reference but exist in Gen Use Case, but they still make sense. Make sure to check the overall logic against the Original Description.
         - **Penalty:** Deduct points heavily if the Generated Use Case invents steps or logic that do NOT exist in the Original Description or Reference (Hallucination).
      **4. Structure**
         - Is the Generated Use Case well-structured, with clear delineation of Basic Flow, Alternative Flows, Pre-conditions, Post-conditions, and Guarantees?
         - Compare to the Reference Use Case, is the Generated one missing or "inventing" any new flows?
         - With all flows, is the coverage of Gen Use Case comparable to Reference Use Case?

      </criteria>
      <process>
      Before giving the final score, you must perform a step-by-step analysis:
      1. **Review Original Description:** Understand the user's intent and key requirements.
      2. **Analyze Actors:** Compare actors in Generated vs. Reference, and verify they match the Original Description.
      3. **Map the Flow:** Attempt to map each step in the Reference Flow to a step in the Generated Flow. Note any missing or out-of-order steps.
      4. **Check Logic:** Verify if Pre-conditions/Post-conditions match and align with the Original Description.
      5. **Detect Noise:** Identify any invented information that doesn't come from the Original Description or Reference.
      </process>
    </instructions>
    `,
    zodSchema: analysisSchema,
  });
  return score;
}

export async function generateMultipleChoiceQuestions(
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  geminiFunctions: GeminiOpenRouterFunctions
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
    })
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
  geminiFunctions: GeminiOpenRouterFunctions
): Promise<
  Array<{ questionId: string; selectedOption: string; reasoning: string }>
> {
  const answerSchema = z.array(
    z.object({
      questionId: z.string(),
      selectedOption: z.string(),
      reasoning: z.string(),
    })
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
`
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

export async function generateMultipleChoiceQuestionsWithScores(
  originalDescription: string,
  useCase: GenUseCase,
  formattedValidationFeedback: string,
  validationScore: UseCaseTermScore,
  geminiFunctions: GeminiOpenRouterFunctions
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
    })
  );

  const scoreContext = `
<validationScores>
Overall Score: ${validationScore.overall}/100
Structural Penalty: ${validationScore.structuralPenalty}

Name Quality:
- Unique Name: ${validationScore.hasUniqueName}
- Verb-Noun Pattern: ${validationScore.hasVerbNounPattern}

Coverage:
- Summary Coverage: ${(validationScore.summaryCoverage * 100).toFixed(1)}%
- Precondition Coverage: ${(validationScore.preCoverage * 100).toFixed(1)}%
- Postcondition Coverage: ${(validationScore.postCoverage * 100).toFixed(1)}%
- Process Pattern Coverage: ${(
    validationScore.processPatternCoverage * 100
  ).toFixed(1)}%

Actor Participation:
- Actor Participation: ${(validationScore.actorParticipation * 100).toFixed(1)}%
- Has Main Actor Steps: ${validationScore.hasMainActorSteps}
- Has System Actor: ${validationScore.hasSystemActor}

Flow Structure:
- Has Trigger Event: ${validationScore.hasTriggerEvent}
- Has Definite Ending: ${validationScore.hasDefiniteEnding}
- Valid Step Numbering: ${validationScore.hasValidStepNumbering}
- Has Alternative Flow: ${validationScore.hasAlternativeFlow}
- Has Exception Flow: ${validationScore.hasExceptionFlow}
- Branch Anchoring Coverage: ${(
    validationScore.branchAnchoringCoverage * 100
  ).toFixed(1)}%
- Branch Condition Coverage: ${(
    validationScore.branchConditionCoverage * 100
  ).toFixed(1)}%
- Alt Flow Condition Coverage: ${(
    validationScore.altFlowConditionCoverage * 100
  ).toFixed(1)}%
- Alt Flow Resume Coverage: ${(
    validationScore.altFlowResumeCoverage * 100
  ).toFixed(1)}%

Loop Quality:
- Has Loop: ${validationScore.hasLoop}
- Loop Condition Coverage: ${(
    validationScore.loopConditionCoverage * 100
  ).toFixed(1)}%
- Loop Span Coverage: ${(validationScore.loopSpanCoverage * 100).toFixed(1)}%

Quality:
- No Fluff: ${validationScore.fluffPenalty}
</validationScores>
  `;

  const prompt = `
<task>
Convert validation feedback into 3-5 specific multiple-choice questions for use case clarification.
Use the quantitative scores to identify specific weaknesses and generate targeted questions.
</task>

<originalDescription>
${originalDescription}
</originalDescription>

<currentUseCase>
${JSON.stringify(useCase, null, 2)}
</currentUseCase>

${scoreContext}

<validationFeedback>
${formattedValidationFeedback}
</validationFeedback>

<guidelines>
Create questions with 2-4 concrete options each, prioritizing areas with low scores.

Example (if branchConditionCoverage is low):
Q: "When payment validation fails (alternative flow from step 5), what should happen?"
Options:
- Return to payment method selection and retry
- Cancel order and notify user via email
- Save order as pending and notify admin for manual review
- Allow user to choose between retry or cancel

Focus on:
- Low coverage areas (< 50%)
- Missing structural elements (flags = false)
- Actor responsibilities (if actorParticipation < 80%)
- Flow branching (if branch coverage < 60%)
- Exception handling (if hasExceptionFlow = false)

Return 3-5 questions maximum.
</guidelines>
  `;

  return geminiFunctions.generateStructured({
    prompt,
    schema: mcSchema,
  });
}
