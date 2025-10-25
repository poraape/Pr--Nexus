const resolveBackendBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    let effectivePort = port;

    if (port === "5173") {
      effectivePort = "8000";
    }

    const portSegment = effectivePort ? `:${effectivePort}` : "";
    return `${protocol}//${hostname}${portSegment}`.replace(/\/$/, "");
  }

  return "";
};

const API_BASE_URL = resolveBackendBaseUrl();

export const buildApiUrl = (path: string) => {
  if (!path.startsWith("/")) {
    throw new Error(`API paths must start with '/'. Received: ${path}`);
  }
  return `${API_BASE_URL}${path}`;
};

export async function extractErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = await response.json();
    if (payload?.detail) {
      if (typeof payload.detail === "string") {
        return payload.detail;
      }
      if (Array.isArray(payload.detail) && payload.detail[0]?.msg) {
        return payload.detail[0].msg as string;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(buildApiUrl(path), init);
  if (!response.ok) {
    const detail = await extractErrorDetail(response);
    throw new Error(detail || `Falha na requisição (${response.status}).`);
  }
  return response;
}
