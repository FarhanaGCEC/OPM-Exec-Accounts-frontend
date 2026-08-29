/**
 * Browser API base: same-origin `/api` (Vite dev proxy or Vercel rewrite).
 * Never use raw `http://server-ip` in the browser on HTTPS — mixed-content block.
 */
export function resolveApiBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
  const fallback = '/api';

  if (!fromEnv) {
    return fallback;
  }

  // Relative path — always safe (proxied).
  if (!/^https?:\/\//i.test(fromEnv)) {
    return fromEnv.replace(/\/$/, '') || fallback;
  }

  // Production HTTPS page + HTTP API URL in env → force same-origin proxy.
  if (
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//i.test(fromEnv)
  ) {
    return fallback;
  }

  return fromEnv.replace(/\/$/, '');
}
