import { useRef } from "react";
import {
  ddMmYyyyToIso,
  formatDateTyping,
  isoToDdMmYyyy,
  isValidDateValue,
  normalizeDateOnBlur
} from "../utils/dateTime";

export default function DateInputField({
  label,
  value,
  onChange,
  onBlurValidate,
  error = "",
  placeholder = "Например, 10.05.2026",
  required = false
}) {
  const pickerRef = useRef(null);
  const isoValue = ddMmYyyyToIso(value);

  function handleTextChange(event) {
    onChange(formatDateTyping(event.target.value));
  }

  function handleTextBlur(event) {
    const normalized = normalizeDateOnBlur(event.target.value);
    onChange(normalized);
    if (onBlurValidate) {
      onBlurValidate(normalized);
    } else if (normalized && !isValidDateValue(normalized)) {
    }
  }

  function handlePickerChange(event) {
    const picked = event.target.value;
    if (picked) {
      onChange(isoToDdMmYyyy(picked));
    }
  }

  function openCalendar() {
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      picker.showPicker();
    } catch {
      picker.focus();
      picker.click();
    }
  }

  return (
    <label>
      {label}
      <div className="date-input-wrap">
        <input
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={value}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          maxLength={10}
          className={error ? "input-error" : ""}
          required={required}
        />
        <button
          type="button"
          className="date-picker-btn"
          onClick={openCalendar}
          title="Открыть календарь"
          aria-label="Открыть календарь"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
            <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        <input
          ref={pickerRef}
          type="date"
          className="date-picker-native"
          value={isoValue}
          onChange={handlePickerChange}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
      <span className={`field-error ${error ? "" : "field-error-placeholder"}`}>{error || " "}</span>
    </label>
  );
}
