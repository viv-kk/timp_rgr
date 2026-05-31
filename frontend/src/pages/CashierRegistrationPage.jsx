import { useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import EmailCodeModal from "../components/EmailCodeModal";
import { useAuth } from "../context/AuthContext";
import { getUsernameValidationError, sanitizeUsername } from "../utils/username";

const PASSWORD_RULE_HINT =
  "Минимум 10 символов, строчная и заглавная буквы, цифра и спецсимвол, без пробелов";

function getPasswordValidationError(password) {
  if (password.length < 10) return "Пароль должен быть не короче 10 символов";
  if (/\s/.test(password)) return "Пароль не должен содержать пробелы";
  if (!/[a-z]/.test(password)) return "Пароль должен содержать хотя бы одну строчную букву";
  if (!/[A-Z]/.test(password)) return "Пароль должен содержать хотя бы одну заглавную букву";
  if (!/\d/.test(password)) return "Пароль должен содержать хотя бы одну цифру";
  if (!/[^A-Za-z0-9]/.test(password)) return "Пароль должен содержать хотя бы один специальный символ";
  return "";
}

function getEmailValidationError(email) {
  const trimmed = email.trim();
  if (!trimmed) return "Поле обязательно";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Укажите корректный email";
  return "";
}

function maskEmail(email) {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 1) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const maskedLocal =
    local.length <= 2 ? `${local[0]}*` : `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

const STAFF_CONFIG = {
  cashier: {
    title: "Регистрация кассира",
    subtitle: "После подачи заявки дождитесь её одобрения администратором. Код подтверждения придёт на email.",
    sendCodePath: "/auth/cashier-register/send-code",
    registerPath: "/auth/cashier-register"
  },
  manager: {
    title: "Регистрация менеджера",
    subtitle: "После подачи заявки дождитесь её одобрения администратором. Код подтверждения придёт на email.",
    sendCodePath: "/auth/manager-register/send-code",
    registerPath: "/auth/manager-register"
  }
};

export default function CashierRegistrationPage({ staffRole = "cashier" }) {
  const config = STAFF_CONFIG[staffRole] || STAFF_CONFIG.cashier;
  const { token, me, loading } = useAuth();
  const formRef = useRef(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeModalError, setCodeModalError] = useState("");
  const [pendingRegistration, setPendingRegistration] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({
    email: "",
    username: "",
    full_name: "",
    password: "",
    confirm_password: ""
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setSuccessMessage("");
    setErrorMessage("");
    setCodeModalError("");

    const formData = new FormData(formEl);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim();
    const trimmedFullName = fullName.trim().replace(/\s+/g, " ");
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");

    const nextFieldErrors = {
      email: getEmailValidationError(trimmedEmail),
      username: getUsernameValidationError(trimmedUsername),
      full_name: trimmedFullName ? "" : "Поле обязательно",
      password: password ? "" : "Поле обязательно",
      confirm_password: confirmPassword ? "" : "Поле обязательно"
    };
    setFieldErrors(nextFieldErrors);
    if (Object.values(nextFieldErrors).some(Boolean)) return;

    const passwordError = getPasswordValidationError(password);
    if (passwordError) {
      setFieldErrors((prev) => ({ ...prev, password: passwordError }));
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Пароли не совпадают");
      return;
    }

    setPending(true);
    try {
      const { data } = await api.post(config.sendCodePath, {
        email: trimmedEmail
      });
      setPendingRegistration({
        email: trimmedEmail,
        username: trimmedUsername,
        full_name: trimmedFullName,
        password,
        message: data?.message || ""
      });
      setCodeModalOpen(true);
    } catch (error) {
      const detail = error?.response?.data?.detail || "Не удалось отправить код";
      if (detail.includes("email") || detail.includes("Email")) {
        setFieldErrors((prev) => ({ ...prev, email: detail }));
      } else {
        setErrorMessage(detail);
      }
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyRegistration(code) {
    if (!pendingRegistration) return;
    setCodeModalError("");
    setPending(true);
    try {
      const { data } = await api.post(config.registerPath, {
        email: pendingRegistration.email,
        username: pendingRegistration.username,
        full_name: pendingRegistration.full_name,
        password: pendingRegistration.password,
        verification_code: code
      });
      setSuccessMessage(data?.message || "Заявка отправлена и ожидает подтверждения администратора.");
      setCodeModalOpen(false);
      setPendingRegistration(null);
      setEmail("");
      setUsername("");
      setFullName("");
      formRef.current?.reset();
      setFieldErrors({
        email: "",
        username: "",
        full_name: "",
        password: "",
        confirm_password: ""
      });
    } catch (error) {
      const detail = error?.response?.data?.detail || "Не удалось отправить заявку";
      if (
        detail.includes("код") ||
        detail.includes("Код") ||
        detail.includes("истёк") ||
        detail.includes("истек")
      ) {
        setCodeModalError(detail);
      } else if (detail === "Пароль должен быть не короче 10 символов") {
        setCodeModalOpen(false);
        setFieldErrors((prev) => ({ ...prev, password: detail }));
      } else if (detail === "Логин может содержать только русские и английские буквы") {
        setCodeModalOpen(false);
        setFieldErrors((prev) => ({ ...prev, username: detail }));
      } else if (detail.includes("ФИО")) {
        setCodeModalOpen(false);
        setFieldErrors((prev) => ({ ...prev, full_name: detail }));
      } else if (detail.includes("email") || detail.includes("Email")) {
        setCodeModalOpen(false);
        setFieldErrors((prev) => ({ ...prev, email: detail }));
      } else {
        setCodeModalOpen(false);
        setErrorMessage(detail);
      }
    } finally {
      setPending(false);
    }
  }

  function closeCodeModal() {
    if (pending) return;
    setCodeModalOpen(false);
    setCodeModalError("");
    setPendingRegistration(null);
  }

  if (!loading && token && me) {
    return <Navigate to="/" replace />;
  }

  const emailHint = pendingRegistration?.email ? maskEmail(pendingRegistration.email) : maskEmail(email);

  return (
    <main className="login-screen">
      <form ref={formRef} className="login-glass" onSubmit={handleSubmit} noValidate>
        <h1>{config.title}</h1>
        <p className="login-subtitle">{config.subtitle}</p>

        <label className="login-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            value={email}
            autoComplete="email"
            placeholder="name@example.com"
            className={fieldErrors.email ? "input-error" : ""}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: "" }));
            }}
            required
          />
          <span className={`field-error ${fieldErrors.email ? "" : "field-error-placeholder"}`}>
            {fieldErrors.email || "."}
          </span>
        </label>

        <label className="login-field">
          <span>ФИО</span>
          <input
            name="full_name"
            value={fullName}
            autoComplete="name"
            placeholder="Иванов Иван Иванович"
            className={fieldErrors.full_name ? "input-error" : ""}
            onChange={(e) => {
              setFullName(e.target.value);
              if (fieldErrors.full_name) setFieldErrors((prev) => ({ ...prev, full_name: "" }));
            }}
            required
          />
          <span className={`field-error ${fieldErrors.full_name ? "" : "field-error-placeholder"}`}>
            {fieldErrors.full_name || "."}
          </span>
        </label>

        <label className="login-field">
          <span>Логин</span>
          <input
            name="username"
            value={username}
            autoComplete="username"
            placeholder="Только русские и английские буквы"
            className={fieldErrors.username ? "input-error" : ""}
            onChange={(e) => {
              setUsername(sanitizeUsername(e.target.value));
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
              minLength={10}
              placeholder={PASSWORD_RULE_HINT}
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

        <label className="login-field">
          <span>Подтверждение пароля</span>
          <div className="login-password-wrap">
            <input
              name="confirm_password"
              type={showConfirmPassword ? "text" : "password"}
              minLength={10}
              placeholder="Введите пароль повторно"
              className={fieldErrors.confirm_password ? "input-error" : ""}
              onChange={() => {
                if (fieldErrors.confirm_password) setFieldErrors((prev) => ({ ...prev, confirm_password: "" }));
              }}
              required
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
              title={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showConfirmPassword ? (
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
          <span className={`field-error ${fieldErrors.confirm_password ? "" : "field-error-placeholder"}`}>
            {fieldErrors.confirm_password || "."}
          </span>
        </label>

        <button className="login-submit" type="submit" disabled={pending}>
          {pending ? "Отправляем код..." : "Отправить заявку"}
        </button>

        {successMessage && <p className="login-success">{successMessage}</p>}
        {errorMessage && !codeModalOpen && <p className="login-error">{errorMessage}</p>}

        <p className="login-register-text">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </form>

      <EmailCodeModal
        open={codeModalOpen}
        title="Подтверждение email"
        description="Введите 6-значный код из письма, отправленного на"
        emailHint={emailHint}
        error={codeModalError}
        pending={pending}
        onClose={closeCodeModal}
        onVerify={handleVerifyRegistration}
        onClear={() => setCodeModalError("")}
      />
    </main>
  );
}
