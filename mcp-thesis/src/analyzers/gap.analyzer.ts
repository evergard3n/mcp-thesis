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
  | "missing_system_failure_handling"
  | "missing_temporal_exceptions"
  | "missing_nested_exceptions"
  | "missing_resource_availability"
  | "missing_post_completion_scenarios"
  | "missing_data_quality_handling"
  | "missing_environmental_interruptions"
  | "missing_technology_variations";

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
 * Detects missing temporal/async exceptions that can occur at any time
 */
function detectTemporalExceptions(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];
  const descLower = originalDescription.toLowerCase();

  // Check if description mentions temporal scenarios
  const temporalKeywords = [
    "at any time",
    "anytime",
    "at all times",
    "throughout",
    "during any",
    "while",
  ];

  const hasTemporalMention = temporalKeywords.some((kw) =>
    descLower.includes(kw)
  );

  if (hasTemporalMention) {
    // Check if there are exception flows without fromStepIndex (global exceptions)
    const hasGlobalException = useCase.flows.some(
      (f) =>
        f.kind === "EXCEPTION" &&
        (f.fromStepIndex === undefined || f.fromStepIndex === null)
    );

    if (!hasGlobalException) {
      gaps.push({
        type: "missing_temporal_exceptions",
        severity: "high",
        description:
          "Description mentions scenarios that can occur 'at any time' but no global exception flows found.",
        suggestedQuestion:
          "Are there any conditions that can occur at any time during the process (e.g., system failures, interruptions)?",
      });
    }
  }

  return gaps;
}

/**
 * Detects missing nested exceptions (exceptions within exception handling)
 */
function detectNestedExceptions(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];
  const descLower = originalDescription.toLowerCase();

  // Check for nested exception keywords
  const nestedKeywords = [
    "timeout",
    "does not respond",
    "fails to provide",
    "within time period",
    "no response",
    "does not supply",
  ];

  const hasNestedMention = nestedKeywords.some((kw) => descLower.includes(kw));

  if (hasNestedMention) {
    // Check if there are exception flows with parentFlow pointing to another exception
    const exceptionFlows = useCase.flows.filter((f) => f.kind === "EXCEPTION");
    const hasNestedExceptions = exceptionFlows.some((f) => {
      const parent = useCase.flows.find((pf) => pf.id === f.parentFlow);
      return parent && parent.kind === "EXCEPTION";
    });

    if (!hasNestedExceptions && exceptionFlows.length > 0) {
      gaps.push({
        type: "missing_nested_exceptions",
        severity: "medium",
        description:
          "Description mentions timeout or non-response scenarios but no nested exception flows found.",
        suggestedQuestion:
          "What happens if a response or action is not received within the expected time? Are there timeouts or escalations?",
      });
    }
  }

  return gaps;
}

/**
 * Detects missing resource availability exceptions
 */
function detectResourceAvailability(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];
  const descLower = originalDescription.toLowerCase();

  // Find assignment/allocation steps
  const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
  if (!mainFlow) return gaps;

  for (const step of mainFlow.steps) {
    const stepDesc = step.description.toLowerCase();

    // Check if step involves resource assignment
    if (stepDesc.match(/assign|allocat|schedul|reserve|book|distribute/i)) {
      // Check if there's an exception for resource unavailability
      const hasResourceException = useCase.flows.some(
        (f) =>
          f.kind === "EXCEPTION" &&
          f.fromStepIndex === step.index &&
          (f.condition?.toLowerCase().includes("no ") ||
            f.condition?.toLowerCase().includes("unavailable") ||
            f.condition?.toLowerCase().includes("insufficient"))
      );

      if (!hasResourceException) {
        gaps.push({
          type: "missing_resource_availability",
          severity: "high",
          description: `Step ${step.index} involves resource assignment but has no exception for resource unavailability.`,
          relatedStep: step.index,
          relatedFlow: "MAIN",
          suggestedQuestion: `What happens if no resources (agents, slots, capacity) are available at step ${step.index}?`,
        });
      }
    }
  }

  // Also check if description mentions resource constraints
  const resourceKeywords = [
    "no agents",
    "unavailable",
    "not available",
    "insufficient",
    "capacity",
    "overloaded",
    "fully booked",
  ];

  const hasResourceMention = resourceKeywords.some((kw) =>
    descLower.includes(kw)
  );

  if (hasResourceMention && gaps.length === 0) {
    gaps.push({
      type: "missing_resource_availability",
      severity: "medium",
      description:
        "Description mentions resource availability issues but no related exception flows found.",
      suggestedQuestion:
        "What happens when required resources (agents, slots, equipment) are unavailable?",
    });
  }

  return gaps;
}

