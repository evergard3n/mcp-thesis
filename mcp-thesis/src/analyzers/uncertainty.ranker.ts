import {
  GenUseCase,
  GenFlow,
  GenStep,
} from "../interfaces/usecase.interface.new.js";
import { UseCaseTermScore } from "../validators/flat.validator.js";
import { GapAnalysis, Gap } from "./gap.analyzer.js";

/**
 * Step-level uncertainty analysis
 */
export interface StepUncertainty {
  stepIndex: number;
  flowId: string;
  flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";
  description: string;

  // Dimensions (0-1, lower = more uncertain)
  clarityScore: number; // How clear/specific is the description?
  completeness: number; // Are actor/target/description present?
  exceptionCoverage: number; // Does this step have exception flows?

  // From gap analyzer
  relatedGaps: Gap[];
  gapSeverity: "high" | "medium" | "low" | "none";

  // Aggregate
  uncertaintyScore: number; // weighted combination
  uncertaintyReasons: string[];
}

/**
 * Flow-level uncertainty analysis
 */
export interface FlowUncertainty {
  flowId: string;
  flowKind: "MAIN" | "ALTERNATIVE" | "EXCEPTION";

  // ALL flow types
  stepsClarityAvg: number;
  stepsCompletenessAvg: number;

  // ALT/EXCEPTION specific
  conditionSpecificity: number; // How specific is the condition?
  hasCondition: boolean;
  hasResolution: boolean; // Does the flow resolve back to main?

  // EXCEPTION specific
  hasValidAnchor: boolean; // Is fromStepIndex valid?
  hasNestedExceptions: boolean; // Are there exceptions from this exception?
  nestedExceptionCoverage: number;

  // Aggregate
  uncertaintyScore: number;
  uncertaintyReasons: string[];
}

/**
 * Step criticality analysis
 */
export interface StepCriticality {
  structuralImportance: number; // 0-1: position in flow
  domainImportance: number; // 0-1: type of operation
  impactRadius: number; // 0-1: downstream dependencies
  criticalityScore: number; // combined score
}

/**
 * Step priority (uncertainty × criticality)
 */
export interface StepPriority {
  stepIndex: number;
  flowId: string;
  actor: string;
  description: string;

  uncertaintyScore: number; // 0-1 (how unclear?)
  criticalityScore: number; // 0-1 (how important?)
  priorityScore: number; // uncertainty × criticality
  priorityRank: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

  // Details for question generation
  uncertaintyReasons: string[];
  relatedGaps: Gap[];
}

/**
 * Complete uncertainty analysis result
 */
export interface UncertaintyAnalysis {
  stepUncertainties: StepUncertainty[];
  flowUncertainties: FlowUncertainty[];
  stepPriorities: StepPriority[];
  overallConfidence: number; // 0-1
  highPriorityCount: number;
}

/**
 * Analyzes clarity of a step description
 * Returns 0-1 score (lower = more uncertain)
 */
