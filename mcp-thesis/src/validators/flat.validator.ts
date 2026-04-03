// --- Score type --------------------------------------------------------------

import z from "zod";
import {
  GenStep,
  GenFlow,
  GenLoop,
  GenUseCase,
} from "../interfaces/usecase.interface.new.js";
import { genUseCaseSchema } from "../schemas/genusecase.schema.js";
import { JsonProjectStore } from "../stores/projectStore.js";

export interface UseCaseTermScore {
  // 0–100 (weighted combination of everything below)
  overall: number;
  structuralPenalty: number; // Points deducted for structural errors (duplicate IDs, orphaned flows, etc.)

  // Name-level checks
  hasUniqueName: boolean; // true if name is unique across project
  hasVerbNounPattern: boolean; // true if name follows verb+noun heuristic

  // 0–1 coverage ratios
  summaryCoverage: number;
  preCoverage: number;
  postCoverage: number;

  // Pre/Post flags
  hasPreconditions: boolean;
  hasPostconditions: boolean;

  actorParticipation: number; // 0–1
  hasMainActorSteps: boolean;
  hasSystemActor: boolean;

  processPatternCoverage: number; // 0–1 (input / validation / persistence / feedback)

  // Flow-level checks
  hasTriggerEvent: boolean; // true if trigger/initiating event is defined
  hasDefiniteEnding: boolean; // true if main flow has clear end state
  hasValidStepNumbering: boolean; // true if no duplicate/gap in step indices

  hasAlternativeFlow: boolean;
  hasExceptionFlow: boolean;
  branchAnchoringCoverage: number; // 0–1, fraction of MAIN steps that have at least one branch
  branchConditionCoverage: number; // 0–1, fraction of alt/exception flows with non-empty condition

  // Alt flow-level checks
  altFlowConditionCoverage: number; // 0-1, fraction of alt flows with non-empty condition
  altFlowResumeCoverage: number; // 0-1, fraction of alt flows with valid resume/end

  hasLoop: boolean;
  loopConditionCoverage: number; // 0–1
  loopSpanCoverage: number; // 0–1

  fluffPenalty: boolean; // true = no obvious fluff, false = fluff present
}

export interface UseCaseStructuralValidationResult {
  valid: boolean;
  errors: string[];
}

