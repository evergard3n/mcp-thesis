import { GenUseCase, GenFlow } from "../interfaces/usecase.interface.new.js";
import { UseCaseTermScore } from "../validators/flat.validator.js";

/**
 * Types of gaps that can be detected in a use case
 */
export type GapType =
  | "missing_exception_flows"
  | "missing_alternative_flows"
  | "incomplete_actors"
  | "uncertain_conditions"
  | "missing_validation_handling"
  | "missing_system_failure_handling";

/**
 * Analysis result for a single gap
 */
export interface Gap {
  type: GapType;
  severity: "high" | "medium" | "low";
  description: string;
  relatedStep?: number;
  relatedFlow?: string;
  suggestedQuestion?: string;
}

/**
 * Complete gap analysis result
 */
export interface GapAnalysis {
  missingExceptionFlows: boolean;
  missingAlternativeFlows: boolean;
  incompleteActors: string[];
  uncertainConditions: string[];
  gaps: Gap[];
  priorityGaps: GapType[]; // ordered by importance
  completenessScore: number; // 0-1 estimate of how complete the use case is
}

/**
 * Analyzes a use case to detect gaps and missing components.
 * This is the core function for identifying what questions need to be asked.
 *
 * @param useCase - The use case to analyze
 * @param validationFeedback - Validation score and metrics
 * @param originalDescription - Original user description (to check for mentioned but not extracted items)
 * @returns Gap analysis with prioritized list of gaps
 */
export async function analyzeGaps(
  useCase: GenUseCase,
  validationFeedback: UseCaseTermScore,
  originalDescription: string
): Promise<GapAnalysis> {
  const gaps: Gap[] = [];
  const incompleteActors: string[] = [];
  const uncertainConditions: string[] = [];

  // 1. Check for missing exception flows
  const missingExceptionFlows = !validationFeedback.hasExceptionFlow;
  if (missingExceptionFlows) {
    gaps.push({
      type: "missing_exception_flows",
      severity: "high",
      description:
        "No exception flows found. Real-world scenarios need error handling.",
      suggestedQuestion:
        "What could go wrong during this process? What error conditions should be handled?",
    });
  }

  // 2. Check for missing alternative flows
  const missingAlternativeFlows = !validationFeedback.hasAlternativeFlow;
  if (missingAlternativeFlows) {
    gaps.push({
      type: "missing_alternative_flows",
      severity: "medium",
      description:
        "No alternative flows found. Consider different valid paths to the same goal.",
      suggestedQuestion:
        "Are there different ways to accomplish this goal? What optional paths exist?",
    });
  }

  // 3. Check for validation steps without failure handling
  const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
  if (mainFlow) {
    for (let i = 0; i < mainFlow.steps.length; i++) {
      const step = mainFlow.steps[i];
      const description = step.description.toLowerCase();

      // Check if step contains validation keywords
      if (description.match(/validat|check|verif|confirm|authentic|ensure/i)) {
        // Check if there's an exception flow from this step
        const hasExceptionFromStep = useCase.flows.some(
          (f) =>
            f.kind === "EXCEPTION" &&
            f.parentFlow === "MAIN" &&
            f.fromStepIndex === step.index
        );

        if (!hasExceptionFromStep) {
          gaps.push({
            type: "missing_validation_handling",
            severity: "high",
            description: `Step ${step.index} performs validation but has no exception flow for validation failure.`,
            relatedStep: step.index,
            relatedFlow: "MAIN",
            suggestedQuestion: `What happens if the validation in step ${step.index} fails? (${step.description})`,
          });
        }
      }

      // Check for system interactions without failure handling
      if (
        step.target &&
        step.target.toLowerCase().match(/system|service|api|database|server/i)
      ) {
        const hasExceptionFromStep = useCase.flows.some(
          (f) =>
            f.kind === "EXCEPTION" &&
            f.parentFlow === "MAIN" &&
            f.fromStepIndex === step.index
        );

        if (!hasExceptionFromStep) {
          gaps.push({
            type: "missing_system_failure_handling",
            severity: "high",
            description: `Step ${step.index} interacts with ${step.target} but has no exception flow for system failures.`,
            relatedStep: step.index,
            relatedFlow: "MAIN",
            suggestedQuestion: `What happens if ${step.target} is unavailable or fails during step ${step.index}?`,
          });
        }
      }
    }
  }

  // 4. Check for incomplete actor participation
  const allSteps = useCase.flows.flatMap((f) => f.steps);
  const usedActors = new Set(allSteps.map((s) => s.actor.toLowerCase()));

  for (const actor of useCase.actors) {
    if (!usedActors.has(actor.toLowerCase())) {
      incompleteActors.push(actor);
      gaps.push({
        type: "incomplete_actors",
        severity: "low",
        description: `Actor '${actor}' is declared but never appears in any step.`,
        suggestedQuestion: `What role does ${actor} play in this use case?`,
      });
    }
  }

  // 5. Check for flows with weak or missing conditions
  for (const flow of useCase.flows) {
    if (
      (flow.kind === "ALTERNATIVE" || flow.kind === "EXCEPTION") &&
      (!flow.condition || flow.condition.trim().length < 10)
    ) {
      uncertainConditions.push(flow.id);
      gaps.push({
        type: "uncertain_conditions",
        severity: "medium",
        description: `Flow '${flow.id}' has a weak or missing condition.`,
        relatedFlow: flow.id,
        suggestedQuestion: `Under what specific conditions does flow '${flow.id}' occur?`,
      });
    }
  }

  // 6. Priority ordering (high severity first, then by type importance)
  const priorityGaps: GapType[] = [];
  const typeOrder: GapType[] = [
    "missing_exception_flows",
    "missing_validation_handling",
    "missing_system_failure_handling",
    "missing_alternative_flows",
    "uncertain_conditions",
    "incomplete_actors",
  ];

  // Add high-severity gaps first
  for (const type of typeOrder) {
    const hasHighSeverityGap = gaps.some(
      (g) => g.type === type && g.severity === "high"
    );
    if (hasHighSeverityGap && !priorityGaps.includes(type)) {
      priorityGaps.push(type);
    }
  }

  // Then add medium and low severity
  for (const type of typeOrder) {
    if (!priorityGaps.includes(type) && gaps.some((g) => g.type === type)) {
      priorityGaps.push(type);
    }
  }

  // 7. Calculate completeness score
  // Start with validation score, penalize for major gaps
  let completenessScore = validationFeedback.overall / 100;

  // Heavy penalty for missing exception flows (most critical)
  if (missingExceptionFlows) {
    completenessScore *= 0.6;
  }

  // Penalty for validation/system steps without exception handling
  const validationGaps = gaps.filter(
    (g) =>
      g.type === "missing_validation_handling" ||
      g.type === "missing_system_failure_handling"
  ).length;
  if (validationGaps > 0) {
    completenessScore *= Math.max(0.5, 1 - validationGaps * 0.1);
  }

  // Moderate penalty for missing alternative flows
  if (missingAlternativeFlows) {
    completenessScore *= 0.85;
  }

  return {
    missingExceptionFlows,
    missingAlternativeFlows,
    incompleteActors,
    uncertainConditions,
    gaps,
    priorityGaps,
    completenessScore: Math.max(0, Math.min(1, completenessScore)),
  };
}

