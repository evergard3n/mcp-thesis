export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface UseCaseItem {
  id?: string;
  name?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface InitProjectRequest {
  name: string;
  description: string;
}

export interface InitProjectResponse {
  projectId: string;
}

export interface LoadProjectByNameRequest {
  name: string;
}

export interface LoadProjectByNameResponse {
  found: boolean;
  summary: ProjectSummary | null;
}

export interface ListProjectsResponse {
  projects: ProjectSummary[];
}

export interface CurrentProjectResponse {
  project: ProjectSummary | null;
}

export interface CurrentProjectUseCasesResponse {
  useCases: UseCaseItem[];
}

export interface SwitchProjectRequest {
  projectId: string;
}

export interface SwitchProjectResponse {
  found: boolean;
  summary: ProjectSummary | null;
}

export interface DeleteProjectRequest {
  projectId: string;
}

export interface DeleteProjectResponse {
  deleted: boolean;
}
