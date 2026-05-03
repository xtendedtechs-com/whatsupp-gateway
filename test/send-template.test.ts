import { describe, it, expect, vi } from "vitest";
import {
  createWhatsAppClient,
  WhatsAppApiError,
  WhatsAppValidationError,
} from "../src/index.js";

const baseOpts = {
  accessToken: "test-token",
  phoneNumberId: "1234567890",
  appSecret: "test-secret",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendTemplate", () => {
  it("posts the correct body and returns messageId + canonical recipient", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: "972501234567", wa_id: "972501234567" }],
        messages: [{ id: "wamid.ABC123" }],
      }),
    );

    const wa = createWhatsAppClient({ ...baseOpts, fetch: fetchMock });
    const res = await wa.sendTemplate({
      to: "+972501234567",
      templateName: "appointment_reminder",
      languageCode: "he",
      components: [
        { type: "body", parameters: [{ type: "text", text: "Dana" }] },
      ],
    });

    expect(res).toEqual({ messageId: "wamid.ABC123", to: "972501234567" });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://graph.facebook.com/v21.0/1234567890/messages",
    );
    const reqInit = init as RequestInit;
    expect(reqInit.method).toBe("POST");
    const headers = reqInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(reqInit.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972501234567",
      type: "template",
      template: {
        name: "appointment_reminder",
        language: { code: "he" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Dana" }] },
        ],
      },
    });
  });

  it("uses configured graphApiVersion", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.X" }],
      }),
    );
    const wa = createWhatsAppClient({
      ...baseOpts,
      fetch: fetchMock,
      graphApiVersion: "v22.0",
    });
    await wa.sendTemplate({
      to: "+14155551234",
      templateName: "t",
      languageCode: "en_US",
    });
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch("/v22.0/");
  });

  it("omits components when empty", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.X" }],
      }),
    );
    const wa = createWhatsAppClient({ ...baseOpts, fetch: fetchMock });
    await wa.sendTemplate({
      to: "+14155551234",
      templateName: "t",
      languageCode: "en_US",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.template.components).toBeUndefined();
  });

  it("uses a custom normalizer when provided", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.X" }],
      }),
    );
    const wa = createWhatsAppClient({
      ...baseOpts,
      fetch: fetchMock,
      normalizeRecipient: (raw) => `9999${raw}`,
    });
    const res = await wa.sendTemplate({
      to: "abc",
      templateName: "t",
      languageCode: "en_US",
    });
    expect(res.to).toBe("9999abc");
  });

  it("throws WhatsAppApiError on 4xx with parsed Meta payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, {
        error: {
          message: "Template name does not exist",
          code: 132001,
          error_subcode: 2494010,
          fbtrace_id: "Aabb",
        },
      }),
    );
    const wa = createWhatsAppClient({ ...baseOpts, fetch: fetchMock });

    let caught: unknown;
    try {
      await wa.sendTemplate({
        to: "+14155551234",
        templateName: "bogus",
        languageCode: "en_US",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WhatsAppApiError);
    const err = caught as WhatsAppApiError;
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe(132001);
    expect(err.subcode).toBe(2494010);
    expect(err.fbtraceId).toBe("Aabb");
    expect(err.isRetryable).toBe(false);
    expect(err.message).toBe("Template name does not exist");
  });

  it("marks 5xx as retryable", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(503, {
        error: { message: "service unavailable", code: 1 },
      }),
    );
    const wa = createWhatsAppClient({ ...baseOpts, fetch: fetchMock });
    let caught: unknown;
    try {
      await wa.sendTemplate({
        to: "+14155551234",
        templateName: "t",
        languageCode: "en_US",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WhatsAppApiError);
    expect((caught as WhatsAppApiError).isRetryable).toBe(true);
  });

  it("marks 429 as retryable", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, {
        error: { message: "rate limited", code: 130429 },
      }),
    );
    const wa = createWhatsAppClient({ ...baseOpts, fetch: fetchMock });
    let caught: unknown;
    try {
      await wa.sendTemplate({
        to: "+14155551234",
        templateName: "t",
        languageCode: "en_US",
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as WhatsAppApiError).isRetryable).toBe(true);
  });

  it("validates input — missing template name", async () => {
    const wa = createWhatsAppClient({ ...baseOpts });
    await expect(
      wa.sendTemplate({
        to: "+14155551234",
        templateName: "",
        languageCode: "en_US",
      }),
    ).rejects.toBeInstanceOf(WhatsAppValidationError);
  });

  it("validates input — bad recipient", async () => {
    const wa = createWhatsAppClient({ ...baseOpts });
    await expect(
      wa.sendTemplate({
        to: "0501234567",
        templateName: "t",
        languageCode: "en_US",
      }),
    ).rejects.toBeInstanceOf(WhatsAppValidationError);
  });

  it("does not log message body content (PII guard)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.X" }],
      }),
    );
    const logs: unknown[][] = [];
    const wa = createWhatsAppClient({
      ...baseOpts,
      fetch: fetchMock,
      logger: {
        info: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
      },
    });
    await wa.sendTemplate({
      to: "+972501234567",
      templateName: "t",
      languageCode: "he",
      components: [
        { type: "body", parameters: [{ type: "text", text: "SECRET-PII" }] },
      ],
    });
    const flat = JSON.stringify(logs);
    expect(flat).not.toContain("SECRET-PII");
    expect(flat).not.toContain("972501234567"); // full number not logged
    expect(flat).toContain("4567"); // last 4 are fine
  });
});
