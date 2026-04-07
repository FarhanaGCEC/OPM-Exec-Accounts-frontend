import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { transactionService } from '../services/transactionService';
import type { ApiResponse } from '../lib/api';
import { formatIsoDateDisplay, formatJsDateDisplay } from '../lib/formatDisplayDate';
import { remarksForDailyLedgerDisplay } from '../lib/dailyLedgerRemarksDisplay';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Calendar, ChevronDown, Download, X } from 'lucide-react';
import ExcelJS from 'exceljs';



// Transaction type definitions
interface DailyTransaction {
  id: number;
  date: string;
  transactionType: 'Daily Transaction';
  category: string;
  paymentType: string;
  chequeNumber: string | null;
  debit: string | null;
  credit: string | null;
  balance: string;
  remarks: string | null;
  /** API may send camelCase or snake_case — used for Remarks display (GCEC vs Customer PDC). */
  pdcType?: string;
  pdc_type?: string;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
}

interface GCECPDC {
  id: number;
  date: string;
  transactionType: 'GCEC PDC';
  customerName: string;
  chequeNumber: string;
  chequeType: string;
  amount: string;
  description: string | null;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
}

interface CustomerPDC {
  id: number;
  date: string;
  transactionType: 'Customer PDC';
  customerName: string;
  chequeNumber: string;
  chequeType: string;
  amount: string;
  description: string | null;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
}

interface PurchaseBill {
  id: number;
  date: string;
  transactionType: 'Purchase Bill';
  vendorName: string;
  invoiceNumber: string;
  billNumber: string | null;
  paymentMethod: string;
  amount: string;
  description: string | null;
  paymentStatus: string;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
}

type AllTransaction = DailyTransaction | GCECPDC | CustomerPDC | PurchaseBill;

interface TransactionSummary {
  dailyTransactions: number;
  gcecPdc: number;
  customerPdc: number;
  purchaseBills: number;
  total: number;
}

// Helper function to format amounts
const formatAmount = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Helper function to format date for Excel (DD-MMM-YYYY, same as Daily Transaction)
const formatDateForExcel = (date: Date | string | null): string => {
  if (!date) return '';
  if (typeof date === 'string') {
    const s = formatIsoDateDisplay(date);
    return s === '—' ? '' : s;
  }
  const s = formatJsDateDisplay(date);
  return s === '—' ? '' : s;
};

function dailyTxnPdcType(txn: DailyTransaction): string | undefined {
  return txn.pdcType ?? txn.pdc_type;
}

// Helper function to get display name for transaction type
const getTransactionTypeDisplayName = (type: string): string => {
  if (type === 'GCEC PDC') {
    return 'GCEC Post Dated Cheques in Hand';
  } else if (type === 'Customer PDC') {
    return 'Customers Post Dated Cheques in Hand';
  } else if (type === 'Purchase Bill') {
    return 'Sales Invoice amount paid against GCEC Purchase Bills';
  }
  return type;
};

