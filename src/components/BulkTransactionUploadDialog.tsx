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
import type { PayablesCategory } from '../services/payablesService';
import type { ReceivablesCategory } from '../services/receivablesService';
import {
  BULK_TX_MAX_ROWS,
  chunkBulkRows,
  parseBulkTransactionCsv,
  parseBulkTransactionExcel,
  type BulkApiTransactionRow,
  type BulkParseRowIssue,
} from '../lib/bulkTransactionCsv';
import { Loader2, Upload } from 'lucide-react';

export type ApiBulkRowError = { csvRow: number; message: string };

function normalizeApiErrors(
  raw: unknown,
  batchStartIndex: number,
  sourceCsvRows: number[]
): ApiBulkRowError[] {
  if (!Array.isArray(raw)) return [];
  const out: ApiBulkRowError[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const idx = typeof o.index === 'number' ? o.index : Number(o.index);
    if (!Number.isInteger(idx) || idx < 0) continue;
    const globalIdx = batchStartIndex + idx;
    const csvRow =
      globalIdx >= 0 && globalIdx < sourceCsvRows.length
        ? sourceCsvRows[globalIdx]
        : batchStartIndex + idx + 1;
    const msg =
      (typeof o.error === 'string' && o.error) ||
      (typeof o.message === 'string' && o.message) ||
      'Validation failed';
    out.push({ csvRow, message: msg });
  }
  return out;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payablesCategories: PayablesCategory[];
  receivablesCategories: ReceivablesCategory[];
  onSuccess: () => void;
};

