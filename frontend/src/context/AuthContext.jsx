import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  api,
  configureAuthRefresh,
  login as loginRequest,
  setAuthToken,
  verifyLogin2FA as verifyLogin2FARequest
} from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem("refresh_token") || "");
  const [me, setMe] = useState(null);
  const [events, setEvents] = useState([]);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthToken(token);
    if (!token) {
      setMe(null);
      setEvents([]);
      setLoading(false);
      return;
    }
    bootstrap();
  }, [token]);

  useEffect(() => {
    configureAuthRefresh({
      getRefreshTokenFn: () => localStorage.getItem("refresh_token"),
      onTokenRefreshFn: (data) => {
        if (data?.access_token) {
          localStorage.setItem("token", data.access_token);
          setToken(data.access_token);
        }
        if (data?.refresh_token) {
          localStorage.setItem("refresh_token", data.refresh_token);
          setRefreshToken(data.refresh_token);
        }
      },
      onRefreshFailFn: () => {
        logout();
      }
    });
  }, []);

  async function bootstrap() {
    setLoading(true);
    try {
      await Promise.all([loadProfile(), loadEvents()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile() {
    try {
      const { data } = await api.get("/auth/me");
      setMe(data);
    } catch {
      logout();
    }
  }

  async function loadEvents() {
    try {
      const { data } = await api.get("/events");
      setEvents(data);
    } catch {
      setEvents([]);
    }
  }

  function storeTokenPair(tokenPair) {
    localStorage.setItem("token", tokenPair.access_token);
    localStorage.setItem("refresh_token", tokenPair.refresh_token);
    setToken(tokenPair.access_token);
    setRefreshToken(tokenPair.refresh_token);
  }

  async function login(username, password) {
    setAuthError("");
    try {
      const response = await loginRequest(username, password);
      if (response?.requires_2fa) {
        return {
          requires2fa: true,
          loginChallengeToken: response.login_challenge_token,
          emailHint: response.email_hint,
          message: response.message
        };
      }
      if (response?.access_token && response?.refresh_token) {
        storeTokenPair(response);
        return { requires2fa: false, success: true };
      }
      setAuthError("Неожиданный ответ сервера");
      return { requires2fa: false, success: false };
    } catch (error) {
      const message = error?.response?.data?.detail;
      setAuthError(message || "Неверный логин или пароль");
      return { requires2fa: false, success: false };
    }
  }

  async function completeLogin2fa(loginChallengeToken, verificationCode) {
    setAuthError("");
    try {
      const tokenPair = await verifyLogin2FARequest(loginChallengeToken, verificationCode);
      storeTokenPair(tokenPair);
      return { success: true };
    } catch (error) {
      const message = error?.response?.data?.detail || "Неверный код подтверждения";
      setAuthError(message);
      return { success: false, error: message };
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    setAuthToken("");
    setToken("");
    setRefreshToken("");
    setMe(null);
    setEvents([]);
  }

  const value = useMemo(
    () => ({
      token,
      refreshToken,
      me,
      events,
      authError,
      loading,
      setAuthError,
      login,
      completeLogin2fa,
      logout,
      loadEvents
    }),
    [token, refreshToken, me, events, authError, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
