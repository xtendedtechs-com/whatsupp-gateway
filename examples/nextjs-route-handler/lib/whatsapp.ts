import { createWhatsAppClient } from "@xtendedtechs/whatsapp-gateway";

let _client: ReturnType<typeof createWhatsAppClient> | null = null;

export function whatsapp() {
  if (!_client) {
    _client = createWhatsAppClient({
      accessToken: process.env["META_WHATSAPP_TOKEN"]!,
      phoneNumberId: process.env["META_WHATSAPP_PHONE_ID"]!,
      appSecret: process.env["META_WHATSAPP_APP_SECRET"]!,
    });
  }
  return _client;
}