function analyzeStepClarity(description: string): number {
  const desc = description.toLowerCase();

  // Vague action verbs (low clarity)
  const vagueVerbs = [
    "validates",
    "checks",
    "processes",
    "handles",
    "manages",
    "deals with",
  ];
  const hasVagueVerb = vagueVerbs.some((v) => desc.includes(v));

  // Specific action verbs (high clarity)
  const specificVerbs = [
    "scans",
    "enters",
    "clicks",
    "types",
    "selects",
    "submits",
    "calculates",
    "sends",
    "receives",
  ];
  const hasSpecificVerb = specificVerbs.some((v) => desc.includes(v));

  // Length and detail
  const wordCount = description.split(/\s+/).length;
  const hasDetail = wordCount >= 5;

  let score = 0.5; // baseline

  if (hasSpecificVerb) score += 0.3;
  if (hasVagueVerb) score -= 0.2;
  if (hasDetail) score += 0.2;
  if (wordCount < 3) score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

/**
 * Analyzes completeness of a step
 * Returns 0-1 score (lower = more incomplete)
 */
function analyzeStepCompleteness(step: GenStep): number {
  let score = 0;

  // Has actor?
  if (step.actor && step.actor.trim().length > 0) score += 0.33;

  // Has description?
  if (step.description && step.description.trim().length > 3) score += 0.34;

  // Has target?
  if (step.target && step.target.trim().length > 0) score += 0.33;

  return score;
}

/**
 * Analyzes exception coverage for a step
 * Returns 0-1 score (lower = less coverage)
 */
function analyzeStepExceptionCoverage(
  step: GenStep,
  parentFlow: GenFlow,
  allFlows: GenFlow[],
): number {
  // Count exception flows from this step
  const exceptionCount = allFlows.filter(
    (f) =>
      f.kind === "EXCEPTION" &&
      f.parentFlow === parentFlow.id &&
      f.fromStepIndex === step.index,
  ).length;

  // Steps that need exceptions
  const needsException =
    step.description.toLowerCase().match(/validat|check|verif|submit|enter/i) ||
    (step.target &&
      step.target.toLowerCase().match(/system|service|api|database/i));

  if (!needsException) return 0.8; // Not critical

  if (exceptionCount === 0) return 0.1; // Critical gap
  if (exceptionCount === 1) return 0.6; // Partial coverage
  return 0.9; // Good coverage
}

/**
 * Analyzes uncertainty for a single step
 */
export function analyzeStepUncertainty(
  step: GenStep,
  parentFlow: GenFlow,
  allFlows: GenFlow[],
  gapAnalysis: GapAnalysis,
): StepUncertainty {
  const clarityScore = analyzeStepClarity(step.description);
  const completeness = analyzeStepCompleteness(step);
  const exceptionCoverage = analyzeStepExceptionCoverage(
    step,
    parentFlow,
    allFlows,
  );

  // Find related gaps
  const relatedGaps = gapAnalysis.gaps.filter(
    (g) => g.relatedStep === step.index && g.relatedFlow === parentFlow.id,
  );

  // Determine gap severity
  let gapSeverity: "high" | "medium" | "low" | "none" = "none";
  const hasHigh = relatedGaps.some((g) => g.severity === "high");
  const hasMedium = relatedGaps.some((g) => g.severity === "medium");
  const hasAny = relatedGaps.length > 0;
  const hasNonMainGap = relatedGaps.some(
    (g) => g.relatedFlow && g.relatedFlow !== "MAIN",
  );
  const cappedSeverity = hasNonMainGap ? "low" : "none";

  if (hasHigh) gapSeverity = "high";
  else if (hasMedium) gapSeverity = "medium";
  else if (hasAny) gapSeverity = "low";

  if (hasNonMainGap && gapSeverity !== "none") {
    gapSeverity = cappedSeverity;
  }

  // Calculate uncertainty score (inverse of confidence)
  // Lower clarity/completeness/coverage = higher uncertainty
  const uncertaintyScore =
    1 - (clarityScore * 0.3 + completeness * 0.3 + exceptionCoverage * 0.4);

  // Add gap penalty
  const gapPenalty =
    gapSeverity === "high" ? 0.3 : gapSeverity === "medium" ? 0.15 : 0;
  const finalUncertainty = Math.min(1, uncertaintyScore + gapPenalty);

  // Collect reasons
  const uncertaintyReasons: string[] = [];
  if (clarityScore < 0.5) uncertaintyReasons.push("Vague or unclear action");
  if (completeness < 0.7) uncertaintyReasons.push("Missing actor or target");
  if (exceptionCoverage < 0.5) uncertaintyReasons.push("No exception handling");
  if (gapSeverity !== "none")
    uncertaintyReasons.push(`${gapSeverity} priority gap detected`);

  return {
    stepIndex: step.index,
    flowId: parentFlow.id,
    flowKind: parentFlow.kind,
    description: step.description,
    clarityScore,
    completeness,
    exceptionCoverage,
    relatedGaps,
    gapSeverity,
    uncertaintyScore: finalUncertainty,
    uncertaintyReasons,
  };
}

/**
 * Analyzes condition specificity for ALT/EXCEPTION flows
 * Returns 0-1 score (lower = less specific)
 */
function analyzeConditionSpecificity(condition: string | undefined): number {
  if (!condition || condition.trim().length === 0) return 0;

  const cond = condition.toLowerCase();

  // Vague conditions
  if (cond.match(/^(error|failure|problem|issue)$/)) return 0.2;

  // Somewhat specific
  if (cond.length < 20) return 0.4;

  // Specific conditions (mentions concrete values, actors, or states)
  if (
    cond.match(
      /\b(invalid|missing|unavailable|timeout|not found|mismatch|incorrect)\b/,
    )
  ) {
    return 0.7;
  }

  // Very specific (includes numbers, names, or detailed scenarios)
  if (cond.match(/\d+|[A-Z][a-z]+\s[A-Z][a-z]+/)) return 0.9;

  return 0.5; // default
}

/**
 * Checks if a flow has a resolution (returns to main flow)
 */
function hasResolution(flow: GenFlow): boolean {
  if (flow.steps.length === 0) return false;

  const lastStep = flow.steps[flow.steps.length - 1];
  const desc = lastStep.description.toLowerCase();

  // Look for resolution keywords
  return (
    desc.includes("return") ||
    desc.includes("resume") ||
    desc.includes("continue") ||
    desc.includes("revert") ||
    /step\s+\d+/.test(desc)
  );
}

/**
 * Analyzes uncertainty for a flow
 */
export function analyzeFlowUncertainty(
  flow: GenFlow,
  useCase: GenUseCase,
  gapAnalysis: GapAnalysis,
): FlowUncertainty {
  // Analyze all steps in this flow
  const stepAnalyses = flow.steps.map((step) =>
    analyzeStepUncertainty(step, flow, useCase.flows, gapAnalysis),
  );

  const stepsClarityAvg =
    stepAnalyses.reduce((sum, s) => sum + s.clarityScore, 0) /
      stepAnalyses.length || 0;
  const stepsCompletenessAvg =
    stepAnalyses.reduce((sum, s) => sum + s.completeness, 0) /
      stepAnalyses.length || 0;

  // ALT/EXCEPTION specific
  const conditionSpecificity =
    flow.kind !== "MAIN" ? analyzeConditionSpecificity(flow.condition) : 1;
  const hasCondition = flow.kind !== "MAIN" && !!flow.condition;
  const flowHasResolution = flow.kind !== "MAIN" ? hasResolution(flow) : true;

  // EXCEPTION specific
  const hasValidAnchor =
    flow.kind === "EXCEPTION"
      ? flow.fromStepIndex !== undefined && flow.fromStepIndex > 0
      : true;

  // Check for nested exceptions (exceptions from this exception flow)
  const hasNestedExceptions =
    flow.kind === "EXCEPTION" &&
    useCase.flows.some(
      (f) => f.kind === "EXCEPTION" && f.parentFlow === flow.id,
    );

  const nestedExceptionCount = useCase.flows.filter(
    (f) => f.kind === "EXCEPTION" && f.parentFlow === flow.id,
  ).length;
  const nestedExceptionCoverage =
    flow.kind === "EXCEPTION" && flow.steps.length > 0
      ? Math.min(1, nestedExceptionCount / Math.max(1, flow.steps.length * 0.3))
      : 1;

  // Calculate flow uncertainty
  let uncertaintyScore =
    1 - (stepsClarityAvg * 0.4 + stepsCompletenessAvg * 0.3);

  if (flow.kind !== "MAIN") {
    uncertaintyScore += (1 - conditionSpecificity) * 0.2;
    if (!hasCondition) uncertaintyScore += 0.1;
    if (!flowHasResolution) uncertaintyScore += 0.1;
  }

  if (flow.kind === "EXCEPTION") {
    if (!hasValidAnchor) uncertaintyScore += 0.15;
    uncertaintyScore += (1 - nestedExceptionCoverage) * 0.15;
  }

  uncertaintyScore = Math.min(1, uncertaintyScore);

  // Collect reasons
  const uncertaintyReasons: string[] = [];
  if (stepsClarityAvg < 0.5) uncertaintyReasons.push("Steps lack clarity");
  if (stepsCompletenessAvg < 0.7)
    uncertaintyReasons.push("Steps are incomplete");
  if (flow.kind !== "MAIN" && conditionSpecificity < 0.5)
    uncertaintyReasons.push("Condition is vague");
  if (flow.kind !== "MAIN" && !hasCondition)
    uncertaintyReasons.push("Missing condition");
  if (flow.kind !== "MAIN" && !flowHasResolution)
    uncertaintyReasons.push("No clear resolution");
  if (flow.kind === "EXCEPTION" && !hasValidAnchor)
    uncertaintyReasons.push("Invalid or missing anchor point");
  if (flow.kind === "EXCEPTION" && nestedExceptionCoverage < 0.5)
    uncertaintyReasons.push("Insufficient nested exception coverage");

  return {
    flowId: flow.id,
    flowKind: flow.kind,
    stepsClarityAvg,
    stepsCompletenessAvg,
    conditionSpecificity,
    hasCondition,
    hasResolution: flowHasResolution,
    hasValidAnchor,
    hasNestedExceptions,
    nestedExceptionCoverage,
    uncertaintyScore,
    uncertaintyReasons,
  };
}

/**
 * Computes structural importance based on position in flow
 */
function computeStructuralImportance(
  stepIndex: number,
  flow: GenFlow,
  allFlows: GenFlow[],
): number {
  const totalSteps = flow.steps.length;
  if (totalSteps === 0) return 0.5;

  // Entry point (first step) is highly critical
  if (stepIndex === 1) return 1.0;

  // Exit point (last step) is important
  if (stepIndex === totalSteps) return 0.8;

  // Steps that spawn many branches are critical
  const branchCount = allFlows.filter(
    (f) =>
      (f.kind === "ALTERNATIVE" || f.kind === "EXCEPTION") &&
      f.parentFlow === flow.id &&
      f.fromStepIndex === stepIndex,
  ).length;

  if (branchCount >= 3) return 0.9;
  if (branchCount === 2) return 0.75;
  if (branchCount === 1) return 0.6;

  // Middle steps
  return 0.5;
}

/**
 * Computes domain importance based on operation type
 */
function computeDomainImportance(step: GenStep): number {
  const desc = step.description.toLowerCase();
  const target = step.target?.toLowerCase() || "";

  // Input/Data collection (highest priority)
  if (desc.match(/report|submit|enter|provide|input|register|fill/i)) {
    return 1.0;
  }

  // Validation/Authentication (very high priority)
  if (desc.match(/validat|verify|check|find policy|authenticate|authorize/i)) {
    return 0.9;
  }

  // Assignment/Allocation (high priority)
  if (desc.match(/assign|allocat|schedul|reserve|book|distribute/i)) {
    return 0.85;
  }

  // System interactions (medium-high priority)
  if (target.match(/system|database|service|api|server/i)) {
    return 0.7;
  }

  // Business logic (medium priority)
  if (desc.match(/calculat|evaluat|investigat|process|analyz|determin/i)) {
    return 0.6;
  }

  // Feedback/Display (low priority)
  if (desc.match(/display|show|notify|inform|present|send notification/i)) {
    return 0.4;
  }

  // Default
  return 0.5;
}

/**
 * Computes impact radius (how many downstream flows depend on this step)
 */
function computeImpactRadius(
  stepIndex: number,
  flow: GenFlow,
  allFlows: GenFlow[],
): number {
  // Count direct branches from this step
  const directBranches = allFlows.filter(
    (f) =>
      (f.kind === "ALTERNATIVE" || f.kind === "EXCEPTION") &&
      f.parentFlow === flow.id &&
      f.fromStepIndex === stepIndex,
  ).length;

  // Count steps after this one in the same flow
  const subsequentSteps = flow.steps.filter((s) => s.index > stepIndex).length;

  // Normalize
  const branchScore = Math.min(1, directBranches / 3);
  const sequenceScore = Math.min(1, subsequentSteps / 5);

  return branchScore * 0.6 + sequenceScore * 0.4;
}

/**
 * Computes step criticality
 */
export function computeStepCriticality(
  step: GenStep,
  flow: GenFlow,
  allFlows: GenFlow[],
): StepCriticality {
  const structuralImportance = computeStructuralImportance(
    step.index,
    flow,
    allFlows,
  );
  const domainImportance = computeDomainImportance(step);
  const impactRadius = computeImpactRadius(step.index, flow, allFlows);

  // Weighted combination
  const criticalityScore =
    structuralImportance * 0.3 + domainImportance * 0.5 + impactRadius * 0.2;

  return {
    structuralImportance,
    domainImportance,
    impactRadius,
    criticalityScore,
  };
}

/**
 * Ranks step priorities (uncertainty × criticality)
 */
export function rankStepPriorities(
  stepUncertainties: StepUncertainty[],
  useCase: GenUseCase,
): StepPriority[] {
  const priorities: StepPriority[] = [];

  for (const stepUnc of stepUncertainties) {
    // Find the flow and step
    const flow = useCase.flows.find((f) => f.id === stepUnc.flowId);
    if (!flow) continue;

    const step = flow.steps.find((s) => s.index === stepUnc.stepIndex);
    if (!step) continue;

    // Compute criticality
    const criticality = computeStepCriticality(step, flow, useCase.flows);

    // Priority = Uncertainty × Criticality
    const priorityScore =
      stepUnc.uncertaintyScore * criticality.criticalityScore;

    // Determine rank
    let priorityRank: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    if (priorityScore >= 0.7) priorityRank = "CRITICAL";
    else if (priorityScore >= 0.5) priorityRank = "HIGH";
    else if (priorityScore >= 0.3) priorityRank = "MEDIUM";
    else priorityRank = "LOW";

    priorities.push({
      stepIndex: stepUnc.stepIndex,
      flowId: stepUnc.flowId,
      actor: step.actor,
      description: stepUnc.description,
      uncertaintyScore: stepUnc.uncertaintyScore,
      criticalityScore: criticality.criticalityScore,
      priorityScore,
      priorityRank,
      uncertaintyReasons: stepUnc.uncertaintyReasons,
      relatedGaps: stepUnc.relatedGaps,
    });
  }

  // Sort by priority score (descending)
  return priorities.sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Performs complete uncertainty analysis
 */
export function rankAllUncertainties(
  useCase: GenUseCase,
  validationScore: UseCaseTermScore,
  gapAnalysis: GapAnalysis,
): UncertaintyAnalysis {
  // Analyze all steps
  const stepUncertainties: StepUncertainty[] = [];
  for (const flow of useCase.flows) {
    for (const step of flow.steps) {
      stepUncertainties.push(
        analyzeStepUncertainty(step, flow, useCase.flows, gapAnalysis),
      );
    }
  }

  // Analyze all flows
  const flowUncertainties: FlowUncertainty[] = useCase.flows.map((flow) =>
    analyzeFlowUncertainty(flow, useCase, gapAnalysis),
  );

  // Rank priorities
  const stepPriorities = rankStepPriorities(stepUncertainties, useCase);

  // Calculate overall confidence (inverse of average uncertainty)
  const avgUncertainty =
    stepUncertainties.reduce((sum, s) => sum + s.uncertaintyScore, 0) /
      stepUncertainties.length || 0;
  const overallConfidence = 1 - avgUncertainty;

  // Count high priority items
  const highPriorityCount = stepPriorities.filter(
    (p) => p.priorityRank === "CRITICAL" || p.priorityRank === "HIGH",
  ).length;

  return {
    stepUncertainties,
    flowUncertainties,
    stepPriorities,
    overallConfidence,
    highPriorityCount,
  };
}
