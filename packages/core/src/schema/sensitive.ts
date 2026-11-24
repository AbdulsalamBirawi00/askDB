/** Words that mark a column as sensitive anywhere in its name (password_hash, homePhone, user_email). */
const SENSITIVE_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "private_key",
  "email",
  "e_mail",
  "phone",
];
/** Short words only matched as a whole part of the name (`pwd`, `ssn`), to avoid false hits. */
const SENSITIVE_WORDS = new Set(["pwd", "ssn", "salt", "otp", "iban"]);

/** Columns hidden by default: they are never sampled or sent to the model until unhidden. */
export function isSensitiveColumnName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_PARTS.some((part) => lower.includes(part))) return true;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return words.some((word) => SENSITIVE_WORDS.has(word));
}
