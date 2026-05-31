const USERNAME_LETTERS_RE = /^[A-Za-zА-Яа-яЁё]+$/;

export function sanitizeUsername(value) {
  return value.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
}

export function getUsernameValidationError(username) {
  if (!username) return "Поле обязательно";
  if (username.length < 3) return "Логин должен быть не короче 3 символов";
  if (!USERNAME_LETTERS_RE.test(username)) {
    return "Логин может содержать только русские и английские буквы";
  }
  return "";
}