export default function BulkTransactionUploadDialog({
  open,
  onOpenChange,
  payablesCategories,
  receivablesCategories,
  onSuccess,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [rows, setRows] = useState<BulkApiTransactionRow[]>([]);
  const [sourceCsvRows, setSourceCsvRows] = useState<number[]>([]);
  const [parseIssues, setParseIssues] = useState<BulkParseRowIssue[]>([]);
  const [apiErrors, setApiErrors] = useState<ApiBulkRowError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);

  const resetState = useCallback(() => {
    setFileLabel('');
    setRows([]);
    setSourceCsvRows([]);
    setParseIssues([]);
    setApiErrors([]);
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
      setApiErrors([]);
      setSubmitError(null);
      setRows([]);
      setSourceCsvRows([]);
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
          const parsed = await parseBulkTransactionExcel(
            buf,
            payablesCategories,
            receivablesCategories
          );
          setParseIssues(parsed.issues);
          setRows(parsed.rows);
          setSourceCsvRows(parsed.sourceCsvRows);
        } else {
          const text = await file.text();
          const parsed = parseBulkTransactionCsv(text, payablesCategories, receivablesCategories);
          setParseIssues(parsed.issues);
          setRows(parsed.rows);
          setSourceCsvRows(parsed.sourceCsvRows);
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
    [payablesCategories, receivablesCategories]
  );

  /** At least one parsed row; per-row parse issues don't block (those rows are simply omitted). */
  const validForSubmit = rows.length > 0 && !submitting;

  const submitFixed = async () => {
    if (!validForSubmit) return;
    setSubmitting(true);
    setApiErrors([]);
    setSubmitError(null);
    setProgress({ sent: 0, total: rows.length });
    try {
      const batches = chunkBulkRows(rows, BULK_TX_MAX_ROWS);
      let offset = 0;
      for (const batch of batches) {
        try {
          const res = await transactionService.createBankTransactionsBulk(batch);
          const body = res.data as Record<string, unknown> | null;
          if (body && body.success === false) {
            const msg =
              (typeof body.message === 'string' && body.message) ||
              (typeof body.error === 'string' && body.error) ||
              'Bulk upload failed';
            throw Object.assign(new Error(msg), { status: 400 });
          }
        } catch (e: unknown) {
          const err = e as Error & { status?: number; errors?: unknown };
          let mapped: ApiBulkRowError[] = [];
          if (Array.isArray(err.errors)) {
            mapped = normalizeApiErrors(err.errors, offset, sourceCsvRows);
          }
          if (err.status === 400 && mapped.length > 0) {
            setApiErrors(mapped);
            setSubmitError(
              'Validation failed — no rows were inserted. Fix the rows below and try again.'
            );
            return;
          }
          if (err.status === 400) {
            setSubmitError(
              err.message ||
                'Validation failed — no rows were inserted (see server message).'
            );
            return;
          }
          setSubmitError(err.message || 'Bulk upload failed');
          return;
        }
        offset += batch.length;
        setProgress({ sent: offset, total: rows.length });
      }
      resetState();
      onOpenChange(false);
      onSuccess();
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">
            Bulk upload — Daily Transaction
          </DialogTitle>
          <p className="text-sm text-gray-600 pt-1">
            Upload a CSV or Excel (.xlsx) file; Excel uses the first worksheet only. Rows above the
            real column headers (e.g. statement titles) are skipped automatically. Use either the
            bulk template (date, type, amount, category; paymentType optional) or a bank-style layout
            (Date, Debit, Credit, Description) — description text is matched to payables/receivables
            category names like the category column. Max{' '}
            {BULK_TX_MAX_ROWS} rows per API request — larger files are split automatically. Dates:
            YYYY-MM-DD or DD/MM/YYYY. Payment types: cash, cheque, creditcard, online (bank
            transfer).
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
            {fileLabel ? `Selected: ${fileLabel}` : 'Choose CSV or Excel file'}
          </Button>

          {parseIssues.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold mb-1">Parse / validation issues</p>
              {rows.length > 0 && (
                <p className="mb-2 text-amber-950/90">
                  {rows.length} row{rows.length === 1 ? '' : 's'} will still be submitted — only the
                  problem rows below are skipped.
                </p>
              )}
              <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
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

          {apiErrors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold mb-1">Server validation (400)</p>
              <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
                {apiErrors.map((p, i) => (
                  <li key={i}>
                    Row {p.csvRow}: {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Preview ({rows.length} row{rows.length === 1 ? '' : 's'})
                {rows.length > BULK_TX_MAX_ROWS &&
                  ` — will send in ${Math.ceil(rows.length / BULK_TX_MAX_ROWS)} requests`}
              </p>
              <div className="border rounded-md overflow-auto max-h-56 text-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-2 border">#</th>
                      <th className="p-2 border">date</th>
                      <th className="p-2 border">type</th>
                      <th className="p-2 border">payment</th>
                      <th className="p-2 border">amount</th>
                      <th className="p-2 border">categoryId</th>
                      <th className="p-2 border">cheque</th>
                      <th className="p-2 border">remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 border">{sourceCsvRows[i] ?? i + 1}</td>
                        <td className="p-2 border">{r.date}</td>
                        <td className="p-2 border">{r.type}</td>
                        <td className="p-2 border">{r.paymentType}</td>
                        <td className="p-2 border">{r.amount}</td>
                        <td className="p-2 border">{r.categoryId}</td>
                        <td className="p-2 border">{r.chequeNumber ?? '—'}</td>
                        <td className="p-2 border">{r.remarks ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <p className="p-2 text-xs text-gray-500 bg-gray-50">
                    Showing first 50 rows only.
                  </p>
                )}
              </div>
            </div>
          )}

          {progress && (
            <p className="text-sm text-gray-600">
              Uploaded {progress.sent} / {progress.total}…
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:items-center">
          {!validForSubmit && !submitting && (
            <p className="text-xs text-gray-500 text-left w-full sm:order-last sm:flex-1 sm:mr-auto">
              {rows.length > 0
                ? null
                : parseIssues.length > 0
                  ? 'Submit stays off until at least one row is valid. Fix the issues above or adjust the file.'
                  : fileLabel
                    ? 'No rows could be imported from this file. Check dates, Debit/Credit columns, and category/description matching.'
                    : 'Select a file — Submit enables when at least one transaction row parses successfully.'}
            </p>
          )}
          <Button type="button" variant="outline" disabled={submitting} onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
            disabled={!validForSubmit}
            onClick={() => void submitFixed()}
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
