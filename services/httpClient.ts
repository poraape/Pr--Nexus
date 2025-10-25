const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

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
