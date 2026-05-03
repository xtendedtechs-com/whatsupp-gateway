/**
 * Optional HTTP adapters. Importing from `@xtendedtechs/whatsapp-gateway/http`
 * does NOT pull in any framework — it just gives you two thin wrappers:
 *
 *   - Express-style: `expressGet` / `expressPost` (req, res) => Promise<void>
 *   - Web Fetch-style: `fetchGet` / `fetchPost` (Request) => Promise<Response>
 *
 * The core library works fine without this file. Use it only if you want
 * a copy-paste handler instead of wiring three lines of glue yourself.
 */

import {
  WhatsAppSignatureError,
  WhatsAppValidationError,
} from "../errors.js";
import type { WhatsAppClient } from "../index.js";
import type { WebhookEvent } from "../types.js";

export type WebhookHandlerOptions = {
  client: WhatsAppClient;
  /** Same string you registered in the Meta App Dashboard webhook config. */
  verifyToken: string;
  /** Called once per parsed event. May be sync or async. */
  onEvent: (event: WebhookEvent) => Promise<void> | void;
  /** Called for any error during handling. Defaults to console.error. */
  onError?: (err: unknown) => void;
};

type ExpressLikeReq = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  /** Raw body — Buffer when `express.raw({ type: 'application/json' })` is used. */
  body: Buffer | string | unknown;
};

type ExpressLikeRes = {
  status: (code: number) => ExpressLikeRes;
  send: (body?: string) => void;
  setHeader?: (name: string, value: string) => void;
};

export type WebhookHandler = {
  /** Express-style GET handler for the verification handshake. */
  expressGet: (req: ExpressLikeReq, res: ExpressLikeRes) => Promise<void>;
  /** Express-style POST handler. Requires `express.raw({ type: 'application/json' })` upstream. */
  expressPost: (req: ExpressLikeReq, res: ExpressLikeRes) => Promise<void>;
  /** Web Fetch-style GET handler (Next.js App Router, Hono, Workers, etc). */
  fetchGet: (request: Request) => Promise<Response>;
  /** Web Fetch-style POST handler. */
  fetchPost: (request: Request) => Promise<Response>;
};

export function createWebhookHandler(
  opts: WebhookHandlerOptions,
): WebhookHandler {
  if (!opts?.client) {
    throw new Error("createWebhookHandler: client is required");
  }
  if (!opts.verifyToken) {
    throw new Error("createWebhookHandler: verifyToken is required");
  }
  if (typeof opts.onEvent !== "function") {
    throw new Error("createWebhookHandler: onEvent callback is required");
  }

  const onError =
    opts.onError ??
    ((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[whatsapp-gateway] webhook handler error:", err);
    });

  async function deliver(events: WebhookEvent[]): Promise<void> {
    for (const event of events) {
      try {
        await opts.onEvent(event);
      } catch (err) {
        onError(err);
      }
    }
  }

  return {
    async expressGet(req, res) {
      const q = req.query ?? {};
      try {
        const challenge = opts.client.verifyWebhookSubscription({
          mode: pickQuery(q["hub.mode"]),
          token: pickQuery(q["hub.verify_token"]),
          challenge: pickQuery(q["hub.challenge"]),
          expectedToken: opts.verifyToken,
        });
        res.status(200).send(challenge);
      } catch (err) {
        onError(err);
        res.status(403).send("Forbidden");
      }
    },

    async expressPost(req, res) {
      try {
        const raw = expressRawBody(req);
        const events = await opts.client.parseWebhookEvent({
          rawBody: raw,
          signatureHeader: req.headers["x-hub-signature-256"],
        });
        // Meta retries unless we 200 quickly. ACK first, deliver after.
        res.status(200).send("OK");
        void deliver(events);
      } catch (err) {
        onError(err);
        if (err instanceof WhatsAppSignatureError) {
          res.status(401).send("Unauthorized");
        } else if (err instanceof WhatsAppValidationError) {
          res.status(400).send("Bad Request");
        } else {
          res.status(500).send("Internal Error");
        }
      }
    },

    async fetchGet(request) {
      const url = new URL(request.url);
      try {
        const challenge = opts.client.verifyWebhookSubscription({
          mode: url.searchParams.get("hub.mode"),
          token: url.searchParams.get("hub.verify_token"),
          challenge: url.searchParams.get("hub.challenge"),
          expectedToken: opts.verifyToken,
        });
        return new Response(challenge, { status: 200 });
      } catch (err) {
        onError(err);
        return new Response("Forbidden", { status: 403 });
      }
    },

    async fetchPost(request) {
      let raw: ArrayBuffer;
      try {
        raw = await request.arrayBuffer();
      } catch (err) {
        onError(err);
        return new Response("Bad Request", { status: 400 });
      }
      try {
        const events = await opts.client.parseWebhookEvent({
          rawBody: Buffer.from(raw),
          signatureHeader: request.headers.get("x-hub-signature-256"),
        });
        // Most fetch-style platforms (Next.js / Workers) lack post-response
        // hooks, so deliver inline before returning. If that's too slow for
        // you, parse here and dispatch to your own queue.
        await deliver(events);
        return new Response("OK", { status: 200 });
      } catch (err) {
        onError(err);
        if (err instanceof WhatsAppSignatureError) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (err instanceof WhatsAppValidationError) {
          return new Response("Bad Request", { status: 400 });
        }
        return new Response("Internal Error", { status: 500 });
      }
    },
  };
}

function pickQuery(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function expressRawBody(req: ExpressLikeReq): Buffer {
  const b = req.body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b, "utf8");
  if (b instanceof Uint8Array) return Buffer.from(b);
  throw new WhatsAppValidationError(
    "Webhook POST body must be a Buffer or string. Mount " +
      "`express.raw({ type: 'application/json' })` BEFORE this handler so the " +
      "raw bytes survive — JSON parsing breaks HMAC verification.",
  );
}
