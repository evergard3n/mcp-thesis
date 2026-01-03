import { Actor, UseCase } from "./usecase.interface.js";

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  useCases: UseCase[];
  actors: Actor[];
}

export interface Store {
  id: string; // sessionId
  createdAt: string;
  updatedAt: string;
  projects: { [projectId: string]: Project }; // Map of projects by their ID
  currentProjectId: string | null; // Currently active project
}
