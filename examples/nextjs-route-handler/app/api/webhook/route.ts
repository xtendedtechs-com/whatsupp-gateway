/**
 * Next.js App Router webhook route. Drop into `app/api/webhook/route.ts`.
 * `runtime: "nodejs"` is required because we use node:crypto under the hood.
 */
import { createWebhookHandler } from "@xtendedtechs/whatsapp-gateway/http";
import { whatsapp } from "@/lib/whatsapp";

export const runtime = "nodejs";

const handler = createWebhookHandler({
  client: whatsapp(),
  verifyToken: process.env["META_WHATSAPP_VERIFY_TOKEN"]!,
  onEvent: async (event) => {
    // TODO: persist + dispatch on your side
    console.log("event:", event.kind, event);
  },
});

export async function GET(req: Request) {
  return handler.fetchGet(req);
}

export async function POST(req: Request) {
  return handler.fetchPost(req);
}
