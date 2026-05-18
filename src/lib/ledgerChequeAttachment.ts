/** Cheque scan rules for Daily Transaction ledger rows. */
export const LEDGER_CHEQUE_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i;

export type LedgerChequeAttachmentMeta = {
  name: string | null;
  url: string | null;
  cloudinaryUrl: string | null;
  type: string | null;
  mimeType: string | null;
};

export function validateLedgerChequeAttachmentFile(file: File): string | null {
  if (!file || file.size === 0) return null;
  if (file.size > LEDGER_CHEQUE_ATTACHMENT_MAX_BYTES) {
    return 'File must be 15 MB or smaller.';
  }
  const name = file.name.trim();
  const mime = (file.type || '').toLowerCase();
  const okMime =
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime === 'image/heic' ||
    mime === 'image/heif';
  const okExt = ALLOWED_EXTENSIONS.test(name);
  if (!okMime && !okExt) {
    return 'Use JPG, PNG, WEBP, GIF, HEIC, or PDF.';
  }
  return null;
}

import {
  attachmentLooksLikeImage,
  attachmentLooksLikePdf,
} from './resolveAttachmentUrl';

/** Prefer Cloudinary for images; same-origin API path for PDFs. */
export function pickLedgerAttachmentDisplayUrl(meta: LedgerChequeAttachmentMeta): string | null {
  const nameOrPath = meta.name || meta.url || meta.cloudinaryUrl || meta.type || '';
  if (attachmentLooksLikePdf(nameOrPath) || meta.type?.toLowerCase() === 'pdf') {
    return meta.url?.trim() || meta.cloudinaryUrl?.trim() || null;
  }
  if (attachmentLooksLikeImage(nameOrPath)) {
    return meta.cloudinaryUrl?.trim() || meta.url?.trim() || null;
  }
  const cloud = meta.cloudinaryUrl?.trim();
  const api = meta.url?.trim();
  if (cloud) return cloud;
  return api || null;
}

/** Resolve browser-openable attachment URL (caller adds ?token= via resolveAttachmentHref). */
export function ledgerAttachmentViewUrl(
  meta: LedgerChequeAttachmentMeta | null | undefined
): string | null {
  if (!meta) return null;
  return pickLedgerAttachmentDisplayUrl(meta);
}

export function mapLedgerChequeAttachmentFromRow(
  row: Record<string, unknown>
): LedgerChequeAttachmentMeta {
  const nested =
    row.attachment && typeof row.attachment === 'object' && !Array.isArray(row.attachment)
      ? (row.attachment as Record<string, unknown>)
      : null;

  const nameRaw =
    nested?.name ??
    row.attachment_name ??
    row.attachmentName ??
    null;
  const urlRaw =
    nested?.url ??
    nested?.attachmentUrl ??
    nested?.attachment_url ??
    row.attachment_url ??
    row.attachmentUrl ??
    null;
  const cloudRaw =
    nested?.cloudinaryUrl ??
    nested?.cloudinary_url ??
    row.cloudinary_url ??
    row.cloudinaryUrl ??
    null;
  const typeRaw = nested?.type ?? row.attachment_type ?? null;
  const mimeRaw = nested?.mimeType ?? nested?.mime_type ?? row.attachment_mime_type ?? null;

  const name = nameRaw != null && String(nameRaw).trim() ? String(nameRaw).trim() : null;
  const url = urlRaw != null && String(urlRaw).trim() ? String(urlRaw).trim() : null;
  const cloudinaryUrl =
    cloudRaw != null && String(cloudRaw).trim() ? String(cloudRaw).trim() : null;

  return {
    name,
    url,
    cloudinaryUrl,
    type: typeRaw != null ? String(typeRaw) : null,
    mimeType: mimeRaw != null ? String(mimeRaw) : null,
  };
}

export function isChequePaymentType(paymentType: string | null | undefined): boolean {
  const p = String(paymentType ?? '')
    .trim()
    .toLowerCase();
  return p === 'cheque';
}
