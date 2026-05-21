import { JsonProjectStore } from "../stores/projectStore.js";

export async function initProject(
  projectStore: JsonProjectStore,
  name: string,
  description: string,
): Promise<{ projectId: string }> {
  const projectId = await projectStore.initProject(name, description);
  return { projectId };
}

export async function loadProjectByName(
  projectStore: JsonProjectStore,
  name: string,
): Promise<{ found: boolean; summary: Awaited<ReturnType<JsonProjectStore["getProjectSummary"]>> }> {
  const found = await projectStore.loadProjectByName(name);
  const summary = found ? await projectStore.getProjectSummary() : null;
  return { found, summary };
}

export async function listAllProjects(projectStore: JsonProjectStore) {
  return projectStore.listAllProjects();
}

export async function getProjectInfo(projectStore: JsonProjectStore) {
  return projectStore.getProjectSummary();
}

export function viewProjectUseCases(projectStore: JsonProjectStore) {
  return projectStore.getAllUseCases();
}

export async function switchToProject(
  projectStore: JsonProjectStore,
  projectId: string,
): Promise<{ found: boolean; summary: Awaited<ReturnType<JsonProjectStore["getProjectSummary"]>> }> {
  const found = await projectStore.switchToProject(projectId);
  const summary = found ? await projectStore.getProjectSummary() : null;
  return { found, summary };
}

export async function deleteProject(
  projectStore: JsonProjectStore,
  projectId: string,
): Promise<{ deleted: boolean }> {
  const deleted = await projectStore.deleteProject(projectId);
  return { deleted };
}
