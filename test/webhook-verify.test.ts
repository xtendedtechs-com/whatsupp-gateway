import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  createWhatsAppClient,
  WhatsAppSignatureError,
} from "../src/index.js";

const baseOpts = {
  accessToken: "tok",
  phoneNumberId: "111",
  appSecret: "shhh-app-secret",
  fetch: (async () => new Response("")) as typeof fetch,
};

describe("verifyWebhookSubscription (GET handshake)", () => {
  const wa = createWhatsAppClient(baseOpts);

  it("returns the challenge when token matches", () => {
    const out = wa.verifyWebhookSubscription({
      mode: "subscribe",
      token: "expected-token",
      challenge: "12345",
      expectedToken: "expected-token",
    });
    expect(out).toBe("12345");
  });

  it("rejects on token mismatch", () => {
    expect(() =>
      wa.verifyWebhookSubscription({
        mode: "subscribe",
        token: "wrong",
        challenge: "12345",
        expectedToken: "expected-token",
      }),
    ).toThrow(WhatsAppSignatureError);
  });

  it("rejects on wrong mode", () => {
    expect(() =>
      wa.verifyWebhookSubscription({
        mode: "unsubscribe",
        token: "expected-token",
        challenge: "12345",
        expectedToken: "expected-token",
      }),
    ).toThrow(WhatsAppSignatureError);
  });

  it("rejects on missing challenge", () => {
    expect(() =>
      wa.verifyWebhookSubscription({
        mode: "subscribe",
        token: "expected-token",
        challenge: null,
        expectedToken: "expected-token",
      }),
    ).toThrow(WhatsAppSignatureError);
  });

  it("rejects when token differs only in length (constant-time prefix attack)", () => {
    expect(() =>
      wa.verifyWebhookSubscription({
        mode: "subscribe",
        token: "expected-token-with-suffix",
        challenge: "12345",
        expectedToken: "expected-token",
      }),
    ).toThrow(WhatsAppSignatureError);
  });
});

// ---------------------------------------------------------------------------
// HMAC fixture — known-good (rawBody, appSecret, signature) triple. Recompute
// locally with:
//   node -e "console.log('sha256=' + require('node:crypto').createHmac('sha256','<secret>').update('<body>').digest('hex'))"
// If this fixture ever drifts, the HMAC code has a bug.
// ---------------------------------------------------------------------------

const FIXTURE_SECRET = "fixture-app-secret-do-not-use-in-prod";
const FIXTURE_BODY = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "0",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550000000",
              phone_number_id: "PNID",
            },
            statuses: [
              {
                id: "wamid.FIXTURE",
                status: "delivered",
                timestamp: "1700000000",
                recipient_id: "15551234567",
              },
            ],
          },
        },
      ],
    },
  ],
});
const FIXTURE_SIG =
  "sha256=b57f4427012cd4c4d5073b7b8778fe5067c206778b174d3382c30a243c2576af";

describe("HMAC signature verification (fixture)", () => {
  it("the recorded fixture matches a fresh computation (regression guard)", () => {
    const fresh =
      "sha256=" +
      createHmac("sha256", FIXTURE_SECRET)
        .update(FIXTURE_BODY)
        .digest("hex");
    expect(fresh).toBe(FIXTURE_SIG);
  });

  it("accepts the fixture signature", async () => {
    const wa = createWhatsAppClient({
      ...baseOpts,
      appSecret: FIXTURE_SECRET,
    });
    const events = await wa.parseWebhookEvent({
      rawBody: FIXTURE_BODY,
      signatureHeader: FIXTURE_SIG,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "status",
      messageId: "wamid.FIXTURE",
      status: "delivered",
    });
  });

  it("rejects when even one byte of the body changes", async () => {
    const wa = createWhatsAppClient({
      ...baseOpts,
      appSecret: FIXTURE_SECRET,
    });
    const tampered = FIXTURE_BODY.replace("delivered", "DELIVERED");
    await expect(
      wa.parseWebhookEvent({
        rawBody: tampered,
        signatureHeader: FIXTURE_SIG,
      }),
    ).rejects.toBeInstanceOf(WhatsAppSignatureError);
  });

  it("rejects when the secret differs", async () => {
    const wa = createWhatsAppClient({
      ...baseOpts,
      appSecret: "wrong-secret",
    });
    await expect(
      wa.parseWebhookEvent({
        rawBody: FIXTURE_BODY,
        signatureHeader: FIXTURE_SIG,
      }),
    ).rejects.toBeInstanceOf(WhatsAppSignatureError);
  });

  it.each([
    ["missing prefix", "b57f4427012cd4c4d5073b7b8778fe5067c206778b174d3382c30a243c2576af"],
    ["wrong prefix", "sha1=b57f4427012cd4c4d5073b7b8778fe5067c206778b174d3382c30a243c2576af"],
    ["empty hex", "sha256="],
    ["odd-length hex", "sha256=abc"],
    ["non-hex chars", "sha256=zzz!@#"],
    ["empty header", ""],
  ])("rejects malformed header (%s)", async (_label, header) => {
    const wa = createWhatsAppClient({
      ...baseOpts,
      appSecret: FIXTURE_SECRET,
    });
    await expect(
      wa.parseWebhookEvent({
        rawBody: FIXTURE_BODY,
        signatureHeader: header,
      }),
    ).rejects.toBeInstanceOf(WhatsAppSignatureError);
  });

  it("rejects missing header", async () => {
    const wa = createWhatsAppClient({
      ...baseOpts,
      appSecret: FIXTURE_SECRET,
    });
    await expect(
      wa.parseWebhookEvent({
        rawBody: FIXTURE_BODY,
        signatureHeader: undefined,
      }),
    ).rejects.toBeInstanceOf(WhatsAppSignatureError);
  });

  it("accepts a Buffer body", async () => {
    const wa = createWhatsAppClient({
      ...baseOpts,
      appSecret: FIXTURE_SECRET,
    });
    const events = await wa.parseWebhookEvent({
      rawBody: Buffer.from(FIXTURE_BODY, "utf8"),
      signatureHeader: FIXTURE_SIG,
    });
    expect(events).toHaveLength(1);
  });
});
