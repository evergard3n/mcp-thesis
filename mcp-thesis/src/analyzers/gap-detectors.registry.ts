import semanticService from "../services/semantic.service.js";
import { describeBranchEntry } from "../helpers/usecase-text.js";
import {
  type Gap,
  type GapDetectorConfig,
  type GapDetectionContext,
  type StepSource,
  type ConditionSource,
  GapSeverity,
  centroidGap,
  keywordGap,
  structuralGap,
  patternGap,
  isStepSource,
  isConditionSource,
} from "./gap-detector.types.js";

// ---------------------------------------------------------------------------
// Helper shared by question-generating centroid detectors
// ---------------------------------------------------------------------------

function stepContext(step: { index: number; actor: string; description: string; target?: string }): string {
  const targetContext = step.target ? ` targeting ${step.target}` : "";
  return `Step ${step.index} involves ${step.actor} performing: "${step.description}"${targetContext}`;
}

// ---------------------------------------------------------------------------
// Registry — one entry per gap type.
// Order determines the order gaps appear in analysis output.
//
// Phase reference:
//   "initial"    — runs on the raw vague baseline (before blueprint probing)
//   "post-probe" — runs after blueprint probing round; use case is enriched
//   "always"     — runs on every call regardless of phase
// ---------------------------------------------------------------------------

