import { useMutation, useQuery } from "@tanstack/react-query";

import queryKeys from "~/consts/queryKeys";
import type {
  DeleteProjectRequest,
  InitProjectRequest,
  LoadProjectByNameRequest,
  SwitchProjectRequest,
} from "~/interfaces/projects.interface";
import projectService from "~/services/project.service";

export const useGetProjects = (sessionId?: string) =>
  useQuery({
    queryKey: [queryKeys.projectsList, sessionId],
    queryFn: async ({ signal }) => {
      const response = await projectService.getProjects(String(sessionId), {
        signal,
      });
      return response.data.projects;
    },
    enabled: Boolean(sessionId),
    refetchOnMount: true,
  });

export const useGetCurrentProject = (sessionId?: string) =>
  useQuery({
    queryKey: [queryKeys.currentProject, sessionId],
    queryFn: async ({ signal }) => {
      const response = await projectService.getCurrentProject(String(sessionId), {
        signal,
      });
      return response.data.project;
    },
    enabled: Boolean(sessionId),
    refetchOnMount: true,
  });

export const useGetCurrentProjectUseCases = (sessionId?: string) =>
  useQuery({
    queryKey: [queryKeys.currentProjectUseCases, sessionId],
    queryFn: async ({ signal }) => {
      const response = await projectService.getCurrentProjectUseCases(
        String(sessionId),
        { signal },
      );
      return response.data.useCases;
    },
    enabled: Boolean(sessionId),
    refetchOnMount: true,
  });

export const useInitProject = () =>
  useMutation({
    mutationFn: async ({ sessionId, body }: { sessionId: string; body: InitProjectRequest }) => {
      const response = await projectService.initProject(sessionId, body);
      return response.data;
    },
  });

export const useLoadProjectByName = () =>
  useMutation({
    mutationFn: async ({
      sessionId,
      body,
    }: {
      sessionId: string;
      body: LoadProjectByNameRequest;
    }) => {
      const response = await projectService.loadProjectByName(sessionId, body);
      return response.data;
    },
  });

export const useSwitchProject = () =>
  useMutation({
    mutationFn: async ({
      sessionId,
      body,
    }: {
      sessionId: string;
      body: SwitchProjectRequest;
    }) => {
      const response = await projectService.switchProject(sessionId, body);
      return response.data;
    },
  });

export const useDeleteProject = () =>
  useMutation({
    mutationFn: async ({
      sessionId,
      body,
    }: {
      sessionId: string;
      body: DeleteProjectRequest;
    }) => {
      const response = await projectService.deleteProject(sessionId, body);
      return response.data;
    },
  });
