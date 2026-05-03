import {
  WhatsAppApiError,
  WhatsAppNetworkError,
  type MetaApiErrorPayload,
} from "./errors.js";
import type { FetchLike, Logger } from "./types.js";

export type GraphRequestArgs = {
  method: "GET" | "POST" | "DELETE";
  /** Path beneath the version base, e.g. `/${phoneNumberId}/messages`. */
  path: string;
  body?: unknown;
  query?: Record<string, string>;
};

export type GraphClient = {
  request: <T>(args: GraphRequestArgs) => Promise<T>;
};

/**
 * Internal wrapper around `https://graph.facebook.com/<version>`. Adds the
 * bearer token, JSON-serializes bodies, and converts non-2xx responses into
 * typed errors. Keeps logger output to metadata only — never the request body
 * or response body — to avoid leaking PII.
 */
export function createGraphClient(args: {
  accessToken: string;
  graphApiVersion: string;
  fetch: FetchLike;
  logger: Logger;
}): GraphClient {
  const { accessToken, graphApiVersion, fetch, logger } = args;
  const base = `https://graph.facebook.com/${graphApiVersion}`;

  return {
    async request<T>(req: GraphRequestArgs): Promise<T> {
      const url = new URL(base + req.path);
      if (req.query) {
        for (const [k, v] of Object.entries(req.query)) {
          url.searchParams.set(k, v);
        }
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      if (req.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const init: RequestInit = {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      };

      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        logger.warn?.("[whatsapp-gateway] network error", {
          method: req.method,
          path: req.path,
        });
        throw new WhatsAppNetworkError(
          `Network error calling Graph API: ${(err as Error)?.message ?? "unknown"}`,
          err,
        );
      }

      const text = await res.text();
      let parsed: unknown = undefined;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          // leave parsed undefined; we'll surface the raw text on error
        }
      }

      if (!res.ok) {
        const errPayload = extractMetaError(parsed);
        logger.warn?.("[whatsapp-gateway] graph api error", {
          method: req.method,
          path: req.path,
          httpStatus: res.status,
          code: errPayload?.code,
          subcode: errPayload?.error_subcode,
        });
        throw new WhatsAppApiError({
          httpStatus: res.status,
          payload: errPayload,
          raw: parsed ?? text,
        });
      }

      return parsed as T;
    },
  };
}

function extractMetaError(parsed: unknown): MetaApiErrorPayload | undefined {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const e = (parsed as { error: unknown }).error;
    if (e && typeof e === "object") {
      return e as MetaApiErrorPayload;
    }
  }
  return undefined;
}