export default function ViewAllTranstion() {
  const [transactions, setTransactions] = useState<AllTransaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const itemsPerPage = 5;

  // Group transactions by type
  const groupedTransactions = transactions.reduce((acc, transaction) => {
    const type = transaction.transactionType;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(transaction);
    return acc;
  }, {} as Record<string, AllTransaction[]>);

  // Flatten grouped transactions with headings
  const transactionsWithHeadings: Array<{ type: 'heading' | 'transaction'; content: string | AllTransaction }> = [];
  
  const transactionOrder = ['Daily Transaction', 'GCEC PDC', 'Customer PDC', 'Purchase Bill'];
  
  transactionOrder.forEach((type) => {
    const typeTransactions = groupedTransactions[type] || [];
    if (typeTransactions.length > 0) {
      transactionsWithHeadings.push({ type: 'heading', content: type });
      typeTransactions.forEach((transaction) => {
        transactionsWithHeadings.push({ type: 'transaction', content: transaction });
      });
    }
  });

  // Pagination - count only transactions (not headings)
  const transactionCount = transactions.length;
  const totalPages = Math.ceil(transactionCount / itemsPerPage);
  
  // Calculate which transactions to show (10 per page)
  const startTransactionIndex = (currentPage - 1) * itemsPerPage;
  const endTransactionIndex = startTransactionIndex + itemsPerPage;
  
  // Build paginated items - show all headers first (like Excel), then transactions on current page under each
  let transactionCounter = 0;
  const paginatedItems: Array<{ type: 'heading' | 'transaction'; content: string | AllTransaction }> = [];
  
  // Use a Set to track unique transactions by their unique identifier
  const seenTransactionIds = new Set<string>();
  
  // First, collect all transactions that should be on the current page (without duplicates)
  const transactionsOnPage: AllTransaction[] = [];
  for (const item of transactionsWithHeadings) {
    if (item.type === 'transaction') {
      if (transactionCounter >= startTransactionIndex && transactionCounter < endTransactionIndex) {
        const txn = item.content as AllTransaction;
        // Create a unique key combining transaction type and ID
        const uniqueKey = `${txn.transactionType}-${txn.id}`;
        
        // Only add if we haven't seen this transaction before
        if (!seenTransactionIds.has(uniqueKey)) {
          seenTransactionIds.add(uniqueKey);
          transactionsOnPage.push(txn);
        }
      }
      transactionCounter++;
    }
  }
  
  // Group transactions on page by type (ensuring no duplicates)
  const transactionsByTypeOnPage = transactionsOnPage.reduce((acc, txn) => {
    const type = txn.transactionType;
    const uniqueKey = `${type}-${txn.id}`;
    
    // Check if this transaction is already in the group
    if (!acc[type]) {
      acc[type] = [];
    }
    
    // Only add if not already in the array
    const exists = acc[type].some((existing: AllTransaction) => 
      `${existing.transactionType}-${existing.id}` === uniqueKey
    );
    
    if (!exists) {
      acc[type].push(txn);
    }
    
    return acc;
  }, {} as Record<string, AllTransaction[]>);
  
  // Get all transaction types that exist in the dataset
  const allTransactionTypes = new Set<string>();
  transactions.forEach(txn => allTransactionTypes.add(txn.transactionType));
  
  // Show all headers in order (like Excel), then show transactions under each
  transactionOrder.forEach((type) => {
    if (allTransactionTypes.has(type)) {
      // Always add header if this type has any transactions in dataset
      paginatedItems.push({ type: 'heading', content: type });
      
      // Add transactions of this type that are on the current page
      const typeTransactionsOnPage = transactionsByTypeOnPage[type] || [];
      typeTransactionsOnPage.forEach(txn => {
        paginatedItems.push({ type: 'transaction', content: txn });
      });
    }
  });

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const params: { startDate?: string; endDate?: string } = {};
      
      if (startDate) {
        params.startDate = startDate.toISOString().split('T')[0];
      }
      if (endDate) {
        params.endDate = endDate.toISOString().split('T')[0];
      }
      
      const response: ApiResponse<any> = await transactionService.getAllTransactions(params);
      
      if (response.success && response.data) {
        const responseData = response.data as any;
        
        // The API returns: { success: true, data: [...], summary: {...}, filters: {...} }
        // api.get() may wrap it, so check both structures
        let transactionsData: AllTransaction[] = [];
        let summaryData: TransactionSummary | null = null;
        
        if (Array.isArray(responseData)) {
          // Direct array
          transactionsData = responseData;
        } else if (responseData?.data && Array.isArray(responseData.data)) {
          // Nested: { data: [...], summary: {...} }
          transactionsData = responseData.data;
          summaryData = responseData.summary || null;
        } else if (responseData?.success && responseData?.data && Array.isArray(responseData.data)) {
          // API response structure: { success: true, data: [...], summary: {...} }
          transactionsData = responseData.data;
          summaryData = responseData.summary || null;
        }
        
        setTransactions(transactionsData);
        setSummary(summaryData);
        setCurrentPage(1); // Reset to first page when filters change
      } else {
        setTransactions([]);
        setSummary(null);
      }
    } catch (err) {
      console.error('[ViewAllTranstion] Error fetching transactions:', err);
      setTransactions([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Clear filters function
  const clearFilters = () => {
    setStartDate(null);
    setEndDate(null);
  };

  // Convert Date to string for input (YYYY-MM-DD format)
  const dateToString = (date: Date | null): string => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Convert string to Date (from input)
  const stringToDate = (dateString: string): Date | null => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  };

  // Excel Download function - exports only filtered transactions (based on startDate/endDate)
  const handleDownloadExcel = useCallback(async () => {
    // transactions array is already filtered by API based on startDate/endDate filters
    if (transactions.length === 0) {
      return;
    }

    // Create workbook using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('All Transactions');
    let currentRow = 1;

    // Helper function to add a row with optional styling
    const addRow = (values: any[], style?: Partial<ExcelJS.Style>) => {
      const row = worksheet.addRow(values);
      if (style) {
        row.eachCell((cell) => {
          Object.assign(cell, style);
        });
      }
      currentRow++;
      return row;
    };

    // Header rows
    addRow(['ADCB (AED)'], { font: { bold: true, size: 14 } });
    addRow(['GCEC CLOUD SECURITY & SURVEILLANCE'], { font: { bold: true, size: 12 } });
    addRow([]);
    
    // Account information
    addRow(['Account No. :', '12990685920001 - AED']);
    addRow(['IBAN', 'AE720030012990685920001']);
    
    // Date range
    addRow(['Start Date:', startDate ? formatDateForExcel(startDate) : '']);
    addRow(['End Date:', endDate ? formatDateForExcel(endDate) : '']);
    addRow([]);

    // Summary
    if (summary) {
      addRow(['Summary:'], { font: { bold: true } });
      addRow(['Daily Transactions:', summary.dailyTransactions]);
      addRow(['GCEC Post Dated Cheques in Hand:', summary.gcecPdc]);
      addRow(['Customers Post Dated Cheques in Hand:', summary.customerPdc]);
      addRow(['Sales Invoice amount paid against GCEC Purchase Bills:', summary.purchaseBills]);
      addRow(['Total:', summary.total]);
      addRow([]);
    }

    // Group transactions by type
    const transactionOrder = ['Daily Transaction', 'GCEC PDC', 'Customer PDC', 'Purchase Bill'];
    
    transactionOrder.forEach((type) => {
      const typeTransactions = groupedTransactions[type] || [];
      if (typeTransactions.length > 0) {
        const displayName = getTransactionTypeDisplayName(type);
        addRow([displayName], { 
          font: { bold: true, size: 12 },
          fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE5E7EB' }
          }
        });
        
        // Headers
        let headers: string[] = [];
        if (type === 'Daily Transaction') {
          headers = ['Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance', 'Remarks'];
        } else if (type === 'GCEC PDC') {
          headers = ['Date', 'Payee', 'Cheque Number', 'Amount'];
        } else if (type === 'Customer PDC') {
          headers = ['Date', 'Customer Name', 'Cheque Number', 'Cheque Type', 'Amount'];
        } else if (type === 'Purchase Bill') {
          headers = ['Date', 'Vendor Name', 'Invoice Number', 'Payment Method', 'Amount'];
        }
        addRow(headers, { font: { bold: true } });

        // Transaction rows
        typeTransactions.forEach((transaction) => {
          if (type === 'Daily Transaction') {
            const txn = transaction as DailyTransaction;
            const formetpaymentType =
              txn.paymentType === 'cheque'
                ? txn.chequeNumber
                : txn.paymentType === 'creditcard'
                ? 'Credit Card'
                : txn.paymentType;

            const debitValue = txn.debit ? parseFloat(String(txn.debit).replace(/,/g, '')) : 0;
            const creditValue = txn.credit ? parseFloat(String(txn.credit).replace(/,/g, '')) : 0;
            const balanceValue = parseFloat(String(txn.balance).replace(/,/g, '')) || 0;
            
            const rawRemarks = txn.remarks || '';
            const remarksCell = remarksForDailyLedgerDisplay(txn.remarks, dailyTxnPdcType(txn));
            const isBouncedOrReturned =
              rawRemarks.toLowerCase().includes('bounced cheque') ||
              rawRemarks.toLowerCase().includes('returned cheque');

            const row = addRow([
              formatDateForExcel(txn.date),
              txn.category,
              formetpaymentType,
              debitValue,
              creditValue,
              balanceValue,
              remarksCell,
            ]);

            // Format number columns
            row.getCell(4).numFmt = '#,##0.00'; // Debit
            row.getCell(5).numFmt = '#,##0.00'; // Credit
            row.getCell(6).numFmt = '#,##0.00'; // Balance

            // If there's a debit amount, make all text in the row red
            if (debitValue > 0) {
              row.eachCell((cell) => {
                cell.font = { color: { argb: 'FFFF0000' } }; // Red color for all cells
              });
            }

            // Apply background color if bounced/returned cheque
            if (isBouncedOrReturned) {
              row.eachCell((cell) => {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FF95DCF7' }
                };
              });
            }
          } else if (type === 'GCEC PDC') {
            const txn = transaction as GCECPDC;
            const amountValue = parseFloat(String(txn.amount).replace(/,/g, '')) || 0;
            const row = addRow([
              formatDateForExcel(txn.date),
              txn.customerName,
              txn.chequeNumber,
              amountValue
            ]);
            row.getCell(4).numFmt = '#,##0.00';
            
            // Make all text red in GCEC PDC rows (background stays white)
            row.eachCell((cell) => {
              cell.font = { color: { argb: 'FFFF0000' } }; // Red color
            });
          } else if (type === 'Customer PDC') {
            const txn = transaction as CustomerPDC;
            const amountValue = parseFloat(String(txn.amount).replace(/,/g, '')) || 0;
            const chequeTypeDisplay = txn.chequeType === 'Payment Cheque' ? '' : 'Security Cheque';
            const isSecurityCheque = chequeTypeDisplay === 'Security Cheque';
            
            const row = addRow([
              formatDateForExcel(txn.date),
              txn.customerName,
              txn.chequeNumber,
              chequeTypeDisplay,
              amountValue
            ]);
            row.getCell(5).numFmt = '#,##0.00';
            
            // Apply red background if Security Cheque
            if (isSecurityCheque) {
              row.eachCell((cell) => {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFF0000' } // Red color
                };
              });
            }
          } else if (type === 'Purchase Bill') {
            const txn = transaction as PurchaseBill;
            const amountValue = parseFloat(String(txn.amount).replace(/,/g, '')) || 0;
            const row = addRow([
              formatDateForExcel(txn.date),
              txn.vendorName,
              txn.invoiceNumber || '',
              txn.paymentMethod,
              amountValue,
             
            ]);
            row.getCell(5).numFmt = '#,##0.00';
     
          }
        });
        
        addRow([]); // Empty row between sections
      }
    });

    // Set column widths
    worksheet.columns = [
      { width: 15 }, // Date
      { width: 25 }, // Category/Customer/Vendor
      { width: 15 }, // Payment Type/Cheque Number/Invoice
      { width: 15 }, // Cheque Number/Cheque Type/Payment Method
      { width: 18 }, // Debit/Amount
      { width: 18 }, // Credit/Description/Payment Status
      { width: 18 }, // Balance/Description
      { width: 20 }, // Remarks/Description
    ];

    // Generate filename and download
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const fileName = `All-Transactions-${dateStr}.xlsx`;

    // Write to buffer and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(url);
  }, [transactions, groupedTransactions, summary, startDate, endDate]);

  // Render transaction row based on type
  const renderTransactionRow = (transaction: AllTransaction) => {
    if (transaction.transactionType === 'Daily Transaction') {
      const txn = transaction as DailyTransaction;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
          <TableCell className="text-gray-700 text-sm py-3 px-4">{formatIsoDateDisplay(txn.date)}</TableCell>
          <TableCell className="text-gray-700 font-medium text-sm py-3 px-4">{txn.category}</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.paymentType}</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.chequeNumber || '-'}</TableCell>
          <TableCell className="text-sm py-3 px-4">
            {txn.debit ? (
              <span className="text-red-600 font-semibold">AED{formatAmount(txn.debit)}</span>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </TableCell>
          <TableCell className="text-sm py-3 px-4">
            {txn.credit ? (
              <span className="text-black font-semibold">AED{formatAmount(txn.credit)}</span>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </TableCell>
          <TableCell className="text-gray-700 font-semibold text-sm py-3 px-4">AED{formatAmount(txn.balance)}</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">
            {remarksForDailyLedgerDisplay(txn.remarks, dailyTxnPdcType(txn)) || '-'}
          </TableCell>
        </TableRow>
      );
    } else if (transaction.transactionType === 'GCEC PDC') {
      const txn = transaction as GCECPDC;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
          <TableCell className="text-red-600 text-sm py-3 px-4">{formatIsoDateDisplay(txn.date)}</TableCell>
          <TableCell className="text-red-600 font-medium text-sm py-3 px-4">{txn.customerName}</TableCell>
          <TableCell className="text-red-600 text-sm py-3 px-4">-</TableCell>
          <TableCell className="text-red-600 text-sm py-3 px-4">{txn.chequeNumber}</TableCell>
          <TableCell className="text-sm py-3 px-4">
            <span className="text-red-600">-</span>
          </TableCell>
          <TableCell className="text-sm py-3 px-4">
            <span className="text-red-600 font-semibold">AED{formatAmount(txn.amount)}</span>
          </TableCell>
          <TableCell className="text-red-600 text-sm py-3 px-4">-</TableCell>
          <TableCell className="text-red-600 text-sm py-3 px-4">{txn.description || '-'}</TableCell>
        </TableRow>
      );
    } else if (transaction.transactionType === 'Customer PDC') {
      const txn = transaction as CustomerPDC;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 hover:bg-purple-50 transition-colors">
          <TableCell className="text-gray-700 text-sm py-3 px-4">{formatIsoDateDisplay(txn.date)}</TableCell>
          <TableCell className="text-gray-700 font-medium text-sm py-3 px-4">{txn.customerName}</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">-</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.chequeNumber}</TableCell>
          <TableCell className="text-sm py-3 px-4">
            <span className="text-gray-400">-</span>
          </TableCell>
          <TableCell className="text-sm py-3 px-4">
            <span className=" text-black font-semibold">AED{formatAmount(txn.amount)}</span>
          </TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">-</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.description || '-'}</TableCell>
        </TableRow>
      );
    } else if (transaction.transactionType === 'Purchase Bill') {
      const txn = transaction as PurchaseBill;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 hover:bg-orange-50 transition-colors">
          <TableCell className="text-gray-700 text-sm py-3 px-4">{formatIsoDateDisplay(txn.date)}</TableCell>
          <TableCell className="text-gray-700 font-medium text-sm py-3 px-4">{txn.vendorName}</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.paymentMethod}</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.invoiceNumber || '-'}</TableCell>
         
          <TableCell className="text-sm py-3 px-4">
            <span className="text-gray-400">-</span>
          </TableCell>
          <TableCell className="text-sm py-3 px-4">
            <span className="text-black font-semibold">AED{formatAmount(txn.amount)}</span>
          </TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">-</TableCell>
          <TableCell className="text-gray-600 text-sm py-3 px-4">{txn.description || '-'}</TableCell>
        </TableRow>
      );
    }
    return null;
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Header Section */}
    {/* Main Card */}
    <div className="bg-white rounded shadow-xl overflow-hidden">
          {/* Action Bar */}
          <div className="bg-[#f7c46d] p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded font-semibold hover:bg-blue-50 transition-all shadow-md"
              >
                <Calendar className="w-5 h-5" />
                Filter by Date
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>

              <button
                onClick={handleDownloadExcel}
                disabled={transactions.length === 0 || loading}
                className="flex items-center gap-2 bg-[#ffff] text-black px-4 py-2 rounded font-semibold hover:bg-[#f1f5f9] transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-5 h-5" />
                Download Excel
              </button>
            </div>
          </div>

          {/* Filter Section */}
          {showFilters && (
            <div className="bg-slate-50 border-b border-slate-200 p-6">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={dateToString(startDate)}
                    onChange={(e) => setStartDate(stringToDate(e.target.value))}
                    max={dateToString(endDate) || undefined}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={dateToString(endDate)}
                    onChange={(e) => setEndDate(stringToDate(e.target.value))}
                    min={dateToString(startDate) || undefined}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>

                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear Filters
                </button>
              </div>
            </div>
          )}
