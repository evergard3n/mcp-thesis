// --- Score type --------------------------------------------------------------

import { GenStep, GenUseCase } from "../interfaces/usecase.interface.new.js";

export interface UseCaseTermScore {
  // 0–100 (weighted combination of everything below)
  overall: number;
  structuralPenalty: number; // Points deducted for structural errors (duplicate IDs, orphaned flows, etc.)

  // 0–1 coverage ratios
  summaryCoverage: number;
  preCoverage: number;
  postCoverage: number;

  actorParticipation: number; // 0–1
  hasMainActorSteps: boolean;
  hasSystemActor: boolean;

  processPatternCoverage: number; // 0–1 (input / validation / persistence / feedback)

  hasAlternativeFlow: boolean;
  hasExceptionFlow: boolean;
  branchAnchoringCoverage: number; // 0–1, fraction of MAIN steps that have at least one branch
  branchConditionCoverage: number; // 0–1, fraction of alt/exception flows with non-empty condition

  hasLoop: boolean;
  loopConditionCoverage: number; // 0–1
  loopSpanCoverage: number; // 0–1

  fluffPenalty: boolean; // true = no obvious fluff, false = fluff present
}

export interface UseCaseValidationResult {
  valid: boolean;
  score?: UseCaseTermScore;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

// --- Config: stopwords & verb buckets ---------------------------------------

const STOP_WORDS = new Set(
  [
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "onto",
    "about",
    "are",
    "was",
    "were",
    "will",
    "would",
    "can",
    "could",
    "should",
    "shall",
    "have",
    "has",
    "had",
    "been",
    "being",
    "to",
    "of",
    "in",
    "on",
    "at",
    "by",
    "a",
    "an",
    "as",
    "it",
    "is",
    "or",
    "if",
    "so",
    "but",
    "not",
  ].map((w) => w.toLowerCase())
);

const INPUT_VERBS = [
  "enter",
  "fill",
  "type",
  "select",
  "choose",
  "upload",
  "provide",
];
const VALIDATION_VERBS = ["validate", "check", "verify", "ensure"];
const PERSISTENCE_VERBS = [
  "save",
  "store",
  "update",
  "create",
  "persist",
  "record",
];
const FEEDBACK_VERBS = [
  "display",
  "show",
  "inform",
  "return",
  "respond",
  "notify",
  "confirm",
];

const FLUFF_TERMS = [
  "etc.",
  "etc",
  "and so on",
  "something",
  "some data",
  "...",
];

// --- Helpers -----------------------------------------------------------------

/**
 * Normalizes a string by converting it to lowercase.
 * Handles undefined and null values by returning an empty string.
 * @param str - The string to normalize (can be undefined or null)
 * @returns A lowercase version of the string, or empty string if input is null/undefined
 */
function normalize(str: string | undefined | null): string {
  return (str ?? "").toLowerCase();
}

/**
 * Tokenizes text into meaningful words by splitting on non-alphanumeric characters.
 * Filters out stop words and tokens shorter than 3 characters.
 * @param text - The text to tokenize
 * @returns An array of meaningful tokens (3+ chars, non-stop-words)
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Collects unique terms from an array of text strings.
 * Tokenizes each text and accumulates all unique tokens into a set.
 * @param texts - Array of text strings to extract terms from
 * @returns A Set containing all unique tokens found across all texts
 */
function collectTerms(texts: string[]): Set<string> {
  const terms = new Set<string>();
  for (const t of texts) {
    for (const tok of tokenize(t)) {
      terms.add(tok);
    }
  }
  return terms;
}

/**
 * Computes the coverage ratio of terms found in haystack strings.
 * Calculates what fraction of the given terms appear in at least one haystack string.
 * @param terms - Set of terms to search for
 * @param haystacks - Array of strings to search within
 * @returns Coverage ratio (0–1): number of matched terms divided by total terms
 */
function computeCoverage(terms: Set<string>, haystacks: string[]): number {
  if (terms.size === 0 || haystacks.length === 0) return 0;
  const lowers = haystacks.map((h) => h.toLowerCase());
  let matched = 0;
  terms.forEach((term) => {
    const t = term.toLowerCase();
    const found = lowers.some((h) => h.includes(t));
    if (found) matched += 1;
  });
  return matched / terms.size;
}

/**
 * Checks if any description contains at least one of the specified verbs.
 * Performs case-insensitive substring matching.
 * @param descriptions - Array of description strings to search in
 * @param verbs - Array of verbs to search for
 * @returns true if any description contains any of the verbs, false otherwise
 */
function anyContainsVerb(descriptions: string[], verbs: string[]): boolean {
  if (descriptions.length === 0) return false;
  const lowers = descriptions.map((d) => d.toLowerCase());
  for (const verb of verbs) {
    const v = verb.toLowerCase();
    if (lowers.some((d) => d.includes(v))) return true;
  }
  return false;
}

/**
 * Compares two strings for equality ignoring case differences.
 * Uses locale-aware comparison with accent sensitivity only.
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal ignoring case, false otherwise
 */
function eqIgnoreCase(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

// --- Main scoring function ---------------------------------------------------

/**
 * Scores a use case based on multiple quality dimensions including term coverage,
 * actor participation, process patterns, branching, loops, and fluff detection.
 *
 * Scoring dimensions:
 * - Summary/Pre/Post Coverage: How well summary and conditions are reflected in steps
 * - Actor Participation: Fraction of declared actors that appear in steps
 * - Process Pattern Coverage: Presence of input/validation/persistence/feedback verbs
 * - Branching: Alternative/exception flows with proper anchoring and conditions
 * - Loops: Loop presence with proper conditions and span
 * - Fluff Penalty: Detects vague terms like "etc.", "...", "something"
 *
 * @param useCase - The use case to score
 * @returns A comprehensive score object with overall score (0-100) and individual metrics
 */
export function scoreUseCaseTerms(
  useCase: GenUseCase,
  { existingActors }: { existingActors: string[] }
): UseCaseTermScore {
  const flows = useCase.flows ?? [];
  const loops = useCase.loops ?? [];

  const mainFlow = flows.find((f) => f.kind === "MAIN");
  const mainSteps: GenStep[] = mainFlow?.steps ?? [];
  const allSteps: GenStep[] = flows.flatMap((f) => f.steps ?? []);
  const allDescriptions = allSteps
    .map((s) => s.description)
    .filter((d) => d && d.trim().length > 0);

  // 1. Summary / pre / post coverage (term existence)
  const summaryTerms = collectTerms([useCase.summary ?? ""]);
  const preTerms = collectTerms(useCase.preconditions ?? []);
  const postTerms = collectTerms(useCase.postconditions ?? []);

  const summaryCoverage = computeCoverage(summaryTerms, allDescriptions);
  const preCoverage = computeCoverage(preTerms, allDescriptions);
  const postCoverage = computeCoverage(postTerms, allDescriptions);

  // 2. Actor participation / main actor / system
  const normalizedActors = (useCase.actors ?? []).map((a) => a.toLowerCase());
  const usedActors = new Set<string>();
  let hasMainActorSteps = false;
  let hasSystemActor = false;

  for (const step of allSteps) {
    const actorNorm = step.actor.toLowerCase();
    const idx = normalizedActors.indexOf(actorNorm);
    if (idx >= 0) usedActors.add(normalizedActors[idx]);

    if (eqIgnoreCase(step.actor, useCase.mainActor)) {
      hasMainActorSteps = true;
    }
    if (actorNorm === "system") {
      hasSystemActor = true;
    }
  }

  const actorParticipation =
    normalizedActors.length > 0 ? usedActors.size / normalizedActors.length : 0;

  // 3. Process pattern coverage (input / validation / persistence / feedback) in MAIN
  const mainDescriptions = mainSteps.map((s) => s.description).filter(Boolean);

  const hasInputStep = anyContainsVerb(mainDescriptions, INPUT_VERBS);
  const hasValidationStep = anyContainsVerb(mainDescriptions, VALIDATION_VERBS);
  const hasPersistenceStep = anyContainsVerb(
    mainDescriptions,
    PERSISTENCE_VERBS
  );
  const hasFeedbackStep = anyContainsVerb(mainDescriptions, FEEDBACK_VERBS);

  const processPatternCoverage =
    (Number(hasInputStep) +
      Number(hasValidationStep) +
      Number(hasPersistenceStep) +
      Number(hasFeedbackStep)) /
    4;

  // 4. Branching coverage (ALTERNATIVE / EXCEPTION)
  const altFlows = flows.filter((f) => f.kind === "ALTERNATIVE");
  const excFlows = flows.filter((f) => f.kind === "EXCEPTION");
  const altExcFlows = [...altFlows, ...excFlows];

  const hasAlternativeFlow = altFlows.length > 0;
  const hasExceptionFlow = excFlows.length > 0;

  let branchAnchoringCoverage = 0;
  if (mainFlow && mainSteps.length > 0) {
    const anchoredMainIndices = new Set<number>();

    for (const flow of altExcFlows) {
      const parent = flow.parentFlow ?? "MAIN";
      // Only consider branches that claim to attach to MAIN
      if (parent === "MAIN" && typeof flow.fromStepIndex === "number") {
        const idx = flow.fromStepIndex;
        // assume indices are 0-based; adjust if you're using 1-based
        if (idx >= 0 && idx < mainSteps.length) {
          anchoredMainIndices.add(idx);
        }
      }
    }

    branchAnchoringCoverage = anchoredMainIndices.size / mainSteps.length;
  }

  let branchConditionCoverage = 0;
  if (altExcFlows.length > 0) {
    const flowsWithCondition = altExcFlows.filter(
      (f) => typeof f.condition === "string" && f.condition.trim().length > 0
    );
    branchConditionCoverage = flowsWithCondition.length / altExcFlows.length;
  }

  // 5. Loop coverage (if any)
  const hasLoop = loops.length > 0;
  let loopConditionCoverage = 0;
  let loopSpanCoverage = 0;

  if (loops.length > 0) {
    const loopsWithCondition = loops.filter(
      (l) => typeof l.condition === "string" && l.condition.trim().length > 0
    ).length;
    loopConditionCoverage = loopsWithCondition / loops.length;

    const multiStepLoops = loops.filter(
      (l) => l.endIndex > l.startIndex
    ).length;
    loopSpanCoverage = multiStepLoops / loops.length;
  }

  // 6. Fluff penalty (presence of obvious "etc", "..." etc.)
  let fluffPenalty = true;
  const lowerDescriptions = allDescriptions.map((d) => d.toLowerCase());
  for (const fluff of FLUFF_TERMS) {
    const f = fluff.toLowerCase();
    if (lowerDescriptions.some((d) => d.includes(f))) {
      fluffPenalty = false;
      break;
    }
  }

  // 7. Structural integrity penalties
  let structuralPenalty = 0;
  const flowIds = new Set<string>();

  // Check for duplicate flow IDs (penalty: -15 points per duplicate)
  for (const flow of flows) {
    if (flowIds.has(flow.id)) {
      structuralPenalty += 15;
    } else {
      flowIds.add(flow.id);
    }
  }

  // check if the alt flow have a non-existing flow

  // Check for circular flow dependencies (penalty: -20 points per circular reference)
  for (const flow of flows) {
    if (flow.parentFlow && flow.parentFlow !== "MAIN") {
      const visited = new Set<string>([flow.id]);
      let currentParent: string | undefined = flow.parentFlow;

      while (currentParent && currentParent !== "MAIN") {
        if (visited.has(currentParent)) {
          structuralPenalty += 20;
          break;
        }
        visited.add(currentParent);
        const parentFlow = flows.find((f) => f.id === currentParent);
        currentParent = parentFlow?.parentFlow ?? undefined;
      }
    }
  }

  // Check for orphaned loops (penalty: -10 points per orphaned loop)
  for (const loop of loops) {
    if (loop.flowRef !== "MAIN" && !flowIds.has(loop.flowRef)) {
      structuralPenalty += 10;
    }
  }

  // Check for invalid fromStepIndex (penalty: -8 points per invalid index)
  for (const flow of flows) {
    if (flow.parentFlow && typeof flow.fromStepIndex === "number") {
      const parentFlow = flows.find((f) => f.id === flow.parentFlow);
      if (parentFlow && parentFlow.steps) {
        const parentStepCount = parentFlow.steps.length;
        if (flow.fromStepIndex < 0 || flow.fromStepIndex >= parentStepCount) {
          structuralPenalty += 8;
        }
      }
    }
  }

  // Check for invalid loop indices (penalty: -8 points per invalid loop)
  for (const loop of loops) {
    const referencedFlow = flows.find((f) => f.id === loop.flowRef);
    if (referencedFlow && referencedFlow.steps) {
      const stepCount = referencedFlow.steps.length;

      if (
        loop.startIndex < 0 ||
        loop.startIndex >= stepCount ||
        loop.endIndex < 0 ||
        loop.endIndex >= stepCount ||
        loop.startIndex > loop.endIndex
      ) {
        structuralPenalty += 8;
      }
    }
  }

  // 8. Combine into overall score (0–100)
  // Weights are heuristic; adjust as you wish.
  const branchKindScore =
    (hasAlternativeFlow ? 0.5 : 0) + (hasExceptionFlow ? 0.5 : 0); // 0–1
  const branchScore =
    0.4 * branchAnchoringCoverage +
    0.3 * branchConditionCoverage +
    0.3 * branchKindScore;

  const loopScore =
    0.4 * (hasLoop ? 1 : 0) +
    0.3 * loopConditionCoverage +
    0.3 * loopSpanCoverage;

  const overall0to1 =
    0.15 * summaryCoverage +
    0.05 * preCoverage +
    0.05 * postCoverage +
    0.15 * actorParticipation +
    0.05 * (hasMainActorSteps ? 1 : 0) +
    0.25 * processPatternCoverage +
    0.15 * branchScore +
    0.05 * loopScore +
    0.1 * (fluffPenalty ? 1 : 0);

  // Apply structural penalties and clamp to 0-100
  const overall = Math.max(
    0,
    Math.min(100, overall0to1 * 100 - structuralPenalty)
  );

  return {
    overall,
    structuralPenalty,

    summaryCoverage,
    preCoverage,
    postCoverage,

    actorParticipation,
    hasMainActorSteps,
    hasSystemActor,

    processPatternCoverage,

    hasAlternativeFlow,
    hasExceptionFlow,
    branchAnchoringCoverage,
    branchConditionCoverage,

    hasLoop,
    loopConditionCoverage,
    loopSpanCoverage,

    fluffPenalty,
  };
}

/**
 * Validates a use case and returns detailed feedback including errors, warnings, and suggestions.
 * This function can be used to generate instructions for an LLM to improve the use case.
 *
 * Error severity levels:
 * - Errors: Critical issues that make the use case invalid or unusable
 * - Warnings: Important issues that significantly impact quality
 * - Suggestions: Recommendations for improvement
 *
 * @param useCase - The use case to validate
 * @param existingActors - Optional list of actors already defined in the project
 * @returns Validation result with errors, warnings, suggestions, and score
 */
export function validateUseCaseWithFeedback(
  useCase: GenUseCase,
  existingActors?: string[]
): UseCaseValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // --- Critical validation checks ---

  // Check for empty or missing summary
  if (!useCase.summary || useCase.summary.trim().length === 0) {
    errors.push(
      "CRITICAL: The use case summary is missing or empty. Please provide a clear, concise summary that describes the goal of this use case."
    );
  }

  // Check for main flow
  const flows = useCase.flows ?? [];
  const mainFlow = flows.find((f) => f.kind === "MAIN");

  if (!mainFlow) {
    errors.push(
      "CRITICAL: No MAIN flow found. Every use case must have a MAIN flow that describes the primary sequence of steps."
    );
    return { valid: false, errors, warnings, suggestions };
  }

  const mainSteps = mainFlow.steps ?? [];
  if (mainSteps.length === 0) {
    errors.push(
      "CRITICAL: The MAIN flow has no steps. Please add at least 3-5 steps that describe the main sequence of actions."
    );
    return { valid: false, errors, warnings, suggestions };
  }

  // Check for actors
  if (!useCase.actors || useCase.actors.length === 0) {
    errors.push(
      "CRITICAL: No actors defined. Please specify at least one actor who interacts with the system."
    );
  }

  // Check for main actor
  if (!useCase.mainActor || useCase.mainActor.trim().length === 0) {
    errors.push(
      "CRITICAL: Main actor is not specified. Please designate which actor is the primary initiator of this use case."
    );
  }

  // Check for flows with parentFlow having ID "MAIN"
  for (const flow of flows) {
    if (flow.parentFlow && flow.id === "MAIN") {
      errors.push(
        `CRITICAL: Flow with ID 'MAIN' cannot have a parentFlow. Only the main flow should have ID 'MAIN', and it should not have a parent.`
      );
    }
  }

  // Check for non-MAIN flows that should have parentFlow
  for (const flow of flows) {
    if (flow.kind !== "MAIN" && !flow.parentFlow) {
      errors.push(
        `CRITICAL: Flow '${flow.id}' has kind '${flow.kind}' but no parentFlow specified. Alternative and exception flows must specify which flow they branch from.`
      );
    }
  }

  // Check for duplicate flow IDs
  const flowIds = new Set<string>();
  const duplicateFlowIds: string[] = [];

  for (const flow of flows) {
    if (flowIds.has(flow.id)) {
      duplicateFlowIds.push(flow.id);
    } else {
      flowIds.add(flow.id);
    }
  }

  if (duplicateFlowIds.length > 0) {
    errors.push(
      `CRITICAL: Duplicate flow IDs found: ${duplicateFlowIds.join(
        ", "
      )}. Each flow must have a unique ID.`
    );
  }

  // Check for orphaned flows (parentFlow references non-existent flow)
  const loops = useCase.loops ?? [];

  for (const flow of flows) {
    if (flow.parentFlow && flow.parentFlow !== "MAIN") {
      if (!flowIds.has(flow.parentFlow)) {
        errors.push(
          `CRITICAL: Flow '${flow.id}' references non-existent parent flow '${flow.parentFlow}'. Parent flow must be either 'MAIN' or an existing flow ID.`
        );
      }
    }
  }

  // Check for circular flow dependencies
  for (const flow of flows) {
    if (flow.parentFlow && flow.parentFlow !== "MAIN") {
      const visited = new Set<string>([flow.id]);
      let currentParent: string | undefined = flow.parentFlow;

      while (currentParent && currentParent !== "MAIN") {
        if (visited.has(currentParent)) {
          errors.push(
            `CRITICAL: Circular flow dependency detected involving flow '${flow.id}'. Flows cannot have circular parent-child relationships.`
          );
          break;
        }

        visited.add(currentParent);
        const parentFlow = flows.find((f) => f.id === currentParent);
        currentParent = parentFlow?.parentFlow ?? undefined;
      }
    }
  }

  // Check for orphaned loops (flowRef references non-existent flow)
  for (const loop of loops) {
    if (loop.flowRef !== "MAIN" && !flowIds.has(loop.flowRef)) {
      errors.push(
        `CRITICAL: Loop references non-existent flow '${loop.flowRef}'. Flow reference must be either 'MAIN' or an existing flow ID.`
      );
    }
  }

  // Check if fromStepIndex points to valid step in parent flow
  for (const flow of flows) {
    if (flow.parentFlow && typeof flow.fromStepIndex === "number") {
      const parentFlow = flows.find((f) => f.id === flow.parentFlow);
      if (parentFlow && parentFlow.steps) {
        const parentStepCount = parentFlow.steps.length;
        if (flow.fromStepIndex < 0 || flow.fromStepIndex >= parentStepCount) {
          errors.push(
            `CRITICAL: Flow '${flow.id}' has fromStepIndex ${
              flow.fromStepIndex
            }, but parent flow '${
              flow.parentFlow
            }' only has ${parentStepCount} steps (valid indices: 0-${
              parentStepCount - 1
            }).`
          );
        }
      }
    }
  }

  // Check if loop indices are valid for their referenced flow
  for (const loop of loops) {
    const referencedFlow = flows.find((f) => f.id === loop.flowRef);
    if (referencedFlow && referencedFlow.steps) {
      const stepCount = referencedFlow.steps.length;

      if (loop.startIndex < 0 || loop.startIndex >= stepCount) {
        errors.push(
          `CRITICAL: Loop has startIndex ${loop.startIndex}, but flow '${
            loop.flowRef
          }' only has ${stepCount} steps (valid indices: 0-${stepCount - 1}).`
        );
      }

      if (loop.endIndex < 0 || loop.endIndex >= stepCount) {
        errors.push(
          `CRITICAL: Loop has endIndex ${loop.endIndex}, but flow '${
            loop.flowRef
          }' only has ${stepCount} steps (valid indices: 0-${stepCount - 1}).`
        );
      }

      if (loop.startIndex > loop.endIndex) {
        warnings.push(
          `INVALID LOOP RANGE: Loop startIndex (${loop.startIndex}) is greater than endIndex (${loop.endIndex}). This creates a backwards or invalid loop.`
        );
      }
    }
  }

  // If we have critical errors, return early
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      suggestions,
      score: {
        overall: 0,
        structuralPenalty: 0,
        summaryCoverage: 0,
        preCoverage: 0,
        postCoverage: 0,
        actorParticipation: 0,
        hasMainActorSteps: false,
        hasSystemActor: false,
        processPatternCoverage: 0,
        hasAlternativeFlow: false,
        hasExceptionFlow: false,
        branchAnchoringCoverage: 0,
        branchConditionCoverage: 0,
        hasLoop: false,
        loopConditionCoverage: 0,
        loopSpanCoverage: 0,
        fluffPenalty: false,
      },
    };
  }

  // --- Score the use case ---
  const score = scoreUseCaseTerms(useCase, {
    existingActors: existingActors ?? [],
  });

  // --- Analyze score and generate feedback ---

  // 1. Summary and coverage issues
  if (score.summaryCoverage < 0.3) {
    warnings.push(
      `LOW SUMMARY COVERAGE (${(score.summaryCoverage * 100).toFixed(
        0
      )}%): The summary terms are poorly reflected in the step descriptions. Ensure that key concepts mentioned in the summary appear in the actual steps.`
    );
  } else if (score.summaryCoverage < 0.6) {
    suggestions.push(
      `IMPROVE SUMMARY COVERAGE (${(score.summaryCoverage * 100).toFixed(
        0
      )}%): Consider adding more steps that address the concepts mentioned in the summary, or refine the summary to better match the steps.`
    );
  }

  // 2. Preconditions and postconditions
  if (score.preCoverage < 0.3 && (useCase.preconditions?.length ?? 0) > 0) {
    warnings.push(
      `LOW PRECONDITION COVERAGE (${(score.preCoverage * 100).toFixed(
        0
      )}%): The preconditions are not well-represented in the steps. Consider adding validation steps that verify the preconditions.`
    );
  }

  if (score.postCoverage < 0.3 && (useCase.postconditions?.length ?? 0) > 0) {
    warnings.push(
      `LOW POSTCONDITION COVERAGE (${(score.postCoverage * 100).toFixed(
        0
      )}%): The postconditions are not well-represented in the steps. Ensure the final steps achieve or verify the stated postconditions.`
    );
  }

  if (!useCase.preconditions || useCase.preconditions.length === 0) {
    suggestions.push(
      "ADD PRECONDITIONS: Consider adding preconditions that must be true before this use case can execute (e.g., 'User must be logged in', 'Database must be accessible')."
    );
  }

  if (!useCase.postconditions || useCase.postconditions.length === 0) {
    suggestions.push(
      "ADD POSTCONDITIONS: Consider adding postconditions that describe the system state after successful completion (e.g., 'Order is saved in database', 'User receives confirmation')."
    );
  }

  // 3. Actor participation
  if (score.actorParticipation < 0.5) {
    warnings.push(
      `LOW ACTOR PARTICIPATION (${(score.actorParticipation * 100).toFixed(
        0
      )}%): Only ${(score.actorParticipation * 100).toFixed(
        0
      )}% of declared actors appear in the steps. Either remove unused actors from the actor list, or add steps where these actors participate.`
    );
  }

  if (!score.hasMainActorSteps) {
    errors.push(
      `MAIN ACTOR NOT PARTICIPATING: The main actor '${useCase.mainActor}' does not appear in any step. The main actor must initiate or participate in the use case.`
    );
  }

  if (!score.hasSystemActor) {
    suggestions.push(
      "ADD SYSTEM ACTOR STEPS: Consider adding steps where the 'System' actor performs actions (validation, processing, storage, etc.). Most use cases involve system responses."
    );
  }

  // Check for actor mismatches with existing actors
  if (existingActors && existingActors.length > 0) {
    const newActors =
      useCase.actors?.filter(
        (a) => !existingActors.some((ea) => eqIgnoreCase(ea, a))
      ) ?? [];

    if (newActors.length > 0) {
      suggestions.push(
        `NEW ACTORS DETECTED: The following actors are not in the existing project: ${newActors.join(
          ", "
        )}. Ensure these are intentionally new actors and not typos of existing ones.`
      );
    }
  }

  // 4. Process pattern coverage
  if (score.processPatternCoverage < 0.5) {
    const missing: string[] = [];
    const mainDescriptions = mainSteps
      .map((s) => s.description)
      .filter(Boolean);

    if (!anyContainsVerb(mainDescriptions, INPUT_VERBS)) {
      missing.push("INPUT (enter, fill, type, select, provide data)");
    }
    if (!anyContainsVerb(mainDescriptions, VALIDATION_VERBS)) {
      missing.push("VALIDATION (validate, check, verify, ensure)");
    }
    if (!anyContainsVerb(mainDescriptions, PERSISTENCE_VERBS)) {
      missing.push("PERSISTENCE (save, store, update, create, persist)");
    }
    if (!anyContainsVerb(mainDescriptions, FEEDBACK_VERBS)) {
      missing.push("FEEDBACK (display, show, inform, notify, confirm)");
    }

    warnings.push(
      `INCOMPLETE PROCESS PATTERN (${(
        score.processPatternCoverage * 100
      ).toFixed(
        0
      )}%): The main flow is missing important process steps. Consider adding: ${missing.join(
        "; "
      )}.`
    );
  }

  // 5. Alternative and exception flows
  if (!score.hasAlternativeFlow && !score.hasExceptionFlow) {
    suggestions.push(
      "ADD ALTERNATIVE/EXCEPTION FLOWS: Consider adding alternative flows (different valid paths) or exception flows (error handling) to make the use case more complete. Real-world scenarios rarely follow only the happy path."
    );
  } else {
    if (!score.hasAlternativeFlow) {
      suggestions.push(
        "ADD ALTERNATIVE FLOWS: Consider adding alternative flows that show different valid ways to accomplish the goal."
      );
    }

    if (!score.hasExceptionFlow) {
      suggestions.push(
        "ADD EXCEPTION FLOWS: Consider adding exception flows that handle error conditions and invalid inputs."
      );
    }
  }

  // 6. Branch anchoring and conditions
  if (
    score.branchAnchoringCoverage < 0.2 &&
    (score.hasAlternativeFlow || score.hasExceptionFlow)
  ) {
    warnings.push(
      `POOR BRANCH ANCHORING (${(score.branchAnchoringCoverage * 100).toFixed(
        0
      )}%): Alternative/exception flows are not properly anchored to main flow steps. Specify the 'fromStepIndex' for each branch to indicate where it diverges.`
    );
  }

  if (
    score.branchConditionCoverage < 0.5 &&
    (score.hasAlternativeFlow || score.hasExceptionFlow)
  ) {
    warnings.push(
      `MISSING BRANCH CONDITIONS (${(
        score.branchConditionCoverage * 100
      ).toFixed(
        0
      )}%): Many alternative/exception flows lack proper condition descriptions. Add clear conditions that explain when each branch is taken.`
    );
  }

  // 7. Loop coverage
  if (score.hasLoop) {
    if (score.loopConditionCoverage < 0.5) {
      warnings.push(
        `MISSING LOOP CONDITIONS (${(score.loopConditionCoverage * 100).toFixed(
          0
        )}%): Loops without conditions are unclear. Specify what condition controls each loop (e.g., 'while items remain', 'until user confirms').`
      );
    }

    if (score.loopSpanCoverage < 0.5) {
      warnings.push(
        `INVALID LOOP SPANS (${(score.loopSpanCoverage * 100).toFixed(
          0
        )}%): Some loops have the same start and end index. Loops should span multiple steps to be meaningful.`
      );
    }
  }

  // 8. Fluff detection
  if (!score.fluffPenalty) {
    warnings.push(
      `VAGUE LANGUAGE DETECTED: The use case contains vague terms like "etc.", "...", or "something". Replace these with specific, concrete descriptions. Each step should be clear and actionable.`
    );
  }

  // 9. Structural penalty feedback
  if (score.structuralPenalty > 0) {
    warnings.push(
      `STRUCTURAL INTEGRITY ISSUES (${score.structuralPenalty.toFixed(
        0
      )} penalty points): The use case has structural problems that reduced the overall score. See the critical errors above for details.`
    );
  }

  // 10. Overall score assessment
  if (score.overall < 40) {
    warnings.push(
      `LOW OVERALL QUALITY SCORE (${score.overall.toFixed(
        0
      )}/100): This use case needs significant improvement across multiple dimensions. Address the specific issues mentioned above.`
    );
  } else if (score.overall < 60) {
    suggestions.push(
      `MODERATE QUALITY SCORE (${score.overall.toFixed(
        0
      )}/100): This use case is acceptable but could be improved. Focus on the warnings and suggestions above for enhancement.`
    );
  } else if (score.overall < 80) {
    suggestions.push(
      `GOOD QUALITY SCORE (${score.overall.toFixed(
        0
      )}/100): This is a solid use case. Consider the suggestions above for further refinement.`
    );
  }

  // Determine validity
  const valid = errors.length === 0 && warnings.length === 0;

  return {
    valid,
    score,
    errors,
    warnings,
    suggestions,
  };
}

