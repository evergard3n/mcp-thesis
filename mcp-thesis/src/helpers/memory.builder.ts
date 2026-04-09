import semanticService from "../services/semantic.service.js";
import { type InteractionMemory, type GapType } from "../analyzers/gap.analyzer.js";
import {
  type OpenEndedQuestion,
  type OpenEndedAnswer,
} from "../validators/llm.validator.js";

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

    const consolidatedMatch = q.id.match(/consolidated-([a-z_]+)-steps-([0-9-]+)/);
    const consolidatedGroupId = consolidatedMatch
      ? consolidatedMatch[1]
      : undefined;
    const consolidatedSteps = consolidatedMatch?.[2]
      ? consolidatedMatch[2].split("-").map((v) => parseInt(v, 10))
      : undefined;

    historyRecords.push({
      stepContext,
      question: q.question,
      answer: a.answer,
      iteration: iterationNumber,
      answerConfidence: a.confidence as "low" | "medium" | "high" | undefined,
      metadata: {
        stepIndex: q.id.match(/step-(\d+)/)
          ? parseInt(q.id.match(/step-(\d+)/)![1], 10)
          : undefined,
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
