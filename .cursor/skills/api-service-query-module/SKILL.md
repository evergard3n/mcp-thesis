---
name: api-service-query-module
description: "Use when creating or refactoring an API service class and its React Query module for this codebase, including request/response types, query hooks, and mutation hooks."
argument-hint: "describe the endpoint, request shape, and required query/mutation hooks"
user-invocable: true
disable-model-invocation: false
---

# API Service and Query Module Skill

Use this skill when adding a new backend endpoint to the app and you need the matching service layer plus the React Query module that consumes it.

## When to Use
- Create a new service file in `src/services/`
- Create a new React Query module in `src/modules/`
- Add query hooks for list/detail endpoints
- Add mutation hooks for create/update/delete workflows
- Standardize request payload mapping between form values and backend DTOs
- Keep request and response types aligned with the endpoint contract

## Inputs to Collect
Before writing code, identify:
- The backend resource name and route constant
- The list, detail, create, update, and delete endpoints
- The request filters or query params
- The backend response shape
- Any form-to-payload conversion rules
- Any query keys that should be added to `src/consts/queriesKeys.ts`

## Procedure
1. Inspect the feature files and identify the owning domain name used in the codebase.
2. Create or update a service class in `src/services/<feature>Service.ts`.
3. Define request interfaces near the service when the shape is feature-specific.
4. Use `httpService` for all HTTP calls and keep methods focused on one endpoint each.
5. Add `AxiosRequestConfig` support for methods that need cancellation or extra config.
6. Return typed `PromiseResponseBase<...>` values that match the backend response.
7. Create or update the query module in `src/modules/<feature>.ts`.
8. Use `useQuery` for reads and `useMutation` for writes.
9. Use stable `queryKey` entries from `queriesKeys` and include filter arguments when the query depends on them.
10. Pass `signal` from React Query into service calls for cancellable requests.
11. Map API data into form models only in the module or model layer, not inside the service.
12. Keep service methods transport-focused and keep module hooks orchestration-focused.

## Service Pattern
Follow this shape for a typical service file:

```ts
import { AxiosRequestConfig } from "axios";
import httpService from "./httpService";
import { CommonFilters, PromiseResponseBase, ResponseCommon, ResponseList } from "@/interfaces/common";
import { FEATURE_URL } from "@/consts/apiUrl";
import { FeatureModel } from "@/interfaces/feature";

export interface RequestGetFeatures extends CommonFilters {
  keyword?: string;
}

export interface RequestAddNewFeature {
  // request fields
}

class FeatureService {
  getFeatures(filters: RequestGetFeatures, configs?: AxiosRequestConfig) {
    return httpService.get(`${FEATURE_URL}`, {
      params: filters,
      ...configs,
    });
  }

  getFeatureById(id: string, configs?: AxiosRequestConfig) {
    return httpService.get(`${FEATURE_URL}/${id}`, configs);
  }

  createFeature(body: RequestAddNewFeature) {
    return httpService.post(`${FEATURE_URL}`, body);
  }

  updateFeature(id: string, body: Partial<RequestAddNewFeature>) {
    return httpService.patch(`${FEATURE_URL}/${id}`, body);
  }

  deleteFeature(id: string) {
    return httpService.delete(`${FEATURE_URL}/${id}`);
  }
}

export default new FeatureService();
```

## Query Module Pattern
Follow this shape for a typical module file:

```ts
import queriesKeys from "@/consts/queriesKeys";
import featureService, { RequestAddNewFeature, RequestGetFeatures } from "@/services/featureService";
import { useMutation, useQuery } from "@tanstack/react-query";

export const useGetFeatures = ({ key, filters }: { key?: string; filters: RequestGetFeatures }) =>
  useQuery({
    queryKey: [queriesKeys.getFeatures, key, filters],
    queryFn: async ({ signal }) => {
      const response = await featureService.getFeatures(filters, { signal });
      return response.data.data;
    },
    refetchOnMount: true,
  });

export const useGetFeatureById = (id?: string) =>
  useQuery({
    queryKey: [queriesKeys.getFeatureById, id],
    queryFn: async ({ signal }) => {
      const response = await featureService.getFeatureById(String(id), { signal });
      return response.data.data;
    },
    enabled: !!id,
    refetchOnMount: true,
  });

export const useAddFeature = () =>
  useMutation({ mutationFn: featureService.createFeature });

export const useUpdateFeature = () =>
  useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<RequestAddNewFeature> }) =>
      featureService.updateFeature(id, body),
  });

export const useDeleteFeature = () =>
  useMutation({ mutationFn: (id: string) => featureService.deleteFeature(id) });
```

## Quality Checks
- Service methods are small and named after business actions.
- Query hooks return the unwrapped `response.data.data` payload.
- `signal` is forwarded for read requests.
- Query keys include every value that changes the result set.
- The service file does not contain React Query logic.
- The module file does not contain raw URL strings.
- Request and form models stay separate when the endpoint needs payload conversion.

## Common Follow-Ups
- Add matching interface types in `src/interfaces/`
- Add query key constants in `src/consts/queriesKeys.ts`
- Add form model helpers when the payload requires transformation
- Add example usage in the page or feature component if the workflow is new
