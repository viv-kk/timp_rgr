import { useCallback, useEffect, useRef, useState } from "react";

const CODE_LENGTH = 6;

function emptyDigits() {
  return Array(CODE_LENGTH).fill("");
}

export default function EmailCodeModal({
  open,
  title,
  description,
  emailHint = "",
  error = "",
  pending = false,
  onClose,
  onVerify,
  onClear
}) {
  const [digits, setDigits] = useState(emptyDigits);
  const inputRefs = useRef([]);

  const resetDigits = useCallback(() => {
    setDigits(emptyDigits());
    onClear?.();
  }, [onClear]);

  useEffect(() => {
    if (!open) {
      setDigits(emptyDigits());
      return;
    }
    const timer = window.setTimeout(() => {
      inputRefs.current[0]?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key === "Escape" && !pending) onClose?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onClose]);

  function updateDigit(index, value) {
    const char = value.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = char;
      return next;
    });
    if (char && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleChange(index, event) {
    const raw = event.target.value;
    if (raw.length > 1) {
      const pasted = raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
      if (!pasted) return;
      const next = emptyDigits();
      for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
      setDigits(next);
      const focusIndex = Math.min(pasted.length, CODE_LENGTH - 1);
      inputRefs.current[focusIndex]?.focus();
      return;
    }
    updateDigit(index, raw);
  }

  function handleKeyDown(index, event) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = emptyDigits();
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
    setDigits(next);
    const focusIndex = Math.min(pasted.length, CODE_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  }

  async function handleVerify(event) {
    event.preventDefault();
    const code = digits.join("");
    if (code.length !== CODE_LENGTH) return;
    await onVerify?.(code);
  }

  function handleClear() {
    resetDigits();
    inputRefs.current[0]?.focus();
  }

  if (!open) return null;

  const code = digits.join("");
  const isComplete = code.length === CODE_LENGTH;

  return (
    <div className="code-modal-overlay" role="presentation" onClick={pending ? undefined : onClose}>
      <div
        className="code-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="code-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="code-modal-close"
          onClick={onClose}
          disabled={pending}
          aria-label="Закрыть"
        >
          ×
        </button>

        <h2 id="code-modal-title" className="code-modal-title">
          {title}
        </h2>
        <p className="code-modal-description">
          {description}
          {emailHint ? (
            <>
              {" "}
              <span className="code-modal-email">{emailHint}</span>
            </>
          ) : null}
        </p>

        <form className="code-modal-form" onSubmit={handleVerify} noValidate>
          <div className="code-modal-digits" onPaste={handlePaste}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={6}
                className={`code-modal-digit${digit ? " filled" : ""}${error ? " error" : ""}`}
                value={digit}
                disabled={pending}
                aria-label={`Цифра ${index + 1}`}
                onChange={(event) => handleChange(index, event)}
                onKeyDown={(event) => handleKeyDown(index, event)}
              />
            ))}
          </div>

          {error ? <p className="code-modal-error">{error}</p> : null}

          <div className="code-modal-actions">
            <button type="submit" className="code-modal-btn primary" disabled={pending || !isComplete}>
              {pending ? "Проверяем..." : "Подтвердить"}
            </button>
            <button
              type="button"
              className="code-modal-btn secondary"
              onClick={handleClear}
              disabled={pending}
            >
              Очистить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
