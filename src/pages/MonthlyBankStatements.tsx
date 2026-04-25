import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, Loader2, Trash2, Upload } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import api from '../lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

type CurrencyCode = 'AED' | 'USD' | 'GBP';
type DocumentType = 'bank_statement' | 'monthly_invoice';

type MonthlyDocumentMeta = {
  fileName?: string | null;
  filename?: string | null;
  originalName?: string | null;
  original_filename?: string | null;
  url?: string | null;
};

type MonthlyStatementRecord = {
  currency?: CurrencyCode;
  currencyCode?: CurrencyCode;
  bank_statement?: MonthlyDocumentMeta | null;
  bankStatement?: MonthlyDocumentMeta | null;
  monthly_invoice?: MonthlyDocumentMeta | null;
  monthlyInvoice?: MonthlyDocumentMeta | null;
};

type ToastState = {
  type: 'success' | 'error';
  message: string;
};

type GridRow = {
  currency: CurrencyCode;
  bankStatement: MonthlyDocumentMeta | null;
  monthlyInvoice: MonthlyDocumentMeta | null;
};

type PendingUploadRow = {
  bankStatementFile: File | null;
  monthlyInvoiceFile: File | null;
};

const CURRENCIES: CurrencyCode[] = ['AED', 'USD', 'GBP'];

const ensurePdfFilename = (name: string | null | undefined, fallback: string): string => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return `${fallback}.pdf`;
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
};

const getMetaFileName = (meta: MonthlyDocumentMeta | null | undefined): string | null => {
  if (!meta) return null;
  return (
    meta.originalName ||
    meta.original_filename ||
    meta.fileName ||
    meta.filename ||
    null
  );
};

const normalizeRecord = (input: unknown): MonthlyStatementRecord | null => {
  if (!input || typeof input !== 'object') return null;
  return input as MonthlyStatementRecord;
};

const formatYearMonth = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

const getRecordFromBody = (body: unknown): MonthlyStatementRecord | null => {
  if (!body || typeof body !== 'object') return null;
  const direct = normalizeRecord(body);
  if (direct?.currency || direct?.currencyCode) return direct;

  const record = body as Record<string, unknown>;
  const candidates = [record.data, record.row, record.record, record.monthlyStatement];
  for (const candidate of candidates) {
    const normalized = normalizeRecord(candidate);
    if (normalized) return normalized;
  }
  return null;
};

