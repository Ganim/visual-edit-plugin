const REMOTE_RX = /^https?:\/\//i;

/**
 * Rewrite a remote-image URL to go through the asset proxy. Local paths and data: URLs
 * are returned as-is.
 *
 * Note: this is a string-level rewriter. CSS `background-image: url(...)` is NOT rewritten
 * in 1.E (deferred to 1.F because it requires CSS parsing).
 */
export function rewriteImageUrl(url: string, proxyBase = '/__assets/proxy'): string {
  if (!url || !REMOTE_RX.test(url)) return url;
  return `${proxyBase}?u=${encodeURIComponent(url)}`;
}

/** Rewrite a srcset's comma-separated `<url> <descriptor>` pairs. */
export function rewriteSrcSet(srcset: string, proxyBase = '/__assets/proxy'): string {
  return srcset
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return '';
      const parts = trimmed.split(/\s+/);
      const url = parts[0]!;
      const descriptor = parts.slice(1).join(' ');
      const newUrl = rewriteImageUrl(url, proxyBase);
      return descriptor ? `${newUrl} ${descriptor}` : newUrl;
    })
    .filter((s) => s.length > 0)
    .join(', ');
}