export interface UseCaseQualityValidationResult {
  score: UseCaseTermScore;
  warnings: string[];
  suggestions: string[];
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

// Common verbs for use case naming (verb+noun pattern)
const USECASE_VERBS = [
  "create",
  "add",
  "edit",
  "update",
  "delete",
  "remove",
  "view",
  "display",
  "show",
  "list",
  "search",
  "find",
  "filter",
  "sort",
  "manage",
  "process",
  "submit",
  "send",
  "receive",
  "validate",
  "verify",
  "approve",
  "reject",
  "cancel",
  "register",
  "login",
  "logout",
  "upload",
  "download",
  "export",
  "import",
  "generate",
  "calculate",
  "configure",
  "setup",
  "initialize",
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

/**
 * Checks if a use case name follows the verb+noun pattern (e.g., "Create Order", "Manage User Account").
 * @param name - The use case name to check
 * @returns true if name starts with a recognized verb followed by a noun
 */
function hasVerbNounPattern(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  const words = normalized.split(/\s+/);

  if (words.length < 2) return false;

  const firstWord = words[0];
  return USECASE_VERBS.includes(firstWord);
}

/**
 * Checks if step indices in a flow have no duplicates and no gaps.
 * Assumes steps should be numbered sequentially starting from 0 or 1.
 * @param steps - Array of steps to check
 * @returns true if numbering is valid (no duplicates, no gaps)
 */
function hasValidStepNumbering(steps: GenStep[]): boolean {
  if (steps.length === 0) return true;

  const indices = steps.map((s) => s.index);
  const uniqueIndices = new Set(indices);

  // Check for duplicates
  if (uniqueIndices.size !== indices.length) return false;

  // Check for gaps (should be consecutive)
  const sorted = Array.from(uniqueIndices).sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Should have exactly (max - min + 1) elements for no gaps
  return sorted.length === max - min + 1;
}

/**
 * Checks if a flow has indicators of a definite ending (e.g., final step with clear completion).
 * Looks for keywords like "complete", "finish", "end", "confirm", "success" in last step.
 * @param flow - The flow to check
 * @returns true if flow has clear ending indicators
 */
function hasDefiniteEnding(flow: GenFlow): boolean {
  if (!flow.steps || flow.steps.length === 0) return false;

  const lastStep = flow.steps[flow.steps.length - 1];
  const description = lastStep.description.toLowerCase();

  const endingKeywords = [
    "complete",
    "finish",
    "end",
    "done",
    "confirm",
    "success",
    "close",
    "terminate",
    "exit",
  ];

  return endingKeywords.some((keyword) => description.includes(keyword));
}

// --- Private scoring sub-functions ------------------------------------------

interface NameDimensionResult {
  hasUniqueName: boolean;
  hasVerbNoun: boolean;
}

function scoreNameDimension(
  useCase: GenUseCase,
  existingUseCaseNames: string[]
): NameDimensionResult {
  const hasUniqueName = !existingUseCaseNames.some((name) =>
    eqIgnoreCase(name, useCase.name)
  );
  const hasVerbNoun = hasVerbNounPattern(useCase.name);
  return { hasUniqueName, hasVerbNoun };
}

interface SummaryDimensionResult {
  hasPreconditions: boolean;
  hasPostconditions: boolean;
  summaryCoverage: number;
  preCoverage: number;
  postCoverage: number;
}

function scoreSummaryDimension(
  useCase: GenUseCase,
  allDescriptions: string[]
): SummaryDimensionResult {
  const hasPreconditions = (useCase.preconditions?.length ?? 0) > 0;
  const hasPostconditions = (useCase.postconditions?.length ?? 0) > 0;
  const summaryTerms = collectTerms([useCase.summary ?? ""]);
  const preTerms = collectTerms(useCase.preconditions ?? []);
  const postTerms = collectTerms(useCase.postconditions ?? []);

  const summaryCoverage = computeCoverage(summaryTerms, allDescriptions);
  const preCoverage = computeCoverage(preTerms, allDescriptions);
  const postCoverage = computeCoverage(postTerms, allDescriptions);

  return {
    hasPreconditions,
    hasPostconditions,
    summaryCoverage,
    preCoverage,
    postCoverage,
  };
}

interface ActorDimensionResult {
  actorParticipation: number;
  hasMainActorSteps: boolean;
  hasSystemActor: boolean;
}

function scoreActorDimension(
  useCase: GenUseCase,
  allSteps: GenStep[]
): ActorDimensionResult {
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

  return { actorParticipation, hasMainActorSteps, hasSystemActor };
}

interface ProcessPatternDimensionResult {
  processPatternCoverage: number;
}

function scoreProcessPatternDimension(
  mainSteps: GenStep[]
): ProcessPatternDimensionResult {
  const mainDescriptions = mainSteps.map((s) => s.description).filter(Boolean);

  const hasInputStep = anyContainsVerb(mainDescriptions, INPUT_VERBS);
  const hasValidationStep = anyContainsVerb(mainDescriptions, VALIDATION_VERBS);
  const hasPersistenceStep = anyContainsVerb(mainDescriptions, PERSISTENCE_VERBS);
  const hasFeedbackStep = anyContainsVerb(mainDescriptions, FEEDBACK_VERBS);

  const processPatternCoverage =
    (Number(hasInputStep) +
      Number(hasValidationStep) +
      Number(hasPersistenceStep) +
      Number(hasFeedbackStep)) /
    4;

  return { processPatternCoverage };
}

interface FlowLevelDimensionResult {
  hasTrigger: boolean;
  hasEnding: boolean;
  hasValidNumbering: boolean;
}

function scoreFlowLevelDimension(
  flows: GenFlow[],
  mainFlow: GenFlow | undefined,
  mainSteps: GenStep[]
): FlowLevelDimensionResult {
  // Check for trigger event (first step should indicate how use case starts)
  const hasTrigger =
    mainSteps.length > 0 && mainSteps[0].description.trim().length > 0;

  // Check for definite ending in main flow
  const hasEnding = mainFlow ? hasDefiniteEnding(mainFlow) : false;

  // Check step numbering validity across all flows
  const hasValidNumbering = flows.every((flow) =>
    hasValidStepNumbering(flow.steps ?? [])
  );

  return { hasTrigger, hasEnding, hasValidNumbering };
}

interface BranchingDimensionResult {
  hasAlternativeFlow: boolean;
  hasExceptionFlow: boolean;
  branchAnchoringCoverage: number;
  branchConditionCoverage: number;
}

function scoreBranchingDimension(
  flows: GenFlow[],
  mainFlow: GenFlow | undefined,
  mainSteps: GenStep[]
): BranchingDimensionResult {
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

  return {
    hasAlternativeFlow,
    hasExceptionFlow,
    branchAnchoringCoverage,
    branchConditionCoverage,
  };
}

interface AltFlowDimensionResult {
  altFlowConditionCoverage: number;
  altFlowResumeCoverage: number;
}

function scoreAltFlowDimension(flows: GenFlow[]): AltFlowDimensionResult {
  const altFlows = flows.filter((f) => f.kind === "ALTERNATIVE");
  const excFlows = flows.filter((f) => f.kind === "EXCEPTION");
  const altExcFlows = [...altFlows, ...excFlows];

  // Check condition coverage for alternative flows specifically
  let altFlowConditionCoverage = 0;
  if (altFlows.length > 0) {
    const altFlowsWithCondition = altFlows.filter(
      (f) => typeof f.condition === "string" && f.condition.trim().length > 0
    );
    altFlowConditionCoverage = altFlowsWithCondition.length / altFlows.length;
  }

  // Check if alt flows have valid resume point or end state
  // A valid alt flow should either:
  // 1. Have a resumeStepRef (not implemented in schema yet, so we check for non-empty steps)
  // 2. Have its own ending (last step indicates completion)
  let altFlowResumeCoverage = 0;
  if (altExcFlows.length > 0) {
    const validAltFlows = altExcFlows.filter((flow) => {
      if (!flow.steps || flow.steps.length === 0) return false;
      // Check if it has a clear ending or has steps (indicating it resumes or ends)
      return hasDefiniteEnding(flow) || flow.steps.length > 0;
    });
    altFlowResumeCoverage = validAltFlows.length / altExcFlows.length;
  }

  return { altFlowConditionCoverage, altFlowResumeCoverage };
}

interface LoopDimensionResult {
  hasLoop: boolean;
  loopConditionCoverage: number;
  loopSpanCoverage: number;
}

function scoreLoopDimension(loops: GenLoop[]): LoopDimensionResult {
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

  return { hasLoop, loopConditionCoverage, loopSpanCoverage };
}

interface FluffDimensionResult {
  fluffPenalty: boolean;
}

function scoreFluffDimension(allDescriptions: string[]): FluffDimensionResult {
  let fluffPenalty = true;
  const lowerDescriptions = allDescriptions.map((d) => d.toLowerCase());
  for (const fluff of FLUFF_TERMS) {
    const f = fluff.toLowerCase();
    if (lowerDescriptions.some((d) => d.includes(f))) {
      fluffPenalty = false;
      break;
    }
  }
  return { fluffPenalty };
}

interface StructuralPenaltiesResult {
  structuralPenalty: number;
}

function scoreStructuralPenalties(
  flows: GenFlow[],
  loops: GenLoop[]
): StructuralPenaltiesResult {
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

  return { structuralPenalty };
}

// --- Main scoring function ---------------------------------------------------

/**
 * Scores a use case based on multiple quality dimensions including term coverage,
 * actor participation, process patterns, branching, loops, and fluff detection.
 *
 * Scoring dimensions:
 * - Name-level: Uniqueness and verb+noun pattern
 * - Summary/Pre/Post Coverage: How well summary and conditions are reflected in steps
 * - Actor Participation: Fraction of declared actors that appear in steps
 * - Process Pattern Coverage: Presence of input/validation/persistence/feedback verbs
 * - Flow-level: Trigger event, definite ending, valid step numbering
 * - Branching: Alternative/exception flows with proper anchoring and conditions
 * - Alt flow-level: Condition coverage and resume/end state
 * - Loops: Loop presence with proper conditions and span
 * - Fluff Penalty: Detects vague terms like "etc.", "...", "something"
 *
 * @param useCase - The use case to score
 * @param options - Scoring options including existing actors and use case names
 * @returns A comprehensive score object with overall score (0-100) and individual metrics
 */
export function scoreUseCaseTerms(
  useCase: GenUseCase,
  {
    existingActors = [],
    existingUseCaseNames = [],
  }: {
    existingActors?: string[];
    existingUseCaseNames?: string[];
  }
): UseCaseTermScore {
  const flows = useCase.flows ?? [];
  const loops = useCase.loops ?? [];

  const mainFlow = flows.find((f) => f.kind === "MAIN");
  const mainSteps: GenStep[] = mainFlow?.steps ?? [];
  const allSteps: GenStep[] = flows.flatMap((f) => f.steps ?? []);
  const allDescriptions = allSteps
    .map((s) => s.description)
    .filter((d) => d && d.trim().length > 0);

  // Suppress unused variable warning for existingActors (kept for API compatibility)
  void existingActors;

  // 0. Name-level checks
  const { hasUniqueName, hasVerbNoun } = scoreNameDimension(
    useCase,
    existingUseCaseNames
  );

  // 1. Summary / pre / post coverage
  const {
    hasPreconditions,
    hasPostconditions,
    summaryCoverage,
    preCoverage,
    postCoverage,
  } = scoreSummaryDimension(useCase, allDescriptions);

  // 2. Actor participation / main actor / system
  const { actorParticipation, hasMainActorSteps, hasSystemActor } =
    scoreActorDimension(useCase, allSteps);

  // 3. Process pattern coverage (input / validation / persistence / feedback) in MAIN
  const { processPatternCoverage } = scoreProcessPatternDimension(mainSteps);

  // 3.5. Flow-level checks
  const { hasTrigger, hasEnding, hasValidNumbering } = scoreFlowLevelDimension(
    flows,
    mainFlow,
    mainSteps
  );

  // 4. Branching coverage (ALTERNATIVE / EXCEPTION)
  const {
    hasAlternativeFlow,
    hasExceptionFlow,
    branchAnchoringCoverage,
    branchConditionCoverage,
  } = scoreBranchingDimension(flows, mainFlow, mainSteps);

  // 4.5. Alt flow-level checks
  const { altFlowConditionCoverage, altFlowResumeCoverage } =
    scoreAltFlowDimension(flows);

  // 5. Loop coverage (if any)
  const { hasLoop, loopConditionCoverage, loopSpanCoverage } =
    scoreLoopDimension(loops);

  // 6. Fluff penalty
  const { fluffPenalty } = scoreFluffDimension(allDescriptions);

  // 7. Structural integrity penalties
  const { structuralPenalty } = scoreStructuralPenalties(flows, loops);

  // 8. Combine into overall score (0–100)
  // Weights are heuristic; adjust as you wish.
  const nameScore = 0.4 * (hasUniqueName ? 1 : 0) + 0.6 * (hasVerbNoun ? 1 : 0);

  const prePostScore =
    0.3 * (hasPreconditions ? 1 : 0) +
    0.3 * (hasPostconditions ? 1 : 0) +
    0.2 * preCoverage +
    0.2 * postCoverage;

  const flowLevelScore =
    0.3 * (hasTrigger ? 1 : 0) +
    0.4 * (hasEnding ? 1 : 0) +
    0.3 * (hasValidNumbering ? 1 : 0);

  const branchKindScore =
    (hasAlternativeFlow ? 0.5 : 0) + (hasExceptionFlow ? 0.5 : 0); // 0–1
  const branchScore =
    0.3 * branchAnchoringCoverage +
    0.2 * branchConditionCoverage +
    0.2 * branchKindScore +
    0.15 * altFlowConditionCoverage +
    0.15 * altFlowResumeCoverage;

  const loopScore =
    0.4 * (hasLoop ? 1 : 0) +
    0.3 * loopConditionCoverage +
    0.3 * loopSpanCoverage;

  const overall0to1 =
    0.05 * nameScore +
    0.12 * summaryCoverage +
    0.08 * prePostScore +
    0.12 * actorParticipation +
    0.04 * (hasMainActorSteps ? 1 : 0) +
    0.2 * processPatternCoverage +
    0.08 * flowLevelScore +
    0.18 * branchScore +
    0.05 * loopScore +
    0.08 * (fluffPenalty ? 1 : 0);

  // Apply structural penalties and clamp to 0-100
  const overall = Math.max(
    0,
    Math.min(100, overall0to1 * 100 - structuralPenalty)
  );

  return {
    overall,
    structuralPenalty,

    // Name-level
    hasUniqueName,
    hasVerbNounPattern: hasVerbNoun,

    summaryCoverage,
    preCoverage,
    postCoverage,

    // Pre/Post flags
    hasPreconditions,
    hasPostconditions,

    actorParticipation,
    hasMainActorSteps,
    hasSystemActor,

    processPatternCoverage,

    // Flow-level
    hasTriggerEvent: hasTrigger,
    hasDefiniteEnding: hasEnding,
    hasValidStepNumbering: hasValidNumbering,

    hasAlternativeFlow,
    hasExceptionFlow,
    branchAnchoringCoverage,
    branchConditionCoverage,

    // Alt flow-level
    altFlowConditionCoverage,
    altFlowResumeCoverage,

    hasLoop,
    loopConditionCoverage,
    loopSpanCoverage,

    fluffPenalty,
  };
}

// --- Private structural check-group functions --------------------------------

interface PartialErrors {
  errors: string[];
}

function checkRequiredFields(useCase: GenUseCase): PartialErrors {
  const errors: string[] = [];

  if (!useCase.summary || useCase.summary.trim().length === 0) {
    errors.push(
      "CRITICAL: The use case summary is missing or empty. Please provide a clear, concise summary that describes the goal of this use case."
    );
  }

  if (!useCase.actors || useCase.actors.length === 0) {
    errors.push(
      "CRITICAL: No actors defined. Please specify at least one actor who interacts with the system."
    );
  }

  if (!useCase.mainActor || useCase.mainActor.trim().length === 0) {
    errors.push(
      "CRITICAL: Main actor is not specified. Please designate which actor is the primary initiator of this use case."
    );
  }

  return { errors };
}

function checkMainFlow(useCase: GenUseCase): {
  errors: string[];
  mainFlowPresent: boolean;
} {
  const errors: string[] = [];
  const flows = useCase.flows ?? [];
  const mainFlow = flows.find((f) => f.kind === "MAIN");

  if (!mainFlow) {
    errors.push(
      "CRITICAL: No MAIN flow found. Every use case must have a MAIN flow that describes the primary sequence of steps."
    );
    return { errors, mainFlowPresent: false };
  }

  const mainSteps = mainFlow.steps ?? [];
  if (mainSteps.length === 0) {
    errors.push(
      "CRITICAL: The MAIN flow has no steps. Please add at least 3-5 steps that describe the main sequence of actions."
    );
    return { errors, mainFlowPresent: false };
  }

  return { errors, mainFlowPresent: true };
}

function checkNameUniqueness(
  useCase: GenUseCase,
  existingUseCaseNames: string[]
): PartialErrors {
  const errors: string[] = [];

  if (existingUseCaseNames.length > 0) {
    const isDuplicate = existingUseCaseNames.some((name) =>
      eqIgnoreCase(name, useCase.name)
    );
    if (isDuplicate) {
      errors.push(
        `CRITICAL: Use case name "${useCase.name}" already exists in the project. Please choose a unique name.`
      );
    }
  }

  return { errors };
}

function checkFlowParentRelations(flows: GenFlow[]): PartialErrors {
  const errors: string[] = [];

  for (const flow of flows) {
    if (flow.parentFlow && flow.id === "MAIN") {
      errors.push(
        `CRITICAL: Flow with ID 'MAIN' cannot have a parentFlow. Only the main flow should have ID 'MAIN', and it should not have a parent.`
      );
    }
  }

  for (const flow of flows) {
    if (flow.kind !== "MAIN" && !flow.parentFlow) {
      errors.push(
        `CRITICAL: Flow '${flow.id}' has kind '${flow.kind}' but no parentFlow specified. Alternative and exception flows must specify which flow they branch from.`
      );
    }
  }

  return { errors };
}

function checkDuplicateFlowIds(flows: GenFlow[]): {
  errors: string[];
  flowIds: Set<string>;
} {
  const errors: string[] = [];
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

  return { errors, flowIds };
}

function checkOrphanedFlowsAndCircular(
  flows: GenFlow[],
  flowIds: Set<string>
): PartialErrors {
  const errors: string[] = [];

  for (const flow of flows) {
    if (flow.parentFlow && flow.parentFlow !== "MAIN") {
      if (!flowIds.has(flow.parentFlow)) {
        errors.push(
          `CRITICAL: Flow '${flow.id}' references non-existent parent flow '${flow.parentFlow}'. Parent flow must be either 'MAIN' or an existing flow ID.`
        );
      }
    }
  }

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

  return { errors };
}

function checkLoopAndIndexValidity(
  flows: GenFlow[],
  loops: GenLoop[],
  flowIds: Set<string>
): PartialErrors {
  const errors: string[] = [];

  for (const loop of loops) {
    if (loop.flowRef !== "MAIN" && !flowIds.has(loop.flowRef)) {
      errors.push(
        `CRITICAL: Loop references non-existent flow '${loop.flowRef}'. Flow reference must be either 'MAIN' or an existing flow ID.`
      );
    }
  }

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
        errors.push(
          `CRITICAL: Loop startIndex (${loop.startIndex}) is greater than endIndex (${loop.endIndex}). This creates a backwards or invalid loop.`
        );
      }
    }
  }

  return { errors };
}

