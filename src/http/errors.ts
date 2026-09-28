export const ERROR_CATEGORIES = [
  'NETWORK_ERROR',
  'RATE_LIMITED',
  'BLOCKED',
  'PARSING_ERROR',
  'AUTH_REQUIRED',
  'UNSUPPORTED',
  'TIMEOUT',
  'HTTP_ERROR',
  'NOT_FOUND',
  'ABORTED',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export class SourceError extends Error {
  readonly category: ErrorCategory;
  readonly status?: number;
  readonly url?: string;
  readonly retryAfterMs?: number;

  constructor(category: ErrorCategory, message: string, opts: { status?: number; url?: string; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'SourceError';
    this.category = category;
    this.status = opts.status;
    this.url = opts.url;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function toSourceError(err: unknown): SourceError {
  if (err instanceof SourceError) return err;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return new SourceError('ABORTED', 'request aborted', { cause: err });
    if (err.name === 'TimeoutError') return new SourceError('TIMEOUT', 'request timed out', { cause: err });
    return new SourceError('NETWORK_ERROR', err.message, { cause: err });
  }
  return new SourceError('NETWORK_ERROR', String(err));
}

/** Errors that mean "stop calling this source for the rest of the run". */
export function isFatalForSource(err: SourceError): boolean {
  return err.category === 'BLOCKED' || err.category === 'AUTH_REQUIRED' || err.category === 'UNSUPPORTED';
}

/**
 * Recognises bot-protection / challenge responses. We never try to solve or evade these;
 * recognising them lets us classify the source as BLOCKED instead of mis-parsing an interstitial.
 */
export function detectBlockPage(status: number, headers: Headers, body: string): string | null {
  const head = body.slice(0, 20_000);
  if (headers.get('cf-mitigated') === 'challenge') return 'Cloudflare challenge (cf-mitigated)';
  if (/captcha-delivery\.com|datadome/i.test(head) && status >= 400) return 'DataDome CAPTCHA';
  if (/<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(head)) return 'Cloudflare managed challenge';
  if (/<title>\s*Attention Required! \| Cloudflare\s*<\/title>/i.test(head)) return 'Cloudflare block page';
  if (/challenges\.cloudflare\.com\/turnstile|turnstileLoad\s*=/i.test(head)) return 'Cloudflare Turnstile challenge';
  if (/px-captcha|perimeterx/i.test(head) && status >= 400) return 'PerimeterX CAPTCHA';
  if (/<title>\s*Security \| Glassdoor\s*<\/title>/i.test(head)) return 'Glassdoor security check';
  if (/<title[^>]*>\s*Security Check - Indeed\.com\s*<\/title>/i.test(head)) return 'Indeed security check';
  if (/<title[^>]*>\s*Security check \| Jobright\s*<\/title>/i.test(head)) return 'JobRight security check';
  if (/<title>\s*Access Denied\s*<\/title>/i.test(head) && /edgesuite(\.|&#46;)net/i.test(head)) return 'Akamai edge block (Access Denied)';
  if (status === 999) return 'Request denied by anti-bot system (HTTP 999)';
  return null;
}
