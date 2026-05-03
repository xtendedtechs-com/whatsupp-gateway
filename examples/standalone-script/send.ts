/**
 * One-off send. Run with:
 *   META_WHATSAPP_TOKEN=...
 *   META_WHATSAPP_PHONE_ID=...
 *   META_WHATSAPP_APP_SECRET=...
 *   npm run send -- +972501234567 appointment_reminder he
 */
import {
  createWhatsAppClient,
  WhatsAppApiError,
} from "@xtendedtechs/whatsapp-gateway";

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

const [, , to, templateName, languageCode = "en_US"] = process.argv;
if (!to || !templateName) {
  console.error("Usage: send.ts <+E164> <templateName> [languageCode]");
  process.exit(1);
}

const wa = createWhatsAppClient({
  accessToken: env("META_WHATSAPP_TOKEN"),
  phoneNumberId: env("META_WHATSAPP_PHONE_ID"),
  appSecret: env("META_WHATSAPP_APP_SECRET"),
});

try {
  const res = await wa.sendTemplate({ to, templateName, languageCode });
  console.log("Sent:", res);
} catch (err) {
  if (err instanceof WhatsAppApiError) {
    console.error(
      `Meta API error: code=${err.code} subcode=${err.subcode ?? "-"} retryable=${err.isRetryable}: ${err.message}`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
}
