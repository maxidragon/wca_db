export const TOKEN_NAME = "wca_db_token";
export const USER_INFO_NAME = "wca_db_user";
/** Dispatched on window when the backend rejects the stored token. */
export const SESSION_EXPIRED_EVENT = "wca-db:session-expired";

const BACKEND_ORIGIN = import.meta.env.PROD
  ? "/server"
  : (import.meta.env.VITE_BACKEND_ORIGIN ?? "http://localhost:3001");

export const backendRequest = async (
  path: string,
  method: "GET" | "POST" = "GET",
  auth = true,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = auth ? localStorage.getItem(TOKEN_NAME) : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BACKEND_ORIGIN}/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  // A token expires after a week, and one signed by another backend is never valid here. Either
  // way every later request would fail too, so the session ends here instead of leaving each
  // page to show its own error, or nothing at all, while the navbar still says logged in.
  if (token && response.status === 401) {
    localStorage.removeItem(TOKEN_NAME);
    localStorage.removeItem(USER_INFO_NAME);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return response;
};
