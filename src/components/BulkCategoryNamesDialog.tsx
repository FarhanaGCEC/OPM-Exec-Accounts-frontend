import { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { payablesService } from '../services/payablesService';
import { receivablesService } from '../services/receivablesService';

import {
  BULK_CATEGORY_NAMES_MAX,
  capCategoryNames,
  parseCategoryNamesFromExcelBuffer,
  parseCategoryNamesFromText,
} from '../lib/bulkCategoryNames';
import { cn } from '@/src/lib/utils';
import { Loader2, Upload } from 'lucide-react';

type Variant = 'payables' | 'receivables';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: Variant;
  /** Page title, e.g. "Debtors List" / "Creditors List" */
  listLabel: string;
  onSuccess: (summary?: string) => void;
};

type BulkPayload = {
  inserted?: number;
  skippedDuplicates?: string[];
  message?: string;
};

function unwrapBulkBody(data: unknown): BulkPayload {
  if (!data || typeof data !== 'object') return {};
  const o = data as Record<string, unknown>;
  const inner = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : o;
  const rec = inner as Record<string, unknown>;
  const inserted =
    typeof rec.inserted === 'number' ? rec.inserted : Number(rec.inserted) || undefined;
  const skippedDuplicates = Array.isArray(rec.skippedDuplicates)
    ? (rec.skippedDuplicates as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  const message = typeof rec.message === 'string' ? rec.message : undefined;
  return { inserted, skippedDuplicates, message };
}

function formatBulkSummary(body: BulkPayload, truncated: number): string {
  if (body.message) return body.message + (truncated > 0 ? ` (${truncated} names not sent — max ${BULK_CATEGORY_NAMES_MAX}.)` : '');
  const inserted = body.inserted ?? 0;
  const skipped = body.skippedDuplicates?.length ?? 0;
  let s = `Added ${inserted} name${inserted === 1 ? '' : 's'}.`;
  if (skipped > 0) s += ` ${skipped} duplicate(s) already in the database were skipped.`;
  if (truncated > 0) s += ` ${truncated} name(s) were not sent (max ${BULK_CATEGORY_NAMES_MAX} per request).`;
  return s;
}

export default function BulkCategoryNamesDialog({
  open,
  onOpenChange,
  variant,
  listLabel,
  onSuccess,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [fileLabel, setFileLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPaste('');
    setFileLabel('');
    setLocalError(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleClose = (next: boolean) => {
    if (!next && !busy) reset();
    onOpenChange(next);
  };

  const runJsonBulk = useCallback(
    async (names: string[]) => {
      if (variant === 'payables') {
        return payablesService.bulkCreatePayables(names);
      }
      return receivablesService.bulkCreateReceivables(names);
    },
    [variant]
  );

  const runCsvBulk = useCallback(
    async (file: File) => {
      if (variant === 'payables') {
        return payablesService.bulkCreatePayablesCsv(file);
      }
      return receivablesService.bulkCreateReceivablesCsv(file);
    },
    [variant]
  );

  const submitJsonNames = useCallback(
    async (names: string[], closeAfter: boolean) => {
      const cleaned = names.map((n) => n.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        setLocalError('Add at least one name (paste or file).');
        return;
      }
      const { names: capped, truncated } = capCategoryNames(cleaned);
      setBusy(true);
      setLocalError(null);
      try {
        const res = await runJsonBulk(capped);
        const raw = res.data as Record<string, unknown> | undefined;
        if (raw && typeof raw === 'object' && raw.success === false) {
          setLocalError(String(raw.message || raw.error || 'Bulk request failed'));
          return;
        }
        if (!res.success) {
          setLocalError(res.message || 'Bulk request failed');
          return;
        }
        const summary = formatBulkSummary(unwrapBulkBody(res.data), truncated);
        reset();
        if (closeAfter) onOpenChange(false);
        onSuccess(summary);
      } catch (e: unknown) {
        setLocalError(e instanceof Error ? e.message : 'Bulk request failed');
      } finally {
        setBusy(false);
      }
    },
    [runJsonBulk, onOpenChange, onSuccess, reset]
  );

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      setLocalError(null);
      if (!file) {
        setFileLabel('');
        return;
      }
      setFileLabel(file.name);
      const lower = file.name.toLowerCase();

      if (lower.endsWith('.csv')) {
        setBusy(true);
        try {
          const res = await runCsvBulk(file);
          const rawCsv = res.data as Record<string, unknown> | undefined;
          if (rawCsv && typeof rawCsv === 'object' && rawCsv.success === false) {
            setLocalError(String(rawCsv.message || rawCsv.error || 'Upload failed'));
            return;
          }
          if (!res.success) {
            setLocalError(res.message || 'Upload failed');
            return;
          }
          const summary = formatBulkSummary(unwrapBulkBody(res.data), 0);
          reset();
          onOpenChange(false);
          onSuccess(summary);
        } catch (err: unknown) {
          setLocalError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setBusy(false);
        }
        return;
      }

      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        setBusy(true);
        try {
          const buf = await file.arrayBuffer();
          const names = parseCategoryNamesFromExcelBuffer(buf);
          setBusy(false);
          await submitJsonNames(names, true);
        } catch (err: unknown) {
          setBusy(false);
          setLocalError(err instanceof Error ? err.message : 'Could not read Excel file');
        }
        return;
      }

      setLocalError(
        'Use a .csv file (sent to server as-is), or .xlsx / .xlsm (names are read in the browser).'
      );
    },
    [runCsvBulk, submitJsonNames, reset, onOpenChange, onSuccess]
  );

  const backendHint =
    variant === 'payables'
      ? 'Payables (creditors you owe) — daily Debit categories.'
      : 'Receivables (debtors who owe you) — daily Credit categories.';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">Bulk import — {listLabel}</DialogTitle>
          <p className="text-sm text-gray-600 pt-1">{backendHint}</p>
          <p className="text-sm text-gray-600">
            Up to {BULK_CATEGORY_NAMES_MAX} names per request. CSV uses{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">/bulk-csv</code>; Excel is read here,
            then JSON <code className="text-xs bg-gray-100 px-1 rounded">/bulk</code>. Rows named
            name / creditor / debtor are skipped as headers. Existing names are skipped (not an
            error).
          </p>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(ev) => void onPickFile(ev)}
          />
          <div>
            <Button
              type="button"
              variant="outline"
              className="border-gray-300 w-full sm:w-auto"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              {fileLabel ? `Selected: ${fileLabel}` : 'Choose CSV or Excel'}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-names-paste">Or paste names (one per line)</Label>
            <textarea
              id="bulk-names-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'Vendor A\nVendor B\n…'}
              disabled={busy}
              className={cn(
                'flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50 md:text-base font-mono text-sm'
              )}
            />
          </div>

          {localError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {localError}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
            disabled={busy || !paste.trim()}
            onClick={() => void submitJsonNames(parseCategoryNamesFromText(paste), true)}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Working…
              </>
            ) : (
              'Submit pasted names'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
