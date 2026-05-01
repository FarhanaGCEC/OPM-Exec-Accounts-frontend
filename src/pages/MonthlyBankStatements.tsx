import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, Loader2, Trash2, Upload } from 'lucide-react';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import api from '../lib/api';

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

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  bank_statement: 'Bank Statement',
  monthly_invoice: 'Monthly Invoice',
};

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

const getUploadFieldName = (documentType: DocumentType): 'bank_statement' | 'monthly_invoice' =>
  documentType === 'bank_statement' ? 'bank_statement' : 'monthly_invoice';

const getPendingUploadKey = (
  documentType: DocumentType
): 'bankStatementFile' | 'monthlyInvoiceFile' =>
  documentType === 'bank_statement' ? 'bankStatementFile' : 'monthlyInvoiceFile';

const getDocumentDisplayName = (documentType: DocumentType) =>
  documentType === 'bank_statement' ? 'bank statement' : 'monthly invoice';

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    const err = error as Error & {
      errors?: Record<string, string[] | string> | string[] | string;
    };
    const details = err.errors;
    if (details && typeof details === 'object') {
      if (Array.isArray(details)) {
        const joined = details.map((item) => String(item).trim()).filter(Boolean).join(' ');
        if (joined) return joined;
      } else {
        const messages = Object.values(details)
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .map((value) => String(value).trim())
          .filter(Boolean);
        if (messages.length > 0) return messages.join(' ');
      }
    }
    return err.message || fallback;
  }
  return fallback;
};

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
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('AED');
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
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
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
  const selectedMonthLabel =
    monthOptions.find((m) => m.value === selectedMonth)?.label || String(selectedMonth);
  const selectedRow =
    rows.find((row) => row.currency === selectedCurrency) || {
      currency: selectedCurrency,
      bankStatement: null,
      monthlyInvoice: null,
    };

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
    async (currency: CurrencyCode, documentType: DocumentType) => {
      const pendingKey = getPendingUploadKey(documentType);
      const selectedFile = pendingUploads[currency][pendingKey];
      if (!selectedFile) {
        showToast(
          'error',
          `Please select a ${getDocumentDisplayName(documentType)} PDF first.`
        );
        return false;
      }

      const key = `${currency}-upload-${documentType}`;
      try {
        setUploadingKey(key);
        const formData = new FormData();
        formData.append('month', formatYearMonth(selectedYear, selectedMonth));
        formData.append('currency', currency);
        formData.append(getUploadFieldName(documentType), selectedFile, selectedFile.name);
        await api.post('/monthly-bank-statements', formData);
        await loadMonthlyStatements();
        setPendingUploads((prev) => ({
          ...prev,
          [currency]: {
            ...prev[currency],
            [pendingKey]: null,
          },
        }));
        showToast(
          'success',
          `${currency} ${getDocumentDisplayName(documentType)} uploaded successfully.`
        );
        return true;
      } catch (error) {
        const message = getErrorMessage(error, 'Upload failed.');
        showToast('error', message);
        return false;
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
        if (token) qs.set('token', token);
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
        if (token) qs.set('token', token);
        const fileUrl = `/api/monthly-bank-statements/file/${documentType}?${qs.toString()}`;
        window.open(fileUrl, '_blank', 'noopener,noreferrer');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to open PDF.';
        showToast('error', message);
      }
    },
    [selectedMonth, selectedYear, showToast]
  );

  const handleDelete = useCallback(
    async (currency: CurrencyCode, documentType: DocumentType) => {
      const label = DOCUMENT_LABELS[documentType];
      if (!window.confirm(`Delete ${label} for ${currency} in selected month?`)) {
        return;
      }
      const key = `${currency}-delete-${documentType}`;
      try {
        setDeletingKey(key);
        await api.delete('/monthly-bank-statements', {
          params: {
            month: formatYearMonth(selectedYear, selectedMonth),
            currency,
            type: documentType,
          },
        });
        await loadMonthlyStatements();
        showToast('success', `${currency} ${label} deleted.`);
      } catch (error) {
        const message = getErrorMessage(error, 'Delete failed.');
        showToast('error', message);
      } finally {
        setDeletingKey(null);
      }
    },
    [loadMonthlyStatements, selectedMonth, selectedYear, showToast]
  );

  const renderStatusPill = (hasFile: boolean) => (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        hasFile ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {hasFile ? 'Uploaded' : 'Missing'}
    </span>
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
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800"
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
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800"
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

      <div className="m-8 overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-sm">
        <div className="border-b bg-gradient-to-r from-[#f7c46d] to-[#edd06a] px-6 py-4">
          <p className="text-sm font-semibold text-gray-900">
            {selectedMonthLabel} {selectedYear}
          </p>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-500" />
              <p className="mt-2 text-sm text-gray-500">Loading monthly statements...</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex gap-1 border-b border-gray-200">
                {CURRENCIES.map((currency) => (
                  <button
                    key={currency}
                    onClick={() => setSelectedCurrency(currency)}
                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                      selectedCurrency === currency
                        ? 'border-b-2 border-[#f7c46d] text-gray-900'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {currency}
                  </button>
                ))}
              </div>
              {(() => {
                const row = selectedRow;
                const bankKey = `${row.currency}-bank_statement`;
                const invoiceKey = `${row.currency}-monthly_invoice`;
                const uploadBankKey = `${row.currency}-upload-bank_statement`;
                const uploadInvoiceKey = `${row.currency}-upload-monthly_invoice`;
                const bankName = getMetaFileName(row.bankStatement);
                const invoiceName = getMetaFileName(row.monthlyInvoice);
                const pending = pendingUploads[row.currency];

                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center rounded-full bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white">
                        {row.currency}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setIsUploadModalOpen(true)}
                          className="h-8 rounded-full"
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Files
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-gray-600">
                        Uploads are managed via the <span className="font-semibold">Upload Files</span> button.
                      </p>
                    </div>

                    <div className="overflow-x-auto rounded-[20px] border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Document
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                              File
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {(['bank_statement', 'monthly_invoice'] as DocumentType[]).map((type) => {
                            const fileName = type === 'bank_statement' ? bankName : invoiceName;
                            const key = `${row.currency}-${type}`;
                            return (
                              <tr key={type} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                                  {DOCUMENT_LABELS[type]}
                                </td>
                                <td className="px-4 py-3">{renderStatusPill(Boolean(fileName))}</td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex max-w-[260px] items-center truncate rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600">
                                    {fileName || 'No file uploaded'}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 rounded-full font-semibold"
                                      onClick={() =>
                                        void handleDownload(
                                          row.currency,
                                          type,
                                          type === 'bank_statement' ? row.bankStatement : row.monthlyInvoice
                                        )
                                      }
                                      disabled={!fileName || downloadingKey === key}
                                    >
                                      {downloadingKey === key ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Download className="mr-2 h-4 w-4" />
                                      )}
                                      Download
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 rounded-full"
                                      onClick={() => void handleView(row.currency, type)}
                                      disabled={!fileName}
                                    >
                                      <Eye className="mr-2 h-4 w-4" />
                                      View
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 rounded-full text-red-600 hover:text-red-700"
                                      onClick={() => void handleDelete(row.currency, type)}
                                      disabled={!fileName || deletingKey === `${row.currency}-delete-${type}`}
                                    >
                                      {deletingKey === `${row.currency}-delete-${type}` ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="mr-2 h-4 w-4" />
                                      )}
                                      Delete
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
                      <DialogContent className="w-[95vw] max-w-xl overflow-hidden">
                        <DialogHeader>
                          <DialogTitle>Upload Monthly Files ({row.currency})</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 overflow-hidden">
                          <div className="space-y-3">
                            <p className="text-xs font-semibold text-gray-700">Select PDFs</p>
                            <div className="space-y-2">
                              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center">
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
                                  className="h-9 w-full shrink-0 rounded-full sm:h-8 sm:w-[140px]"
                                >
                                  <Upload className="mr-2 h-4 w-4" />
                                  Bank PDF
                                </Button>
                                <span
                                  className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center overflow-hidden rounded-full bg-white px-3 py-1.5 text-xs text-gray-600 sm:min-h-8"
                                  title={pending.bankStatementFile?.name || 'Not selected'}
                                >
                                  <span className="block w-full min-w-0 truncate whitespace-nowrap">
                                    {pending.bankStatementFile?.name || 'Not selected'}
                                  </span>
                                </span>
                              </div>
                              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center">
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
                                  className="h-9 w-full shrink-0 rounded-full sm:h-8 sm:w-[140px]"
                                >
                                  <Upload className="mr-2 h-4 w-4" />
                                  Invoice PDF
                                </Button>
                                <span
                                  className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center overflow-hidden rounded-full bg-white px-3 py-1.5 text-xs text-gray-600 sm:min-h-8"
                                  title={pending.monthlyInvoiceFile?.name || 'Not selected'}
                                >
                                  <span className="block w-full min-w-0 truncate whitespace-nowrap">
                                    {pending.monthlyInvoiceFile?.name || 'Not selected'}
                                  </span>
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="grid min-w-0 grid-cols-1 gap-2">
                            <Button
                              size="sm"
                              onClick={async () => {
                                const didUpload = await handleUpload(
                                  row.currency,
                                  'bank_statement'
                                );
                                if (didUpload) {
                                  setIsUploadModalOpen(false);
                                }
                              }}
                              disabled={
                                uploadingKey === uploadBankKey || !pending.bankStatementFile
                              }
                              className="h-10 w-full min-w-0 rounded-full bg-[#f7c46d] px-3 text-black hover:bg-[#c9a82f]"
                            >
                              {uploadingKey === uploadBankKey ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 h-4 w-4" />
                              )}
                              <span className="truncate">Upload Bank Statement</span>
                            </Button>
                            <Button
                              size="sm"
                              onClick={async () => {
                                const didUpload = await handleUpload(
                                  row.currency,
                                  'monthly_invoice'
                                );
                                if (didUpload) {
                                  setIsUploadModalOpen(false);
                                }
                              }}
                              disabled={
                                uploadingKey === uploadInvoiceKey || !pending.monthlyInvoiceFile
                              }
                              className="h-10 w-full min-w-0 rounded-full bg-[#f7c46d] px-3 text-black hover:bg-[#c9a82f]"
                            >
                              {uploadingKey === uploadInvoiceKey ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 h-4 w-4" />
                              )}
                              <span className="truncate">Upload Monthly Invoice</span>
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
