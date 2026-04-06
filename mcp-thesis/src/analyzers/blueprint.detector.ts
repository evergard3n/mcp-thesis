import { readFile } from "fs/promises";
import { join } from "path";
import {
  GenUseCase,
  GenFlow,
  GenStep,
} from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import {
  predictBlueprintFamilies,
  blueprintMatchesPredictedFamilies,
} from "../services/blueprint-family.service.js";
import { Gap } from "./gap-detector.types.js";

export interface BlueprintGapResult {
  gaps: Gap[];
  coveredStepKeys: Set<string>;
  detectedDomains: Set<"human-system" | "system-system">;
}

export type DomainType = "human-system" | "system-system";

interface BlueprintActivationRules {
  minRolesMatched: number;
  requireDifferentActors: boolean;
}

interface BlueprintRoleDefinition {
  id: string;
  description: string;
  isMandatory: boolean;
  threshold: number;
  keywords: string[];
  centroid?: number[] | null;
}

interface BlueprintScenarioDefinition {
  id: string;
  description: string;
  triggerCondition: string;
  anchorRole: string;
  severity: "high" | "medium" | "low";
  threshold: number;
  questionTemplate: string;
  checkPhrases: string[];
  centroid?: number[] | null;
}

interface BlueprintDefinition {
  id: string;
  name: string;
  domainType: DomainType;
  domainDescription?: string;
  /** Process-family tags for second-stage filtering (multi-label). */
  families?: string[];
  probeQuestion?: string;
  activation: BlueprintActivationRules;
  roles: BlueprintRoleDefinition[];
  expectedScenarios: BlueprintScenarioDefinition[];
}

/** Optional context to narrow blueprints by predicted families. */
export interface BlueprintActivationOptions {
  useCase?: GenUseCase;
  originalDescription?: string;
}

interface BlueprintDataFile {
  modelId: string;
  blueprints: BlueprintDefinition[];
}

interface RoleCandidate {
  stepIndex: number;
  step: GenStep;
  flowId: string;
  actor: string;
  similarity: number;
}

interface RoleAssignment {
  roleId: string;
  stepIndex: number;
  flowId: string;
  actor: string;
  description: string;
  similarity: number;
}

export interface BlueprintActivation {
  blueprintId: string;
  blueprintName: string;
  probeQuestion: string;
  confidence: number;
  assignments: RoleAssignment[];
  domainType?: string;
}

export interface EmbeddedStep {
  step: GenStep;
  flow: GenFlow;
  embedding: number[];
}

let blueprintCache: BlueprintDefinition[] | null = null;

export function clearBlueprintCache(): void {
  blueprintCache = null;
  console.log("Blueprint cache cleared");
}

async function loadBlueprints(): Promise<BlueprintDefinition[]> {
  if (blueprintCache) return blueprintCache;

  try {
    const dataPath = join(process.cwd(), "src/data/blueprints.json");
    const fileContent = await readFile(dataPath, "utf-8");
    const data = JSON.parse(fileContent) as BlueprintDataFile;

    console.log(`Loading blueprints from ${dataPath}`);
    let computedRoles = 0;
    let computedScenarios = 0;

    for (const blueprint of data.blueprints) {
      for (const role of blueprint.roles) {
        if (!role.centroid) {
          const roleEmbeddings = await semanticService.embedBatch(
            role.keywords,
          );
          role.centroid = await semanticService.computeCentroid(roleEmbeddings);
          computedRoles++;
        }
      }

      for (const scenario of blueprint.expectedScenarios) {
        if (!scenario.centroid) {
          const scenarioEmbeddings = await semanticService.embedBatch(
            scenario.checkPhrases,
          );
          scenario.centroid =
            await semanticService.computeCentroid(scenarioEmbeddings);
          computedScenarios++;
        }
      }
    }

    blueprintCache = data.blueprints;
    console.log(
      `Blueprints loaded: ${blueprintCache.length} (roles computed: ${computedRoles}, scenarios computed: ${computedScenarios})`,
    );

    // Log domain distribution
    const domainCounts = blueprintCache.reduce(
      (acc, bp) => {
        acc[bp.domainType] = (acc[bp.domainType] || 0) + 1;
        return acc;
      },
      {} as Record<DomainType, number>,
    );
    console.log(`Domain distribution:`, domainCounts);

    return blueprintCache;
  } catch (error) {
    console.error("Failed to load blueprints:", error);
    return [];
  }
}

