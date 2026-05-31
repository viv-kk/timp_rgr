export function sanitizeBuyerName(value) {
  return value.replace(/\d/g, "");
}

export function getBuyerNameValidationError(name) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/\d/.test(trimmed)) {
    return "ФИО не должно содержать цифры";
  }
  return "";
}
