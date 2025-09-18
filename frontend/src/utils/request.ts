export const TOKEN_NAME = "wca_db_token";
export const USER_INFO_NAME = "wca_db_user";

const BACKEND_ORIGIN = import.meta.env.PROD
  ? "/server"
  : "http://localhost:3001";

export const backendRequest = async (
  path: string,
  method: "GET" | "POST" = "GET",
  auth = true,
  body?: any
): Promise<Response> => {
  const headers: any = { "Content-Type": "application/json" };
  if (auth) {
    const token = localStorage.getItem(TOKEN_NAME);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${BACKEND_ORIGIN}/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
};
