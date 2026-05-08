function withApiAuthToken(url: string): string {
  try {
    if (typeof window === 'undefined') return url;
    const parsed = new URL(url, window.location.href);
    const isSameOrigin = parsed.origin === window.location.origin;
    const isApiRoute = parsed.pathname.startsWith('/api/');
    if (!isSameOrigin || !isApiRoute) return parsed.toString();
    if (parsed.searchParams.has('token')) return parsed.toString();
    const token = localStorage.getItem('authToken');
    if (!token) return parsed.toString();
    parsed.searchParams.set('token', token);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Browser-openable URL for a stored attachment path (same-origin /api proxy or absolute). */
export function resolveAttachmentHref(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl || !String(pathOrUrl).trim()) return null;
  const s = String(pathOrUrl).trim();
  if (/^https?:\/\//i.test(s)) return withApiAuthToken(s);
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
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
  if (/\.(jpe?g|png|gif|webp|bmp|svg)(\?|$|#)/i.test(s)) return true;
  if (/res\.cloudinary\.com\/.+\/image\/upload\//i.test(s)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(s);
}

export function attachmentLooksLikePdf(nameOrUrl: string | null | undefined): boolean {
  if (!nameOrUrl) return false;
  return /\.pdf(\?|$|#)/i.test(String(nameOrUrl));
}