/**
 * Get blueprints filtered by domain type
 */
export async function getBlueprintsByDomain(
  domainType?: DomainType,
): Promise<BlueprintDefinition[]> {
  const allBlueprints = await loadBlueprints();
  if (!domainType) return allBlueprints;
  return allBlueprints.filter((bp) => bp.domainType === domainType);
}

/**
 * Get available domain types from loaded blueprints
 */
export async function getAvailableDomains(): Promise<DomainType[]> {
  const blueprints = await loadBlueprints();
  return Array.from(new Set(blueprints.map((bp) => bp.domainType)));
}

function collectEmbeddedMainSteps(
  embeddedSteps: EmbeddedStep[],
): EmbeddedStep[] {
  return embeddedSteps.filter((item) => item.flow.kind === "MAIN");
}

async function buildCandidatesForRole(
  role: BlueprintRoleDefinition,
  mainSteps: EmbeddedStep[],
): Promise<RoleCandidate[]> {
  if (!role.centroid) return [];

  const candidates: RoleCandidate[] = [];
  for (const item of mainSteps) {
    const similarity = await semanticService.cosineSimilarity(
      item.embedding,
      role.centroid,
    );
    if (similarity >= role.threshold) {
      candidates.push({
        stepIndex: item.step.index,
        step: item.step,
        flowId: item.flow.id,
        actor: item.step.actor,
        similarity,
      });
    }
  }

  return candidates.sort((a, b) => {
    const d = b.similarity - a.similarity;
    if (Math.abs(d) > 1e-9) return d > 0 ? 1 : -1;
    return a.stepIndex - b.stepIndex;
  });
}

function assignRolesOrdered(
  blueprint: BlueprintDefinition,
  candidatesMap: Map<string, RoleCandidate[]>,
): RoleAssignment[] | null {
  const assignments: RoleAssignment[] = [];
  let lastAssignedStepIndex = -1;

  for (const role of blueprint.roles) {
    const candidates = candidatesMap.get(role.id) ?? [];
    const filteredCandidates = candidates.filter(
      (candidate) => candidate.stepIndex > lastAssignedStepIndex,
    );

    if (filteredCandidates.length === 0) {
      if (role.isMandatory) return null;
      continue;
    }

    const chosen = filteredCandidates[0];
    assignments.push({
      roleId: role.id,
      stepIndex: chosen.stepIndex,
      flowId: chosen.flowId,
      actor: chosen.actor,
      description: chosen.step.description,
      similarity: chosen.similarity,
    });
    lastAssignedStepIndex = chosen.stepIndex;
  }

  if (assignments.length < blueprint.activation.minRolesMatched) {
    return null;
  }

  if (blueprint.activation.requireDifferentActors) {
    const actorSet = new Set(assignments.map((assignment) => assignment.actor));
    if (actorSet.size < assignments.length) return null;
  }

  return assignments;
}

function interpolateTemplate(
  template: string,
  assignmentsByRole: Map<string, RoleAssignment>,
): string {
  let output = template;

  for (const [roleId, assignment] of assignmentsByRole.entries()) {
    const replacements: Array<[string, string]> = [
      [`{${roleId}.actor}`, assignment.actor],
      [`{${roleId}.stepIndex}`, assignment.stepIndex.toString()],
      [`{${roleId}.description}`, assignment.description],
    ];

    for (const [token, value] of replacements) {
      output = output.split(token).join(value);
    }
  }

  return output;
}