function checkStepNumberingAndAltFlowSteps(flows: GenFlow[]): PartialErrors {
  const errors: string[] = [];

  for (const flow of flows) {
    if (flow.steps && flow.steps.length > 0) {
      if (!hasValidStepNumbering(flow.steps)) {
        const indices = flow.steps.map((s) => s.index);
        const uniqueIndices = new Set(indices);

        if (uniqueIndices.size !== indices.length) {
          errors.push(
            `CRITICAL: Flow '${flow.id}' has duplicate step indices. Each step must have a unique index.`
          );
        } else {
          errors.push(
            `CRITICAL: Flow '${flow.id}' has gaps in step indices. Steps must be numbered consecutively (e.g., 0,1,2,3 or 1,2,3,4).`
          );
        }
      }
    }
  }

  for (const flow of flows) {
    if (flow.kind === "ALTERNATIVE" || flow.kind === "EXCEPTION") {
      if (!flow.steps || flow.steps.length === 0) {
        errors.push(
          `CRITICAL: Flow '${flow.id}' has no steps. Alternative/exception flows must have at least one step.`
        );
      }
    }
  }

  return { errors };
}

function checkMainActorInActorsList(useCase: GenUseCase): PartialErrors {
  const errors: string[] = [];

  if (useCase.mainActor && useCase.actors) {
    const mainActorInList = useCase.actors.some((a) =>
      eqIgnoreCase(a, useCase.mainActor)
    );
    if (!mainActorInList) {
      errors.push(
        `CRITICAL: Main actor '${useCase.mainActor}' is not in the actors list. The main actor must be included in the actors array.`
      );
    }
  }

  return { errors };
}