/**
 * Detects missing post-completion scenarios (reopening, reversal)
 */
function detectPostCompletionScenarios(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];
  const descLower = originalDescription.toLowerCase();

  // Find closing/completion steps
  const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
  if (!mainFlow || mainFlow.steps.length === 0) return gaps;

  const lastStep = mainFlow.steps[mainFlow.steps.length - 1];
  const lastStepDesc = lastStep.description.toLowerCase();

  // Check if last step is a closing action
  if (lastStepDesc.match(/close|complet|finish|terminat|end|settle|finaliz/i)) {
    // Check if there's an exception or alternative flow from the last step
    const hasPostCompletionFlow = useCase.flows.some(
      (f) =>
        (f.kind === "EXCEPTION" || f.kind === "ALTERNATIVE") &&
        f.fromStepIndex === lastStep.index
    );

    if (!hasPostCompletionFlow) {
      gaps.push({
        type: "missing_post_completion_scenarios",
        severity: "medium",
        description: `Step ${lastStep.index} closes the process but has no flows for post-completion scenarios.`,
        relatedStep: lastStep.index,
        relatedFlow: "MAIN",
        suggestedQuestion: `Can this process be reopened or reversed after step ${lastStep.index}? What happens if new information arrives after completion?`,
      });
    }
  }

  // Also check description for reopening keywords
  const reopenKeywords = [
    "reopen",
    "reverse",
    "undo",
    "after close",
    "after completion",
    "reverts to",
    "resume",
    "reactivate",
  ];

  const hasReopenMention = reopenKeywords.some((kw) => descLower.includes(kw));

  if (hasReopenMention && gaps.length === 0) {
    gaps.push({
      type: "missing_post_completion_scenarios",
      severity: "high",
      description:
        "Description mentions post-completion actions but no related flows found.",
      suggestedQuestion:
        "Under what conditions can this process be reopened or resumed after completion?",
    });
  }

  return gaps;
}

/**
 * Detects missing data quality handling at input steps
 */
function detectDataQualityIssues(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];

  // Focus on first 2 steps (initial data collection)
  const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
  if (!mainFlow || mainFlow.steps.length < 2) return gaps;

  const initialSteps = mainFlow.steps.slice(0, 2);

  for (const step of initialSteps) {
    const stepDesc = step.description.toLowerCase();

    // Check if step involves data submission/collection
    if (
      stepDesc.match(
        /submit|enter|provid|input|report|fill|upload|send|register/i
      )
    ) {
      // Check if there's an exception for data quality issues
      const hasDataQualityException = useCase.flows.some(
        (f) =>
          f.kind === "EXCEPTION" &&
          f.fromStepIndex === step.index &&
          (f.condition?.toLowerCase().includes("incomplete") ||
            f.condition?.toLowerCase().includes("invalid") ||
            f.condition?.toLowerCase().includes("missing") ||
            f.condition?.toLowerCase().includes("malformed"))
      );

      if (!hasDataQualityException) {
        gaps.push({
          type: "missing_data_quality_handling",
          severity: "high",
          description: `Step ${step.index} involves data submission but has no exception for incomplete or invalid data.`,
          relatedStep: step.index,
          relatedFlow: "MAIN",
          suggestedQuestion: `What happens if the data submitted in step ${step.index} is incomplete, invalid, or missing required fields?`,
        });
      }
    }
  }

  return gaps;
}

/**
 * Detects missing environmental/external interruption handling
 */
