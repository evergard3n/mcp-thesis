import { GenUseCase } from "../interfaces/usecase.interface.new.js";
import { collectUseCaseText } from "../helpers/usecase-text.js";

/**
 * Coarse vertical / process-family labels for second-stage blueprint filtering.
 * Blueprints tag themselves with one or more families; we predict labels from text
 * and intersect. Empty prediction → skip family filter (full recall).
 */
export const BLUEPRINT_FAMILY_KEYWORDS: Record<string, string[]> = {
  claims: [
    "claim",
    "adjuster",
    "loss",
    "policy",
    "insurance",
    "coverage",
    "claimant",
    "indemnity",
  ],
  purchasing: [
    "purchase",
    "order",
    "vendor",
    "buyer",
    "approv",
    "request",
    "procure",
    "po ",
    "purchase order",
    "requisition",
  ],
  corporate: ["corporate", "company", "employee", "budget", "department"],
  logistics: [
    "ship",
    "deliver",
    "warehouse",
    "freight",
    "carrier",
    "route",
    "inventory",
    "dispatch",
  ],
  locking: ["lock", "exclusive", "mutex", "contention", "deadlock", "resource access"],
  integration: ["api", "sync", "integrat", "endpoint", "service call", "rest "],
  messaging: ["event", "publish", "subscribe", "queue", "message", "notification"],
  operations: ["batch", "job", "schedule", "pipeline", "bulk"],
  web: ["session", "browser", "login", "draft", "resume", "timeout", "ui "],
  insurance: ["underwrit", "premium", "deductible", "policyholder"],
  generic: [],
};

/**
 * Keyword-based multi-label family prediction. If no keyword hits, returns an empty set
 * so callers can skip family filtering.
 */
export function predictBlueprintFamilies(
  useCase: GenUseCase,
  originalDescription: string,
): Set<string> {
  const text = collectUseCaseText(useCase, originalDescription);
  const labels = new Set<string>();
  for (const [family, keywords] of Object.entries(BLUEPRINT_FAMILY_KEYWORDS)) {
    if (family === "generic") continue;
    if (keywords.some((kw) => text.includes(kw))) {
      labels.add(family);
    }
  }
  return labels;
}

/**
 * True if this blueprint should stay in the candidate pool for activation / gap detection.
 * - No predicted labels → pass all (recall).
 * - Blueprint has `families` including "generic" → always pass.
 * - Otherwise pass if intersection(predicted, blueprint.families) is non-empty.
 */
export function blueprintMatchesPredictedFamilies(
  blueprintFamilies: string[] | undefined,
  predicted: Set<string>,
): boolean {
  const fams =
    blueprintFamilies && blueprintFamilies.length > 0
      ? blueprintFamilies
      : ["generic"];
  if (fams.includes("generic")) return true;
  if (predicted.size === 0) return true;
  return fams.some((f) => predicted.has(f));
}
