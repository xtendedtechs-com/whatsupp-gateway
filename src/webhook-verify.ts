import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WhatsAppSignatureError,
  WhatsAppValidationError,
} from "./errors.js";
import type {
  ParseWebhookEventInput,
  VerifyWebhookSubscriptionInput,
  WebhookEvent,
  WebhookInboundEvent,
  WebhookStatusEvent,
} from "./types.js";

/**
 * Verify Meta's webhook subscription handshake (the GET on subscribe).
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
export function verifyWebhookSubscription(
  input: VerifyWebhookSubscriptionInput,
): string {
  const { mode, token, challenge, expectedToken } = input;
  if (!expectedToken) {
    throw new WhatsAppValidationError(
      "verifyWebhookSubscription: expectedToken is required",
    );
  }
  if (mode !== "subscribe") {
    throw new WhatsAppSignatureError(`Unexpected hub.mode: ${String(mode)}`);
  }
  if (typeof token !== "string" || typeof challenge !== "string") {
    throw new WhatsAppSignatureError(
      "Missing hub.verify_token or hub.challenge",
    );
  }
  if (!safeStringEqual(token, expectedToken)) {
    throw new WhatsAppSignatureError("Verify token mismatch");
  }
  return challenge;
}

function safeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the X-Hub-Signature-256 header against the raw request body.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#event-notifications
 */
export function verifySignature(args: {
  appSecret: string;
  rawBody: Buffer;
  signatureHeader: string | string[] | null | undefined;
}): void {
  const { appSecret, rawBody, signatureHeader } = args;
  const header = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  if (!header || typeof header !== "string") {
    throw new WhatsAppSignatureError("Missing X-Hub-Signature-256 header");
  }
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) {
    throw new WhatsAppSignatureError(
      "X-Hub-Signature-256 must start with 'sha256='",
    );
  }
  const provided = header.slice(prefix.length);
  if (!/^[0-9a-fA-F]+$/.test(provided) || provided.length === 0) {
    throw new WhatsAppSignatureError("Malformed signature");
  }
  const computed = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const providedBuf = Buffer.from(provided, "hex");
  const computedBuf = Buffer.from(computed, "hex");
  if (
    providedBuf.length !== computedBuf.length ||
    !timingSafeEqual(providedBuf, computedBuf)
  ) {
    throw new WhatsAppSignatureError();
  }
}

/**
 * Verify HMAC and parse a Meta webhook POST payload into a list of events.
 *
 * NOTE: returns an array — a single Meta payload can carry multiple statuses
 * and/or messages bundled together. Callers should iterate.
 */
export async function parseWebhookEvent(args: {
  appSecret: string;
  input: ParseWebhookEventInput;
}): Promise<WebhookEvent[]> {
  const { appSecret, input } = args;
  const rawBuf = toBuffer(input.rawBody);
  verifySignature({
    appSecret,
    rawBody: rawBuf,
    signatureHeader: input.signatureHeader,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBuf.toString("utf8"));
  } catch {
    throw new WhatsAppValidationError("Webhook body is not valid JSON");
  }

  return extractEvents(parsed);
}

function toBuffer(b: string | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b, "utf8");
  return Buffer.from(b);
}

// Payload shape:
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
type MetaWebhookEnvelope = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<MetaInboundMessage>;
        statuses?: Array<MetaStatus>;
      };
    }>;
  }>;
};

function extractEvents(payload: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  const root = payload as MetaWebhookEnvelope | null;

  if (
    !root ||
    typeof root !== "object" ||
    root.object !== "whatsapp_business_account"
  ) {
    events.push({ kind: "unknown", raw: payload });
    return events;
  }

  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) {
        events.push({ kind: "unknown", raw: change });
        continue;
      }
      const statuses = value.statuses ?? [];
      const messages = value.messages ?? [];

      if (statuses.length === 0 && messages.length === 0) {
        events.push({ kind: "unknown", raw: change });
        continue;
      }

      for (const s of statuses) {
        events.push(parseStatus(s));
      }
      for (const m of messages) {
        events.push(parseInbound(m));
      }
    }
  }
  if (events.length === 0) {
    events.push({ kind: "unknown", raw: payload });
  }
  return events;
}

type MetaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

function parseStatus(s: MetaStatus): WebhookEvent {
  if (!s.id || !s.status || !s.recipient_id || !s.timestamp) {
    return { kind: "unknown", raw: s };
  }
  const ev: WebhookStatusEvent = {
    kind: "status",
    messageId: s.id,
    status: s.status,
    timestamp: s.timestamp,
    recipient: s.recipient_id,
  };
  if (s.errors && s.errors.length > 0) {
    ev.errors = s.errors.map((e) => ({
      code: e.code ?? 0,
      ...(e.title !== undefined ? { title: e.title } : {}),
      ...(e.message !== undefined ? { message: e.message } : {}),
    }));
  }
  return ev;
}

type MetaInboundMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string };
  sticker?: { id?: string; mime_type?: string };
};

function parseInbound(m: MetaInboundMessage): WebhookEvent {
  if (!m.id || !m.from || !m.timestamp) {
    return { kind: "unknown", raw: m };
  }
  const ev: WebhookInboundEvent = {
    kind: "inbound",
    from: m.from,
    messageId: m.id,
    timestamp: m.timestamp,
    raw: m,
  };
  if (m.type === "text" && m.text?.body) {
    ev.text = m.text.body;
  }
  const media =
    (m.type === "image" && m.image) ||
    (m.type === "video" && m.video) ||
    (m.type === "audio" && m.audio) ||
    (m.type === "document" && m.document) ||
    (m.type === "sticker" && m.sticker) ||
    null;
  if (media && media.id) {
    ev.mediaId = media.id;
    ev.mediaType = m.type ?? "unknown";
  }
  return ev;
}
