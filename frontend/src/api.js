import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export const api = axios.create({
  baseURL: API_URL
});

let getRefreshToken = () => null;
let onTokenRefresh = () => {};
let onRefreshFail = () => {};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error?.response?.status;
    const isAuthEndpoint =
      originalRequest?.url?.includes("/auth/login") ||
      originalRequest?.url?.includes("/auth/login/verify-2fa") ||
      originalRequest?.url?.includes("/auth/refresh");

    if (status === 401 && !isAuthEndpoint && !originalRequest?._retry) {
      originalRequest._retry = true;
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        onRefreshFail();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken
        });
        onTokenRefresh(data);
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        onRefreshFail();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export function configureAuthRefresh({ getRefreshTokenFn, onTokenRefreshFn, onRefreshFailFn }) {
  getRefreshToken = getRefreshTokenFn;
  onTokenRefresh = onTokenRefreshFn;
  onRefreshFail = onRefreshFailFn;
}

export async function login(username, password) {
  const body = new URLSearchParams();
  body.set("username", username);
  body.set("password", password);
  const { data } = await api.post("/auth/login", body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  return data;
}

export async function verifyLogin2FA(loginChallengeToken, verificationCode) {
  const { data } = await api.post("/auth/login/verify-2fa", {
    login_challenge_token: loginChallengeToken,
    verification_code: verificationCode
  });
  return data;
}
