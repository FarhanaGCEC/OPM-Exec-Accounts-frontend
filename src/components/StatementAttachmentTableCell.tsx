import { useState, useEffect, useRef } from 'react';
import { FileText, Loader2, Trash2 } from 'lucide-react';
import { Label } from './ui/label';
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

export interface StatementAttachmentTableCellProps {
  card: CreditCardStatement;
  isEditing: boolean;
  statementAttachmentFile: File | null;
  onAttachmentFileChange: (file: File | null) => void;
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

export function StatementAttachmentTableCell({
  card,
  isEditing,
  statementAttachmentFile,
  onAttachmentFileChange,
  onDeleteAttachment,
  deleteAttachmentBusy = false,
  onEditClick,
}: StatementAttachmentTableCellProps) {
  const [open, setOpen] = useState(false);
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
    return (
      <div className="flex flex-col gap-2 min-w-[160px] max-w-[260px]">
        <Label className="text-xs text-gray-600">Attachment (PDF)</Label>
        {hasStored && !statementAttachmentFile ? (
          <span
            className="text-xs text-gray-700 truncate border border-gray-100 rounded px-2 py-1 bg-gray-50"
            title={card.attachmentName || card.attachmentUrl || ''}
          >
            Current: {card.attachmentName?.trim() || 'attachment'}
          </span>
        ) : null}
        {hasStored && onDeleteAttachment ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs justify-start text-red-700 border-red-200 hover:bg-red-50"
            disabled={deleteAttachmentBusy || Boolean(statementAttachmentFile)}
            onClick={() => onDeleteAttachment()}
            title={statementAttachmentFile ? 'Save or clear the new file first' : undefined}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1 shrink-0" />
            Remove PDF
          </Button>
        ) : null}

        <input
          type="file"
          accept=".pdf,application/pdf"
          className="block w-full text-xs text-gray-700 file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs"
          onChange={(e) => onAttachmentFileChange(e.target.files?.[0] ?? null)}
        />
        {statementAttachmentFile ? (
          <span
            className="text-xs text-gray-600 truncate"
            title={statementAttachmentFile.name}
          >
            New: {statementAttachmentFile.name}
          </span>
        ) : null}
      </div>
    );
  }

  if (href) {
    const openEdit = () => {
      setOpen(false);
      onEditClick?.();
    };

    return (
      <>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-[#fef9e8] hover:border-[#f7c46d] transition-colors"
          title={label}
          aria-label={`View attachment: ${label}`}
          onClick={() => setOpen(true)}
        >
          <FileText className="h-4 w-4 shrink-0" />
        </button>

        <Dialog open={open} onOpenChange={setOpen}>
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
                  className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                  onClick={openEdit}
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
      </>
    );
  }

  if (card.attachmentName) {
    return <span className="text-sm text-gray-700">{card.attachmentName}</span>;
  }

  return <span className="text-sm text-gray-400">—</span>;
}
