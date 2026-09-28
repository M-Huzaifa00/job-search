import type { SourceHttp } from '../../http/client.ts';
import { SourceError } from '../../http/errors.ts';
import { isIndeedUrl, isPublicHttpUrl, tryParseUrl } from '../../core/normalization/url.ts';

export interface ResolvedUrl {
  finalUrl: string;
  chain: string[];
  status: number;
  viaIndeed: boolean;
  /** Body of the final page (only when requested). */
  html?: string;
}

/**
 * Follows a redirect chain hop by hop so every intermediate URL can be checked:
 * public http(s) only (SSRF guard) and any Indeed hop marks the listing as Indeed-routed.
 * Also follows simple `<meta http-equiv="refresh">` and `window.location` redirects.
 */
export async function resolveRedirects(http: SourceHttp, url: string, opts: { maxHops?: number; readFinalBody?: boolean; signal?: AbortSignal } = {}): Promise<ResolvedUrl> {
  const chain: string[] = [];
  let current = url;
  const maxHops = opts.maxHops ?? 6;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isPublicHttpUrl(current)) throw new SourceError('HTTP_ERROR', `refusing to follow non-public URL`, { url: current });
    chain.push(current);
    if (isIndeedUrl(current)) return { finalUrl: current, chain, status: 0, viaIndeed: true };
    const res = await http.request(current, {
      redirect: 'manual',
      acceptStatuses: [200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 404, 410],
      skipBody: false,
      retries: 1,
      signal: opts.signal,
      skipBlockDetection: true,
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = tryParseUrl(location, current);
      if (!next) break;
      current = next.toString();
      continue;
    }
    // Client-side redirects used by click trackers.
    const meta = res.text.slice(0, 20_000).match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*\d+\s*;\s*url=['"]?([^"'>\s]+)/i);
    const js = res.text.slice(0, 20_000).match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
    const target = meta?.[1] ?? js?.[1];
    if (res.status === 200 && target && hop < maxHops && res.text.length < 20_000) {
      const next = tryParseUrl(target.replace(/&amp;/g, '&'), current);
      if (next) {
        current = next.toString();
        continue;
      }
    }
    return { finalUrl: current, chain, status: res.status, viaIndeed: chain.some((u) => isIndeedUrl(u)), html: opts.readFinalBody ? res.text : undefined };
  }
  return { finalUrl: current, chain, status: 0, viaIndeed: chain.some((u) => isIndeedUrl(u)) };
}