// --- Main structural validation function -------------------------------------

/**
 * Validates the core structural integrity of a use case.
 * Checks for critical errors that make the use case technically invalid or broken.
 *
 * Structural checks include:
 * - Schema compliance
 * - Required fields (summary, main flow, actors, main actor)
 * - Flow structure (duplicate IDs, orphaned flows, circular dependencies)
 * - Index validity (step indices, loop indices, fromStepIndex)
 * - Step numbering (duplicates, gaps)
 * - Name uniqueness (if existingUseCaseNames provided)
 *
 * @param useCaseInput - The use case to validate
 * @param options - Validation options
 * @returns Structural validation result with only critical errors
 */
export function validateUseCaseStructure(
  useCaseInput: z.infer<typeof genUseCaseSchema>,
  options?: {
    existingUseCaseNames?: string[];
  }
): UseCaseStructuralValidationResult {
  const existingUseCaseNames = options?.existingUseCaseNames ?? [];
  const errors: string[] = [];

  const result = genUseCaseSchema.safeParse(useCaseInput);

  if (!result.success) {
    const zodErrors = result.error.errors.map(
      (err) =>
        `Schema validation error at ${err.path.join(".")}: ${err.message}`
    );
    errors.push(...zodErrors);
    return { valid: false, errors };
  }

  const useCase = result.data as GenUseCase;
  const flows = useCase.flows ?? [];
  const loops = useCase.loops ?? [];

  errors.push(...checkRequiredFields(useCase).errors);

  const mainFlowCheck = checkMainFlow(useCase);
  errors.push(...mainFlowCheck.errors);
  if (!mainFlowCheck.mainFlowPresent) {
    return { valid: false, errors };
  }

  errors.push(...checkNameUniqueness(useCase, existingUseCaseNames).errors);
  errors.push(...checkFlowParentRelations(flows).errors);

  const { errors: dupErrors, flowIds } = checkDuplicateFlowIds(flows);
  errors.push(...dupErrors);

  errors.push(...checkOrphanedFlowsAndCircular(flows, flowIds).errors);
  errors.push(...checkLoopAndIndexValidity(flows, loops, flowIds).errors);
  errors.push(...checkStepNumberingAndAltFlowSteps(flows).errors);
  errors.push(...checkMainActorInActorsList(useCase).errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

// --- Private quality feedback-group functions --------------------------------

interface FeedbackGroup {
  warnings: string[];
  suggestions: string[];
}

function feedbackName(
  useCase: GenUseCase,
  score: UseCaseTermScore
): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!score.hasUniqueName) {
    suggestions.push(
      `UNIQUE NAME: Consider a more distinctive name to avoid confusion with existing use cases.`
    );
  }

  if (!score.hasVerbNounPattern) {
    warnings.push(
      `NAME PATTERN: Use case name "${useCase.name}" does not follow the recommended verb+noun pattern (e.g., "Create Order", "Manage Users"). This improves clarity and consistency.`
    );
  }

  return { warnings, suggestions };
}

