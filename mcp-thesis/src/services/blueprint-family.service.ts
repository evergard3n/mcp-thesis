import { GenUseCase } from "../interfaces/usecase.interface.new.js";

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

export interface FamilyPrediction {
  /** Matched family keys (never includes "generic" from keywords — generic is implicit fallback). */
  labels: Set<string>;
  /** 0–1 heuristic strength; used to decide whether to apply family filter. */
  strength: number;
}

function collectUseCaseText(useCase: GenUseCase, originalDescription: string): string {
  const flowBits = useCase.flows.flatMap((f) => [
    f.id,
    f.condition ?? "",
    ...f.steps.map((s) => `${s.actor} ${s.description}`),
  ]);
  return [
    useCase.name,
    useCase.summary,
    originalDescription,
    ...(useCase.actors ?? []),
    ...flowBits,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Keyword-based multi-label family prediction. If no keyword hits, returns empty labels
 * and strength 0 → callers should skip family filtering.
 */
export function predictBlueprintFamilies(
  useCase: GenUseCase,
  originalDescription: string,
): FamilyPrediction {
  const text = collectUseCaseText(useCase, originalDescription);
  const labels = new Set<string>();
  for (const [family, keywords] of Object.entries(BLUEPRINT_FAMILY_KEYWORDS)) {
    if (family === "generic") continue;
    if (keywords.some((kw) => text.includes(kw))) {
      labels.add(family);
    }
  }
  const strength =
    labels.size === 0 ? 0 : Math.min(1, 0.35 + labels.size * 0.18);
  return { labels, strength };
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
