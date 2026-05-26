import semanticService from "../services/semantic.service.js";
import {
  type InteractionMemory,
  type GapType,
} from "../analyzers/gap.analyzer.js";
import { type OpenEndedAnswer } from "../validators/llm.validator.js";
import { parseConsolidatedId } from "./consolidated-id.js";
import { OpenEndedQuestion } from "../validators/question-builders.js";

export async function buildInteractionMemories(
  questions: OpenEndedQuestion[],
  answers: OpenEndedAnswer[],
  iterationNumber: number,
): Promise<InteractionMemory[]> {
  const contextsToEmbed: string[] = [];
  const questionsToEmbed: string[] = [];
  const historyRecords: Omit<InteractionMemory, "vector" | "questionVector">[] =
    [];

  for (const q of questions) {
    const a = answers.find((ans) => ans.questionId === q.id);
    if (!a) continue;

    const stepContext = q.context.step || "Global";
    const contextString = `${stepContext} | ${q.context.whyAsking}`;

    contextsToEmbed.push(contextString);
    questionsToEmbed.push(q.question);

    // get groups, consolidated IDs, and step indexes from question ID
    const parsedConsolidated = parseConsolidatedId(q.id);
    const consolidatedGroupId = parsedConsolidated?.groupId;
    const consolidatedSteps = parsedConsolidated?.stepIndexes;

    historyRecords.push({
      stepContext,
      question: q.question,
      answer: a.answer,
      iteration: iterationNumber,
      answerConfidence: a.confidence as "low" | "medium" | "high" | undefined,
      metadata: {
        // check if single step, then parse and add
        stepIndex: q.id.match(/step-(\d+)/)
          ? parseInt(q.id.match(/step-(\d+)/)![1], 10)
          : undefined,
        // check if consolidated questions, add all consolidated steps' ids
        stepIndexes: consolidatedSteps,
        gapType: q.context.patternType as GapType,
        consolidatedGroupId,
        flowId: q.context.flowId || "MAIN",
      },
    });
  }

  if (contextsToEmbed.length === 0) return [];

  const contextVectors = await semanticService.embedBatch(contextsToEmbed);
  const questionVectors = await semanticService.embedBatch(questionsToEmbed);

  return historyRecords.map((record, i) => ({
    ...record,
    vector: contextVectors[i],
    questionVector: questionVectors[i],
  }));
}
