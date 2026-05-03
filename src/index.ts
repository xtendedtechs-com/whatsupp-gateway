import { createGraphClient } from "./client.js";
import { defaultNormalizeRecipient } from "./normalize.js";
import { sendTemplate } from "./send-template.js";
import {
  parseWebhookEvent,
  verifyWebhookSubscription,
} from "./webhook-verify.js";
import type {
  Logger,
  ParseWebhookEventInput,
  SendTemplateInput,
  SendTemplateResult,
  VerifyWebhookSubscriptionInput,
  WebhookEvent,
  WhatsAppClientOptions,
} from "./types.js";

const DEFAULT_GRAPH_VERSION = "v21.0";

export type WhatsAppClient = {
  /**
   * Send a pre-approved template message.
   * @throws WhatsAppValidationError on bad input
   * @throws WhatsAppApiError on Graph API non-2xx (check `.isRetryable`)
   * @throws WhatsAppNetworkError on transport failure
   */
  sendTemplate: (input: SendTemplateInput) => Promise<SendTemplateResult>;

  /**
   * Verify the GET handshake Meta sends when (re-)subscribing a webhook.
   * Echo the returned challenge back as `text/plain` with status 200.
   * @throws WhatsAppSignatureError on token mismatch / wrong mode
   */
  verifyWebhookSubscription: (input: VerifyWebhookSubscriptionInput) => string;

  /**
   * Verify HMAC + parse a webhook POST. The raw body is required because the
   * HMAC is computed over the exact bytes Meta sent. JSON-parse it AFTER this
   * function returns, never before.
   *
   * Returns an array — a single payload can carry multiple events.
   * @throws WhatsAppSignatureError on bad/missing signature
   * @throws WhatsAppValidationError on malformed JSON
   */
  parseWebhookEvent: (
    input: ParseWebhookEventInput,
  ) => Promise<WebhookEvent[]>;
};

export function createWhatsAppClient(
  opts: WhatsAppClientOptions,
): WhatsAppClient {
  if (!opts || typeof opts !== "object") {
    throw new Error("createWhatsAppClient: options object is required");
  }
  if (!opts.accessToken) {
    throw new Error("createWhatsAppClient: accessToken is required");
  }
  if (!opts.phoneNumberId) {
    throw new Error("createWhatsAppClient: phoneNumberId is required");
  }
  if (!opts.appSecret) {
    throw new Error("createWhatsAppClient: appSecret is required");
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "createWhatsAppClient: global fetch is unavailable; pass `fetch` explicitly (Node 20+ required)",
    );
  }

  const logger: Logger = opts.logger ?? {};
  const normalize = opts.normalizeRecipient ?? defaultNormalizeRecipient;

  const graph = createGraphClient({
    accessToken: opts.accessToken,
    graphApiVersion: opts.graphApiVersion ?? DEFAULT_GRAPH_VERSION,
    fetch: fetchImpl,
    logger,
  });

  return {
    sendTemplate: (input) =>
      sendTemplate({
        graph,
        phoneNumberId: opts.phoneNumberId,
        normalize,
        logger,
        input,
      }),
    verifyWebhookSubscription: (input) => verifyWebhookSubscription(input),
    parseWebhookEvent: (input) =>
      parseWebhookEvent({ appSecret: opts.appSecret, input }),
  };
}

export {
  WhatsAppApiError,
  WhatsAppNetworkError,
  WhatsAppSignatureError,
  WhatsAppValidationError,
} from "./errors.js";

export { defaultNormalizeRecipient } from "./normalize.js";

export type {
  FetchLike,
  Logger,
  ParseWebhookEventInput,
  SendTemplateInput,
  SendTemplateResult,
  TemplateBodyComponent,
  TemplateButtonComponent,
  TemplateComponent,
  TemplateCurrencyParameter,
  TemplateDateTimeParameter,
  TemplateDocumentParameter,
  TemplateFooterComponent,
  TemplateHeaderComponent,
  TemplateImageParameter,
  TemplateParameter,
  TemplatePayloadParameter,
  TemplateTextParameter,
  TemplateVideoParameter,
  VerifyWebhookSubscriptionInput,
  WebhookEvent,
  WebhookInboundEvent,
  WebhookStatusEvent,
  WebhookUnknownEvent,
  WhatsAppClientOptions,
} from "./types.js";
