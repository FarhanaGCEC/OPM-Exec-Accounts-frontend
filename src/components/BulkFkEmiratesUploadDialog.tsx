import { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { transactionService } from '../services/transactionService';
import {
  parseFkEmiratesBulkCsv,
  parseFkEmiratesBulkExcel,
  type FkEmiratesBulkRow,
  type FkBulkParseIssue,
} from '../lib/fkEmiratesBulkParse';
import { Loader2, Upload } from 'lucide-react';

type Currency = 'AED' | 'USD' | 'GBP';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: Currency;
  onSuccess: () => void;
};

export default function BulkFkEmiratesUploadDialog({
  open,
  onOpenChange,
  currency,
  onSuccess,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [rows, setRows] = useState<FkEmiratesBulkRow[]>([]);
  const [parseIssues, setParseIssues] = useState<FkBulkParseIssue[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const resetState = useCallback(() => {
    setFileLabel('');
    setRows([]);
    setParseIssues([]);
    setSubmitError(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = (next: boolean) => {
    if (!next && !submitting) resetState();
    onOpenChange(next);
  };

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      setSubmitError(null);
      setRows([]);
      setParseIssues([]);
      if (!file) {
        setFileLabel('');
        return;
      }
      setFileLabel(file.name);
      try {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
          const buf = await file.arrayBuffer();
          const parsed = await parseFkEmiratesBulkExcel(buf);
          setParseIssues(parsed.issues);
          setRows(parsed.rows);
        } else {
          const text = await file.text();
          const parsed = parseFkEmiratesBulkCsv(text);
          setParseIssues(parsed.issues);
          setRows(parsed.rows);
        }
      } catch (err) {
        setParseIssues([
          {
            csvRow: 1,
            message: err instanceof Error ? err.message : 'Failed to read file',
          },
        ]);
      }
    },
    []
  );

  const validForSubmit = rows.length > 0 && !submitting;

  const submitRows = async () => {
    if (!validForSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setProgress({ done: 0, total: rows.length });
    try {
      let failed = 0;
      let lastMsg = '';
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const payload = {
          date: r.date,
          description: r.description,
          details: r.details,
          currency,
          debit: r.debit > 0 ? r.debit : 0,
          credit: r.credit > 0 ? r.credit : 0,
          ...(r.bankCharges > 0 ? { bankCharges: r.bankCharges } : {}),
        };
        try {
          const res = await transactionService.createFkEmiratesTransaction(payload);
          if (!res.success) {
            failed++;
            lastMsg = res.message || (res as { error?: string }).error || 'Save failed';
          }
        } catch (e: unknown) {
          failed++;
          lastMsg = e instanceof Error ? e.message : 'Save failed';
        }
        setProgress({ done: i + 1, total: rows.length });
      }
      if (failed > 0) {
        setSubmitError(
          `${failed} of ${rows.length} row(s) failed to save.${lastMsg ? ` Last error: ${lastMsg}` : ''}`
        );
        if (failed < rows.length) onSuccess();
        return;
      }
      resetState();
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Bulk upload failed');
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">
            Bulk upload — FK Emirates NBD ({currency})
          </DialogTitle>
          <p className="text-sm text-gray-600 pt-1">
            CSV or Excel (.xlsx) with columns: <strong>Date</strong>, <strong>Description</strong>,{' '}
            <strong>Debit</strong>, <strong>Credit</strong>. Optional: <strong>Details</strong>{' '}
            (Online, Cash, Cheque number, etc.), <strong>Bank charges</strong>. Rows above the real
            header are skipped when possible. Dates: YYYY-MM-DD, DD/MM/YYYY, or 31-Dec-25. Amounts
            can include AED or commas. Imports use the <strong>{currency}</strong> tab you selected.
          </p>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            type="button"
            variant="outline"
            className="border-gray-300"
            disabled={submitting}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            {fileLabel ? `Selected: ${fileLabel}` : 'Choose CSV or Excel'}
          </Button>

          {parseIssues.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold mb-1">Parse notes</p>
              {rows.length > 0 && (
                <p className="mb-2 text-amber-950/90">
                  {rows.length} row{rows.length === 1 ? '' : 's'} ready to submit (problem rows were
                  skipped).
                </p>
              )}
              <ul className="list-disc pl-5 space-y-0.5 max-h-28 overflow-y-auto">
                {parseIssues.map((p, i) => (
                  <li key={i}>
                    Row {p.csvRow}: {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {submitError}
            </div>
          )}

          {rows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Preview ({rows.length} row{rows.length === 1 ? '' : 's'}) — {currency}
              </p>
              <div className="border rounded-md overflow-auto max-h-48 text-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-2 border">#</th>
                      <th className="p-2 border">date</th>
                      <th className="p-2 border">description</th>
                      <th className="p-2 border">details</th>
                      <th className="p-2 border">debit</th>
                      <th className="p-2 border">credit</th>
                      <th className="p-2 border">bank chg.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 40).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 border">{i + 1}</td>
                        <td className="p-2 border">{r.date}</td>
                        <td className="p-2 border max-w-[200px] truncate" title={r.description}>
                          {r.description}
                        </td>
                        <td className="p-2 border">{r.details}</td>
                        <td className="p-2 border">{r.debit || '—'}</td>
                        <td className="p-2 border">{r.credit || '—'}</td>
                        <td className="p-2 border">{r.bankCharges || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 40 && (
                  <p className="p-2 text-xs text-gray-500 bg-gray-50">Showing first 40 rows.</p>
                )}
              </div>
            </div>
          )}

          {progress && (
            <p className="text-sm text-gray-600">
              Saving {progress.done} / {progress.total}…
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:items-center">
          {!validForSubmit && !submitting && (
            <p className="text-xs text-gray-500 text-left w-full sm:order-last sm:flex-1 sm:mr-auto">
              {fileLabel && rows.length === 0
                ? 'No data rows found. Check headers (Date, Description, Debit, Credit) and dates.'
                : 'Select a file — Submit enables when at least one row parses.'}
            </p>
          )}
          <Button type="button" variant="outline" disabled={submitting} onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
            disabled={!validForSubmit}
            onClick={() => void submitRows()}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting…
              </>
            ) : (
              'Submit'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
