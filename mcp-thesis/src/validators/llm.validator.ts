import z from "zod";
import geminiFunctions from "../helpers/gemini.functions.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";

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
  useCase: GenUseCase,
  formattedValidationFeedback: string
) => {
  const questions = COVE_LLM_QUESTIONS.map((question) => `- ${question}`);
  const questionsSchema = z.array(z.string());

  const prompt = `
        <intructions>
        You are a validator in a team of software analysts. Your teammates have already created an use case, and validated it using a predefined algorithm.
        You are given the use case, the validation feedback, and a set of further validation questions.
        Your task is to read those three materials, and give FIVE SPECIFIC QUESTIONS ONLY that will help your teammates to improve the use case.
        REMEMBER, questions should be specific to the use case, and the validation feedback.
        You must return questions that your teammates can self-analyze if there are any mistakes in their original response
        You must return questions in an array of strings.
        </intructions>
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
  baseUseCase,
  questions,
}: {
  baseUseCase: GenUseCase;
  questions: string[];
}) {
  const answers: string[] = [];
  for (const question of questions) {
    const llmAnswer = await geminiFunctions.generate({
      prompt: `
      <instructions>
      You are a member in a team of software analysts. Your teammates have created a draft version of an use case, base on the user query.
      Another member of yours has validated the use case, and asked you a question to improve the use case.
      Your task is to answer the questions, and provide some instructions related to your teammates to improve the use case.
      You do not have to explain your reasons, just provide concise answers and instructions.
      </instructions>
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
