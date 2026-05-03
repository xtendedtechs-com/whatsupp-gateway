# @xtendedtechs/whatsapp-gateway

A small, focused TypeScript wrapper for the WhatsApp Business Cloud API. Two
operations, no opinions:

1. **Send a pre-approved template message** to a phone number.
2. **Receive + verify webhook callbacks** (delivery status, inbound messages).

Zero runtime dependencies. ESM + CJS. Node 20+. Framework-agnostic — the core
is plain functions, with optional Express / Web-Fetch handlers behind a separate
import path.

This package does **not** include a queue, a scheduler, a retry daemon,
persistence, or any country-specific phone normalization. See
[What this package doesn't do](#what-this-package-doesnt-do) below.

---

## Table of contents

1. [Meta-side setup](#1-meta-side-setup)
2. [Install](#2-install)
3. [Use](#3-use)
4. [Webhook setup](#4-webhook-setup)
5. [Environment variables](#5-environment-variables)
6. [Errors and retries](#6-errors-and-retries)
7. [Limits and behavior](#7-limits-and-behavior)
8. [What this package doesn't do](#what-this-package-doesnt-do)
9. [Future work](#future-work)
10. [Development](#development)

---

## 1. Meta-side setup

A complete walk-through, top to bottom. If you already have a working WhatsApp
Business Cloud API setup, skip to [Install](#2-install).

### 1.1 Create a Meta Business + add the WhatsApp product

1. Open <https://business.facebook.com> and create a Business account (or use
   an existing one).
2. Open <https://developers.facebook.com/apps>, click **Create App**, choose
   **Business** as the type.
3. From the new app's dashboard, **Add product → WhatsApp → Set up**.

### 1.2 Register a phone number and grab the Phone Number ID

1. In the WhatsApp panel, go to **API setup**.
2. Either pick the test number Meta provides (only sends to phones you've added
   to the test allow-list) or add your own number and verify it.
3. Note the **Phone Number ID** (numeric, looks like `1234567890`). This is
   `META_WHATSAPP_PHONE_ID`.
4. Note the **WhatsApp Business Account ID** — you'll need it to manage
   templates.

### 1.3 Create a System User and a long-lived token

The token shown in the API-setup panel is a **personal user token** that
expires every 23 hours / 60 days. Don't use it for production.

1. Open <https://business.facebook.com/settings/system-users>.
2. **Add** → create a System User. Role: **Admin**.
3. **Add Assets** → add the WhatsApp Business Account, give the System User
   **Full control**.
4. **Generate new token** → pick the same WhatsApp app you created above.
   Scopes: `whatsapp_business_messaging` and `whatsapp_business_management`.
   Set token expiry to **Never**.
5. Copy the token. This is `META_WHATSAPP_TOKEN`. Treat it like a database
   password.

### 1.4 Get the App Secret

1. <https://developers.facebook.com/apps> → your app → **App settings → Basic**.
2. Click **Show** next to **App secret**. This is `META_WHATSAPP_APP_SECRET`.
   It's used to verify the HMAC signature on every webhook callback.

### 1.5 Create a webhook callback URL and verify token

1. Decide where Meta will POST callbacks (e.g.
   `https://api.example.com/webhook`). Must be HTTPS in production.
2. Pick a random string to act as the GET-handshake password and store it in
   `META_WHATSAPP_VERIFY_TOKEN`. (`openssl rand -hex 24` is fine.)
3. App dashboard → **WhatsApp → Configuration → Webhook → Edit**.
4. Paste the callback URL and verify token, then click **Verify and save**.
   Meta will hit your URL with `?hub.mode=subscribe&hub.verify_token=...` —
   `verifyWebhookSubscription` handles that. See
   [Webhook setup](#4-webhook-setup).
5. **Subscribe** to the `messages` field.

### 1.6 Create + submit a template

You can only send templates that Meta has **approved**.

1. <https://business.facebook.com/wa/manage/message-templates/>.
2. **Create template**. Pick a category:
   - **Authentication** — OTPs and login codes. Restricted shape.
   - **Utility** — order updates, reminders, account notifications.
   - **Marketing** — promos. Subject to stricter approval and rate-limiting.
3. Name the template, fill placeholder text (`{{1}}`, `{{2}}`, ...), submit.
4. Wait for **Approved** status (usually minutes, sometimes hours). The name
   you used here is what you pass as `templateName`.

---

## 2. Install

```bash
npm install @xtendedtechs/whatsapp-gateway
# or pnpm add / yarn add
```

Node 20 or newer is required (the package uses the built-in `fetch` and
`node:crypto`).

---

## 3. Use

The four-line happy path:

```ts
import { createWhatsAppClient } from "@xtendedtechs/whatsapp-gateway";

const wa = createWhatsAppClient({
  accessToken: process.env.META_WHATSAPP_TOKEN!,
  phoneNumberId: process.env.META_WHATSAPP_PHONE_ID!,
  appSecret: process.env.META_WHATSAPP_APP_SECRET!,
});

const result = await wa.sendTemplate({
  to: "+972501234567",
  templateName: "appointment_reminder",
  languageCode: "he",
  components: [
    {
      type: "body",
      parameters: [
        { type: "text", text: "Dana" },
        { type: "text", text: "Tomorrow 14:30" },
      ],
    },
  ],
});
// → { messageId: "wamid.HBgL...", to: "972501234567" }
```

### Phone normalization

The default normalizer accepts strict E.164 (`+972501234567`) or the digit-only
canonical form Meta wants (`972501234567`). It does **not** handle local
numbers — your app already knows its country, so do the local→international
conversion on your side and pass the result here. If you want to centralize it:

```ts
const wa = createWhatsAppClient({
  /* ... */
  normalizeRecipient: (raw) => myCountrySpecificNormalizer(raw),
});
```

### Errors

The package throws three classes:

```ts
import {
  WhatsAppApiError,
  WhatsAppSignatureError,
  WhatsAppValidationError,
  WhatsAppNetworkError,
} from "@xtendedtechs/whatsapp-gateway";
```

See [Errors and retries](#6-errors-and-retries).

### Logging

Pass any object with optional `info`/`warn`/`debug`/`error` methods. The
gateway only logs metadata: HTTP status, Meta error code, message id, and the
**last 4 digits** of the recipient. Message bodies are never logged.

```ts
const wa = createWhatsAppClient({
  /* ... */
  logger: console,
});
```

---

## 4. Webhook setup

Webhooks have two halves: a one-time GET handshake when you (re-)subscribe, and
ongoing POSTs with delivery statuses + inbound messages.

The two raw functions are:

```ts
wa.verifyWebhookSubscription({
  mode, token, challenge, expectedToken,
}); // returns string to echo back, throws on mismatch

wa.parseWebhookEvent({
  rawBody,           // Buffer | string | Uint8Array — must be raw bytes
  signatureHeader,   // value of "x-hub-signature-256"
}); // returns WebhookEvent[], throws on bad signature
```

> **Critical:** `rawBody` must be the exact bytes Meta sent. The HMAC is
> computed over those bytes. If your framework JSON-parses the body before you
> see it, signature verification will fail. Configure your framework to keep
> the raw body for the webhook route.

`WebhookEvent` is a discriminated union:

```ts
type WebhookEvent =
  | { kind: "status"; messageId; status; timestamp; recipient; errors? }
  | { kind: "inbound"; from; messageId; timestamp; text?; mediaId?; mediaType?; raw }
  | { kind: "unknown"; raw }; // forward-compat for shapes we don't recognize
```

A single Meta payload can carry multiple events (one delivery + one read +
one inbound, for example). That's why `parseWebhookEvent` returns an array.

### 4.1 Express

```ts
import express from "express";
import { createWhatsAppClient } from "@xtendedtechs/whatsapp-gateway";
import { createWebhookHandler } from "@xtendedtechs/whatsapp-gateway/http";

const wa = createWhatsAppClient({ /* ... */ });

const handler = createWebhookHandler({
  client: wa,
  verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN!,
  onEvent: async (event) => {
    // YOUR persistence / dispatch lives here
  },
});

const app = express();

// IMPORTANT: raw body for the webhook route, BEFORE express.json()
app.get("/webhook", (req, res) => handler.expressGet(req, res));
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => handler.expressPost(req, res),
);

app.use(express.json()); // for the rest of your app
```

Full file: [`examples/express-server/server.ts`](./examples/express-server/server.ts).

### 4.2 Next.js (App Router)

```ts
// app/api/webhook/route.ts
import { createWebhookHandler } from "@xtendedtechs/whatsapp-gateway/http";
import { whatsapp } from "@/lib/whatsapp";

export const runtime = "nodejs"; // required: uses node:crypto

const handler = createWebhookHandler({
  client: whatsapp(),
  verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN!,
  onEvent: async (event) => { /* ... */ },
});

export const GET  = (req: Request) => handler.fetchGet(req);
export const POST = (req: Request) => handler.fetchPost(req);
```

Full file: [`examples/nextjs-route-handler/`](./examples/nextjs-route-handler).

### 4.3 Anything else

The HTTP adapter is optional. With ~30 lines you can wire up Fastify, Hono,
Workers, etc. directly against the core API — see
[`src/http/index.ts`](./src/http/index.ts) as a reference.

---

## 5. Environment variables

| Name                          | Required | Where it comes from                                                                                                |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `META_WHATSAPP_TOKEN`         | yes      | System User token (§1.3). Long-lived. Treat as a secret.                                                           |
| `META_WHATSAPP_PHONE_ID`      | yes      | Numeric Phone Number ID (§1.2).                                                                                    |
| `META_WHATSAPP_APP_SECRET`    | yes      | App → Settings → Basic → App secret (§1.4). Used for webhook HMAC.                                                 |
| `META_WHATSAPP_VERIFY_TOKEN`  | only for receiving webhooks | A random string YOU choose (§1.5). Configured on both sides.                                       |

Variable names are conventions, not enforced — pass whatever you want into
`createWhatsAppClient`.

---

## 6. Errors and retries

| Class                       | When                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `WhatsAppValidationError`   | You passed garbage (missing template name, bad phone, body that isn't valid JSON, etc.).          |
| `WhatsAppSignatureError`    | Webhook handshake token didn't match, or POST HMAC didn't match.                                  |
| `WhatsAppApiError`          | Meta returned a non-2xx. Has `httpStatus`, `code`, `subcode`, `fbtraceId`, `isRetryable`.         |
| `WhatsAppNetworkError`      | The fetch call rejected — no HTTP response (DNS, reset, timeout). Always retryable.               |

**Retries are your job.** This package will not retry for you. The recommended
loop:

```ts
async function sendWithRetry(input, attempts = 4) {
  let delay = 500;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await wa.sendTemplate(input);
    } catch (err) {
      const retryable =
        (err instanceof WhatsAppApiError && err.isRetryable) ||
        err instanceof WhatsAppNetworkError;
      if (!retryable || i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}
```

`isRetryable` is true for: HTTP 5xx, HTTP 429, network errors, and Meta's
documented transient codes (`1`, `2`, `4`, `17`, `32`, `613`, `80007`,
`130429`, `131056`).

---

## 7. Limits and behavior

A few practical notes that bite first-timers:

- **Per-phone-number rate limits** depend on your phone-number quality tier
  (250 / 1k / 10k / 100k / unlimited unique recipients per 24h). Quality moves
  up automatically with use; it can also drop if recipients block you.
- **Template categories** matter. Marketing templates have stricter approval,
  per-user frequency caps, and require the user to have opted in.
- **24-hour customer service window**: once a user messages you, you can reply
  with free-form messages for 24 hours. Outside that window, you can only send
  approved templates.
- **Meta retries webhook POSTs** if they don't get a 2xx within ~20s. The
  bundled `expressPost` adapter sends the 200 ACK first and then dispatches
  events. If you push to a queue inside `onEvent`, keep that fast.
- **Don't log message bodies.** Default logger output is metadata-only by
  design (last-4 digits of recipient, message id, status code). Maintain that
  hygiene if you customize logging.

---

## What this package doesn't do

By design, **none** of these are in scope. If you want them, build them on
top — don't extend this package.

- ❌ A queue, scheduler, retry daemon, or cron runner.
- ❌ A persistence layer. No DB, no ORM, no migrations. You store message ids
  and statuses on your side.
- ❌ Country-specific phone normalization. Default normalizer requires E.164;
  pass `normalizeRecipient` if you want different rules.
- ❌ A multi-provider messaging abstraction. WhatsApp Cloud API only. If you
  want a Twilio fallback, wrap this package, don't extend it.
- ❌ Media upload / download helpers (yet).
- ❌ Free-form (non-template) outbound messages (yet).

---

## Future work

Things that are reasonable additions if real demand shows up — none planned:

- `wa.sendText(...)` for replies inside the 24-hour customer service window.
- `wa.uploadMedia(...)` / `wa.downloadMedia(...)` for inbound + outbound media.
- `wa.markAsRead(...)`.
- Helper for template management (create / list / delete).
- Pluggable `RetryPolicy` for callers that want a simple knob instead of
  writing their own loop.

If any of these become urgent for your use case, open an issue — but the bar
for new public API surface is high.

---

## Development

```bash
npm install
npm run typecheck
npm test         # mocked fetch, fast
npm run build    # produces dist/ (ESM + CJS + .d.ts)
```

### Integration smoke test

Set the four `*_TEST` env vars below to send a real template message to a
recipient you control. Skipped by default.

```bash
META_WHATSAPP_TOKEN_TEST=...
META_WHATSAPP_PHONE_ID_TEST=...
META_WHATSAPP_TEST_RECIPIENT=+972501234567
META_WHATSAPP_TEST_TEMPLATE=hello_world
META_WHATSAPP_TEST_LANG=en_US        # optional
npm test
```

---

## License

UNLICENSED — proprietary, internal use only. No rights granted to redistribute
or use outside the owning organization.
