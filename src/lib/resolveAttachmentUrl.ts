/** Browser-openable URL for a stored attachment path (same-origin /api proxy or absolute). */
export function resolveAttachmentHref(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl || !String(pathOrUrl).trim()) return null;
  const s = String(pathOrUrl).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  const path = s.startsWith('/') ? s : `/${s}`;
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return `${base.replace(/\/$/, '')}${path}`;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${base.replace(/\/$/, '')}${path}`;
  }
  return path;
}

export function attachmentLooksLikeImage(nameOrUrl: string | null | undefined): boolean {
  if (!nameOrUrl) return false;
  const s = String(nameOrUrl);
  if (/\.(jpe?g|png|gif|webp|bmp|svg)(\?|$|#)/i.test(s)) return true;
  if (/res\.cloudinary\.com\/.+\/image\/upload\//i.test(s)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(s);
}
