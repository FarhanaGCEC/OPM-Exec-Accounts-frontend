import { useState } from 'react';
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
  resolveAttachmentHref,
} from '../lib/resolveAttachmentUrl';

const googleDocsViewerUrl = (fileUrl: string): string =>
  `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;

export interface PdcAttachmentTableCellProps {
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  variant?: 'default' | 'onDark';
  /** Opens the same edit flow as the row’s Edit action. */
  onEditClick?: () => void;
}

export function PdcAttachmentTableCell({
  attachmentUrl,
  attachmentName,
  variant = 'default',
  onEditClick,
}: PdcAttachmentTableCellProps) {
  const [open, setOpen] = useState(false);
  const href = resolveAttachmentHref(attachmentUrl);
  const textClass = variant === 'onDark' ? 'text-white' : 'text-gray-700';
  const isProbablyImage = attachmentLooksLikeImage(
    attachmentName || attachmentUrl || ''
  );
  const previewHref = !isProbablyImage && href ? googleDocsViewerUrl(href) : href;
  const label = attachmentName?.trim() || 'Cheque image';

  if (!href) {
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
              <a href={previewHref || href} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
