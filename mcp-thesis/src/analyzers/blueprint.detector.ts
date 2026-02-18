import { readFile } from "fs/promises";
import { join } from "path";
import { GenUseCase, GenFlow, GenStep } from "../interfaces/usecase.interface.new.js";
import semanticService from "../services/semantic.service.js";
import { Gap } from "./gap.analyzer.js";

export interface BlueprintGapResult {
  gaps: Gap[];
  coveredStepKeys: Set<string>;
}

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
  activation: BlueprintActivationRules;
  roles: BlueprintRoleDefinition[];
  expectedScenarios: BlueprintScenarioDefinition[];
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

interface EmbeddedStep {
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
          const roleEmbeddings = await semanticService.embedBatch(role.keywords);
          role.centroid = await semanticService.computeCentroid(roleEmbeddings);
          computedRoles++;
        }
      }

      for (const scenario of blueprint.expectedScenarios) {
        if (!scenario.centroid) {
          const scenarioEmbeddings = await semanticService.embedBatch(
            scenario.checkPhrases,
          );
          scenario.centroid = await semanticService.computeCentroid(
            scenarioEmbeddings,
          );
          computedScenarios++;
        }
      }
    }

    blueprintCache = data.blueprints;
    console.log(
      `Blueprints loaded: ${blueprintCache.length} (roles computed: ${computedRoles}, scenarios computed: ${computedScenarios})`,
    );

    return blueprintCache;
  } catch (error) {
    console.error("Failed to load blueprints:", error);
    return [];
  }
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

  return candidates.sort((a, b) => b.similarity - a.similarity);
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

export async function detectBlueprintGaps(
  useCase: GenUseCase,
  embeddedSteps: EmbeddedStep[],
): Promise<BlueprintGapResult> {
  const blueprints = await loadBlueprints();
  const gaps: Gap[] = [];
  const coveredStepKeys = new Set<string>();

  if (blueprints.length === 0) return { gaps, coveredStepKeys };

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
      });
    }
  }

  return { gaps, coveredStepKeys };
}