export const GAP_DETECTORS: GapDetectorConfig[] = [

  // =========================================================================
  // CENTROID-BASED  (post-probe: baseline has no exceptions yet; centroid
  // matching would fire on every step and generate noise)
  // =========================================================================

  centroidGap({
    gapType: "missing_validation_handling",
    categoryName: "validation",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens when this validation encounters partial data, format mismatches, or conflicting records? Describe the specific failure scenario and how it's handled.`,
  }),

  centroidGap({
    gapType: "missing_search_handling",
    categoryName: "search_lookup",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens when this search returns no results, multiple ambiguous matches, or stale/outdated data? How does the actor proceed?`,
  }),

  centroidGap({
    gapType: "missing_data_quality_handling",
    categoryName: "data_input",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens when the submitted data is incomplete, contains contradictory information, or duplicates an existing entry? What are the minimum required fields?`,
  }),

  centroidGap({
    gapType: "missing_resource_availability",
    categoryName: "resource_assignment",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens when no suitable resource is available, the assigned resource becomes unavailable, or the assignment times out? Is there a default fallback?`,
  }),

  centroidGap({
    gapType: "missing_system_failure_handling",
    categoryName: "system_interaction",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens when the system is unavailable, responds with a timeout, or returns a partial/corrupted response? Is data automatically saved?`,
  }),

  centroidGap({
    gapType: "missing_post_completion_scenarios",
    categoryName: "completion",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens if the actor attempts to finish without completing all required information? Can the process be saved for later, reopened, or reversed after this point?`,
  }),

  centroidGap({
    gapType: "missing_save_resume_handling",
    categoryName: "save_resume",
    phase: "post-probe",
    severity: GapSeverity.Medium,
    question: (step) =>
      `${stepContext(step)}. Can this step be partially completed and saved as a draft for later? What state is preserved, and what happens when the actor resumes?`,
    // Only probe multi-field / complex submission steps
    preFilter: (step) =>
      step.description.length > 50 ||
      /\b(form|report|details|fields|information|submission|entry|register|complete request|finalize|fill)\b/.test(
        step.description.toLowerCase(),
      ),
  }),

  centroidGap({
    gapType: "missing_cancellation_handling",
    categoryName: "user_cancellation",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens if the actor decides to cancel or abort at this point? Is data saved, discarded, or rolled back? Who is notified?`,
  }),

  centroidGap({
    gapType: "missing_alternative_path",
    categoryName: "alternative_path",
    phase: "post-probe",
    severity: GapSeverity.Medium,
    question: (step) =>
      `${stepContext(step)}. Is there an alternative way to accomplish this step (e.g., a different method, channel, or workflow)? Under what condition would the actor choose the alternative?`,
  }),

  centroidGap({
    gapType: "missing_authorization_denial",
    categoryName: "authorization_denial",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens if the required authorization or approval is denied at this point? Is there an escalation path, appeal, or does the process terminate?`,
  }),

  centroidGap({
    gapType: "missing_timeout_retry",
    categoryName: "timeout_retry",
    phase: "post-probe",
    severity: GapSeverity.High,
    question: (step) =>
      `${stepContext(step)}. What happens if this step times out or the expected response is not received? Is there an automatic retry, a fallback, or does the process escalate?`,
  }),

  centroidGap({
    gapType: "missing_notification_failure",
    categoryName: "notification_failure",
    phase: "post-probe",
    severity: GapSeverity.Medium,
    question: (step) =>
      `${stepContext(step)}. What happens if this notification or message fails to deliver? Is it retried, is the recipient alerted through another channel, or is the failure silently logged?`,
    preFilter: (step) =>
      /\b(notif|email|alert|send|message|inform|dispatch|broadcast|confirm|report|sms|deliver)\b/i.test(
        step.description,
      ),
  }),

  // =========================================================================
  // STRUCTURAL  (incomplete_actors is always valid; flow-presence checks are
  // only meaningful after at least one probing round)
  // =========================================================================

  structuralGap({
    gapType: "incomplete_actors",
    phase: "always",
    detect: ({ useCase }): Gap[] => {
      const allSteps = useCase.flows.flatMap((f) => f.steps);
      const usedActors = new Set(allSteps.map((s) => s.actor.toLowerCase()));
      return useCase.actors
        .filter((actor) => !usedActors.has(actor.toLowerCase()))
        .map((actor) => ({
          type: "incomplete_actors" as const,
          severity: GapSeverity.Low,
          description: `Actor '${actor}' is declared but never appears in any step.`,
          suggestedQuestion: `What role does ${actor} play in this use case?`,
        }));
    },
  }),

  // DISABLED: Global exception/alternative questions hand the LLM the full
  // step list, making it trivially enumerate one branch per step. This bypasses
  // the targeted gap-detection → question pipeline and inflates discovery
  // without proving the HITL architecture's value. Kept for reference.
  //
  // structuralGap({
  //   gapType: "missing_exception_flows",
  //   phase: "post-probe",
  //   detect: ({ validationFeedback, useCase }): Gap[] => { ... },
  // }),
  // structuralGap({
  //   gapType: "missing_alternative_flows",
  //   phase: "post-probe",
  //   detect: ({ validationFeedback, useCase }): Gap[] => { ... },
  // }),

  // =========================================================================
  // CONDITION QUALITY  (always: on a vague baseline there are no conditions,
  // so this detector naturally returns nothing on early calls)
  // =========================================================================

  patternGap({
    gapTypes: ["uncertain_conditions"],
    phase: "always",
    detect: async (ctx: GapDetectionContext): Promise<Gap[]> => {
      const gaps: Gap[] = [];
      const conditionItems = ctx.embeddedTexts.filter((e) =>
        isConditionSource(e.source),
      );
      const vagueCentroid = ctx.categories.find(
        (c) => c.name === "vague_condition",
      )?.centroid;

      for (const item of conditionItems) {
        const src = item.source as ConditionSource;
        const issues: string[] = [];
        let qualityScore = 0.7;

        if (vagueCentroid) {
          const vagueSim = await semanticService.cosineSimilarity(
            item.embedding,
            vagueCentroid,
          );
          if (vagueSim > 0.6) {
            qualityScore -= 0.3;
            issues.push("Condition is semantically vague");
          }
        }

        if (src.flow.fromStepIndex !== undefined && src.flow.parentFlow) {
          const anchorStep = ctx.embeddedTexts.find(
            (e) =>
              isStepSource(e.source) &&
              (e.source as StepSource).flowId === src.flow.parentFlow &&
              (e.source as StepSource).stepIndex === src.flow.fromStepIndex,
          );
          if (anchorStep) {
            const anchorSim = await semanticService.cosineSimilarity(
              item.embedding,
              anchorStep.embedding,
            );
            if (anchorSim < 0.3) {
              qualityScore -= 0.2;
              issues.push("Condition unrelated to anchor step");
            }
          }
        }

        if (src.flow.condition && src.flow.condition.trim().length < 10) {
          qualityScore -= 0.2;
          issues.push("Condition too short");
        }

        if (qualityScore < 0.5) {
          // Build a context-rich question: include the flow kind, the parent step
          // that this branch forks from, and the branch's own first step so the
          // expert understands exactly which point in the narrative we are asking about.
          const flow = src.flow;
          const flowKindLabel =
            flow.kind === "ALTERNATIVE" ? "alternative flow" : "exception flow";
          const branchContext = describeBranchEntry(ctx.useCase, flow);

          const suggestedQuestion =
            `In the "${src.flowId}" ${flowKindLabel}:${branchContext} ` +
            `What is the exact condition or event that triggers this branch? ` +
            `Describe the specific state, actor action, or system signal that causes execution to leave the normal flow and enter "${src.flowId}".`;

          gaps.push({
            type: "uncertain_conditions",
            severity: qualityScore < 0.3 ? GapSeverity.High : GapSeverity.Medium,
            description: `Flow "${src.flowId}" has weak condition: ${issues.join(", ")}`,
            relatedFlow: src.flowId,
            suggestedQuestion,
          });
        }
      }
      return gaps;
    },
  }),

  // =========================================================================
  // KEYWORD-BASED  (always: description-driven, valid from the first call)
  // =========================================================================

  keywordGap({
    gapType: "missing_temporal_exceptions",
    triggerKeywords: [
      "at any time",
      "anytime",
      "at all times",
      "throughout",
      "during any",
      "while",
    ],
    phase: "always",
    severity: GapSeverity.High,
    description:
      "Description mentions scenarios that can occur 'at any time' but no global exception flows found.",
    question:
      "Are there any conditions that can occur at any time during the process (e.g., system failures, interruptions)?",
    isCovered: (uc) =>
      uc.flows.some(
        (f) =>
          f.kind === "EXCEPTION" &&
          (f.fromStepIndex === undefined || f.fromStepIndex === null),
      ),
  }),

  keywordGap({
    gapType: "missing_nested_exceptions",
    triggerKeywords: [
      "timeout",
      "does not respond",
      "fails to provide",
      "within time period",
      "no response",
      "does not supply",
    ],
    phase: "always",
    severity: GapSeverity.Medium,
    description:
      "Description mentions timeout or non-response scenarios but no nested exception flows found.",
    question:
      "What happens if a response or action is not received within the expected time? Are there timeouts or escalations?",
    isCovered: (uc) => {
      const exceptionFlows = uc.flows.filter((f) => f.kind === "EXCEPTION");
      // If no exception flows exist yet, treat as covered (too early to probe
      // for nested exceptions — blueprint probing hasn't happened yet)
      if (exceptionFlows.length === 0) return true;
      return exceptionFlows.some((f) => {
        const parent = uc.flows.find((pf) => pf.id === f.parentFlow);
        return parent && parent.kind === "EXCEPTION";
      });
    },
  }),

  keywordGap({
    gapType: "missing_environmental_interruptions",
    triggerKeywords: [
      "fire alarm",
      "emergency",
      "evacuation",
      "power outage",
      "natural disaster",
      "interruption",
      "external event",
    ],
    phase: "always",
    severity: GapSeverity.Medium,
    description:
      "Description mentions environmental or external interruptions but no related exception flows found.",
    question:
      "How does the process handle external interruptions like emergencies, power failures, or environmental events?",
    isCovered: (uc) =>
      uc.flows.some(
        (f) =>
          f.kind === "EXCEPTION" &&
          [
            "fire alarm",
            "emergency",
            "evacuation",
            "power outage",
            "natural disaster",
            "interruption",
            "external event",
          ].some((kw) => f.condition?.toLowerCase().includes(kw)),
      ),
  }),

  keywordGap({
    gapType: "missing_technology_variations",
    triggerKeywords: [
      "by check",
      "by cash",
      "electronic",
      "paper",
      "digital",
      "manual",
      "automated",
      "online",
      "offline",
    ],
    phase: "always",
    severity: GapSeverity.Low,
    description:
      "Description mentions different technology or implementation methods but no alternative flows found.",
    question:
      "Are there different ways to implement certain steps (e.g., electronic vs. paper, online vs. offline)?",
    isCovered: (uc) => {
      const mainFlow = uc.flows.find((f) => f.kind === "MAIN");
      const alternativeFlows = uc.flows.filter((f) => f.kind === "ALTERNATIVE");
      return !mainFlow || alternativeFlows.length > 0;
    },
  }),

  // =========================================================================
  // PATTERN  (post-probe: needs structured flow state to detect coverage gaps)
  // =========================================================================

  // Claim / adjudication outcomes — may emit up to 3 distinct gap types
  patternGap({
    gapTypes: [
      "missing_eligibility_failure_handling",
      "missing_assignment_unavailability_handling",
      "missing_policy_outcome_branching",
    ],
    phase: "post-probe",
    detect: ({ useCase }): Gap[] => {
      const mainFlow = useCase.flows.find(
        (f) => f.id === "MAIN" || f.kind === "MAIN",
      );
      if (!mainFlow) return [];

      const mainSteps = mainFlow.steps.map((step) => ({
        ...step,
        dl: step.description.toLowerCase(),
      }));

      const hasPolicyValidation = mainSteps.some(
        (s) =>
          (s.dl.includes("policy") &&
            (s.dl.includes("valid") ||
              s.dl.includes("verify") ||
              s.dl.includes("align") ||
              s.dl.includes("guideline"))) ||
          (s.dl.includes("eligib") && s.dl.includes("verify")),
      );

      const hasAssignment = mainSteps.some(
        (s) =>
          s.dl.includes("assign") &&
          (s.dl.includes("agent") ||
            s.dl.includes("review") ||
            s.dl.includes("adjuster")),
      );

      const hasGuidelineReview = mainSteps.some(
        (s) =>
          s.dl.includes("guideline") ||
          (s.dl.includes("policy") && s.dl.includes("within")),
      );

      const nonMainFlows = useCase.flows.filter((f) => f.id !== mainFlow.id);

      const flowText = (f: (typeof nonMainFlows)[0]) =>
        `${f.condition ?? ""} ${f.steps.map((s) => s.description).join(" ")}`.toLowerCase();

      const hasDeclineTermination = nonMainFlows.some((f) => {
        const t = flowText(f);
        return (
          (t.includes("decline") || t.includes("reject")) &&
          (t.includes("terminate") || t.includes("close") || t.includes("end"))
        );
      });

      const hasAssignmentUnavailable = nonMainFlows.some((f) => {
        const t = flowText(f);
        return (
          (t.includes("wait") || t.includes("hold") || t.includes("queue")) &&
          t.includes("assign") &&
          (t.includes("agent") ||
            t.includes("review") ||
            t.includes("adjuster"))
        );
      });

      const hasNegotiation = nonMainFlows.some((f) => {
        const t = flowText(f);
        return (
          t.includes("negotiat") ||
          t.includes("partial payment") ||
          t.includes("adjusted payment")
        );
      });

      const gaps: Gap[] = [];

      if (hasPolicyValidation && !hasDeclineTermination) {
        gaps.push({
          type: "missing_eligibility_failure_handling",
          severity: GapSeverity.High,
          description:
            "Main flow validates policy/eligibility but no explicit decline-and-terminate outcome is modeled for invalid cases.",
          suggestedQuestion:
            "If eligibility or policy validation fails, what exact steps occur (decline, notify claimant, record details), and does the process terminate or allow retry/appeal?",
        });
      }

      if (hasAssignment && !hasAssignmentUnavailable) {
        gaps.push({
          type: "missing_assignment_unavailability_handling",
          severity: GapSeverity.High,
          description:
            "Main flow assigns an agent/reviewer but no branch describes what happens when no assignee is available.",
          suggestedQuestion:
            "What happens if no reviewer/agent is available at assignment time? Is the case queued or put on hold, who is notified, and when does processing resume?",
        });
      }

      if (hasGuidelineReview && !hasNegotiation) {
        gaps.push({
          type: "missing_policy_outcome_branching",
          severity: GapSeverity.Medium,
          description:
            "Main flow checks policy guidelines but does not model differentiated outcomes for severe vs minor violations.",
          suggestedQuestion:
            "When policy guidelines are violated, how are major violations handled versus minor violations? Does one path terminate while another allows negotiation or adjusted payment?",
        });
      }

      return gaps;
    },
  }),
];
