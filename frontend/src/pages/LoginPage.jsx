import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import EmailCodeModal from "../components/EmailCodeModal";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { token, me, loading, authError, setAuthError, login, completeLogin2fa } = useAuth();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ username: "", password: "" });
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeModalError, setCodeModalError] = useState("");
  const [loginChallengeToken, setLoginChallengeToken] = useState("");
  const [emailHint, setEmailHint] = useState("");

  async function handleLogin(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const nextErrors = {
      username: username ? "" : "Поле обязательно",
      password: password ? "" : "Поле обязательно"
    };
    setFieldErrors(nextErrors);
    if (nextErrors.username || nextErrors.password) return;

    setAuthError("");
    setCodeModalError("");
    setPending(true);
    const result = await login(username, password);
    setPending(false);
    if (result?.requires2fa) {
      setLoginChallengeToken(result.loginChallengeToken || "");
      setEmailHint(result.emailHint || "");
      setCodeModalOpen(true);
      return;
    }
    if (result?.success) {
      formEl.reset();
      setFieldErrors({ username: "", password: "" });
    }
  }

  async function handleVerify2FA(code) {
    setCodeModalError("");
    setAuthError("");
    setPending(true);
    const result = await completeLogin2fa(loginChallengeToken, code);
    setPending(false);
    if (result?.success) {
      setCodeModalOpen(false);
      setLoginChallengeToken("");
      setEmailHint("");
      setCodeModalError("");
      return;
    }
    setCodeModalError(result?.error || "Неверный код подтверждения");
  }

  function closeCodeModal() {
    if (pending) return;
    setCodeModalOpen(false);
    setLoginChallengeToken("");
    setEmailHint("");
    setCodeModalError("");
    setAuthError("");
  }

  if (!loading && token && me) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-screen">
      <form className="login-glass" onSubmit={handleLogin} noValidate>
        <h1>Event Security</h1>
        <p className="login-subtitle">Контроль продажи и прохода по одноразовому QR-коду</p>

        <label className="login-field">
          <span>Логин</span>
          <input
            name="username"
            placeholder="Введите логин"
            className={fieldErrors.username ? "input-error" : ""}
            onChange={() => {
              if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: "" }));
            }}
            required
          />
          <span className={`field-error ${fieldErrors.username ? "" : "field-error-placeholder"}`}>
            {fieldErrors.username || "."}
          </span>
        </label>

        <label className="login-field">
          <span>Пароль</span>
          <div className="login-password-wrap">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Введите пароль"
              className={fieldErrors.password ? "input-error" : ""}
              onChange={() => {
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: "" }));
              }}
              required
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              title={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 3l18 18M10.58 10.59A2 2 0 0013.41 13.4M9.88 5.09A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 8-1.1 3.09-3.33 5.49-6.12 6.91M6.61 6.63C4.36 8.09 2.64 9.94 1 12c.68 1.92 1.79 3.58 3.2 4.91"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M1 12C2.73 7.11 7 4 12 4s9.27 3.11 11 8c-1.73 4.89-6 8-11 8S2.73 16.89 1 12z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
                </svg>
              )}
            </button>
          </div>
          <span className={`field-error ${fieldErrors.password ? "" : "field-error-placeholder"}`}>
            {fieldErrors.password || "."}
          </span>
        </label>

        <button className="login-submit" type="submit" disabled={pending}>
          {pending ? "Проверяем..." : "Войти"}
        </button>

        {authError && !codeModalOpen && <p className="login-error">{authError}</p>}

        <p className="login-register-text">
          Нет аккаунта кассира? <Link to="/register-cashier">Зарегистрироваться</Link>
        </p>
        <p className="login-register-text">
          Нет аккаунта менеджера? <Link to="/register-manager">Зарегистрироваться</Link>
        </p>
      </form>

      <EmailCodeModal
        open={codeModalOpen}
        title="Подтверждение входа"
        description="Введите 6-значный код из письма, отправленного на"
        emailHint={emailHint}
        error={codeModalError}
        pending={pending}
        onClose={closeCodeModal}
        onVerify={handleVerify2FA}
        onClear={() => setCodeModalError("")}
      />
    </main>
  );
}
