/**
 * Public types for the WhatsApp gateway.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference
 */

export type Logger = {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export type FetchLike = typeof globalThis.fetch;

export type WhatsAppClientOptions = {
  /** System User access token (long-lived). */
  accessToken: string;
  /** Numeric Phone Number ID from the Meta WhatsApp dashboard. */
  phoneNumberId: string;
  /** Meta App Secret — used to verify webhook payload HMACs. */
  appSecret: string;
  /** Graph API version. Defaults to "v21.0". */
  graphApiVersion?: string;
  /** Custom fetch implementation (for testing or custom HTTP behavior). */
  fetch?: FetchLike;
  /** Optional logger. Receives metadata only (no message bodies). */
  logger?: Logger;
  /**
   * Optional recipient normalizer. Defaults to a strict-E.164 normalizer
   * (see `defaultNormalizeRecipient`). Override if your inputs aren't already
   * in international form — country-specific local-number rules belong
   * in caller code, not here.
   */
  normalizeRecipient?: (raw: string) => string;
};

// ---------------------------------------------------------------------------
// Template message components — mirror Meta's request shape verbatim.
// https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#template-object
// ---------------------------------------------------------------------------

export type TemplateTextParameter = {
  type: "text";
  text: string;
};

export type TemplateCurrencyParameter = {
  type: "currency";
  currency: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
};

export type TemplateDateTimeParameter = {
  type: "date_time";
  date_time: { fallback_value: string };
};

export type TemplateImageParameter = {
  type: "image";
  image: { link: string } | { id: string };
};

export type TemplateDocumentParameter = {
  type: "document";
  document:
    | { link: string; filename?: string }
    | { id: string; filename?: string };
};

export type TemplateVideoParameter = {
  type: "video";
  video: { link: string } | { id: string };
};

export type TemplatePayloadParameter = {
  type: "payload";
  payload: string;
};

export type TemplateParameter =
  | TemplateTextParameter
  | TemplateCurrencyParameter
  | TemplateDateTimeParameter
  | TemplateImageParameter
  | TemplateDocumentParameter
  | TemplateVideoParameter
  | TemplatePayloadParameter;

export type TemplateHeaderComponent = {
  type: "header";
  parameters?: TemplateParameter[];
};

export type TemplateBodyComponent = {
  type: "body";
  parameters?: TemplateParameter[];
};

export type TemplateFooterComponent = {
  type: "footer";
  parameters?: TemplateParameter[];
};

export type TemplateButtonComponent = {
  type: "button";
  sub_type: "quick_reply" | "url" | "copy_code" | "catalog" | "flow";
  index: number;
  parameters?: TemplateParameter[];
};

export type TemplateComponent =
  | TemplateHeaderComponent
  | TemplateBodyComponent
  | TemplateFooterComponent
  | TemplateButtonComponent;

export type SendTemplateInput = {
  /** E.164 phone number, e.g. "+972501234567". */
  to: string;
  /** Pre-approved template name. */
  templateName: string;
  /** BCP-47 / Meta locale code, e.g. "he", "en_US". */
  languageCode: string;
  components?: TemplateComponent[];
};

export type SendTemplateResult = {
  /** Meta message id, e.g. "wamid.HBgL...". */
  messageId: string;
  /** Canonical recipient (digits only, no leading "+"). */
  to: string;
};

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export type WebhookStatusEvent = {
  kind: "status";
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed" | (string & {});
  timestamp: string;
  recipient: string;
  errors?: Array<{ code: number; title?: string; message?: string }>;
};

export type WebhookInboundEvent = {
  kind: "inbound";
  from: string;
  messageId: string;
  timestamp: string;
  text?: string;
  mediaId?: string;
  mediaType?:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | (string & {});
  /** The full inbound message object as Meta sent it. */
  raw: unknown;
};

/**
 * Returned for any payload shape the parser doesn't recognize — for example,
 * new event fields Meta adds in the future. Forward-compat escape hatch.
 */
export type WebhookUnknownEvent = {
  kind: "unknown";
  raw: unknown;
};

export type WebhookEvent =
  | WebhookStatusEvent
  | WebhookInboundEvent
  | WebhookUnknownEvent;

export type VerifyWebhookSubscriptionInput = {
  mode: string | null | undefined;
  token: string | null | undefined;
  challenge: string | null | undefined;
  expectedToken: string;
};

export type ParseWebhookEventInput = {
  /**
   * Raw request body, exactly as received. NOT JSON-parsed — HMAC is computed
   * over the raw bytes, so any reformatting will break verification.
   */
  rawBody: string | Buffer | Uint8Array;
  signatureHeader: string | string[] | null | undefined;
};
