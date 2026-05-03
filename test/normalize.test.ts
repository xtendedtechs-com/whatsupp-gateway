import { describe, it, expect } from "vitest";
import { defaultNormalizeRecipient } from "../src/normalize.js";
import { WhatsAppValidationError } from "../src/errors.js";

describe("defaultNormalizeRecipient", () => {
  it("strips a leading + and returns digits", () => {
    expect(defaultNormalizeRecipient("+972501234567")).toBe("972501234567");
  });

  it("accepts already-canonical digit-only form", () => {
    expect(defaultNormalizeRecipient("972501234567")).toBe("972501234567");
  });

  it("trims surrounding whitespace", () => {
    expect(defaultNormalizeRecipient("  +14155551234  ")).toBe("14155551234");
  });

  it("accepts the shortest legal E.164 (7 digits)", () => {
    expect(defaultNormalizeRecipient("+1234567")).toBe("1234567");
  });

  it("accepts the longest legal E.164 (15 digits)", () => {
    expect(defaultNormalizeRecipient("+123456789012345")).toBe(
      "123456789012345",
    );
  });

  it.each([
    ["local form, no country code", "0501234567"],
    ["leading 0 after +", "+0501234567"],
    ["spaces", "+972 50 123 4567"],
    ["dashes", "+972-50-123-4567"],
    ["letters", "abc"],
    ["empty", ""],
    ["just a plus", "+"],
    ["too short", "+12345"],
    ["too long (16)", "+1234567890123456"],
  ])("rejects %s (%s)", (_label, raw) => {
    expect(() => defaultNormalizeRecipient(raw)).toThrow(
      WhatsAppValidationError,
    );
  });
});
