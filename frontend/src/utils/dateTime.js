export function formatTimeTyping(rawValue) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function formatDateTyping(rawValue) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

export function normalizeDateOnBlur(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  const dotted = trimmed.replace(/[/-]/g, ".");
  const directMatch = dotted.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (directMatch) {
    return `${directMatch[1].padStart(2, "0")}.${directMatch[2].padStart(2, "0")}.${directMatch[3]}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  return trimmed;
}

export function normalizeTimeOnBlur(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  const directMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (directMatch) return `${directMatch[1].padStart(2, "0")}:${directMatch[2].padStart(2, "0")}`;
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 3 || digitsOnly.length === 4) {
    const hoursRaw = digitsOnly.length === 3 ? digitsOnly.slice(0, 1) : digitsOnly.slice(0, 2);
    return `${hoursRaw.padStart(2, "0")}:${digitsOnly.slice(-2).padStart(2, "0")}`;
  }
  return trimmed;
}

export function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function isValidDateValue(value) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function validateDateTimeFields(dateValue, timeValue) {
  const errors = {};
  if (!isValidDateValue(dateValue)) errors.starts_date = "Некорректная дата. Формат: ДД.ММ.ГГГГ";
  if (!isValidTimeValue(timeValue)) errors.starts_time = "Некорректное время. Формат: ЧЧ:ММ";
  return errors;
}

export function buildIsoDateTime(dateValue, timeValue) {
  if (!isValidDateValue(dateValue) || !isValidTimeValue(timeValue)) return null;
  const [day, month, year] = dateValue.split(".");
  return new Date(`${year}-${month}-${day}T${timeValue}:00`).toISOString();
}

export function ddMmYyyyToIso(value) {
  if (!isValidDateValue(value)) return "";
  const [day, month, year] = value.split(".");
  return `${year}-${month}-${day}`;
}

export function isoToDdMmYyyy(isoValue) {
  if (!isoValue) return "";
  const [year, month, day] = isoValue.split("-");
  if (!year || !month || !day) return "";
  return `${day.padStart(2, "0")}.${month.padStart(2, "0")}.${year}`;
}

export function toDateInputValue(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export function toTimeInputValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