export default function MonthlyBankStatements() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [rows, setRows] = useState<GridRow[]>(
    CURRENCIES.map((currency) => ({
      currency,
      bankStatement: null,
      monthlyInvoice: null,
    }))
  );
  const [loading, setLoading] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingUploads, setPendingUploads] = useState<Record<CurrencyCode, PendingUploadRow>>({
    AED: { bankStatementFile: null, monthlyInvoiceFile: null },
    USD: { bankStatementFile: null, monthlyInvoiceFile: null },
    GBP: { bankStatementFile: null, monthlyInvoiceFile: null },
  });

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const monthOptions = useMemo(
    () => [
      { value: 1, label: 'January' },
      { value: 2, label: 'February' },
      { value: 3, label: 'March' },
      { value: 4, label: 'April' },
      { value: 5, label: 'May' },
      { value: 6, label: 'June' },
      { value: 7, label: 'July' },
      { value: 8, label: 'August' },
      { value: 9, label: 'September' },
      { value: 10, label: 'October' },
      { value: 11, label: 'November' },
      { value: 12, label: 'December' },
    ],
    []
  );

  const yearOptions = useMemo(
    () => [currentYear - 1, currentYear, currentYear + 1, currentYear + 2],
    [currentYear]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((type: ToastState['type'], message: string) => {
    setToast({ type, message });
  }, []);

  const loadMonthlyStatements = useCallback(async () => {
    try {
      setLoading(true);
      const monthParam = formatYearMonth(selectedYear, selectedMonth);
      const nextRows = await Promise.all(
        CURRENCIES.map(async (currency) => {
          try {
            const response = await api.get<unknown>('/monthly-bank-statements', {
              params: {
                month: monthParam,
                currency,
              },
            });
            const normalized = getRecordFromBody(response?.data);
            return {
              currency,
              bankStatement: normalized?.bank_statement || normalized?.bankStatement || null,
              monthlyInvoice: normalized?.monthly_invoice || normalized?.monthlyInvoice || null,
            };
          } catch {
            return {
              currency,
              bankStatement: null,
              monthlyInvoice: null,
            };
          }
        })
      );

      setRows(nextRows);
    } catch {
      setRows(
        CURRENCIES.map((currency) => ({
          currency,
          bankStatement: null,
          monthlyInvoice: null,
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    void loadMonthlyStatements();
  }, [loadMonthlyStatements]);

  const setPendingFile = useCallback(
    (currency: CurrencyCode, type: 'bankStatementFile' | 'monthlyInvoiceFile', file: File | null) => {
      if (file && !file.name.toLowerCase().endsWith('.pdf')) {
        showToast('error', 'Only PDF files are allowed.');
        return;
      }
      setPendingUploads((prev) => ({
        ...prev,
        [currency]: {
          ...prev[currency],
          [type]: file,
        },
      }));
    },
    [showToast]
  );

  const handleUpload = useCallback(
    async (currency: CurrencyCode) => {
      const files = pendingUploads[currency];
      if (!files.bankStatementFile || !files.monthlyInvoiceFile) {
        showToast('error', 'Please select both files: bank statement and monthly invoice.');
        return;
      }

      const key = `${currency}-upload`;
      try {
        setUploadingKey(key);
        const formData = new FormData();
        formData.append('month', formatYearMonth(selectedYear, selectedMonth));
        formData.append('currency', currency);
        formData.append('bank_statement', files.bankStatementFile, files.bankStatementFile.name);
        formData.append('monthly_invoice', files.monthlyInvoiceFile, files.monthlyInvoiceFile.name);
        await api.post('/monthly-bank-statements', formData);
        await loadMonthlyStatements();
        setPendingUploads((prev) => ({
          ...prev,
          [currency]: {
            bankStatementFile: null,
            monthlyInvoiceFile: null,
          },
        }));
        showToast('success', `${currency} monthly files uploaded successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed.';
        showToast('error', message);
      } finally {
        setUploadingKey(null);
      }
    },
    [loadMonthlyStatements, pendingUploads, selectedMonth, selectedYear, showToast]
  );

  const handleDownload = useCallback(
    async (currency: CurrencyCode, documentType: DocumentType, currentMeta: MonthlyDocumentMeta | null) => {
      const key = `${currency}-${documentType}`;
      const monthParam = formatYearMonth(selectedYear, selectedMonth);
      try {
        setDownloadingKey(key);
        const token = localStorage.getItem('authToken');
        const qs = new URLSearchParams({
          currency,
          month: monthParam,
        });
        const response = await fetch(`/api/monthly-bank-statements/file/${documentType}?${qs.toString()}`, {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          let errorMessage = 'Failed to download PDF.';
          try {
            const errBody = await response.json();
            errorMessage = String(errBody?.message || errBody?.error || errorMessage);
          } catch {
            // keep fallback
          }
          throw new Error(errorMessage);
        }

        let filename = getMetaFileName(currentMeta) || `${currency}-${documentType}-${monthParam}.pdf`;
        const disposition = String(response.headers.get('content-disposition') || '');
        const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
        if (match?.[1]) {
          filename = decodeURIComponent(match[1]).replace(/"/g, '');
        }
        const blob = await response.blob();
        const safeName = ensurePdfFilename(filename, `${currency}-${documentType}-${monthParam}`);
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = safeName;
        a.click();
        window.URL.revokeObjectURL(objectUrl);
        showToast('success', `Downloaded ${currency} ${documentType === 'bank_statement' ? 'bank statement' : 'monthly invoice'}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Download failed.';
        showToast('error', message);
      } finally {
        setDownloadingKey(null);
      }
    },
    [selectedMonth, selectedYear, showToast]
  );

  const handleView = useCallback(
    async (currency: CurrencyCode, documentType: DocumentType) => {
      const monthParam = formatYearMonth(selectedYear, selectedMonth);
      try {
        const token = localStorage.getItem('authToken');
        const qs = new URLSearchParams({
          currency,
          month: monthParam,
        });
        const response = await fetch(`/api/monthly-bank-statements/file/${documentType}?${qs.toString()}`, {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          let errorMessage = 'Failed to open PDF.';
          try {
            const errBody = await response.json();
            errorMessage = String(errBody?.message || errBody?.error || errorMessage);
          } catch {
            // keep fallback
          }
          throw new Error(errorMessage);
        }

        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => {
          window.URL.revokeObjectURL(objectUrl);
        }, 15000);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to open PDF.';
        showToast('error', message);
      }
    },
    [selectedMonth, selectedYear, showToast]
  );

  const handleDelete = useCallback(
    async (currency: CurrencyCode) => {
      if (!window.confirm(`Delete both PDFs for ${currency} in selected month?`)) {
        return;
      }
      const key = `${currency}-delete`;
      try {
        setDeletingKey(key);
        await api.delete('/monthly-bank-statements', {
          params: {
            month: formatYearMonth(selectedYear, selectedMonth),
            currency,
          },
        });
        await loadMonthlyStatements();
        showToast('success', `${currency} monthly record deleted.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Delete failed.';
        showToast('error', message);
      } finally {
        setDeletingKey(null);
      }
    },
    [loadMonthlyStatements, selectedMonth, selectedYear, showToast]
  );

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
          <h2 className="text-2xl font-bold text-gray-900">Monthly Bank Statements</h2>
        </div>
        <div className="mr-4 flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              disabled={loading}
            >
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              disabled={loading}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {toast && (
        <div
          className={`mx-8 mb-4 rounded-md border p-3 text-sm ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-xl overflow-hidden">
        <div className="border-b bg-gradient-to-r from-[#f7c46d] to-[#edd06a] px-6 py-4">
          <p className="text-sm font-semibold text-gray-900">
            Upload and manage monthly files for each currency
          </p>
          <p className="text-xs text-gray-700">
            Select both PDFs, upload once, then use View / Download actions.
          </p>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="bg-[#f8d589] hover:bg-[#f8d589]">
                  <TableHead className="px-4 py-3 text-left text-sm font-semibold text-black">Currency</TableHead>
                  <TableHead className="px-4 py-3 text-left text-sm font-semibold text-black">Upload (Both PDFs)</TableHead>
                  <TableHead className="px-4 py-3 text-left text-sm font-semibold text-black">Bank Statement</TableHead>
                  <TableHead className="px-4 py-3 text-left text-sm font-semibold text-black">Monthly Invoice</TableHead>
                  <TableHead className="px-4 py-3 text-left text-sm font-semibold text-black">Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="px-4 py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-500" />
                      <p className="mt-2 text-sm text-gray-500">Loading monthly statements...</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const bankKey = `${row.currency}-bank_statement`;
                    const invoiceKey = `${row.currency}-monthly_invoice`;
                    const uploadKey = `${row.currency}-upload`;
                    const deleteKey = `${row.currency}-delete`;
                    const bankName = getMetaFileName(row.bankStatement);
                    const invoiceName = getMetaFileName(row.monthlyInvoice);
                    const pending = pendingUploads[row.currency];
                    return (
                      <TableRow key={row.currency} className="border-b border-gray-100 hover:bg-gray-50/80">
                        <TableCell className="px-4 py-5 align-top">
                          <div className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
                            {row.currency}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-5">
                          <div className="flex min-w-[280px] flex-col gap-2">
                            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
                              <input
                                ref={(el) => {
                                  fileInputRefs.current[bankKey] = el;
                                }}
                                type="file"
                                accept=".pdf,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  setPendingFile(row.currency, 'bankStatementFile', e.target.files?.[0] ?? null);
                                  e.currentTarget.value = '';
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => fileInputRefs.current[bankKey]?.click()}
                                className="h-8"
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                Bank PDF
                              </Button>
                              <span className="max-w-[150px] truncate text-xs text-gray-500" title={pending.bankStatementFile?.name || ''}>
                                {pending.bankStatementFile?.name || 'Not selected'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
                              <input
                                ref={(el) => {
                                  fileInputRefs.current[invoiceKey] = el;
                                }}
                                type="file"
                                accept=".pdf,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  setPendingFile(row.currency, 'monthlyInvoiceFile', e.target.files?.[0] ?? null);
                                  e.currentTarget.value = '';
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => fileInputRefs.current[invoiceKey]?.click()}
                                className="h-8"
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                Invoice PDF
                              </Button>
                              <span className="max-w-[150px] truncate text-xs text-gray-500" title={pending.monthlyInvoiceFile?.name || ''}>
                                {pending.monthlyInvoiceFile?.name || 'Not selected'}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => void handleUpload(row.currency)}
                              disabled={
                                uploadingKey === uploadKey ||
                                !pending.bankStatementFile ||
                                !pending.monthlyInvoiceFile
                              }
                              className="w-fit bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                            >
                              {uploadingKey === uploadKey ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 h-4 w-4" />
                              )}
                              Upload Both
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-5 align-top">
                          <div className="flex min-w-[240px] items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleDownload(row.currency, 'bank_statement', row.bankStatement)}
                              disabled={!bankName || downloadingKey === bankKey}
                            >
                              {downloadingKey === bankKey ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="mr-2 h-4 w-4" />
                              )}
                              Download
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleView(row.currency, 'bank_statement')}
                              disabled={!bankName}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </Button>
                          </div>
                          <p className="mt-2 max-w-[280px] truncate text-xs text-gray-500" title={bankName || ''}>
                            {bankName || 'No file uploaded'}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-5 align-top">
                          <div className="flex min-w-[240px] items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleDownload(row.currency, 'monthly_invoice', row.monthlyInvoice)}
                              disabled={!invoiceName || downloadingKey === invoiceKey}
                            >
                              {downloadingKey === invoiceKey ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="mr-2 h-4 w-4" />
                              )}
                              Download
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleView(row.currency, 'monthly_invoice')}
                              disabled={!invoiceName}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </Button>
                          </div>
                          <p className="mt-2 max-w-[280px] truncate text-xs text-gray-500" title={invoiceName || ''}>
                            {invoiceName || 'No file uploaded'}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-5 align-top">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleDelete(row.currency)}
                            disabled={deletingKey === deleteKey}
                            className="text-red-600 hover:text-red-700"
                          >
                            {deletingKey === deleteKey ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