function detectEnvironmentalInterruptions(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];
  const descLower = originalDescription.toLowerCase();

  // Check for environmental interruption keywords
  const environmentalKeywords = [
    "fire alarm",
    "emergency",
    "evacuation",
    "power outage",
    "natural disaster",
    "interruption",
    "external event",
  ];

  const hasEnvironmentalMention = environmentalKeywords.some((kw) =>
    descLower.includes(kw)
  );

  if (hasEnvironmentalMention) {
    // Check if there are exception flows for environmental events
    const hasEnvironmentalException = useCase.flows.some(
      (f) =>
        f.kind === "EXCEPTION" &&
        environmentalKeywords.some((kw) =>
          f.condition?.toLowerCase().includes(kw)
        )
    );

    if (!hasEnvironmentalException) {
      gaps.push({
        type: "missing_environmental_interruptions",
        severity: "medium",
        description:
          "Description mentions environmental or external interruptions but no related exception flows found.",
        suggestedQuestion:
          "How does the process handle external interruptions like emergencies, power failures, or environmental events?",
      });
    }
  }

  return gaps;
}

/**
 * Detects missing technology variation flows
 */
function detectTechnologyVariations(
  useCase: GenUseCase,
  originalDescription: string
): Gap[] {
  const gaps: Gap[] = [];
  const descLower = originalDescription.toLowerCase();

  // Check for technology variation keywords
  const techKeywords = [
    "by check",
    "by cash",
    "electronic",
    "paper",
    "digital",
    "manual",
    "automated",
    "online",
    "offline",
  ];

  const hasTechMention = techKeywords.some((kw) => descLower.includes(kw));

  if (hasTechMention) {
    // Check if there are alternative flows for technology variations
    const mainFlow = useCase.flows.find((f) => f.kind === "MAIN");
    const alternativeFlows = useCase.flows.filter(
      (f) => f.kind === "ALTERNATIVE"
    );

    if (alternativeFlows.length === 0 && mainFlow) {
      gaps.push({
        type: "missing_technology_variations",
        severity: "low",
        description:
          "Description mentions different technology or implementation methods but no alternative flows found.",
        suggestedQuestion:
          "Are there different ways to implement certain steps (e.g., electronic vs. paper, online vs. offline)?",
      });
    }
  }

  return gaps;
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

  // 6. NEW: Detect temporal/async exceptions
  gaps.push(...detectTemporalExceptions(useCase, originalDescription));

  // 7. NEW: Detect nested exceptions
  gaps.push(...detectNestedExceptions(useCase, originalDescription));

  // 8. NEW: Detect resource availability issues
  gaps.push(...detectResourceAvailability(useCase, originalDescription));

  // 9. NEW: Detect post-completion scenarios
  gaps.push(...detectPostCompletionScenarios(useCase, originalDescription));

  // 10. NEW: Detect data quality issues at input
  gaps.push(...detectDataQualityIssues(useCase, originalDescription));

  // 11. NEW: Detect environmental interruptions
  gaps.push(...detectEnvironmentalInterruptions(useCase, originalDescription));

  // 12. NEW: Detect technology variations
  gaps.push(...detectTechnologyVariations(useCase, originalDescription));

  // 13. Priority ordering (high severity first, then by type importance)
  const priorityGaps: GapType[] = [];
  const typeOrder: GapType[] = [
    "missing_exception_flows",
    "missing_data_quality_handling",
    "missing_validation_handling",
    "missing_resource_availability",
    "missing_system_failure_handling",
    "missing_post_completion_scenarios",
    "missing_temporal_exceptions",
    "missing_nested_exceptions",
    "missing_environmental_interruptions",
    "missing_alternative_flows",
    "missing_technology_variations",
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

  // 14. Calculate completeness score
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

  // Penalty for data quality issues (critical for input steps)
  const dataQualityGaps = gaps.filter(
    (g) => g.type === "missing_data_quality_handling"
  ).length;
  if (dataQualityGaps > 0) {
    completenessScore *= Math.max(0.5, 1 - dataQualityGaps * 0.15);
  }

  // Penalty for resource availability issues
  const resourceGaps = gaps.filter(
    (g) => g.type === "missing_resource_availability"
  ).length;
  if (resourceGaps > 0) {
    completenessScore *= Math.max(0.6, 1 - resourceGaps * 0.1);
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
