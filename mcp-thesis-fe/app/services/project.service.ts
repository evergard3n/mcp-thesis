import type { AxiosRequestConfig } from "axios";

import { buildSessionProjectsUrl } from "~/consts/apiUrl";
import type {
  CurrentProjectResponse,
  CurrentProjectUseCasesResponse,
  DeleteProjectRequest,
  DeleteProjectResponse,
  InitProjectRequest,
  InitProjectResponse,
  ListProjectsResponse,
  LoadProjectByNameRequest,
  LoadProjectByNameResponse,
  SwitchProjectRequest,
  SwitchProjectResponse,
} from "~/interfaces/projects.interface";

import httpService from "./http.service";

class ProjectService {
  initProject(sessionId: string, body: InitProjectRequest) {
    return httpService.post<InitProjectResponse>(
      buildSessionProjectsUrl(sessionId, "init"),
      body,
    );
  }

  loadProjectByName(sessionId: string, body: LoadProjectByNameRequest) {
    return httpService.post<LoadProjectByNameResponse>(
      buildSessionProjectsUrl(sessionId, "load-by-name"),
      body,
    );
  }

  getProjects(sessionId: string, config?: AxiosRequestConfig) {
    return httpService.get<ListProjectsResponse>(
      buildSessionProjectsUrl(sessionId),
      config,
    );
  }

  getCurrentProject(sessionId: string, config?: AxiosRequestConfig) {
    return httpService.get<CurrentProjectResponse>(
      buildSessionProjectsUrl(sessionId, "current"),
      config,
    );
  }

  getCurrentProjectUseCases(sessionId: string, config?: AxiosRequestConfig) {
    return httpService.get<CurrentProjectUseCasesResponse>(
      buildSessionProjectsUrl(sessionId, "current/use-cases"),
      config,
    );
  }

  switchProject(sessionId: string, body: SwitchProjectRequest) {
    return httpService.post<SwitchProjectResponse>(
      buildSessionProjectsUrl(sessionId, "switch"),
      body,
    );
  }

  deleteProject(sessionId: string, body: DeleteProjectRequest) {
    return httpService.post<DeleteProjectResponse>(
      buildSessionProjectsUrl(sessionId, "delete"),
      body,
    );
  }
}

export default new ProjectService();