/**
 * Formats validation results into a single instruction string for LLM feedback.
 * Combines errors, warnings, and suggestions into a clear, actionable format.
 *
 * @param result - The validation result to format
 * @returns A formatted string containing all feedback, or empty string if valid
 */
export function formatValidationForLLM(
  result: UseCaseValidationResult
): string {
  if (
    result.valid &&
    result.errors.length === 0 &&
    result.warnings.length === 0 &&
    result.suggestions.length === 0
  ) {
    return "";
  }

  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push("CRITICAL ERRORS (must fix):");
    result.errors.forEach((err, idx) => {
      parts.push(`${idx + 1}. ${err}`);
    });
    parts.push("");
  }

  if (result.warnings.length > 0) {
    parts.push("WARNINGS (important improvements needed):");
    result.warnings.forEach((warn, idx) => {
      parts.push(`${idx + 1}. ${warn}`);
    });
    parts.push("");
  }

  if (result.suggestions.length > 0) {
    parts.push("SUGGESTIONS (recommended improvements):");
    result.suggestions.forEach((sugg, idx) => {
      parts.push(`${idx + 1}. ${sugg}`);
    });
    parts.push("");
  }

  if (result.score) {
    parts.push(`Overall Quality Score: ${result.score.overall.toFixed(0)}/100`);
    if (result.score.structuralPenalty > 0) {
      parts.push(
        `Structural Penalty Applied: -${result.score.structuralPenalty.toFixed(
          0
        )} points (due to duplicate IDs, orphaned flows, circular dependencies, or invalid indices)`
      );
    }
  }

  return parts.join("\n");
}