function feedbackSummaryAndConditions(score: UseCaseTermScore): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

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

  if (!score.hasPreconditions) {
    suggestions.push(
      "ADD PRECONDITIONS: Consider adding preconditions that must be true before this use case can execute (e.g., 'User must be logged in', 'Database must be accessible')."
    );
  } else if (score.preCoverage < 0.3) {
    warnings.push(
      `LOW PRECONDITION COVERAGE (${(score.preCoverage * 100).toFixed(
        0
      )}%): The preconditions are not well-represented in the steps. Consider adding validation steps that verify the preconditions.`
    );
  }

  if (!score.hasPostconditions) {
    suggestions.push(
      "ADD POSTCONDITIONS: Consider adding postconditions that describe the system state after successful completion (e.g., 'Order is saved in database', 'User receives confirmation')."
    );
  } else if (score.postCoverage < 0.3) {
    warnings.push(
      `LOW POSTCONDITION COVERAGE (${(score.postCoverage * 100).toFixed(
        0
      )}%): The postconditions are not well-represented in the steps. Ensure the final steps achieve or verify the stated postconditions.`
    );
  }

  return { warnings, suggestions };
}

function feedbackActors(
  useCase: GenUseCase,
  score: UseCaseTermScore,
  existingActors: string[]
): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

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
    warnings.push(
      `MAIN ACTOR NOT PARTICIPATING: The main actor '${useCase.mainActor}' does not appear in any step. The main actor must initiate or participate in the use case.`
    );
  }

  if (!score.hasSystemActor) {
    suggestions.push(
      "ADD SYSTEM ACTOR STEPS: Consider adding steps where the 'System' actor performs actions (validation, processing, storage, etc.). Most use cases involve system responses."
    );
  }

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

  return { warnings, suggestions };
}

