import { Button } from '@/components/ui/button';
import Layout from '../components/Layout';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileSpreadsheet, Plus, Edit, Trash2, Loader2, Search, Upload } from 'lucide-react';
import type { ApiResponse } from '../lib/api';
import { transactionService, type BankTransaction as BankTransactionType } from '../services/transactionService';
import ExcelJS from 'exceljs';
import { applyArialToExcelJsWorkbook, excelExportFont } from '../lib/excelExportFont';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { SearchableSelect } from '../components/ui/searchable-select';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import BulkFkEmiratesUploadDialog from '../components/BulkFkEmiratesUploadDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Checkbox } from '../components/ui/checkbox';
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import { canMutateRecords } from '../lib/authPayload';

interface FkEmritsTransaction {
  id?: string | number;
  date: string;
  description: string;
  details: string;
  debit?: number | string | null;
  credit?: number | string | null;
  bankCharges?: number | string | null;
  balance?: number | string;
  currency?: string;
  accountNumber?: string | null;
}

type Currency = 'AED' | 'USD' | 'GBP';

export default function FkEmrits() {
  const canMutate = canMutateRecords();
  const [loading, setLoading] = useState(false);
  const [allTransactions, setAllTransactions] = useState<FkEmritsTransaction[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('AED');
  const [filterText, setFilterText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<FkEmritsTransaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<FkEmritsTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debtorsList, setDebtorsList] = useState<ReceivablesCategory[]>([]);
  const [creditorsList, setCreditorsList] = useState<PayablesCategory[]>([]);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  
  // Form state
  const [formData, setFormData] = useState<{
    date: string;
    description: string;
    type: 'Debit' | 'Credit' | '';
    paymentType: 'cheque' | 'online' | 'cash' | 'creditcard' | '';
    chequeNumber: string;
    amount: string;
    bankCharges: string;
  }>({
    date: '',
    description: '',
    type: '',
    paymentType: '',
    chequeNumber: '',
    amount: '',
    bankCharges: '',
  });

  // Get currency symbol
  const getCurrencySymbol = (currency: Currency): string => {
    switch (currency) {
      case 'AED': return 'AED';
      case 'USD': return '$';
      case 'GBP': return '£';
      default: return '$';
    }
  };

  // Fetch all transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response: ApiResponse<any> = await transactionService.getFkEmiratesTransactions(
        selectedCurrency
      );
      
      if (response.success && response.data) {
        // API returns all transactions - map to camelCase
        const mappedTransactions: FkEmritsTransaction[] = response.data.map((txn: any) => ({
          id: txn.id,
          date: txn.date,
          description: txn.description || '',
          details: txn.details || '',
          debit: txn.debit,
          credit: txn.credit,
          bankCharges: txn.bankCharges,
          balance: txn.balance,
          currency: txn.currency, // Keep currency for filtering
          accountNumber: txn.accountNumber || null,
        }));
        setAllTransactions(mappedTransactions);
      } else {
        setError('Failed to fetch transactions');
      }
    } catch (err: any) {
      console.error('Error fetching FK Emirates transactions:', err);
      setError(err?.message || 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  }, [selectedCurrency]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    if (!isModalOpen) return;
    let cancelled = false;

    const toArray = (value: unknown): Array<Record<string, unknown>> => {
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
      if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        if (Array.isArray(nested.data)) return nested.data as Array<Record<string, unknown>>;
        if (Array.isArray(nested.items)) return nested.items as Array<Record<string, unknown>>;
      }
      return [];
    };

    void (async () => {
      try {
        const [debtorsRes, creditorsRes] = await Promise.all([
          receivablesService.getReceivables(),
          payablesService.getPayables(),
        ]);
        if (!cancelled && debtorsRes.success) {
          const debtors = toArray(debtorsRes.data)
            .map((item, index) => ({
              id: String(item.id ?? item.value ?? `debtor-${index}`),
              name: String(item.name ?? item.customerName ?? item.customer_name ?? '').trim(),
            }))
            .filter((item) => item.name.length > 0);
          setDebtorsList(debtors);
        }
        if (!cancelled && creditorsRes.success) {
          const creditors = toArray(creditorsRes.data)
            .map((item, index) => ({
              id: String(item.id ?? item.value ?? `creditor-${index}`),
              name: String(item.name ?? item.vendorName ?? item.vendor_name ?? '').trim(),
            }))
            .filter((item) => item.name.length > 0);
          setCreditorsList(creditors);
        }
      } catch (e) {
        console.error('[FkEmrits] Failed to load debtors/creditors list', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isModalOpen]);

  // Helper function to format date
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      if (Number.isNaN(date.getTime())) return dateString;
      const day = String(date.getDate()).padStart(2, '0');
      const month = date.toLocaleString('en-US', { month: 'short' });
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return dateString;
    }
  };

  const parseDateForSort = (dateString: string): Date | null => {
    const parsed = new Date(dateString);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const parts = String(dateString).split('/');
    if (parts.length === 3) {
      const day = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const year = Number(parts[2]);
      const fallback = new Date(year, month, day);
      if (!Number.isNaN(fallback.getTime())) return fallback;
    }
    return null;
  };

  // Filter transactions by selected currency first, then by search text
  const filteredTransactions = useMemo(() => {
    // First filter by selected currency
    let currencyFiltered = allTransactions.filter((txn: FkEmritsTransaction) => txn.currency === selectedCurrency);
    
    // Then filter by search text if provided
    if (filterText.trim()) {
      const searchLower = filterText.toLowerCase();
      currencyFiltered = currencyFiltered.filter((txn: FkEmritsTransaction) => {
        const description = (txn.description || '').toLowerCase();
        const details = (txn.details || '').toLowerCase();
        const date = formatDate(txn.date).toLowerCase();
        return description.includes(searchLower) || details.includes(searchLower) || date.includes(searchLower);
      });
    }

    // Always show newest first in table view.
    return [...currencyFiltered].sort((a, b) => {
      const aDate = parseDateForSort(a.date);
      const bDate = parseDateForSort(b.date);
      if (!aDate && !bDate) return Number(b.id || 0) - Number(a.id || 0);
      if (!aDate) return 1;
      if (!bDate) return -1;
      const byDate = bDate.getTime() - aDate.getTime();
      if (byDate !== 0) return byDate;
      return Number(b.id || 0) - Number(a.id || 0);
    });
  }, [allTransactions, selectedCurrency, filterText]);

  const selectableInView = useMemo(
    () =>
      filteredTransactions.filter((t) => t.id != null && String(t.id).trim() !== ''),
    [filteredTransactions]
  );

  useEffect(() => {
    const allowed = new Set(selectableInView.map((t) => String(t.id)));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      if (next.size === prev.size && [...prev].every((id) => next.has(id))) return prev;
      return next;
    });
  }, [selectableInView]);

  const allInViewSelected =
    selectableInView.length > 0 &&
    selectableInView.every((t) => selectedIds.has(String(t.id)));
  const someInViewSelected = selectableInView.some((t) => selectedIds.has(String(t.id)));

  const toggleRowSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInView = () => {
    setSelectedIds(new Set(selectableInView.map((t) => String(t.id))));
  };

  const clearRowSelection = () => setSelectedIds(new Set());

  const handleBulkDeleteConfirm = async () => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) {
      setIsBulkDeleteDialogOpen(false);
      return;
    }
    try {
      setBulkDeleting(true);
      setError(null);
      await transactionService.bulkDeleteFkEmiratesTransactions(ids, selectedCurrency);
      clearRowSelection();
      setIsBulkDeleteDialogOpen(false);
      await fetchTransactions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

  const isBusy = loading || bulkDeleting;

  // Handle Add New
  const handleAddNew = () => {
    setEditingTransaction(null);
    setFormData({
      date: '',
      description: '',
      type: '',
      paymentType: '',
      chequeNumber: '',
      amount: '',
      bankCharges: '',
    });
    setIsModalOpen(true);
  };

  // Handle Edit
  const handleEdit = (transaction: FkEmritsTransaction) => {
    setEditingTransaction(transaction);
    
    // Determine type based on debit/credit
    const type = transaction.debit && parseFloat(String(transaction.debit)) > 0 
      ? 'Debit' 
      : transaction.credit && parseFloat(String(transaction.credit)) > 0 
      ? 'Credit' 
      : '';
    
    // Get amount value
    const amount = transaction.debit && parseFloat(String(transaction.debit)) > 0
      ? String(transaction.debit)
      : transaction.credit && parseFloat(String(transaction.credit)) > 0
      ? String(transaction.credit)
      : '';
    
    // Map details to paymentType (normalize to match dropdown values)
    let paymentType: 'cheque' | 'online' | 'cash' | 'creditcard' | '' = '';
    const detailsLower = (transaction.details || '').toLowerCase();
    if (detailsLower.includes('cheque')) {
      paymentType = 'cheque';
    } else if (detailsLower.includes('online')) {
      paymentType = 'online';
    } else if (detailsLower.includes('cash')) {
      paymentType = 'cash';
    } else if (detailsLower.includes('credit') || detailsLower.includes('card')) {
      paymentType = 'creditcard';
    }
    
    setFormData({
      date: transaction.date || '',
      description: transaction.description || '',
      type: type as 'Debit' | 'Credit' | '',
      paymentType: paymentType,
      chequeNumber: (transaction as any).chequeNumber || '',
      amount: amount,
      bankCharges: transaction.bankCharges ? String(transaction.bankCharges) : '',
    });
    setIsModalOpen(true);
  };

  // Handle Delete
  const handleDeleteClick = (transaction: FkEmritsTransaction) => {
    setTransactionToDelete(transaction);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete?.id) return;
    
    try {
      setLoading(true);
      const response = await transactionService.deleteFkEmiratesTransaction(
        String(transactionToDelete.id),
        selectedCurrency
      );
      
      if (response.success) {
        await fetchTransactions();
        setIsDeleteDialogOpen(false);
        setTransactionToDelete(null);
      } else {
        setError('Failed to delete transaction');
      }
    } catch (err: any) {
      console.error('Error deleting transaction:', err);
      setError(err?.message || 'Failed to delete transaction');
    } finally {
      setLoading(false);
    }
  };

  // Handle Save (Create or Update)
  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Validation
      if (!formData.type) {
        setError('Please select a type (Debit or Credit)');
        setLoading(false);
        return;
      }
      if (!formData.paymentType) {
        setError('Please select a payment type');
        setLoading(false);
        return;
      }
      if (!formData.amount || formData.amount.trim() === '') {
        setError('Please enter an amount');
        setLoading(false);
        return;
      }
      if (formData.paymentType === 'cheque' && !formData.chequeNumber.trim()) {
        setError('Cheque number is required when payment type is cheque');
        setLoading(false);
        return;
      }
      
      // Convert paymentType to details format
      let details = '';
      if (formData.paymentType === 'cheque') {
        details = formData.chequeNumber; // Use cheque number as details
      } else if (formData.paymentType === 'creditcard') {
        details = 'Credit Card';
      } else {
        details = formData.paymentType.charAt(0).toUpperCase() + formData.paymentType.slice(1);
      }
      
      // Parse and validate amount
      const amountValue = parseFloat(formData.amount.replace(/,/g, ''));
      if (isNaN(amountValue) || amountValue <= 0) {
        setError('Please enter a valid amount greater than 0');
        setLoading(false);
        return;
      }
      
      const payload: any = {
        date: formData.date,
        description: formData.description,
        details: details,
      };
      
      // Set debit or credit based on type - always set both fields
      if (formData.type === 'Debit') {
        payload.debit = amountValue; // Send as number, service will handle conversion
        payload.credit = 0; // Always set credit to 0 for debit transactions
      } else if (formData.type === 'Credit') {
        payload.credit = amountValue; // Send as number, service will handle conversion
        payload.debit = 0; // Always set debit to 0 for credit transactions
      }
      
      // Bank charges - only include if provided and valid
      if (formData.bankCharges && formData.bankCharges.trim() !== '') {
        const bankChargesValue = parseFloat(formData.bankCharges.replace(/,/g, ''));
        if (!isNaN(bankChargesValue) && bankChargesValue >= 0) {
          payload.bankCharges = bankChargesValue;
        }
      }
      
      // Add currency to payload
      payload.currency = selectedCurrency;
      
      let response: ApiResponse<BankTransactionType>;
      
      if (editingTransaction?.id) {
        // Update
        response = await transactionService.updateFkEmiratesTransaction(String(editingTransaction.id), payload);
      } else {
        // Create
        response = await transactionService.createFkEmiratesTransaction(payload);
      }
      
      if (response.success) {
        await fetchTransactions();
        setIsModalOpen(false);
        setEditingTransaction(null);
      } else {
        setError('Failed to save transaction');
      }
    } catch (err: any) {
      console.error('Error saving transaction:', err);
      setError(err?.message || 'Failed to save transaction');
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
    if (allTransactions.length === 0) {
      setError('No transactions available to download');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('FK Emirates NBD Transactions');
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

      // Group transactions by currency
      const transactionsByCurrency: Record<string, FkEmritsTransaction[]> = {
        AED: [],
        USD: [],
        GBP: [],
      };

      allTransactions.forEach((txn) => {
        const currency = txn.currency || 'AED';
        if (transactionsByCurrency[currency]) {
          transactionsByCurrency[currency].push(txn);
        }
      });

      // Check if we have any transactions
      const hasAnyTransactions = Object.values(transactionsByCurrency).some(arr => arr.length > 0);
      if (!hasAnyTransactions) {
        setError('No transactions available to download');
        setLoading(false);
        return;
      }

      // Process each currency section
      const currencies: Currency[] = ['AED', 'USD', 'GBP'];
      
      currencies.forEach((currency) => {
        const currencyTransactions = transactionsByCurrency[currency];
        if (currencyTransactions.length === 0) return;

        // Section Title - merge across all columns
        const titleText = `FK EMIRATES NBD (${currency})`;
        const titleRow = addRow([titleText, '', '', '', '', '']);
        // Merge cells for title spanning all 6 columns
        const titleStartRow = currentRow - 1;
        try {
          worksheet.mergeCells(titleStartRow, 1, titleStartRow, 6);
        } catch (e) {
          // If merge fails, continue without merge
          console.warn('Could not merge title cells:', e);
        }
        const titleCell = titleRow.getCell(1);
        titleCell.font = excelExportFont({
          bold: true,
          size: 14,
          color: { argb: 'FF000000' },
        }) as ExcelJS.Font;
        titleCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb:  'FFFFFFFF' } // Green for AED, white for others
        };
        titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
        // Add black border to title row
        titleRow.eachCell((cell) => {
          cell.border = {
            top: { style: 'medium', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            left: { style: 'medium', color: { argb: 'FF000000' } },
            right: { style: 'medium', color: { argb: 'FF000000' } }
          };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Account Number - only show for AED
        if (currency === 'AED') {
            addRow([]);
          addRow(['Account No:', '1014123881301'] ,{font:{bold:true}});

        } else {
            addRow([]);
          addRow(['Account No:', ''],{font:{bold:true}});
        }
        addRow([]); // Empty row

        // Table Headers
        const headers = ['Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance'];
        const headerRow = addRow(headers);
        headerRow.font = excelExportFont({
          bold: true,
          color: { argb: 'FF000000' },
        }) as ExcelJS.Font;
        addRow([]);
        // Get currency format - use proper Excel number format
        let currencyFormat: string;
        if (currency === 'AED') {
          currencyFormat = '"AED"#,##0.00'; // AED prefix format like "AED5,367.50"
        } else if (currency === 'USD') {
          currencyFormat = '$#,##0.00';
        } else {
          currencyFormat = '£#,##0.00';
        }

        // Transaction rows
        currencyTransactions.forEach((transaction) => {
          const debitValue = transaction.debit ? parseFloat(String(transaction.debit).replace(/,/g, '')) : 0;
          const creditValue = transaction.credit ? parseFloat(String(transaction.credit).replace(/,/g, '')) : 0;
          const balanceValue = transaction.balance ? parseFloat(String(transaction.balance).replace(/,/g, '')) : 0;
          const hasDebit = !isNaN(debitValue) && debitValue > 0;
          
          // Ensure values are valid numbers
          const safeDebit = isNaN(debitValue) ? 0 : debitValue;
          const safeCredit = isNaN(creditValue) ? 0 : creditValue;
          const safeBalance = isNaN(balanceValue) ? 0 : balanceValue;
          
          const row = addRow([
            formatDateForExcel(transaction.date),
            transaction.description || '',
            transaction.details || '',
            safeDebit,
            safeCredit,
            safeBalance,
          ]);

          // Border add nahi karna (No need to add borders here)

          // Format number columns with currency symbol
          const debitCell = row.getCell(4);
          const creditCell = row.getCell(5);
          const balanceCell = row.getCell(6);
          
          debitCell.numFmt = currencyFormat;
          creditCell.numFmt = currencyFormat;
          balanceCell.numFmt = currencyFormat;

          // Debit column: Always red text (even if 0.00)
          debitCell.font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          
          if (hasDebit) {
            row.getCell(1).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
            row.getCell(2).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
            row.getCell(3).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          }

          creditCell.font = excelExportFont({ color: { argb: 'FF000000' } }) as ExcelJS.Font;

          if (safeBalance < 0) {
            balanceCell.font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
          } else if (safeBalance > 0) {
            balanceCell.font = excelExportFont({ color: { argb: 'FF0000FF' } }) as ExcelJS.Font;
          }
        });

        // Empty row between sections
        addRow([]);
        addRow([]);
      });

      // Set column widths
      worksheet.columns = [
        { width: 15 }, // Date
        { width: 40 }, // Description
        { width: 15 }, // Details
        { width: 18 }, // Debit
        { width: 18 }, // Credit
        { width: 18 }, // Balance
      ];

      // Generate filename and download
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const fileName = `FK-Emirates-All-Currencies-${dateStr}.xlsx`;

      // Write to buffer and download
      applyArialToExcelJsWorkbook(workbook);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
      setError(null);
    } catch (err: any) {
      console.error('Error downloading Excel:', err);
      setError(err?.message || 'Failed to download Excel file. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined) return '-';
    const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
    return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const currencySymbol = getCurrencySymbol(selectedCurrency);
  const shouldShowBankCharges = selectedCurrency !== 'AED';

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
          <h2 className="text-2xl font-bold text-gray-900">FK EMIRATES NBD</h2>
        </div>
        <div className="flex items-center gap-3 mr-4">
          <Button
            onClick={handleDownloadExcel}
            variant="outline"
            className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black"
            disabled={isBusy || allTransactions.length === 0}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Download Excel</span>
          </Button>
          <Button
            onClick={() => {
              setError(null);
              setBulkUploadOpen(true);
            }}
            variant="outline"
            className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black"
            disabled={isBusy}
          >
            <Upload className="w-4 h-4" />
            <span>Bulk upload</span>
          </Button>
          {canMutate && (
            <Button
            type="button"
            onClick={() => {
              setError(null);
              setIsBulkDeleteDialogOpen(true);
            }}
            variant="outline"
            className="flex items-center space-x-2 border-red-200 text-red-700 hover:bg-red-50"
            disabled={isBusy || selectedIds.size === 0}
          >
            <Trash2 className="w-4 h-4" />
            <span>Bulk delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
            </Button>
          )}
          {canMutate && (
            <Button
            onClick={handleAddNew}
            className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black flex items-center space-x-2 transition-colors rounded-lg"
            disabled={isBusy}
          >
            <Plus className="w-4 h-4 text-black" />
            <span>Add New</span>
            </Button>
          )}
        </div>
      </div>

      {/* Currency Tabs */}
      <div className="mx-8 mb-4 flex gap-1 border-b border-gray-200">
        {(['AED', 'USD', 'GBP'] as Currency[]).map((currency) => (
          <button
            key={currency}
            onClick={() => {
              setSelectedCurrency(currency);
              setFilterText(''); // Reset filter when switching currency
            }}
            className={`px-6 py-3 font-medium text-sm transition-colors ${
              selectedCurrency === currency
                ? 'text-gray-900 border-b-2 border-[#f7c46d]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {currency}
          </button>
        ))}
      </div>

      {/* Filter Section */}
      <div className="mx-8 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            type="text"
            placeholder="Filter by description, details, or date..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {error && (
        <div className="mx-8 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {canMutate && filteredTransactions.length > 0 && (
        <div className="mx-8 mb-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="text-white"
            disabled={selectedIds.size === 0 || isBusy}
            onClick={() => setIsBulkDeleteDialogOpen(true)}
          >
            Delete selected ({selectedIds.size})
          </Button>
          {selectedIds.size > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={clearRowSelection}
            >
              Clear selection
            </Button>
          )}
        </div>
      )}

      <div className="mx-8">
        {loading && allTransactions.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-[#f7c46d]" />
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {filterText ? 'No transactions match your filter.' : 'No transactions found. Click "Add New" to create one.'}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#f7c46d] border-0">
                    {canMutate && (
                      <TableHead className="w-10 py-3 px-2">
                      <Checkbox
                        disabled={selectableInView.length === 0 || isBusy}
                        checked={
                          allInViewSelected
                            ? true
                            : someInViewSelected
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(v) => {
                          if (v === true) selectAllInView();
                          else clearRowSelection();
                        }}
                        aria-label="Select all visible rows"
                      />
                      </TableHead>
                    )}
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Date</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Description</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Details</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Debit</TableHead>
                    {shouldShowBankCharges && (
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Bank Charges</TableHead>
                    )}
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Credit</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Balance</TableHead>
                    {canMutate && (
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((transaction) => {
                    const rowId =
                      transaction.id != null && String(transaction.id).trim() !== ''
                        ? String(transaction.id)
                        : null;
                    return (
                    <TableRow key={rowId ?? `${transaction.date}-${transaction.description}-${transaction.balance}`} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
                      {canMutate && (
                        <TableCell className="py-3 px-2">
                        <Checkbox
                          disabled={!rowId || isBusy}
                          checked={rowId ? selectedIds.has(rowId) : false}
                          onCheckedChange={() => rowId && toggleRowSelected(rowId)}
                          aria-label={`Select row ${transaction.description || ''}`}
                        />
                        </TableCell>
                      )}
                      <TableCell className="text-gray-700 text-sm py-3 px-4">{formatDate(transaction.date)}</TableCell>
                      <TableCell className="text-gray-700 font-medium text-sm py-3 px-4">{transaction.description}</TableCell>
                      <TableCell className="text-gray-600 text-sm py-3 px-4">{transaction.details}</TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        {transaction.debit ? (
                          <span className="text-red-600 font-semibold">{currencySymbol}{formatAmount(transaction.debit)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      {shouldShowBankCharges && (
                        <TableCell className="text-sm py-3 px-4">
                          {transaction.bankCharges ? (
                            <span className="text-red-600 font-semibold">{currencySymbol}{formatAmount(transaction.bankCharges)}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-sm py-3 px-4">
                        {transaction.credit ? (
                          <span className="text-black font-semibold">{currencySymbol}{formatAmount(transaction.credit)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        {(() => {
                          const balanceValue = transaction.balance ? parseFloat(String(transaction.balance).replace(/,/g, '')) : 0;
                          const isNegative = balanceValue < 0;
                          return (
                            <span className={`font-semibold ${isNegative ? 'text-red-600' : 'text-gray-700'}`}>
                              {currencySymbol}{formatAmount(transaction.balance)}
                            </span>
                          );
                        })()}
                      </TableCell>
                      {canMutate && (
                        <TableCell className="text-sm py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(transaction)}
                            disabled={isBusy}
                            className="h-8 w-8 p-0"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(transaction)}
                            disabled={isBusy}
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTransaction ? `Edit ${selectedCurrency} Transaction` : `Add New ${selectedCurrency} Transaction`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <SearchableSelect
                value={formData.description || undefined}
                onValueChange={(value) => setFormData({ ...formData, description: value })}
                placeholder="Select description"
                searchPlaceholder="Search Description..."
              >
                {(() => {
                  const debtorNames = debtorsList
                    .map((d) =>
                      String(
                        (d as unknown as Record<string, unknown>).name ??
                          (d as unknown as Record<string, unknown>).customerName ??
                          (d as unknown as Record<string, unknown>).customer_name ??
                          ''
                      ).trim()
                    )
                    .filter(Boolean);
                  const creditorNames = creditorsList
                    .map((c) =>
                      String(
                        (c as unknown as Record<string, unknown>).name ??
                          (c as unknown as Record<string, unknown>).vendorName ??
                          (c as unknown as Record<string, unknown>).vendor_name ??
                          ''
                      ).trim()
                    )
                    .filter(Boolean);
                  const descriptionOptions = [...new Set([...debtorNames, ...creditorNames])]
                    .sort((a, b) => a.localeCompare(b));
                  const current = formData.description.trim();
                  const legacyOption =
                    current && !descriptionOptions.includes(current) ? current : null;

                  return [
                    legacyOption ? (
                      <SelectItem key={`legacy-${legacyOption}`} value={legacyOption} textValue={legacyOption}>
                        {legacyOption} (not in list)
                      </SelectItem>
                    ) : null,
                    ...descriptionOptions.map((name) => (
                      <SelectItem key={name} value={name} textValue={name}>
                        {name}
                      </SelectItem>
                    )),
                  ];
                })()}
              </SearchableSelect>
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value as 'Debit' | 'Credit' | '' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Debit">Debit</SelectItem>
                  <SelectItem value="Credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="paymentType">Payment Type</Label>
              <Select
                value={formData.paymentType}
                onValueChange={(value) => setFormData({ ...formData, paymentType: value as 'cheque' | 'online' | 'cash' | 'creditcard' | '', chequeNumber: '' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Payment Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="creditcard">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.paymentType === 'cheque' && (
              <div>
                <Label htmlFor="chequeNumber">Cheque Number</Label>
                <Input
                  id="chequeNumber"
                  value={formData.chequeNumber}
                  onChange={(e) => setFormData({ ...formData, chequeNumber: e.target.value })}
                  placeholder="Enter cheque number"
                />
              </div>
            )}
            <div>
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={formData.amount}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    amount: e.target.value
                      .replace(/[^0-9.]/g, '')
                      .replace(/(\..*)\./g, '$1'),
                  })
                }
                placeholder="0"
              />
            </div>
            {shouldShowBankCharges && (
              <div>
                <Label htmlFor="bank_charges">Bank Charges</Label>
                <Input
                  id="bank_charges"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={formData.bankCharges}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      bankCharges: e.target.value
                        .replace(/[^0-9.]/g, '')
                        .replace(/(\..*)\./g, '$1'),
                    })
                  }
                  placeholder="0"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingTransaction(null);
                }}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <BulkFkEmiratesUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        currency={selectedCurrency}
        onSuccess={() => {
          void fetchTransactions();
          setError(null);
        }}
      />

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
          const currencySymbol = getCurrencySymbol(selectedCurrency);
          const amountText = amount > 0 ? `${currencySymbol}${formatAmount(amount)}` : '';
          return `transaction dated ${date}${description ? ` for "${description}"` : ''}${amountText ? ` (${amountText})` : ''}`;
        })()}
        isLoading={loading}
      />

      <DeleteConfirmationDialog
        open={isBulkDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!bulkDeleting) setIsBulkDeleteDialogOpen(open);
        }}
        onConfirm={handleBulkDeleteConfirm}
        title={`Delete ${selectedIds.size} transaction(s)?`}
        description={`This will permanently delete ${selectedIds.size} FK Emirates NBD ${selectedCurrency} row(s) using the API. This cannot be undone.`}
        itemName={undefined}
        isLoading={bulkDeleting}
        confirmButtonText="Delete all selected"
      />
    </Layout>
  );
}