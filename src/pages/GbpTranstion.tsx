
import { Button } from '@/components/ui/button';
import Layout from '../components/Layout';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit, Trash2, Loader2, Download, Upload, X, Eye } from 'lucide-react';
import api, { type ApiResponse } from '../lib/api';
import { transactionService, type BankTransaction as BankTransactionType } from '../services/transactionService';
import ExcelJS from 'exceljs';
import { applyArialToExcelJsWorkbook, excelExportFont } from '../lib/excelExportFont';
import { formatDateForApi, formatIsoDateDisplay } from '../lib/formatDisplayDate';
import {
  buildFxDebitCreditBankChargesPayload,
  fxEditFormAmountAndBankCharges,
} from '../lib/fxTransactionAmounts';
import { fxAdcbDetailsFromPaymentType, fxAdcbPaymentTypeFromDetails } from '../lib/fxAdcbPaymentDetails';
import {
  emptyFxAdcbFilters,
  filterFxAdcbTransactions,
} from '../lib/fxAdcbTransactionFilters';
import { apiDateToTransactionFormDate } from '../lib/transactionFormDate';
import FxAdcbTransactionFilterBar, {
  type FxAdcbActiveTab,
  type FxAdcbFilterState,
} from '../components/FxAdcbTransactionFilterBar';
import FxAdcbTransactionFormDialog, {
  emptyFxAdcbFormValues,
  resolveFxAdcbCategoryId,
  type FxAdcbFormValues,
} from '../components/FxAdcbTransactionFormDialog';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import { canMutateRecords, canUploadStatements } from '../lib/authPayload';
import {
  isChangeRequestQueuedResponse,
  isImmediateMutationSuccess,
  mutationErrorMessage,
  userMessageFromChangeRequestSubmit,
} from '../lib/changeRequestUi';

interface GbpTransaction {
  id?: string | number;
  date: string;
  description: string;
  details: string;
  debit?: number | string | null;
  credit?: number | string | null;
  bankCharges?: number;
  balance?: number | string;
  remarks?: string | null;
}

interface DailyBankStatementMeta {
  id?: number;
  fileName?: string;
  filename?: string;
  originalName?: string;
  original_filename?: string;
}

interface ToastState {
  type: 'success' | 'error';
  message: string;
}

const STATEMENT_CURRENCY = 'GBP';

const parseGbpTransactionDate = (value: string): Date | null => {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const parts = String(value).split('/');
  if (parts.length === 3) {
    const day = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const year = Number(parts[2]);
    const fallback = new Date(year, month, day);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }

  return null;
};