async function isScenarioCovered(
  scenario: BlueprintScenarioDefinition,
  coverageEmbeddings: Array<{ embedding: number[]; weight: number }>,
): Promise<boolean> {
  if (!scenario.centroid || coverageEmbeddings.length === 0) return false;

  let maxSimilarity = 0;
  for (const item of coverageEmbeddings) {
    const sim = await semanticService.cosineSimilarity(
      item.embedding,
      scenario.centroid,
    );
    maxSimilarity = Math.max(maxSimilarity, sim * item.weight);
  }

  return maxSimilarity >= scenario.threshold;
}

/**
 * Run role matching only for all blueprints and return activations sorted by confidence.
 * Used for the probe phase: identify which blueprints are plausibly active before
 * asking the expert to confirm them.
 */
export async function detectActivatedBlueprints(
  embeddedSteps: EmbeddedStep[],
  filterByDomain?: DomainType,
  options?: BlueprintActivationOptions,
): Promise<BlueprintActivation[]> {
  let blueprints = await loadBlueprints();
  if (filterByDomain) {
    blueprints = blueprints.filter((bp) => bp.domainType === filterByDomain);
  }

  if (options?.useCase && options.originalDescription !== undefined) {
    const { labels, strength } = predictBlueprintFamilies(
      options.useCase,
      options.originalDescription,
    );
    if (labels.size > 0 && strength >= 0.35) {
      const before = blueprints.length;
      blueprints = blueprints.filter((bp) =>
        blueprintMatchesPredictedFamilies(bp.families, labels),
      );
      console.log(
        `[Blueprint families] predicted=[${[...labels].join(", ")}] strength=${strength.toFixed(2)} → ${blueprints.length}/${before} blueprints`,
      );
    }
  }

  const mainSteps = collectEmbeddedMainSteps(embeddedSteps);
  const activations: BlueprintActivation[] = [];

  for (const blueprint of blueprints) {
    const candidatesMap = new Map<string, RoleCandidate[]>();
    for (const role of blueprint.roles) {
      const candidates = await buildCandidatesForRole(role, mainSteps);
      candidatesMap.set(role.id, candidates);
    }

    const assignments = assignRolesOrdered(blueprint, candidatesMap);
    if (!assignments) continue;

    const avgConfidence =
      assignments.reduce((sum, a) => sum + a.similarity, 0) / assignments.length;

    activations.push({
      blueprintId: blueprint.id,
      blueprintName: blueprint.name,
      probeQuestion: blueprint.probeQuestion ?? `Does this use case involve a ${blueprint.name} pattern?`,
      confidence: avgConfidence,
      assignments,
      domainType: blueprint.domainType,
    });
  }

  return activations.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Detect blueprint gaps in a use case
 *
 * @param useCase The use case to analyze
 * @param embeddedSteps Embedded steps with precomputed embeddings
 * @param filterByDomain Optional domain filter to only activate matching blueprints (prevents cross-domain overlap)
 * @param confirmedBlueprintIds If provided and non-empty, only process blueprints in this set
 * @param droppedBlueprintIds Ignored for blueprint selection (soft-drop policy: only
 *   `confirmedBlueprintIds` gates which blueprints emit gaps; probe non-confirmation is not permanent exclusion).
 * @returns Blueprint gap analysis result
 */
export async function detectBlueprintGaps(
  useCase: GenUseCase,
  embeddedSteps: EmbeddedStep[],
  filterByDomain?: DomainType,
  confirmedBlueprintIds?: Set<string>,
  _droppedBlueprintIds?: Set<string>,
  options?: BlueprintActivationOptions,
): Promise<BlueprintGapResult> {
  let blueprints = await loadBlueprints();

  // FIX: Domain-based filtering to prevent cross-domain overlap
  if (filterByDomain) {
    const originalCount = blueprints.length;
    blueprints = blueprints.filter((bp) => bp.domainType === filterByDomain);
    console.log(
      `Blueprint domain filter: ${filterByDomain} (${blueprints.length}/${originalCount} blueprints active)`,
    );
  }

  if (options?.useCase && options.originalDescription !== undefined) {
    const { labels, strength } = predictBlueprintFamilies(
      options.useCase,
      options.originalDescription,
    );
    if (labels.size > 0 && strength >= 0.35) {
      const before = blueprints.length;
      blueprints = blueprints.filter((bp) =>
        blueprintMatchesPredictedFamilies(bp.families, labels),
      );
      console.log(
        `[Blueprint families] gap pass: ${blueprints.length}/${before} blueprints after family filter`,
      );
    }
  }

  // If confirmed set is provided but empty, probe hasn't happened yet — emit nothing
  if (confirmedBlueprintIds !== undefined && confirmedBlueprintIds.size === 0) {
    return { gaps: [], coveredStepKeys: new Set(), detectedDomains: new Set() };
  }

  // If confirmed set is non-empty, only process confirmed blueprints
  if (confirmedBlueprintIds && confirmedBlueprintIds.size > 0) {
    blueprints = blueprints.filter((bp) => confirmedBlueprintIds.has(bp.id));
  }

  const gaps: Gap[] = [];
  const coveredStepKeys = new Set<string>();
  const detectedDomains = new Set<DomainType>();

  if (blueprints.length === 0)
    return { gaps, coveredStepKeys, detectedDomains };

  const mainSteps = collectEmbeddedMainSteps(embeddedSteps);
  const coverageTexts: Array<{ text: string; weight: number }> = [];
  for (const flow of useCase.flows) {
    if (flow.kind === "MAIN") continue;
    if (flow.condition) {
      coverageTexts.push({ text: flow.condition, weight: 1.2 });
    }
    for (const step of flow.steps) {
      coverageTexts.push({ text: step.description, weight: 1 });
    }
  }
  const coverageEmbeddings = coverageTexts.length
    ? await semanticService.embedBatch(coverageTexts.map((t) => t.text))
    : [];
  const coverageItems = coverageEmbeddings.map((embedding, index) => ({
    embedding,
    weight: coverageTexts[index].weight,
  }));

  for (const blueprint of blueprints) {
    const candidatesMap = new Map<string, RoleCandidate[]>();
    for (const role of blueprint.roles) {
      const candidates = await buildCandidatesForRole(role, mainSteps);
      candidatesMap.set(role.id, candidates);
    }

    const assignments = assignRolesOrdered(blueprint, candidatesMap);
    if (!assignments) continue;

    // Track detected domain when blueprint activates
    detectedDomains.add(blueprint.domainType);

    const blueprintConfidence =
      assignments.reduce((sum, a) => sum + a.similarity, 0) / assignments.length;

    const assignmentsByRole = new Map(
      assignments.map((assignment) => [assignment.roleId, assignment]),
    );

    for (const assignment of assignments) {
      coveredStepKeys.add(`${assignment.flowId}|${assignment.stepIndex}`);
    }

    for (const scenario of blueprint.expectedScenarios) {
      if (!assignmentsByRole.has(scenario.anchorRole)) continue;

      const covered = await isScenarioCovered(scenario, coverageItems);
      if (covered) continue;

      const anchor = assignmentsByRole.get(scenario.anchorRole);
      if (!anchor) continue;

      const suggestedQuestion = interpolateTemplate(
        scenario.questionTemplate,
        assignmentsByRole,
      );

      gaps.push({
        type: `blueprint_${blueprint.id}_${scenario.id}`,
        severity: scenario.severity,
        description: scenario.description,
        relatedStep: anchor.stepIndex,
        relatedFlow: anchor.flowId,
        suggestedQuestion,
        blueprintConfidence,
      });
    }
  }

  return { gaps, coveredStepKeys, detectedDomains };
}
