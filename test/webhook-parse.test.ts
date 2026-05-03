import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { createWhatsAppClient } from "../src/index.js";

const APP_SECRET = "test-app-secret";
const wa = createWhatsAppClient({
  accessToken: "tok",
  phoneNumberId: "111",
  appSecret: APP_SECRET,
  fetch: (async () => new Response("")) as typeof fetch,
});

function sign(body: string): string {
  return (
    "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex")
  );
}

describe("parseWebhookEvent", () => {
  it("parses a status event (delivered)", async () => {
    // https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "ENTRY_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15551111111",
                  phone_number_id: "PHONE_NUMBER_ID",
                },
                statuses: [
                  {
                    id: "wamid.STATUS1",
                    status: "delivered",
                    timestamp: "1700000000",
                    recipient_id: "972501234567",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const events = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(events).toEqual([
      {
        kind: "status",
        messageId: "wamid.STATUS1",
        status: "delivered",
        timestamp: "1700000000",
        recipient: "972501234567",
      },
    ]);
  });

  it("parses a status event with errors", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  {
                    id: "wamid.FAIL",
                    status: "failed",
                    timestamp: "1700000099",
                    recipient_id: "972501234567",
                    errors: [
                      {
                        code: 131026,
                        title: "Receiver is incapable of receiving this message",
                        message: "user not on whatsapp",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const [event] = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(event).toMatchObject({
      kind: "status",
      status: "failed",
      errors: [{ code: 131026, title: expect.any(String) }],
    });
  });

  it("parses a text inbound message", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "ENTRY_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "PNID" },
                contacts: [
                  { wa_id: "972501234567", profile: { name: "Dana" } },
                ],
                messages: [
                  {
                    id: "wamid.IN1",
                    from: "972501234567",
                    timestamp: "1700000001",
                    type: "text",
                    text: { body: "hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const [event] = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(event).toMatchObject({
      kind: "inbound",
      from: "972501234567",
      messageId: "wamid.IN1",
      timestamp: "1700000001",
      text: "hello",
    });
  });

  it("parses an inbound media (image) message", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    id: "wamid.IMG",
                    from: "972501234567",
                    timestamp: "1700000002",
                    type: "image",
                    image: { id: "MEDIA_ID_42", mime_type: "image/jpeg" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const [event] = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(event).toMatchObject({
      kind: "inbound",
      mediaId: "MEDIA_ID_42",
      mediaType: "image",
    });
  });

  it("parses an inbound document message", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.DOC",
                    from: "972501234567",
                    timestamp: "1700000003",
                    type: "document",
                    document: {
                      id: "DOCID",
                      mime_type: "application/pdf",
                      filename: "invoice.pdf",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const [event] = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(event).toMatchObject({
      kind: "inbound",
      mediaId: "DOCID",
      mediaType: "document",
    });
  });

  it("flags future-shape payloads as unknown (forward-compat)", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "some_future_field",
              value: { some_future_key: { foo: "bar" } },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const events = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("unknown");
  });

  it("flags non-WhatsApp objects as unknown", async () => {
    const payload = { object: "page", entry: [] };
    const raw = JSON.stringify(payload);
    const [event] = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(event!.kind).toBe("unknown");
  });

  it("returns multiple events when payload has multiple statuses", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                statuses: [
                  {
                    id: "wamid.A",
                    status: "sent",
                    timestamp: "1",
                    recipient_id: "972501234567",
                  },
                  {
                    id: "wamid.A",
                    status: "delivered",
                    timestamp: "2",
                    recipient_id: "972501234567",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const events = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === "status")).toBe(true);
  });

  it("returns mixed events from a single payload", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  {
                    id: "wamid.S",
                    status: "read",
                    timestamp: "1",
                    recipient_id: "972501234567",
                  },
                ],
                messages: [
                  {
                    id: "wamid.M",
                    from: "972501234567",
                    timestamp: "2",
                    type: "text",
                    text: { body: "yo" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const events = await wa.parseWebhookEvent({
      rawBody: raw,
      signatureHeader: sign(raw),
    });
    expect(events.map((e) => e.kind)).toEqual(["status", "inbound"]);
  });

  it("rejects malformed JSON", async () => {
    const raw = "{ this is not json";
    await expect(
      wa.parseWebhookEvent({
        rawBody: raw,
        signatureHeader: sign(raw),
      }),
    ).rejects.toMatchObject({ name: "WhatsAppValidationError" });
  });
});
