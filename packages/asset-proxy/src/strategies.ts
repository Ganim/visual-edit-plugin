import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export type RemoteImageStrategy = 'placeholder' | 'pass-through' | 'cached';

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
  const upstream = await fetch(ctx.url);
  const body = new Uint8Array(await upstream.arrayBuffer());
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
    body,
  };
}

export async function cached(ctx: StrategyContext): Promise<StrategyResponse> {
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
