import z from "zod";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { GeminiOpenRouterFunctions } from "./gemini-openrouter.service.js";
import { GenUseCase, GenFlow } from "../interfaces/usecase.interface.new.js";
import { parseConsolidatedId } from "../helpers/consolidated-id.js";
import {
  buildGenerateUseCasePrompt,
  buildExtractFlowsPrompt,
  buildRefineWithHybridAnswersPrompt,
} from "../helpers/usecase.prompts.js";

// ---------------------------------------------------------------------------
// normalizeFlowIds 
// ---------------------------------------------------------------------------

// Recursively computes nesting depth of a flow (MAIN's direct children = 0).
// Used for topological sort so parents are always renamed before their children.
function getTopologicalLevel(
  flowId: string,
  flows: GenFlow[],
  visited = new Set<string>(),
): number {
  if (visited.has(flowId)) return 999; // cycle guard
  visited.add(flowId);
  const flow = flows.find((f) => f.id === flowId);
  if (!flow || !flow.parentFlow || flow.parentFlow === "MAIN") return 0;
  return 1 + getTopologicalLevel(flow.parentFlow, flows, visited);
}

/**
 * Rewrites every non-MAIN flow ID to match the canonical convention
 * (EXT_3a, ALT_2b, EXT_1a.2a, …) after an LLM call may have produced
 * arbitrary IDs. Must run on every LLM-generated use case before storing.
 *
 * Pass order: topological (parents first) so each child can look up its
 * parent's already-renamed ID from the `renames` map.
 */
export function normalizeFlowIds(useCase: GenUseCase): GenUseCase {
  const normalized = JSON.parse(JSON.stringify(useCase)) as GenUseCase;
  const flows = normalized.flows;
  const mainStepCount = flows.find((f) => f.kind === "MAIN")?.steps.length ?? 0;

  // Maps old LLM-generated IDs → new canonical IDs (seeded with MAIN → MAIN).
  const renames = new Map<string, string>([["MAIN", "MAIN"]]);
  // Counts how many EXT/ALT have been assigned per (parent, type, stepIndex)
  // so we can hand out letters a, b, c… without collisions.
  const letterCounters = new Map<string, number>();
  // Fallback slot allocator for flows that have no fromStepIndex.
  const nextFallbackSlot = new Map<string, number>();

  // Process parents before children.
  const sorted = [...flows].sort((a, b) => {
    if (a.kind === "MAIN") return -1;
    if (b.kind === "MAIN") return 1;
    return getTopologicalLevel(a.id, flows) - getTopologicalLevel(b.id, flows);
  });

  for (const flow of sorted) {
    if (flow.kind === "MAIN") continue;

    // Resolve parent to its already-renamed ID.
    const newParentId = renames.get(flow.parentFlow || "MAIN") ?? "MAIN";
    flow.parentFlow = newParentId;

    // Resolve step index: use explicit value or allocate a fallback slot.
    let stepIndex: number;
    if (typeof flow.fromStepIndex === "number") {
      stepIndex = flow.fromStepIndex;
    } else {
      const fallbackStart =
        newParentId === "MAIN"
          ? mainStepCount + 1
          : (flows.find((f) => f.id === newParentId)?.steps.length ?? 0) + 1;
      stepIndex = nextFallbackSlot.get(newParentId) ?? fallbackStart;
      nextFallbackSlot.set(newParentId, stepIndex + 1);
    }
    flow.fromStepIndex = stepIndex;

    // Assign the next available letter for this (parent, type, step) slot.
    const type = flow.kind === "ALTERNATIVE" ? "ALT" : "EXT";
    const counterKey =
      newParentId === "MAIN"
        ? `${newParentId}_${type}_${stepIndex}`
        : `${newParentId}_${stepIndex}`;
    const letterIndex = letterCounters.get(counterKey) ?? 0;
    letterCounters.set(counterKey, letterIndex + 1);
    const letter = String.fromCharCode(97 + letterIndex); // 0→'a', 1→'b', …

    // Build canonical ID: EXT_3a (root) or EXT_1a.2a (nested).
    const newId =
      newParentId === "MAIN"
        ? `${type}_${stepIndex}${letter}`
        : `${newParentId}.${stepIndex}${letter}`;

    renames.set(flow.id, newId);
    flow.id = newId;
  }

  // Patch loop references that pointed to renamed flow IDs.
  for (const loop of normalized.loops ?? []) {
    if (loop.flowRef && renames.has(loop.flowRef)) {
      loop.flowRef = renames.get(loop.flowRef)!;
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Module-level schemas
// ---------------------------------------------------------------------------

const extractedFlowSchema = z.array(
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

export async function extractFlowsFromOpenEndedAnswers(
  answers: Array<{ questionId: string; answer: string; confidence?: string }>,
  baseUseCase: GenUseCase,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<GenFlow[]> {
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
    schema: extractedFlowSchema,
  });
}

export async function refineWithHybridAnswers(
  originalDescription: string,
  baseUseCase: GenUseCase,
  openEndedAnswers: Array<{
    questionId: string;
    answer: string;
    confidence?: string;
  }>,
  geminiFunctions: GeminiOpenRouterFunctions,
): Promise<GenUseCase> {
  const qaContext = openEndedAnswers
    .map((a) => `Answer [${a.questionId}] (confidence: ${a.confidence ?? "high"}):\n${a.answer}`)
    .join("\n\n");

  const prompt = buildRefineWithHybridAnswersPrompt(originalDescription, baseUseCase, qaContext);

  const rebuiltUseCase = await geminiFunctions.generateStructured({
    prompt,
    schema: genUseCaseSchema,
  });

  return normalizeFlowIds(rebuiltUseCase);
}
