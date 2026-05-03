import type { GraphClient } from "./client.js";
import { WhatsAppValidationError } from "./errors.js";
import type {
  Logger,
  SendTemplateInput,
  SendTemplateResult,
} from "./types.js";

/**
 * Meta's response shape for POST /{phone_number_id}/messages.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
type MetaSendResponse = {
  messaging_product: "whatsapp";
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
};

export async function sendTemplate(args: {
  graph: GraphClient;
  phoneNumberId: string;
  normalize: (raw: string) => string;
  logger: Logger;
  input: SendTemplateInput;
}): Promise<SendTemplateResult> {
  const { graph, phoneNumberId, normalize, logger, input } = args;

  if (!input || typeof input !== "object") {
    throw new WhatsAppValidationError("sendTemplate: input is required");
  }
  if (!input.templateName || typeof input.templateName !== "string") {
    throw new WhatsAppValidationError(
      "sendTemplate: templateName is required",
    );
  }
  if (!input.languageCode || typeof input.languageCode !== "string") {
    throw new WhatsAppValidationError(
      "sendTemplate: languageCode is required",
    );
  }
  if (!input.to || typeof input.to !== "string") {
    throw new WhatsAppValidationError("sendTemplate: to is required");
  }

  const recipient = normalize(input.to);

  const body = {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: recipient,
    type: "template" as const,
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(input.components && input.components.length > 0
        ? { components: input.components }
        : {}),
    },
  };

  const response = await graph.request<MetaSendResponse>({
    method: "POST",
    path: `/${encodeURIComponent(phoneNumberId)}/messages`,
    body,
  });

  const messageId = response.messages?.[0]?.id;
  if (!messageId) {
    throw new WhatsAppValidationError(
      "sendTemplate: Meta response missing messages[0].id",
    );
  }

  // PII-conscious logging: last 4 digits + message id, no body content.
  logger.info?.("[whatsapp-gateway] template sent", {
    template: input.templateName,
    language: input.languageCode,
    recipientLast4: recipient.slice(-4),
    messageId,
  });

  return {
    messageId,
    to: recipient,
  };
}