export default function GbpTranstion() {
  const canMutate = canMutateRecords();
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<GbpTransaction[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<GbpTransaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<GbpTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [filters, setFilters] = useState<FxAdcbFilterState>(emptyFxAdcbFilters);
  const [activeTab, setActiveTab] = useState<FxAdcbActiveTab>('all');
  const [debtorsList, setDebtorsList] = useState<ReceivablesCategory[]>([]);
  const [creditorsList, setCreditorsList] = useState<PayablesCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [formInitialValues, setFormInitialValues] = useState<FxAdcbFormValues>(emptyFxAdcbFormValues);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [statementMeta, setStatementMeta] = useState<DailyBankStatementMeta | null>(null);
  const [statementPreviewUrl, setStatementPreviewUrl] = useState<string | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isViewingPdf, setIsViewingPdf] = useState(false);

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response: ApiResponse<any> = await transactionService.getGbpTransactions();
      
      if (response.success && response.data) {
        // API returns data array directly with camelCase fields
        const mappedTransactions: GbpTransaction[] = response.data.map((txn: any) => ({
          id: txn.id,
          date: txn.date,
          description: txn.description || '',
          details: txn.details || '',
          debit: txn.debit,
          credit: txn.credit,
          bankCharges: txn.bankCharges,
          balance: txn.balance,
          remarks: txn.remarks ?? null,
        }));
        setTransactions(mappedTransactions);
      } else {
        setError('Failed to fetch transactions');
      }
    } catch (err: any) {
      console.error('Error fetching GBP transactions:', err);
      setError(err?.message || 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const loadStatementMeta = useCallback(async () => {
    try {
      setStatementLoading(true);
      const response = await api.get<any>('/daily-bank-statement', {
        params: { currency: STATEMENT_CURRENCY },
      });
      const body = response?.data;
      const maybeMeta = body?.data ?? body?.statement ?? body?.dailyBankStatement ?? body;
      setStatementMeta(maybeMeta && typeof maybeMeta === 'object' ? maybeMeta : null);
    } catch {
      setStatementMeta(null);
    } finally {
      setStatementLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatementMeta();
  }, [loadStatementMeta]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((type: ToastState['type'], message: string) => {
    setToast({ type, message });
  }, []);

  const openUploadModal = useCallback(() => {
    setReportFile(null);
    setShowUploadModal(true);
  }, []);

  const closeUploadModal = useCallback(() => {
    setShowUploadModal(false);
    setReportFile(null);
  }, []);

  const closeViewModal = useCallback(() => {
    setShowViewModal(false);
    if (statementPreviewUrl) {
      window.URL.revokeObjectURL(statementPreviewUrl);
    }
    setStatementPreviewUrl(null);
  }, [statementPreviewUrl]);

  const handleViewStatementPdf = useCallback(async () => {
    try {
      setIsViewingPdf(true);
      const token = localStorage.getItem('authToken');
      const response = await fetch(
        `/api/daily-bank-statement/file?currency=${encodeURIComponent(STATEMENT_CURRENCY)}`,
        {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      if (!response.ok) {
        let errorMessage = 'Failed to open statement PDF.';
        try {
          const errorBody = await response.json();
          errorMessage = String(errorBody?.message || errorBody?.error || errorMessage);
        } catch {
          // keep default message
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      if (statementPreviewUrl) {
        window.URL.revokeObjectURL(statementPreviewUrl);
      }
      setStatementPreviewUrl(url);
      setShowViewModal(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open statement PDF.';
      showToast('error', message);
    } finally {
      setIsViewingPdf(false);
    }
  }, [showToast, statementPreviewUrl]);

  const handleReportUpload = useCallback(async () => {
    if (!reportFile) {
      showToast('error', 'Please select a report file first.');
      return;
    }
    if (!reportFile.name.toLowerCase().endsWith('.pdf')) {
      showToast('error', 'Only PDF files are allowed.');
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', reportFile, reportFile.name);
      await api.post(`/daily-bank-statement?currency=${encodeURIComponent(STATEMENT_CURRENCY)}`, formData);
      await loadStatementMeta();
      showToast('success', `Statement "${reportFile.name}" uploaded successfully.`);
      setShowUploadModal(false);
      setReportFile(null);
    } catch {
      showToast('error', 'Failed to upload statement. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [loadStatementMeta, reportFile, showToast]);

  const sortedTransactions = useMemo(
    () =>
      [...transactions].sort((a, b) => {
        const aDate = parseGbpTransactionDate(a.date);
        const bDate = parseGbpTransactionDate(b.date);
        if (!aDate && !bDate) return Number(b.id || 0) - Number(a.id || 0);
        if (!aDate) return 1;
        if (!bDate) return -1;
        const byDate = bDate.getTime() - aDate.getTime();
        if (byDate !== 0) return byDate;
        return Number(b.id || 0) - Number(a.id || 0);
      }),
    [transactions]
  );

  const filteredTransactions = useMemo(
    () =>
      filterFxAdcbTransactions(
        sortedTransactions,
        filters,
        activeTab,
        parseGbpTransactionDate
      ),
    [sortedTransactions, filters, activeTab]
  );

  const loadCategories = useCallback(async () => {
    setLoadingCategories(true);
    try {
      const toArray = (value: unknown): Array<Record<string, unknown>> => {
        if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
        if (value && typeof value === 'object') {
          const nested = value as Record<string, unknown>;
          for (const key of ['data', 'items', 'categories', 'receivables', 'payables', 'results', 'rows']) {
            const v = nested[key];
            if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
          }
        }
        return [];
      };

      const [debtorsRes, creditorsRes] = await Promise.all([
        receivablesService.getReceivables(),
        payablesService.getPayables(),
      ]);
      if (debtorsRes.success) {
        const debtors = toArray(debtorsRes.data)
          .map((item, index) => ({
            id: String(item.id ?? item.value ?? `debtor-${index}`),
            name: String(item.name ?? item.customerName ?? item.customer_name ?? '').trim(),
          }))
          .filter((item) => item.name.length > 0);
        setDebtorsList(debtors);
      }
      if (creditorsRes.success) {
        const creditors = toArray(creditorsRes.data)
          .map((item, index) => ({
            id: String(item.id ?? item.value ?? `creditor-${index}`),
            name: String(item.name ?? item.vendorName ?? item.vendor_name ?? '').trim(),
          }))
          .filter((item) => item.name.length > 0);
        setCreditorsList(creditors);
      }
    } catch (e) {
      console.error('[GbpTranstion] Failed to load debtors/creditors list', e);
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (!isModalOpen) return;
    void loadCategories();
  }, [isModalOpen, loadCategories]);

  const handleAddNew = () => {
    setEditingTransaction(null);
    setError(null);
    setFormInitialValues({ ...emptyFxAdcbFormValues });
    setIsModalOpen(true);
  };

  const handleEdit = (transaction: GbpTransaction) => {
    setEditingTransaction(transaction);

    const { type, amount, bankCharges } = fxEditFormAmountAndBankCharges(
      transaction.debit,
      transaction.credit,
      transaction.bankCharges
    );
    const { paymentType, chequeNumber } = fxAdcbPaymentTypeFromDetails(transaction.details || '');
    const resolvedType = (type || 'Debit') as 'Debit' | 'Credit';
    const categoryId = resolveFxAdcbCategoryId(
      transaction.description || '',
      resolvedType,
      creditorsList,
      debtorsList
    );

    setFormInitialValues({
      date: apiDateToTransactionFormDate(transaction.date),
      type: resolvedType,
      categoryId,
      paymentType: paymentType || 'cash',
      chequeNumber,
      amount,
      bankCharges,
      remarks: transaction.remarks ?? '',
    });
    setError(null);
    setIsModalOpen(true);
  };

  // Handle Delete
  const handleDeleteClick = (transaction: GbpTransaction) => {
    setTransactionToDelete(transaction);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete?.id) return;
    
    try {
      setLoading(true);
      const response = await transactionService.deleteGbpTransaction(String(transactionToDelete.id));
      
      if (response.success) {
        if (isChangeRequestQueuedResponse(response)) {
          setToast({
            type: 'success',
            message: userMessageFromChangeRequestSubmit(response),
          });
          setIsDeleteDialogOpen(false);
          setTransactionToDelete(null);
          return;
        }
        if (isImmediateMutationSuccess(response)) {
          await fetchTransactions();
          setToast({ type: 'success', message: response.message || 'Transaction deleted.' });
        }
        setIsDeleteDialogOpen(false);
        setTransactionToDelete(null);
      } else {
        setError('Failed to delete transaction');
      }
    } catch (err: unknown) {
      console.error('Error deleting transaction:', err);
      setError(mutationErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async (values: FxAdcbFormValues) => {
    try {
      setLoading(true);
      setError(null);

      const amountValue =
        values.amount && values.amount.trim() !== ''
          ? parseFloat(values.amount.replace(/,/g, ''))
          : 0;
      const bankChargesValue =
        values.bankCharges && values.bankCharges.trim() !== ''
          ? parseFloat(values.bankCharges.replace(/,/g, ''))
          : 0;
      const hasAmount = !isNaN(amountValue) && amountValue > 0;
      const hasBankCharges = !isNaN(bankChargesValue) && bankChargesValue > 0;

      const categoryList = values.type === 'Debit' ? creditorsList : debtorsList;
      const category = categoryList.find((c) => String(c.id) === values.categoryId);
      const description = category?.name ?? '';

      const details = fxAdcbDetailsFromPaymentType(
        values.paymentType,
        values.chequeNumber ?? ''
      );

      const payload = {
        date: formatDateForApi(values.date) || values.date.trim(),
        description,
        details,
        ...(values.remarks?.trim()
          ? { remarks: values.remarks.trim() }
          : editingTransaction?.id
            ? { remarks: null }
            : {}),
        ...buildFxDebitCreditBankChargesPayload(
          values.type,
          amountValue,
          bankChargesValue,
          hasAmount,
          hasBankCharges
        ),
      };

      let response: ApiResponse<BankTransactionType>;

      if (editingTransaction?.id) {
        response = await transactionService.updateGbpTransaction(String(editingTransaction.id), payload);
      } else {
        response = await transactionService.createGbpTransaction(payload);
      }

      if (response.success) {
        if (isChangeRequestQueuedResponse(response)) {
          setToast({
            type: 'success',
            message: userMessageFromChangeRequestSubmit(response),
          });
          setIsModalOpen(false);
          setEditingTransaction(null);
          return;
        }
        await fetchTransactions();
        setToast({
          type: 'success',
          message:
            response.message ||
            (editingTransaction ? 'Transaction updated.' : 'Transaction created.'),
        });
        setIsModalOpen(false);
        setEditingTransaction(null);
      } else {
        setError('Failed to save transaction');
      }
    } catch (err: unknown) {
      console.error('Error saving transaction:', err);
      setError(mutationErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Helper function to format date for Excel (dd-mmm-yy format like "31-Dec-25")
  const formatDateForExcel = (date: Date | string | null): string => {
    if (!date) return '';
    
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      if (isNaN(dateObj.getTime())) return '';
      
      const day = String(dateObj.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[dateObj.getMonth()];
      const year = String(dateObj.getFullYear()).slice(-2); // Last 2 digits of year
      
      return `${day}-${month}-${year}`;
    } catch {
      return '';
    }
  };

  const handleDownloadExcel = async () => {
    if (filteredTransactions.length === 0) {
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('GBP Transactions');
      let currentRow = 1;

      // Helper function to add a row with optional styling
      const addRow = (values: any[], style?: Partial<ExcelJS.Style>) => {
        const row = worksheet.addRow(values);
        const font = excelExportFont(
          style?.font && typeof style.font === 'object'
            ? (style.font as Partial<ExcelJS.Font>)
            : {}
        ) as ExcelJS.Font;
        if (style) {
          const { font: _omit, ...rest } = style;
          row.eachCell((cell) => {
            Object.assign(cell, { ...rest, font });
          });
        } else {
          row.eachCell((cell) => {
            cell.font = font;
          });
        }
        currentRow++;
        return row;
      };

      // Header rows
      addRow(['ADCB GCEC CLOUD (GBP)'], { font: { bold: true, size: 14 } });
      addRow(['Account No:', '12990685920003']);
      addRow([]);

      // Headers
      const headers = ['Date', 'Description', 'Details', 'Debit', 'Bank Charges', 'Credit', 'Balance', 'Remarks'];
      addRow(headers);
      addRow([], { font: { bold: true } });

      // Transaction rows
      filteredTransactions.forEach((transaction) => {
        const debitValue = transaction.debit ? parseFloat(String(transaction.debit).replace(/,/g, '')) : 0;
        const bankChargesValue = transaction.bankCharges ? parseFloat(String(transaction.bankCharges).replace(/,/g, '')) : 0;
        const creditValue = transaction.credit ? parseFloat(String(transaction.credit).replace(/,/g, '')) : 0;
        const balanceValue = transaction.balance ? parseFloat(String(transaction.balance).replace(/,/g, '')) : 0;
        
        // Check if this row should have red text and light blue background (if bank charges exist)
        const hasBankCharges = bankChargesValue > 0;
        const hasDebit = debitValue > 0;
        
        const row = addRow([
          formatDateForExcel(transaction.date),
          transaction.description,
          transaction.details,
          debitValue,
          bankChargesValue,
          creditValue,
          balanceValue,
          transaction.remarks?.trim() || '',
        ]);

        // Format number columns with $ symbol
        row.getCell(4).numFmt = '£#,##0.00'; // Debit
        row.getCell(5).numFmt = '£#,##0.00'; // Bank Charges
        row.getCell(6).numFmt = '£#,##0.00'; // Credit
        row.getCell(7).numFmt = '£#,##0.00'; // Balance

        // Apply light blue background if bank charges exist
    

        // Apply red text based on transaction type
        if (hasBankCharges) {
          row.getCell(1).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          row.getCell(2).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          row.getCell(3).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          row.getCell(5).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
        }
        
        if (hasDebit) {
          row.getCell(1).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          row.getCell(2).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          row.getCell(3).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          row.getCell(4).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
        }

        if (balanceValue < 0) {
          row.getCell(7).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
        }
      });

      // Set column widths
      worksheet.columns = [
        { width: 15 }, // Date
        { width: 25 }, // Description
        { width: 15 }, // Details
        { width: 18 }, // Debit
        { width: 18 }, // Bank Charges
        { width: 18 }, // Credit
        { width: 18 }, // Balance
        { width: 24 }, // Remarks
      ];

      // Generate filename and download
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const fileName = `GBP-Transactions-${dateStr}.xlsx`;

      applyArialToExcelJsWorkbook(workbook);
      // Write to buffer and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading Excel:', err);
      setError(err?.message || 'Failed to download Excel file');
    }
  };

  const clearFilters = () => {
    setFilters(emptyFxAdcbFilters);
    setActiveTab('all');
  };

  const formatAmount = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined) return '-';
    const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
    return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (dateString: string): string => formatIsoDateDisplay(dateString);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
          <h2 className="text-2xl font-bold text-gray-900">ADCB GCEC CLOUD (GBP)</h2>
        </div>
        <div className="flex items-center gap-3 mr-4">
          {canMutate && (
            <Button
              onClick={handleAddNew}
              className="bg-[#a8061d] hover:bg-[#6b0210] text-black flex items-center space-x-2 transition-colors rounded-lg"
              disabled={loading}
            >
              <Plus className="w-4 h-4 text-black" />
              <span>Add New</span>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <FxAdcbTransactionFilterBar
        filters={filters}
        activeTab={activeTab}
        onFiltersChange={setFilters}
        onActiveTabChange={setActiveTab}
        onClearFilters={clearFilters}
        toolbarActions={
          <>
            <Button
              onClick={handleViewStatementPdf}
              variant="outline"
              className="flex items-center gap-2 border-gray-300 hover:bg-gray-50 text-black font-semibold"
              disabled={statementLoading || isViewingPdf || !statementMeta}
              title="View bank statement"
            >
              <Eye className="h-4 w-4" />
              <span>{isViewingPdf ? 'Opening...' : 'View Bank Statement'}</span>
            </Button>
            {canUploadStatements() && (
              <Button
                onClick={openUploadModal}
                variant="outline"
                className="flex items-center gap-2 border-gray-300 hover:bg-gray-50 text-black"
                disabled={isUploading}
                title="Upload bank statement"
              >
                <Upload className="h-4 w-4" />
                <span>Upload Bank Statement</span>
              </Button>
            )}
            <Button
              onClick={handleDownloadExcel}
              variant="outline"
              className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black font-semibold"
              disabled={loading || filteredTransactions.length === 0}
            >
              <Download className="w-4 h-4" />
              <span>Download Excel</span>
            </Button>
          </>
        }
      />

      <div className="mx-4">
        {loading && transactions.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-[#d90522]" />
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {filters.startDate ||
            filters.endDate ||
            filters.searchDetails ||
            filters.searchAmount ||
            filters.searchDescription ||
            activeTab !== 'all'
              ? 'No transactions match your filters.'
              : 'No transactions found. Click "Add New" to create one.'}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#a8061d] border-0">
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Date</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Description</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Details</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Debit</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Bank Charges</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Credit</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Balance</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Remarks</TableHead>
                    {canMutate && (
                      <TableHead className="font-semibold text-black text-sm text-left py-1 px-3">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((transaction) => (
                    <TableRow key={transaction.id} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
                      <TableCell className="text-gray-700 text-sm py-1 px-3">{formatDate(transaction.date)}</TableCell>
                      <TableCell className="text-gray-700 font-medium text-sm py-1 px-3">{transaction.description}</TableCell>
                      <TableCell className="text-gray-600 text-sm py-1 px-3">{transaction.details}</TableCell>
                      <TableCell className="text-sm py-1 px-3">
                        {transaction.debit ? (
                          <span className="text-red-600 font-semibold">£{formatAmount(transaction.debit)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-1 px-3">
                        {transaction.bankCharges ? (
                          <span className="text-red-600 font-semibold">£{formatAmount(transaction.bankCharges)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-1 px-3">
                        {transaction.credit ? (
                          <span className="text-black font-semibold">£{formatAmount(transaction.credit)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-1 px-3">
                        {(() => {
                          const balanceValue = transaction.balance ? parseFloat(String(transaction.balance).replace(/,/g, '')) : 0;
                          const isNegative = balanceValue < 0;
                          return (
                            <span className={`font-semibold ${isNegative ? 'text-red-600' : 'text-gray-700'}`}>
                              £{formatAmount(transaction.balance)}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-gray-600 text-sm py-1 px-3 max-w-[12rem] truncate" title={transaction.remarks || undefined}>
                        {transaction.remarks?.trim() || ''}
                      </TableCell>
                      {canMutate && (
                        <TableCell className="text-sm py-1 px-3">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(transaction)}
                              disabled={loading}
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(transaction)}
                              disabled={loading}
                              className="h-8 w-8 p-0"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {canUploadStatements() && showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-lg font-semibold text-gray-900">Upload Report</h3>
              <button
                onClick={closeUploadModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close upload modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <label className="block text-sm font-medium text-gray-700">Select statement file</label>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null;
                  setReportFile(selected);
                }}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#a8061d] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black"
              />
              {reportFile && <p className="text-xs text-gray-600">Selected: {reportFile.name}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button
                onClick={closeUploadModal}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReportUpload}
                disabled={isUploading}
                className="rounded bg-[#a8061d] px-4 py-2 text-sm font-semibold text-black hover:bg-[#8f0e1c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showViewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-6xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-lg font-semibold text-gray-900">Bank Statement Preview</h3>
              <button
                onClick={closeViewModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close statement preview modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[75vh] w-full bg-gray-100">
              {statementPreviewUrl ? (
                <iframe
                  title="Bank Statement PDF"
                  src={statementPreviewUrl}
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  Unable to load statement preview.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button
                onClick={closeViewModal}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed right-4 top-4 z-[70] rounded-md border px-4 py-2 text-sm shadow-lg ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      <FxAdcbTransactionFormDialog
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open);
          if (!open) {
            setEditingTransaction(null);
            setError(null);
          }
        }}
        currencyLabel="GBP"
        currencySymbol="£"
        editing={!!editingTransaction}
        initialValues={formInitialValues}
        payablesCategories={creditorsList}
        receivablesCategories={debtorsList}
        loadingCategories={loadingCategories}
        isSubmitting={loading}
        error={error}
        onSubmit={handleFormSubmit}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) {
            setTransactionToDelete(null);
          }
        }}
        onConfirm={handleDeleteConfirm}
        itemName={(() => {
          if (!transactionToDelete) return '';
          const date = formatDate(transactionToDelete.date);
          const description = transactionToDelete.description || 'Unknown';
          const debitValue = transactionToDelete.debit ? parseFloat(String(transactionToDelete.debit).replace(/,/g, '')) : 0;
          const creditValue = transactionToDelete.credit ? parseFloat(String(transactionToDelete.credit).replace(/,/g, '')) : 0;
          const amount = debitValue > 0 ? debitValue : creditValue;
          const amountText = amount > 0 ? `£${formatAmount(amount)}` : '';
          return `GBP transaction dated ${date}${description ? ` for "${description}"` : ''}${amountText ? ` (${amountText})` : ''}`;
        })()}
        isLoading={loading}
      />
    </Layout>
  );
}