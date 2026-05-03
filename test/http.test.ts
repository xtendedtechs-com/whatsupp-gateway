import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createWhatsAppClient } from "../src/index.js";
import { createWebhookHandler } from "../src/http/index.js";

const APP_SECRET = "http-test-secret";
const VERIFY_TOKEN = "verify-me";

const wa = createWhatsAppClient({
  accessToken: "tok",
  phoneNumberId: "111",
  appSecret: APP_SECRET,
  fetch: (async () => new Response("")) as typeof fetch,
});

const samplePayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                id: "wamid.X",
                from: "972501234567",
                timestamp: "1",
                type: "text",
                text: { body: "hi" },
              },
            ],
          },
        },
      ],
    },
  ],
};
const sampleBody = JSON.stringify(samplePayload);
const sampleSig =
  "sha256=" + createHmac("sha256", APP_SECRET).update(sampleBody).digest("hex");

describe("createWebhookHandler — fetch style", () => {
  it("GET echoes the challenge when token matches", async () => {
    const onEvent = vi.fn();
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent,
    });
    const url =
      "https://example.test/webhook?hub.mode=subscribe" +
      `&hub.verify_token=${VERIFY_TOKEN}` +
      "&hub.challenge=12345";
    const res = await h.fetchGet(new Request(url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("GET returns 403 on bad token", async () => {
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent: () => {},
      onError: () => {},
    });
    const url =
      "https://example.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345";
    const res = await h.fetchGet(new Request(url));
    expect(res.status).toBe(403);
  });

  it("POST verifies signature and dispatches events", async () => {
    const onEvent = vi.fn();
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent,
    });
    const res = await h.fetchPost(
      new Request("https://example.test/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": sampleSig },
        body: sampleBody,
      }),
    );
    expect(res.status).toBe(200);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "inbound", text: "hi" }),
    );
  });

  it("POST returns 401 on bad signature", async () => {
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent: () => {},
      onError: () => {},
    });
    const res = await h.fetchPost(
      new Request("https://example.test/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body: sampleBody,
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("createWebhookHandler — express style", () => {
  function makeRes() {
    const calls: { status?: number; body?: string } = {};
    const res = {
      status(code: number) {
        calls.status = code;
        return res;
      },
      send(body?: string) {
        calls.body = body;
      },
    };
    return { res, calls };
  }

  it("expressGet echoes challenge", async () => {
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent: () => {},
    });
    const { res, calls } = makeRes();
    await h.expressGet(
      {
        query: {
          "hub.mode": "subscribe",
          "hub.verify_token": VERIFY_TOKEN,
          "hub.challenge": "abc",
        },
        headers: {},
        body: undefined,
      },
      res,
    );
    expect(calls.status).toBe(200);
    expect(calls.body).toBe("abc");
  });

  it("expressPost ACKs 200 and delivers events", async () => {
    const onEvent = vi.fn();
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent,
    });
    const { res, calls } = makeRes();
    await h.expressPost(
      {
        method: "POST",
        headers: { "x-hub-signature-256": sampleSig },
        body: Buffer.from(sampleBody, "utf8"),
      },
      res,
    );
    expect(calls.status).toBe(200);
    // delivery is fire-and-forget, give the microtask queue a tick
    await new Promise((r) => setImmediate(r));
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it("expressPost returns 400 if body wasn't kept raw", async () => {
    const onError = vi.fn();
    const h = createWebhookHandler({
      client: wa,
      verifyToken: VERIFY_TOKEN,
      onEvent: () => {},
      onError,
    });
    const { res, calls } = makeRes();
    await h.expressPost(
      {
        method: "POST",
        headers: { "x-hub-signature-256": sampleSig },
        body: { already: "parsed" },
      },
      res,
    );
    expect(calls.status).toBe(400);
    expect(onError).toHaveBeenCalled();
  });
});
