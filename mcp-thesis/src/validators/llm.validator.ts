import z from "zod";
import { GeminiOpenRouterFunctions } from "../services/gemini-openrouter.service.js";
import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { BlueprintActivation } from "../analyzers/blueprint.detector.js";
import { DomainType } from "../services/domain-classifier.service.js";
import { type Gap } from "../analyzers/gap-detector.types.js";
import {
  type StepPriorityShape,
  type OpenEndedQuestion,
  buildSeedQuestions,
  buildMainExpansionQuestions,
  buildGapExceptionQuestions,
  buildMissingConditionQuestions,
  buildGlobalGapQuestions,
} from "./question-builders.js";

// ---------------------------------------------------------------------------
// Prompt builder functions
// ---------------------------------------------------------------------------

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

Each blueprint has a Domain field: "${DomainType.HumanSystem}" (people + systems) or "${DomainType.SystemSystem}" (automated).

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

// Re-export OpenEndedQuestion from question-builders so all callers can import
// from a single place (llm.validator.ts) without knowing the internal split.
export type { OpenEndedQuestion } from "./question-builders.js";

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

  // Trust the LLM's confidence assessment from the structured prompt.
  // The prompt already defines clear criteria:
  //   high   = answer found in the detailed description
  //   medium = inferred from domain knowledge
  //   low    = making a reasonable assumption
  //
  // Previous approach: a regex flagged any answer containing words like
  // "may", "could", "not explicitly" as low — but these words appear
  // naturally even in answers that directly cite the source material
  // (e.g. "This scenario is covered by Extension 2a, which may trigger
  // when..."). This killed 72% of valid answers.
  //
  // Only override: if the LLM returned an empty/trivial confidence value,
  // default to "medium" so downstream consumers always have a signal.
  return answers.map((answer) => {
    const conf = (answer.confidence || "").trim().toLowerCase();
    if (!conf || !["high", "medium", "low"].includes(conf)) {
      return { ...answer, confidence: "medium" };
    }
    return answer;
  });
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
    .map((a) => `${a.blueprintId}(${(a.confidence * 100).toFixed(0)}%/${a.domainType ?? "?"})`)
    .join(", ");
  console.log(`[Probe] domain=${domain} | activations=${activations.length}: ${activationSummary}`);
  console.log(`[Probe] detailedDescription length=${detailedDescription.length} chars`);

  const prompt = buildProbeBlueprintsWithExpertPrompt(activations, detailedDescription, domain);
  const schema = z.array(z.string());

  try {
    const result = await geminiFunctions.generateStructured({ prompt, schema });
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

/**
 * Generates adaptive questions based on priority rankings.
 * Combines step priorities, flow uncertainties, and global gap analysis.
 * Phase builders are in ./question-builders.ts.
 */
export async function generateAdaptiveQuestions(
  stepPriorities: StepPriorityShape[],
  flowUncertainties: Array<{
    flowId: string;
    flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
    hasCondition: boolean;
    uncertaintyScore: number;
  }>,
  maxQuestions: number = 6,
  previousQuestions: string[] = [],
  blueprintOnly: boolean = false,
  confirmedBlueprintCount: number = 1,
  baselineFlowIds?: Set<string>,
  globalGaps: Gap[] = [],
  useCase?: GenUseCase,
  originalDescription?: string,
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

  // Phase 0.5: MAIN flow expansion (first pass only, when description available)
  if (previousQuestions.length === 0 && useCase && originalDescription) {
    const { questions: expansionQs, asked: expansionAsked } =
      await buildMainExpansionQuestions(
        useCase,
        originalDescription,
        [...previousQuestions, ...askedInThisBatch],
      );
    for (const q of expansionQs) {
      if (allQuestions.length >= maxQuestions) break;
      allQuestions.push(q);
    }
    askedInThisBatch = [...askedInThisBatch, ...expansionAsked];
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
    baselineFlowIds,
  );
  for (const q of gapQs) {
    if (allQuestions.length >= maxQuestions) break;
    allQuestions.push(q);
  }
  askedInThisBatch = gapAsked;

  // Phase 2 & 3 are skipped when blueprintOnly=true
  if (blueprintOnly) return allQuestions;

  // Phase 2: Missing flow conditions (requires useCase for context-rich question framing)
  if (!useCase) return allQuestions;
  const { questions: condQs, asked: condAsked } = await buildMissingConditionQuestions(
    flowUncertainties,
    previousQuestions,
    askedInThisBatch,
    maxQuestions,
    allQuestions.length,
    useCase,
    baselineFlowIds,
  );
  for (const q of condQs) {
    if (allQuestions.length >= maxQuestions) break;
    allQuestions.push(q);
  }
  askedInThisBatch = condAsked;

  // Phase 3: Global gap questions (no relatedStep — structural, keyword, actor gaps)
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