/**
 * Checks if gap analysis indicates the use case needs significant improvement
 * @param analysis - The gap analysis result
 * @returns true if use case has major gaps that need to be addressed
 */
export function hasMajorGaps(analysis: GapAnalysis): boolean {
  return (
    analysis.missingExceptionFlows ||
    analysis.gaps.filter((g) => g.severity === "high").length > 0 ||
    analysis.completenessScore < 0.5
  );
}

/**
 * Gets a human-readable summary of the gap analysis
 * @param analysis - The gap analysis result
 * @returns A formatted string summarizing the gaps found
 */
export function formatGapAnalysis(analysis: GapAnalysis): string {
  const parts: string[] = [];

  parts.push(
    `Completeness Score: ${(analysis.completenessScore * 100).toFixed(0)}%`
  );
  parts.push(`Total Gaps Found: ${analysis.gaps.length}`);
  parts.push("");

  if (analysis.gaps.length > 0) {
    parts.push("Gap Summary:");
    const highPriority = analysis.gaps.filter((g) => g.severity === "high");
    const mediumPriority = analysis.gaps.filter((g) => g.severity === "medium");
    const lowPriority = analysis.gaps.filter((g) => g.severity === "low");

    if (highPriority.length > 0) {
      parts.push(`  HIGH PRIORITY: ${highPriority.length} gaps`);
      highPriority.forEach((g) => parts.push(`    - ${g.description}`));
    }

    if (mediumPriority.length > 0) {
      parts.push(`  MEDIUM PRIORITY: ${mediumPriority.length} gaps`);
      mediumPriority.forEach((g) => parts.push(`    - ${g.description}`));
    }

    if (lowPriority.length > 0) {
      parts.push(`  LOW PRIORITY: ${lowPriority.length} gaps`);
    }
  } else {
    parts.push("No significant gaps detected.");
  }

  return parts.join("\n");
}
