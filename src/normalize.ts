import { WhatsAppValidationError } from "./errors.js";

/**
 * Default recipient normalizer.
 *
 * Accepts strict E.164 (`+972501234567`) or the digit-only canonical form
 * Meta expects (`972501234567`). Returns the canonical form (no leading `+`).
 *
 * Does NOT apply any country-specific local-number rules. Callers whose
 * inputs are local numbers should pass their own `normalizeRecipient`
 * to `createWhatsAppClient`.
 */
export function defaultNormalizeRecipient(raw: string): string {
  if (typeof raw !== "string") {
    throw new WhatsAppValidationError(
      `Recipient must be a string, got ${typeof raw}`,
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new WhatsAppValidationError("Recipient is empty");
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = hasPlus ? trimmed.slice(1) : trimmed;
  // E.164: country code starts 1-9, total digits 7-15.
  if (!/^[1-9]\d{6,14}$/.test(digits)) {
    throw new WhatsAppValidationError(
      `Recipient "${raw}" is not in E.164 form. ` +
        `Expected +<country><number> with 7-15 digits total, no spaces or punctuation.`,
    );
  }
  return digits;
}
