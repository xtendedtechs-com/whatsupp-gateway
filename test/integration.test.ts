/**
 * Integration smoke test — env-gated, opt-in.
 *
 * Set ALL of the following to run:
 *   META_WHATSAPP_TOKEN_TEST        System User token
 *   META_WHATSAPP_PHONE_ID_TEST     numeric Phone Number ID
 *   META_WHATSAPP_TEST_RECIPIENT    +E.164 destination (your own test phone)
 *   META_WHATSAPP_TEST_TEMPLATE     name of an approved template
 *
 * Optional:
 *   META_WHATSAPP_TEST_LANG         language code, default "en_US"
 *   META_WHATSAPP_APP_SECRET_TEST   only required if you exercise webhook code
 *
 * This sends a real WhatsApp message to the configured recipient. Don't set
 * these in CI unless you know exactly what's getting sent.
 */
import { describe, it, expect } from "vitest";
import { createWhatsAppClient } from "../src/index.js";

const SHOULD_RUN =
  !!process.env["META_WHATSAPP_TOKEN_TEST"] &&
  !!process.env["META_WHATSAPP_PHONE_ID_TEST"] &&
  !!process.env["META_WHATSAPP_TEST_RECIPIENT"] &&
  !!process.env["META_WHATSAPP_TEST_TEMPLATE"];

describe.skipIf(!SHOULD_RUN)("integration: live Meta send", () => {
  it("sends a real template message", async () => {
    const wa = createWhatsAppClient({
      accessToken: process.env["META_WHATSAPP_TOKEN_TEST"]!,
      phoneNumberId: process.env["META_WHATSAPP_PHONE_ID_TEST"]!,
      appSecret: process.env["META_WHATSAPP_APP_SECRET_TEST"] ?? "unused",
    });
    const res = await wa.sendTemplate({
      to: process.env["META_WHATSAPP_TEST_RECIPIENT"]!,
      templateName: process.env["META_WHATSAPP_TEST_TEMPLATE"]!,
      languageCode: process.env["META_WHATSAPP_TEST_LANG"] ?? "en_US",
    });
    expect(res.messageId).toMatch(/^wamid\./);
  }, 30_000);
});
