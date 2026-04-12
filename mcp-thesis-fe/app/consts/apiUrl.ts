const DEFAULT_API_BASE_URL = "http://localhost:3006";

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

export const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
);

export const SESSIONS_URL = "/sessions";

export const buildSessionUrl = (sessionId: string): string =>
  `${SESSIONS_URL}/${sessionId}`;

export const buildSessionStateUrl = (sessionId: string): string =>
  `${buildSessionUrl(sessionId)}/state`;

export const buildSessionHitlUrl = (sessionId: string, endpoint: string): string =>
  `${buildSessionUrl(sessionId)}/hitl/${endpoint}`;

export const buildSessionProjectsUrl = (
  sessionId: string,
  endpoint = "",
): string => {
  const base = `${buildSessionUrl(sessionId)}/projects`;
  return endpoint ? `${base}/${endpoint}` : base;
};

export const buildApiUrl = (path: string): string => `${API_BASE_URL}${path}`;