function feedbackFlowLevel(score: UseCaseTermScore): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!score.hasTriggerEvent) {
    warnings.push(
      `TRIGGER EVENT: The first step should clearly describe how the use case is initiated (e.g., "User clicks login button", "System receives order request").`
    );
  }

  if (!score.hasDefiniteEnding) {
    warnings.push(
      `DEFINITE ENDING: The main flow should have a clear ending that indicates successful completion. Consider adding a final step that confirms the outcome.`
    );
  }

  return { warnings, suggestions };
}

function feedbackProcessPattern(
  score: UseCaseTermScore,
  mainSteps: GenStep[]
): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

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

  return { warnings, suggestions };
}

function feedbackBranchingAndAltFlows(
  score: UseCaseTermScore,
  flows: GenFlow[]
): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

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

  if (score.hasAlternativeFlow && score.altFlowConditionCoverage < 0.5) {
    warnings.push(
      `ALT FLOW CONDITIONS (${(score.altFlowConditionCoverage * 100).toFixed(
        0
      )}%): Many alternative flows lack clear conditions. Each alternative flow should specify when it is taken instead of the main flow.`
    );
  }

  if (
    (score.hasAlternativeFlow || score.hasExceptionFlow) &&
    score.altFlowResumeCoverage < 0.5
  ) {
    warnings.push(
      `ALT FLOW COMPLETION (${(score.altFlowResumeCoverage * 100).toFixed(
        0
      )}%): Many alternative/exception flows don't clearly indicate how they end. Each flow should either resume at a specific step or have its own ending.`
    );
  }

  for (const flow of flows) {
    if (flow.kind === "ALTERNATIVE" || flow.kind === "EXCEPTION") {
      if (!flow.condition || flow.condition.trim().length === 0) {
        warnings.push(
          `MISSING CONDITION: Flow '${flow.id}' (${flow.kind}) should have a clear condition that describes when this flow is taken.`
        );
      }

      if (flow.steps && flow.steps.length > 0 && !hasDefiniteEnding(flow)) {
        suggestions.push(
          `FLOW ENDING: Flow '${flow.id}' should clearly indicate how it ends (returns to main flow, ends the use case, etc.).`
        );
      }
    }
  }

  return { warnings, suggestions };
}

