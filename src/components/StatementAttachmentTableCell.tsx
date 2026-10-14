import { useState, useEffect, useRef } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { CreditCardStatement } from '../services/creditCardService';
import { resolveStatementAttachmentHref } from '../services/creditCardService';
import {
  attachmentOpenInNewTabHref,
  attachmentPreviewIframeSrc,
  fetchAttachmentAsPdfBlob,
  pickAttachmentPreviewFallback,
  shouldEmbedAttachmentDirectly,
  type AttachmentPreviewMode,
} from '../lib/attachmentPreview';
import { attachmentLooksLikeImage } from '../lib/resolveAttachmentUrl';

/** Hover tooltip from statements API `available_limit` (not from PDF). */
export function formatAvailableLimitTooltip(
  availableLimit: string | null | undefined
): string {
  if (availableLimit == null || String(availableLimit).trim() === '') {
    return 'Available Limit: N/A';
  }
  const n = parseFloat(String(availableLimit).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) {
    return 'Available Limit: N/A';
  }
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Available Limit: ${formatted}`;
}

export interface StatementAttachmentTableCellProps {
  card: CreditCardStatement;
  isEditing: boolean;
  statementAttachmentFile: File | null;
  onAttachmentFileChange: (file: File | null) => void;
  /** Active row file input — read on save if React state lags behind the picker. */
  attachmentInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Remove stored PDF via DELETE /statements/:id/attachment (when provided). */
  onDeleteAttachment?: () => void;
  deleteAttachmentBusy?: boolean;
  onEditClick?: () => void;
}

function useStatementPdfPreview(
  open: boolean,
  href: string | null,
  showImage: boolean
): { mode: AttachmentPreviewMode; blobUrl: string | null } {
  const [mode, setMode] = useState<AttachmentPreviewMode>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !href) {
      setMode('loading');
      setBlobUrl(null);
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      return;
    }

    if (showImage) {
      setMode('blob');
      setBlobUrl(null);
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      return;
    }

    if (shouldEmbedAttachmentDirectly(href)) {
      setMode('iframe');
      setBlobUrl(null);
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setMode('loading');
    setBlobUrl(null);
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    void fetchAttachmentAsPdfBlob(href, controller.signal)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
        setMode('blob');
      })
      .catch(() => {
        if (cancelled) return;
        setMode(pickAttachmentPreviewFallback(href));
        setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [open, href, showImage]);

  return { mode, blobUrl };
}

function AttachmentPreviewDialog({
  open,
  onOpenChange,
  label,
  href,
  showImage,
  mode,
  iframeSrc,
  openTabHref,
  onEditClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  href: string;
  showImage: boolean;
  mode: AttachmentPreviewMode;
  iframeSrc: string | null;
  openTabHref: string | null;
  onEditClick?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto gap-4">
        <DialogHeader>
          <DialogTitle className="pr-8 truncate text-base">{label}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[50vh] flex-col rounded-md border border-gray-100 bg-gray-50 overflow-hidden">
          {showImage ? (
            <img
              src={href}
              alt=""
              className="max-h-[75vh] w-full object-contain bg-white"
            />
          ) : mode === 'loading' ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-600">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          ) : mode === 'error' ? (
            <p className="text-sm text-gray-600 px-4 py-8 text-center">
              Preview could not be loaded. Use &quot;Open in new tab&quot; to view or download
              the file.
            </p>
          ) : iframeSrc ? (
            <iframe
              title={label}
              src={iframeSrc}
              className="w-full min-h-[75vh] border-0 bg-white"
            />
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {onEditClick ? (
            <Button
              type="button"
              className="bg-[#a8061d] hover:bg-[#6b0210] text-black"
              onClick={() => {
                onOpenChange(false);
                onEditClick();
              }}
            >
              Edit
            </Button>
          ) : null}
          <Button variant="outline" className="text-black" asChild>
            <a href={openTabHref ?? href} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StatementAttachmentTableCell({
  card,
  isEditing,
  statementAttachmentFile,
  onAttachmentFileChange,
  onDeleteAttachment,
  deleteAttachmentBusy = false,
  onEditClick,
  attachmentInputRef,
}: StatementAttachmentTableCellProps) {
  const [open, setOpen] = useState(false);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = attachmentInputRef ?? localInputRef;
  const href = resolveStatementAttachmentHref(card.attachmentUrl);
  const label = card.attachmentName?.trim() || 'Statement attachment';
  const showImage = attachmentLooksLikeImage(
    card.attachmentName || card.attachmentUrl || ''
  );
  const { mode, blobUrl } = useStatementPdfPreview(open, href, showImage);
  const iframeSrc = href ? attachmentPreviewIframeSrc(mode, href, blobUrl) : null;
  const openTabHref = href ? attachmentOpenInNewTabHref(href, blobUrl) : null;

  if (isEditing) {
    const hasStored =
      Boolean(card.attachmentName?.trim()) || Boolean(card.attachmentUrl?.trim());
    const displayName = statementAttachmentFile
      ? statementAttachmentFile.name
      : hasStored
        ? card.attachmentName?.trim() || 'Current file'
        : null;

    return (
      <div
        className="inline-flex items-center gap-1 pt-1 pr-1"
        title={
          displayName
            ? `Attachment: ${displayName}`
            : 'Attachment (PDF or image)'
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          data-statement-attachment-input
          accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => onAttachmentFileChange(e.target.files?.[0] ?? null)}
        />

        {hasStored ? (
          <div className="relative inline-flex shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0 text-gray-700 hover:bg-[#d90522]/15"
              title={href ? `View: ${label}` : displayName || 'Current file'}
              aria-label={href ? `View attachment: ${label}` : 'Current attachment'}
              onClick={() => {
                if (href) setOpen(true);
              }}
              disabled={!href}
            >
              <FileText className="h-4 w-4" />
            </Button>
            {onDeleteAttachment ? (
              <button
                type="button"
                disabled={deleteAttachmentBusy}
                title="Remove attachment"
                aria-label="Remove attachment"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDeleteAttachment();
                }}
                className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow-sm hover:bg-red-600 disabled:opacity-50"
              >
                {deleteAttachmentBusy ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <X className="h-2.5 w-2.5" strokeWidth={3} />
                )}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="relative inline-flex shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`h-8 w-8 p-0 hover:bg-[#d90522]/15 ${
              statementAttachmentFile ? 'text-green-700' : 'text-gray-700'
            }`}
            title={
              statementAttachmentFile
                ? `Replace: ${statementAttachmentFile.name}`
                : 'Choose PDF or image'
            }
            aria-label="Choose attachment"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
          </Button>
          {statementAttachmentFile ? (
            <button
              type="button"
              title="Clear selected file"
              aria-label="Clear selected file"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAttachmentFileChange(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow-sm hover:bg-red-600"
            >
              <X className="h-2.5 w-2.5" strokeWidth={3} />
            </button>
          ) : null}
        </div>

        {hasStored && href ? (
          <AttachmentPreviewDialog
            open={open}
            onOpenChange={setOpen}
            label={label}
            href={href}
            showImage={showImage}
            mode={mode}
            iframeSrc={iframeSrc}
            openTabHref={openTabHref}
          />
        ) : null}
      </div>
    );
  }

  if (href) {
    const availableLimitTitle = formatAvailableLimitTooltip(card.availableLimit);

    return (
      <>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-[#fde8eb] hover:border-[#a8061d] transition-colors"
          title={availableLimitTitle}
          aria-label={`View attachment: ${label}. ${availableLimitTitle}`}
          onClick={() => setOpen(true)}
        >
          <FileText className="h-4 w-4 shrink-0" />
        </button>

        <AttachmentPreviewDialog
          open={open}
          onOpenChange={setOpen}
          label={label}
          href={href}
          showImage={showImage}
          mode={mode}
          iframeSrc={iframeSrc}
          openTabHref={openTabHref}
          onEditClick={onEditClick}
        />
      </>
    );
  }

  if (card.attachmentName) {
    return (
      <span className="text-sm text-gray-700 truncate max-w-full" title={card.attachmentName}>
        {card.attachmentName}
      </span>
    );
  }

  return <span className="text-sm text-gray-400">—</span>;
}
