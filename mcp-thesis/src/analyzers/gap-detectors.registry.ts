import semanticService from "../services/semantic.service.js";
import {
  type Gap,
  type GapDetectorConfig,
  type GapDetectionContext,
  GapSeverity,
  centroidGap,
  keywordGap,
  actorGap,
  conditionQualityGap,
} from "./gap-detector.types.js";

// ---------------------------------------------------------------------------
// Registry — one entry per gap type.
// Order determines the order gaps appear in analysis output.
// ---------------------------------------------------------------------------

export const GAP_DETECTORS: GapDetectorConfig[] = [

  // =========================================================================
  // CENTROID-BASED  (post-probe: baseline has no exceptions yet; centroid
  // matching would fire on every step and generate noise)
  // =========================================================================

  centroidGap({
    gapType: "missing_validation_handling",
    categoryName: "validation",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_search_handling",
    categoryName: "search_lookup",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_data_quality_handling",
    categoryName: "data_input",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_resource_availability",
    categoryName: "resource_assignment",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_system_failure_handling",
    categoryName: "system_interaction",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_post_completion_scenarios",
    categoryName: "completion",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_save_resume_handling",
    categoryName: "save_resume",
    severity: GapSeverity.Medium,
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
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_alternative_path",
    categoryName: "alternative_path",
    severity: GapSeverity.Medium,
  }),

  centroidGap({
    gapType: "missing_authorization_denial",
    categoryName: "authorization_denial",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_timeout_retry",
    categoryName: "timeout_retry",
    severity: GapSeverity.High,
  }),

  centroidGap({
    gapType: "missing_notification_failure",
    categoryName: "notification_failure",
    severity: GapSeverity.Medium,
    preFilter: (step) =>
      /\b(notif|email|alert|send|message|inform|dispatch|broadcast|confirm|report|sms|deliver)\b/i.test(
        step.description,
      ),
  }),

  // =========================================================================
  // STRUCTURAL
  // =========================================================================

  actorGap({ gapType: "incomplete_actors" }),

  // =========================================================================
  // CONDITION QUALITY
  // =========================================================================

  conditionQualityGap({ gapType: "uncertain_conditions" }),

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

 
];
