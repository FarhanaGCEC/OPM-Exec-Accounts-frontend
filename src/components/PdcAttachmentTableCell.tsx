import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import {
  attachmentLooksLikeImage,
  attachmentLooksLikePdf,
  resolveAttachmentHref,
} from '../lib/resolveAttachmentUrl';

const googleDocsViewerUrl = (fileUrl: string): string =>
  `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;

function isPublicHttpsUrl(href: string): boolean {
  try {
    const u = new URL(href, typeof window !== 'undefined' ? window.location.href : undefined);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface PdcAttachmentTableCellProps {
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  variant?: 'default' | 'onDark';
  /** When true, render nothing if there is no attachment URL (no “—” placeholder). */
  hideIfMissing?: boolean;
  /** Opens the same edit flow as the row’s Edit action. */
  onEditClick?: () => void;
}

export function PdcAttachmentTableCell({
  attachmentUrl,
  attachmentName,
  variant = 'default',
  hideIfMissing = false,
  onEditClick,
}: PdcAttachmentTableCellProps) {
  const [open, setOpen] = useState(false);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const href = resolveAttachmentHref(attachmentUrl);
  const textClass = variant === 'onDark' ? 'text-white' : 'text-gray-700';
  const isProbablyImage = attachmentLooksLikeImage(
    attachmentName || attachmentUrl || ''
  );
  const isProbablyPdf = attachmentLooksLikePdf(attachmentName || attachmentUrl || '');
  const previewHref = !isProbablyImage && href ? googleDocsViewerUrl(href) : href;
  const pdfEmbedHref = pdfObjectUrl || previewHref || href;
  const label = attachmentName?.trim() || 'Cheque attachment';

  useEffect(() => {
    if (!open || !isProbablyPdf || !href) return;
    let active = true;
    let nextObjectUrl: string | null = null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    const loadPdf = async () => {
      setPdfLoading(true);
      setPdfError(null);
      try {
        const headers: HeadersInit = {};
        let credentials: RequestCredentials = 'omit';
        try {
          const token = localStorage.getItem('authToken');
          const u = new URL(href, window.location.href);
          if (u.origin === window.location.origin) {
            credentials = 'include';
            if (token) headers.Authorization = `Bearer ${token}`;
          }
        } catch {
          // Ignore URL parsing errors and use defaults.
        }

        const response = await fetch(href, {
          credentials,
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to load PDF (${response.status})`);
        }
        const blob = await response.blob();
        if (!blob || blob.size === 0) {
          throw new Error('Empty PDF file');
        }
        const typed =
          blob.type === 'application/pdf'
            ? blob
            : new Blob([blob], { type: 'application/pdf' });
        nextObjectUrl = URL.createObjectURL(typed);
        if (!active) return;
        setPdfObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextObjectUrl;
        });
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : 'Unable to preview this PDF.';
        setPdfError(message);
        setPdfObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      } finally {
        if (active) setPdfLoading(false);
      }
    };

    loadPdf();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [open, isProbablyPdf, href]);

  if (!href) {
    if (hideIfMissing) return null;
    return <span className={`text-sm ${textClass}`}>—</span>;
  }

  const btnClass =
    variant === 'onDark'
      ? 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/40 bg-white/10 text-white hover:bg-white/20 transition-colors'
      : 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-[#fef9e8] hover:border-[#f7c46d] transition-colors';

  const handleEdit = () => {
    setOpen(false);
    onEditClick?.();
  };

  return (
    <>
      <button
        type="button"
        className={btnClass}
        title={label}
        aria-label={`View attachment: ${label}`}
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto gap-4">
          <DialogHeader>
            <DialogTitle className="pr-8 truncate text-base">{label}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-[200px] items-center justify-center rounded-md border border-gray-100 bg-gray-50 p-2">
            {isProbablyImage ? (
              <img
                src={href}
                alt=""
                className="max-h-[70vh] w-full object-contain"
              />
            ) : isProbablyPdf ? (
              pdfLoading ? (
                <p className="text-sm text-gray-600">Loading PDF preview...</p>
              ) : pdfError ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-red-600">{pdfError}</p>
                  <a
                    href={isPublicHttpsUrl(href) ? previewHref || href : href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#c9a82f] underline text-sm"
                  >
                    Open PDF in new tab
                  </a>
                </div>
              ) : (
                <iframe
                  src={pdfEmbedHref ?? undefined}
                  title={label}
                  className="h-[70vh] w-full rounded-md border-0 bg-white"
                />
              )
            ) : (
              <a
                href={previewHref || href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#c9a82f] underline text-sm"
              >
                Open file in new tab
              </a>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            {onEditClick && (
              <Button
                type="button"
                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                onClick={handleEdit}
              >
                Edit
              </Button>
            )}
            <Button variant="outline" className="text-black" asChild>
              <a
                href={pdfObjectUrl || href || previewHref || undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in new tab
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
