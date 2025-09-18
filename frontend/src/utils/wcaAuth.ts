import { backendRequest, TOKEN_NAME, USER_INFO_NAME } from "./request";

interface WcaLoginResponse {
  status: number;
  data: {
    token: string;
    userInfo: any;
    message?: string;
  };
}

export const loginWithWca = async (
  code: string,
  redirectUri: string
): Promise<WcaLoginResponse> => {
  const response = await backendRequest("auth/wca/login", "POST", false, {
    code,
    redirectUri,
  });
  const data = await response.json();
  if (response.status === 200) {
    localStorage.setItem(TOKEN_NAME, data.token);
    localStorage.setItem(USER_INFO_NAME, JSON.stringify(data.userInfo));
  }
  return {
    status: response.status,
    data,
  };
};

export const logout = () => {
  localStorage.removeItem(TOKEN_NAME);
  localStorage.removeItem(USER_INFO_NAME);
};

export const getToken = () => localStorage.getItem(TOKEN_NAME);

export const getUserInfo = () => {
  const data = localStorage.getItem(USER_INFO_NAME);
  return data ? JSON.parse(data) : null;
};