function feedbackLoops(score: UseCaseTermScore): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

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

  return { warnings, suggestions };
}

function feedbackFluffAndStructure(score: UseCaseTermScore): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!score.fluffPenalty) {
    warnings.push(
      `VAGUE LANGUAGE DETECTED: The use case contains vague terms like "etc.", "...", or "something". Replace these with specific, concrete descriptions. Each step should be clear and actionable.`
    );
  }

  if (score.structuralPenalty > 0) {
    warnings.push(
      `STRUCTURAL INTEGRITY ISSUES (${score.structuralPenalty.toFixed(
        0
      )} penalty points): The use case has structural problems that reduced the overall score.`
    );
  }

  return { warnings, suggestions };
}

function feedbackOverallScore(score: UseCaseTermScore): FeedbackGroup {
  const warnings: string[] = [];
  const suggestions: string[] = [];

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

  return { warnings, suggestions };
}

// --- Main quality validation function ----------------------------------------

/**
 * Validates the semantic quality and completeness of a use case.
 * Provides warnings and suggestions for improving the use case meaning and quality.
 *
 * Quality checks include:
 * - Name patterns (verb+noun)
 * - Pre/post conditions presence and coverage
 * - Actor participation
 * - Process pattern coverage
 * - Trigger events and definite endings
 * - Alternative/exception flow quality
 * - Branch conditions and resume points
 * - Loop conditions
 * - Fluff detection
 *
 * @param useCase - The use case to validate (must be structurally valid)
 * @param options - Validation options
 * @returns Quality validation result with score, warnings, and suggestions
 */
