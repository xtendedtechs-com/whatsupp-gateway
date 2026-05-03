/**
 * Error classes exposed by the gateway.
 *
 * Meta error code reference:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export class WhatsAppValidationError extends Error {
  override readonly name = "WhatsAppValidationError";
  constructor(message: string) {
    super(message);
  }
}

export class WhatsAppSignatureError extends Error {
  override readonly name = "WhatsAppSignatureError";
  constructor(message = "Webhook signature verification failed") {
    super(message);
  }
}

export type MetaApiErrorPayload = {
  message: string;
  code: number;
  error_subcode?: number;
  type?: string;
  fbtrace_id?: string;
  error_data?: unknown;
};

/**
 * Thrown for any non-2xx response from Meta's Graph API. Wraps the parsed
 * `error` object so callers can branch on `code`/`subcode`.
 */
export class WhatsAppApiError extends Error {
  override readonly name = "WhatsAppApiError";
  readonly httpStatus: number;
  readonly code: number;
  readonly subcode: number | undefined;
  readonly type: string | undefined;
  readonly fbtraceId: string | undefined;
  /** The raw response body (parsed JSON if possible, otherwise the text). */
  readonly raw: unknown;

  constructor(args: {
    httpStatus: number;
    payload: MetaApiErrorPayload | undefined;
    raw: unknown;
  }) {
    const msg =
      args.payload?.message ??
      `WhatsApp API request failed with HTTP ${args.httpStatus}`;
    super(msg);
    this.httpStatus = args.httpStatus;
    this.code = args.payload?.code ?? 0;
    this.subcode = args.payload?.error_subcode;
    this.type = args.payload?.type;
    this.fbtraceId = args.payload?.fbtrace_id;
    this.raw = args.raw;
  }

  /**
   * True for transient failures the caller can safely retry with backoff:
   * 5xx, 429, network errors, and Meta's documented transient error codes.
   * Non-retryable: 4xx with a permanent code (bad template, bad recipient,
   * unauthenticated, account suspended, etc.).
   */
  get isRetryable(): boolean {
    if (this.httpStatus >= 500) return true;
    if (this.httpStatus === 429) return true;
    // Documented transient Meta codes.
    const transient = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131056]);
    return transient.has(this.code);
  }
}

/**
 * Thrown when the underlying fetch call rejects (DNS, connection reset, etc.)
 * — i.e., we never got an HTTP response back.
 */
export class WhatsAppNetworkError extends Error {
  override readonly name = "WhatsAppNetworkError";
  override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
  get isRetryable(): boolean {
    return true;
  }
}
