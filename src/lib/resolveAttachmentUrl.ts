import { resolveApiBaseUrl } from './apiBaseUrl';

function apiBaseOrigin(): string | null {
  const base = resolveApiBaseUrl();
  if (!/^https?:\/\//i.test(base)) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * Backend may store `http://server-ip/api/...` while the app is served over HTTPS via `/api` proxy.
 * Browsers block mixed-content fetch/iframe to raw HTTP — rewrite to same-origin `/api/...`.
 */
function rewriteHttpApiToSameOriginProxy(url: string): string {
  if (typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'http:' || !parsed.pathname.startsWith('/api/')) {
      return url;
    }
    const pageOrigin = window.location.origin;
    if (parsed.origin === pageOrigin) return url;
    return `${pageOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function shouldAttachApiAuthToken(parsed: URL): boolean {
  if (!parsed.pathname.startsWith('/api/')) return false;
  if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return true;
  const apiOrigin = apiBaseOrigin();
  return Boolean(apiOrigin && parsed.origin === apiOrigin);
}

function withApiAuthToken(url: string): string {
  try {
    if (typeof window === 'undefined') return url;
    const rewritten = rewriteHttpApiToSameOriginProxy(url);
    const parsed = new URL(rewritten, window.location.href);
    if (!shouldAttachApiAuthToken(parsed)) return parsed.toString();
    if (parsed.searchParams.has('token')) return parsed.toString();
    const token = localStorage.getItem('authToken');
    if (!token) return parsed.toString();
    parsed.searchParams.set('token', token);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Headers/credentials for authenticated attachment fetch (iframe cannot send Authorization). */
export function attachmentFetchInit(href: string): {
  credentials: RequestCredentials;
  headers: HeadersInit;
} {
  const headers: HeadersInit = {};
  let credentials: RequestCredentials = 'omit';
  try {
    if (typeof window === 'undefined') return { credentials, headers };
    const token = localStorage.getItem('authToken');
    const u = new URL(href, window.location.href);
    const needsAuth =
      shouldAttachApiAuthToken(u) ||
      (typeof window !== 'undefined' && u.origin === window.location.origin);
    if (needsAuth) {
      credentials = 'include';
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    /* ignore */
  }
  return { credentials, headers };
}

export function isPublicHttpsUrl(href: string): boolean {
  try {
    const u = new URL(href, typeof window !== 'undefined' ? window.location.href : undefined);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSameOriginAttachmentUrl(href: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const u = new URL(href, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Browser-openable URL for a stored attachment path (same-origin /api proxy or absolute). */
export function resolveAttachmentHref(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl || !String(pathOrUrl).trim()) return null;
  let s = String(pathOrUrl).trim();
  if (/^https?:\/\//i.test(s)) {
    s = rewriteHttpApiToSameOriginProxy(s);
    return withApiAuthToken(s);
  }
  const base = resolveApiBaseUrl();
  const path = s.startsWith('/') ? s : `/${s}`;
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return withApiAuthToken(`${base.replace(/\/$/, '')}${path}`);
  }
  if (typeof window !== 'undefined') {
    return withApiAuthToken(`${window.location.origin}${base.replace(/\/$/, '')}${path}`);
  }
  return withApiAuthToken(path);
}

export function attachmentLooksLikeImage(nameOrUrl: string | null | undefined): boolean {
  if (!nameOrUrl) return false;
  const s = String(nameOrUrl);
  if (/\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)(\?|$|#)/i.test(s)) return true;
  if (/res\.cloudinary\.com\/.+\/image\/upload\//i.test(s)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/i.test(s);
}

/** Cloudinary statement PDFs use `/raw/upload/` and often have no `.pdf` suffix in the URL. */
export function isCloudinaryRawUploadUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /res\.cloudinary\.com\/.+\/raw\/upload\//i.test(String(url));
}

export function attachmentLooksLikePdf(nameOrUrl: string | null | undefined): boolean {
  if (!nameOrUrl) return false;
  const s = String(nameOrUrl);
  if (/\.pdf(\?|$|#)/i.test(s)) return true;
  return isCloudinaryRawUploadUrl(s);
}