export async function validateUseCaseQuality(
  useCase: GenUseCase,
  options?: {
    projectStore: JsonProjectStore;
  }
): Promise<UseCaseQualityValidationResult> {
  const existingActors =
    (await options?.projectStore.getAllActors())?.map((a) => a.name) ?? [];
  const existingUseCaseNames =
    options?.projectStore.getAllUseCases().map((uc) => uc.name) ?? [];

  const flows = useCase.flows ?? [];
  const mainFlow = flows.find((f) => f.kind === "MAIN");
  const mainSteps: GenStep[] = mainFlow?.steps ?? [];

  const score = scoreUseCaseTerms(useCase, {
    existingActors,
    existingUseCaseNames,
  });

  const groups = [
    feedbackName(useCase, score),
    feedbackSummaryAndConditions(score),
    feedbackActors(useCase, score, existingActors),
    feedbackFlowLevel(score),
    feedbackProcessPattern(score, mainSteps),
    feedbackBranchingAndAltFlows(score, flows),
    feedbackLoops(score),
    feedbackFluffAndStructure(score),
    feedbackOverallScore(score),
  ];

  const warnings: string[] = groups.flatMap((g) => g.warnings);
  const suggestions: string[] = groups.flatMap((g) => g.suggestions);

  return {
    score,
    warnings,
    suggestions,
  };
}

/**
 * Validates a use case comprehensively (both structure and quality).
 * This is a convenience function that combines structural and quality validation.
 *
 * @param useCaseInput - The use case to validate (JSON string or GenUseCase object)
 * @param options - Validation options including existing actors and use case names
 * @returns Validation result with errors, warnings, suggestions, and score
 */
export async function validateUseCaseWithFeedback(
  useCaseInput: z.infer<typeof genUseCaseSchema>,
  options?: {
    projectStore: JsonProjectStore;
  }
): Promise<UseCaseValidationResult> {
  // First, validate structural integrity
  const allUseCases = await options?.projectStore.getAllUseCases();
  const structuralResult = validateUseCaseStructure(useCaseInput, {
    existingUseCaseNames: allUseCases?.map((uc) => uc.name) ?? [],
  });

  // If structural validation fails, return early with only errors
  if (!structuralResult.valid) {
    return {
      valid: false,
      errors: structuralResult.errors,
      warnings: [],
      suggestions: [],
      score: {
        overall: 0,
        structuralPenalty: 0,
        hasUniqueName: false,
        hasVerbNounPattern: false,
        summaryCoverage: 0,
        preCoverage: 0,
        postCoverage: 0,
        hasPreconditions: false,
        hasPostconditions: false,
        actorParticipation: 0,
        hasMainActorSteps: false,
        hasSystemActor: false,
        processPatternCoverage: 0,
        hasTriggerEvent: false,
        hasDefiniteEnding: false,
        hasValidStepNumbering: false,
        hasAlternativeFlow: false,
        hasExceptionFlow: false,
        branchAnchoringCoverage: 0,
        branchConditionCoverage: 0,
        altFlowConditionCoverage: 0,
        altFlowResumeCoverage: 0,
        hasLoop: false,
        loopConditionCoverage: 0,
        loopSpanCoverage: 0,
        fluffPenalty: false,
      },
    };
  }

  // If structurally valid, perform quality validation
  const useCase = genUseCaseSchema.parse(useCaseInput) as GenUseCase;
  const qualityResult = await validateUseCaseQuality(useCase, options);

  // Combine results
  return {
    valid: true,
    errors: [],
    warnings: qualityResult.warnings,
    suggestions: qualityResult.suggestions,
    score: qualityResult.score,
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
