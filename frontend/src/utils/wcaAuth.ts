const TOKEN_NAME = "wca_token"
const USER_INFO_NAME = "wca_user"

interface WcaLoginResponse {
  status: number
  data: {
    token: string
    userInfo: any
    message?: string
  }
}

export const backendRequest = async (
  path: string,
  method: "GET" | "POST" = "GET",
  auth = true,
  body?: any
): Promise<Response> => {
  const headers: any = { "Content-Type": "application/json" }
  if (auth) {
    const token = localStorage.getItem(TOKEN_NAME)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  return fetch(`http://localhost:3001/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

export const loginWithWca = async (code: string, redirectUri: string): Promise<WcaLoginResponse> => {
  const response = await backendRequest("auth/wca/login", "POST", false, {
    code,
    redirectUri,
  })
  const data = await response.json()
  if (response.status === 200) {
    localStorage.setItem(TOKEN_NAME, data.token)
    localStorage.setItem(USER_INFO_NAME, JSON.stringify(data.userInfo))
  }
  return {
    status: response.status,
    data,
  }
}

export const logout = () => {
  localStorage.removeItem(TOKEN_NAME)
  localStorage.removeItem(USER_INFO_NAME)
}

export const getToken = () => localStorage.getItem(TOKEN_NAME)
export const getUserInfo = () => {
  const data = localStorage.getItem(USER_INFO_NAME)
  return data ? JSON.parse(data) : null
}