</div>
      {/* Summary uards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-blue-700 mb-2">Daily Transactions</p>
              <p className="text-3xl font-bold text-blue-900">{summary.dailyTransactions}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-black mb-2">GCEC Post Dated Cheques in Hand</p>
              <p className="text-3xl font-bold text-black">{summary.gcecPdc}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-purple-700 mb-2">Customers Post Dated Cheques in Hand</p>
              <p className="text-3xl font-bold text-purple-900">{summary.customerPdc}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-orange-700 mb-2">Sales Invoice amount paid against GCEC Purchase Bills</p>
              <p className="text-3xl font-bold text-orange-900">{summary.purchaseBills}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Transactions Table */}
      <Card className="bg-white border border-gray-200 overflow-hidden shadow-lg">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f7c46d] mx-auto mb-4"></div>
                <p className="text-base text-gray-500">Loading transactions...</p>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-lg font-medium text-gray-500 mb-2">No transactions found</p>
                <p className="text-sm text-gray-400">Try adjusting your date filters</p>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#f1f5f9] border-0">
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Date</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Category/Customer/Vendor</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Payment Type</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Cheque/Invoice No</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Debit</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Credit</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Balance</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Remarks/Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                          No transactions on this page
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedItems.map((item, index) => {
                        if (item.type === 'heading') {
                          const displayName = getTransactionTypeDisplayName(item.content as string);
                          return (
                            <TableRow key={`heading-${item.content}-${index}`} className="bg-gradient-to-r from-gray-100 to-gray-50 border-t-2 border-gray-300">
                              <TableCell colSpan={8} className="font-bold text-gray-900 text-lg py-4 px-4">
                                {displayName}
                              </TableCell>
                            </TableRow>
                          );
                        } else {
                          const txn = item.content as AllTransaction;
                          // Use unique key combining type and ID to prevent duplicate rendering
                          return (
                            <React.Fragment key={`${txn.transactionType}-${txn.id}-${index}`}>
                              {renderTransactionRow(txn)}
                            </React.Fragment>
                          );
                        }
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="p-6 border-t border-gray-200 bg-white">
                  <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
                    {/* Info Section */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="text-sm text-gray-600">Showing</span>
                        <span className="text-sm font-semibold text-gray-900 px-2 py-0.5 bg-white rounded border border-gray-300">
                          {startTransactionIndex + 1}
                        </span>
                        <span className="text-sm text-gray-600">-</span>
                        <span className="text-sm font-semibold text-gray-900 px-2 py-0.5 bg-white rounded border border-gray-300">
                          {Math.min(endTransactionIndex, transactionCount)}
                        </span>
                        <span className="text-sm text-gray-600">of</span>
                        <span className="text-sm font-semibold text-gray-900 px-2 py-0.5 bg-white rounded border border-gray-300">
                          {transactionCount}
                        </span>
                      </div>
                    </div>

                    {/* Pagination Controls */}
                    <div className="flex items-center gap-3">
                      {/* Previous Button */}
                      <button
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                          currentPage === 1
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-[#f7c46d] hover:text-white hover:border-[#f7c46d] shadow-sm hover:shadow-md'
                        }`}
                      >
                        Previous
                      </button>

                      {/* Page Numbers */}
                      <div className="flex items-center gap-1">
                        {totalPages <= 7 ? (
                          // Show all pages if 7 or fewer
                          Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                currentPage === page
                                  ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                              }`}
                            >
                              {page}
                            </button>
                          ))
                        ) : (
                          // Smart pagination with ellipsis for many pages
                          <>
                            {/* First page */}
                            <button
                              onClick={() => setCurrentPage(1)}
                              className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                currentPage === 1
                                  ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                              }`}
                            >
                              1
                            </button>

                            {/* Ellipsis before current range */}
                            {currentPage > 3 && (
                              <span className="px-2 text-gray-400 font-medium">...</span>
                            )}

                            {/* Pages around current page */}
                            {Array.from({ length: 5 }, (_, i) => {
                              const page = currentPage - 2 + i;
                              if (page > 1 && page < totalPages) {
                                return (
                                  <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                      currentPage === page
                                        ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                                    }`}
                                  >
                                    {page}
                                  </button>
                                );
                              }
                              return null;
                            })}

                            {/* Ellipsis after current range */}
                            {currentPage < totalPages - 2 && (
                              <span className="px-2 text-gray-400 font-medium">...</span>
                            )}

                            {/* Last page */}
                            <button
                              onClick={() => setCurrentPage(totalPages)}
                              className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                currentPage === totalPages
                                  ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                              }`}
                            >
                              {totalPages}
                            </button>
                          </>
                        )}
                      </div>

                      {/* Next Button */}
                      <button
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                          currentPage === totalPages
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-[#f7c46d] hover:text-white hover:border-[#f7c46d] shadow-sm hover:shadow-md'
                        }`}
                      >
                        Next
                      </button>

                      {/* Go to Page Input */}
                      <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-300">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Go to:</span>
                        <input
                          type="number"
                          min={1}
                          max={totalPages}
                          value={currentPage}
                          onChange={(e) => {
                            const page = parseInt(e.target.value);
                            if (page >= 1 && page <= totalPages) {
                              setCurrentPage(page);
                            }
                          }}
                          className="w-16 h-10 px-2 text-sm text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f7c46d] focus:border-[#f7c46d] shadow-sm"
                        />
                        <span className="text-sm text-gray-500">/ {totalPages}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
   </div>
  );
}
