/**
 * Minimal Express app exposing /webhook (GET + POST) and /send.
 * Persistence and dispatch are YOUR job — this just shows wiring.
 *
 * Required env:
 *   META_WHATSAPP_TOKEN
 *   META_WHATSAPP_PHONE_ID
 *   META_WHATSAPP_APP_SECRET
 *   META_WHATSAPP_VERIFY_TOKEN
 */
import express from "express";
import { createWhatsAppClient } from "@xtendedtechs/whatsapp-gateway";
import { createWebhookHandler } from "@xtendedtechs/whatsapp-gateway/http";

const wa = createWhatsAppClient({
  accessToken: process.env["META_WHATSAPP_TOKEN"]!,
  phoneNumberId: process.env["META_WHATSAPP_PHONE_ID"]!,
  appSecret: process.env["META_WHATSAPP_APP_SECRET"]!,
});

const handler = createWebhookHandler({
  client: wa,
  verifyToken: process.env["META_WHATSAPP_VERIFY_TOKEN"]!,
  onEvent: async (event) => {
    // TODO: persist / dispatch on your side
    console.log("event:", event.kind, event);
  },
});

const app = express();

// CRITICAL: /webhook POST must use raw body so HMAC verification works.
// Mount express.raw BEFORE express.json, scoped to the webhook path only.
app.get("/webhook", (req, res) => handler.expressGet(req, res));
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => handler.expressPost(req, res),
);

// Other routes can use the normal JSON parser.
app.use(express.json());

app.post("/send", async (req, res) => {
  try {
    const result = await wa.sendTemplate(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const port = Number(process.env["PORT"] ?? 3000);
app.listen(port, () => console.log(`listening on :${port}`));
