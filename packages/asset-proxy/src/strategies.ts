import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export type RemoteImageStrategy = 'placeholder' | 'pass-through' | 'cached';

/**
 * Guard against SSRF — blocks private/loopback/link-local addresses.
 * Only http: and https: are allowed.
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Strip brackets from IPv6 hostname (URL.hostname returns "[::1]" with brackets).
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    // IPv6 unique local addresses (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return false;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return false;
    // IPv4-mapped loopback (::ffff:127.0.0.1).
    if (/^::ffff:7f[0-9a-f]{2}:/.test(host)) return false;
    return true;
  } catch { return false; }
}

const BLOCKED_RESPONSE: StrategyResponse = {
  status: 403,
  contentType: 'text/plain',
  body: 'asset-proxy: blocked unsafe URL',
};

export interface StrategyContext {
  url: string;                           // the full external URL (after URL-decode)
  cache: Map<string, CachedAsset>;       // shared cache for 'cached' strategy
}

export interface CachedAsset {
  body: Uint8Array;
  contentType: string;
}

export interface StrategyResponse {
  status: number;
  contentType: string;
  body: Uint8Array | string;             // string = inline SVG/text; Uint8Array = binary
}

const PLACEHOLDER_SVG = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ccc" fill-opacity="0.3"/></svg>`;

export async function placeholder(): Promise<StrategyResponse> {
  return {
    status: 200,
    contentType: 'image/svg+xml',
    body: PLACEHOLDER_SVG,
  };
}

export async function passThrough(ctx: StrategyContext): Promise<StrategyResponse> {
  if (!isSafeUrl(ctx.url)) return BLOCKED_RESPONSE;
  const upstream = await fetch(ctx.url);
  const body = new Uint8Array(await upstream.arrayBuffer());
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
    body,
  };
}

export async function cached(ctx: StrategyContext): Promise<StrategyResponse> {
  if (!isSafeUrl(ctx.url)) return BLOCKED_RESPONSE;
  const hit = ctx.cache.get(ctx.url);
  if (hit) return { status: 200, contentType: hit.contentType, body: hit.body };
  const upstream = await fetch(ctx.url);
  const body = new Uint8Array(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (upstream.status === 200) ctx.cache.set(ctx.url, { body, contentType });
  return { status: upstream.status, contentType, body };
}

export function dispatchStrategy(name: RemoteImageStrategy, ctx: StrategyContext): Promise<StrategyResponse> {
  if (name === 'placeholder') return placeholder();
  if (name === 'pass-through') return passThrough(ctx);
  if (name === 'cached') return cached(ctx);
  const _exhaustive: never = name;
  return Promise.reject(new VisualEditError(makeEnvelope({
    code: CODES.VE_ASSET_001_UNKNOWN_STRATEGY,
    message: `[VE_ASSET_001]: unknown asset strategy: ${String(_exhaustive)}`,
    severity: 'error',
    recovery: 'user-action',
    blame: 'user-config',
  })));
}
