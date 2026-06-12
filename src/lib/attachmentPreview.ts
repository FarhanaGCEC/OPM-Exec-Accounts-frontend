import {
  attachmentFetchInit,
  attachmentLooksLikePdf,
  isCloudinaryRawUploadUrl,
  isPublicHttpsUrl,
  isSameOriginAttachmentUrl,
} from './resolveAttachmentUrl';

export type AttachmentPreviewMode = 'loading' | 'blob' | 'iframe' | 'google' | 'error';

const googleDocsViewerUrl = (fileUrl: string): string =>
  `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;

/**
 * Cloudinary `/raw/upload/` returns `application/octet-stream` — iframe shows "page not found".
 * Those URLs must be fetched and shown via a `application/pdf` blob URL instead.
 */
export function shouldEmbedAttachmentDirectly(href: string): boolean {
  if (isCloudinaryRawUploadUrl(href)) return false;
  return isSameOriginAttachmentUrl(href);
}

/** Called only after fetch fails — never returns `blob` (caller already tried that). */
export function pickAttachmentPreviewFallback(
  href: string
): Exclude<AttachmentPreviewMode, 'loading' | 'blob'> {
  if (shouldEmbedAttachmentDirectly(href)) return 'iframe';
  if (isSameOriginAttachmentUrl(href)) return 'iframe';
  if (isPublicHttpsUrl(href)) return 'google';
  return 'error';
}

export function attachmentPreviewIframeSrc(
  mode: AttachmentPreviewMode,
  href: string,
  blobUrl: string | null
): string | null {
  if (mode === 'blob' && blobUrl) return blobUrl;
  if (mode === 'iframe') return href;
  if (mode === 'google') return googleDocsViewerUrl(href);
  return null;
}

export function attachmentOpenInNewTabHref(
  href: string,
  blobUrl: string | null
): string {
  if (blobUrl) return blobUrl;
  if (isCloudinaryRawUploadUrl(href) || isSameOriginAttachmentUrl(href)) return href;
  if (attachmentLooksLikePdf(href)) return href;
  return googleDocsViewerUrl(href);
}

export async function fetchAttachmentAsPdfBlob(
  href: string,
  signal?: AbortSignal
): Promise<Blob> {
  const { credentials, headers } = attachmentFetchInit(href);
  const response = await fetch(href, { credentials, headers, signal });
  if (!response.ok) {
    throw new Error(`Failed to load file (HTTP ${response.status})`);
  }
  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Empty file');
  }
  const type = (blob.type || '').toLowerCase();
  if (type === 'application/pdf') return blob;
  // Cloudinary raw PDFs are often `application/octet-stream` — force PDF MIME for iframe preview.
  if (
    isCloudinaryRawUploadUrl(href) ||
    type === 'application/octet-stream' ||
    type === '' ||
    attachmentLooksLikePdf(href)
  ) {
    return new Blob([blob], { type: 'application/pdf' });
  }
  return blob;
}
