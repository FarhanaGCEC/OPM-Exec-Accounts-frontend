import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Plus, Calendar as CalendarIcon, Loader2, Edit, Trash2, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import Calendar from '../components/ui/calendar-tailwind';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import { transactionService, type BankTransaction as BankTransactionType } from '../services/transactionService';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import type { ApiResponse } from '../lib/api';

interface BankTransaction extends BankTransactionType {
  categoryName?: string;
  amount?: string | number; // For display with commas (legacy)
  balance: string; // For display
  debitFormatted?: string | null; // Formatted debit amount
  creditFormatted?: string | null; // Formatted credit amount
  originalDate?: string; // Store original ISO date for editing
}

// Zod validation schema
const transactionSchema = z.object({
  date: z.string()
    .min(10, 'Date is required')
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in dd/mm/yyyy format'),
  type: z.enum(['Debit', 'Credit'], {
    required_error: 'Please select a type',
  }),
  categoryId: z.string()
    .min(1, 'Category is required'),
  paymentType: z.enum(['creditcard', 'cheque', 'cash', 'banktransfer'], {
    required_error: 'Please select a payment type',
  }),
  chequeNumber: z.string().optional(),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
}).refine((data) => {
  // If payment type is cheque, chequeNumber is required
  if (data.paymentType === 'cheque') {
    return data.chequeNumber && data.chequeNumber.trim().length > 0;
  }
  return true;
}, {
  message: 'Cheque number is required when payment type is cheque',
  path: ['chequeNumber'],
});

type TransactionFormData = z.infer<typeof transactionSchema>;

// Date formatting function: Convert ISO date to "DD-MMM-YYYY" format
const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = String(date.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day}-${month}-${year}`;
  } catch (err) {
    return dateString;
  }
};

export default function BankTransaction() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<BankTransaction | null>(null);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [payablesCategories, setPayablesCategories] = useState<PayablesCategory[]>([]);
  const [receivablesCategories, setReceivablesCategories] = useState<ReceivablesCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'online' | 'cheque' | 'cash'>('all');

  const form = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      date: '',
      type: 'Debit',
      categoryId: '',
      paymentType: 'cash',
      chequeNumber: '',
      amount: '',
    },
  });

  const paymentType = form.watch('paymentType');
  const transactionType = form.watch('type');

  // Clear cheque number when payment type changes away from cheque
  useEffect(() => {
    if (paymentType !== 'cheque') {
      form.setValue('chequeNumber', '');
    }
  }, [paymentType, form]);

  // Clear category when transaction type changes
  useEffect(() => {
    form.setValue('categoryId', '');
  }, [transactionType, form]);

  // Fetch both payables and receivables categories
  const fetchCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      
      // Fetch payables categories
      const payablesResponse: ApiResponse<PayablesCategory[]> = await payablesService.getPayables();
      if (payablesResponse.success && payablesResponse.data && Array.isArray(payablesResponse.data)) {
        const payablesData = payablesResponse.data.map(cat => ({
          ...cat,
          id: String(cat.id),
        }));
        setPayablesCategories(payablesData);
      }
      
      // Fetch receivables categories
      const receivablesResponse: ApiResponse<ReceivablesCategory[]> = await receivablesService.getReceivables();
      if (receivablesResponse.success && receivablesResponse.data && Array.isArray(receivablesResponse.data)) {
        const receivablesData = receivablesResponse.data.map(cat => ({
          ...cat,
          id: String(cat.id),
        }));
        setReceivablesCategories(receivablesData);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Get categories based on transaction type
  const getAvailableCategories = () => {
    if (transactionType === 'Debit') {
      return payablesCategories;
    } else {
      return receivablesCategories;
    }
  };

  // Fetch transactions on component mount
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response: ApiResponse<BankTransactionType[]> = await transactionService.getBankTransactions();
      
      if (response.success && response.data && Array.isArray(response.data)) {
        // Process transactions from API response
        const transactionsData: BankTransaction[] = response.data.map(transaction => {
          // Format date from ISO to "DD-MMM-YYYY"
          const formattedDate = formatDate(transaction.date);
          
          // Format debit/credit amounts
          const debitAmount = transaction.debit 
            ? transaction.debit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : null;
          const creditAmount = transaction.credit 
            ? transaction.credit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : null;
          
          // Format balance
          const formattedBalance = typeof transaction.balance === 'number'
            ? transaction.balance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : String(transaction.balance || '0');
          
          // Convert 'online' from API to 'banktransfer' for frontend consistency
          const frontendPaymentType = transaction.paymentType === 'online' ? 'banktransfer' : transaction.paymentType;
          
          return {
            ...transaction,
            id: String(transaction.id || ''),
            date: formattedDate, // Formatted date for display
            originalDate: transaction.date, // Store original ISO date for editing
            categoryName: transaction.category || 'N/A', // Use category from API
            paymentType: frontendPaymentType as 'creditcard' | 'cheque' | 'cash' | 'banktransfer',
            debit: transaction.debit,
            credit: transaction.credit,
            debitFormatted: debitAmount,
            creditFormatted: creditAmount,
            balance: formattedBalance,
          };
        });
        setTransactions(transactionsData);
      } else {
        setTransactions([]);
      }
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setError('Failed to fetch transactions');
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const onSubmit = async (data: TransactionFormData) => {
    try {
      setIsSubmitting(true);
      setError(null);

      // Convert amount to number (remove commas)
      const amountNumber = parseFloat(data.amount.replace(/,/g, ''));

      // Prepare payload for API
      // Convert 'banktransfer' to 'online' for API
      const apiPaymentType = data.paymentType === 'banktransfer' ? 'online' : data.paymentType;
      
      const payload: {
        date: string;
        type: 'Debit' | 'Credit';
        categoryId: string | number;
        paymentType: 'creditcard' | 'cheque' | 'cash' | 'online';
        chequeNumber?: string;
        amount: number;
      } = {
        date: data.date, // Format: dd/mm/yyyy
        type: data.type,
        categoryId: data.categoryId,
        paymentType: apiPaymentType as 'creditcard' | 'cheque' | 'cash' | 'online',
        amount: amountNumber,
      };

      // Only include chequeNumber if payment type is cheque
      if (data.paymentType === 'cheque' && data.chequeNumber) {
        payload.chequeNumber = data.chequeNumber;
      }

      console.log('[BankTransaction] Sending payload:', payload);

      let response: ApiResponse<BankTransactionType>;

      if (editingTransaction) {
        // Update existing transaction
        response = await transactionService.updateBankTransaction(String(editingTransaction.id), payload);
      } else {
        // Create new transaction
        response = await transactionService.createBankTransaction(payload);
      }

      if (response.success && response.data) {
        // Find category name for display based on transaction type
        const categoryList = data.type === 'Debit' ? payablesCategories : receivablesCategories;
        const selectedCategory = categoryList.find(cat => String(cat.id) === data.categoryId);
        
        // Format amount with commas for display
        const amountValue = typeof response.data.amount === 'number' 
          ? response.data.amount 
          : parseFloat(String(response.data.amount).replace(/,/g, ''));
        const formattedAmount = amountValue.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });

        if (editingTransaction) {
          // Update existing transaction in state
          const updatedTransaction: BankTransaction = {
            ...response.data,
            id: String(response.data.id || editingTransaction.id),
            categoryName: selectedCategory?.name,
            amount: formattedAmount,
            balance: String(response.data.balance || editingTransaction.balance),
          };
          setTransactions(prevTransactions =>
            prevTransactions.map(t => 
              t.id === editingTransaction.id ? updatedTransaction : t
            )
          );
        } else {
          // Add new transaction to local state
          const newTransaction: BankTransaction = {
            ...response.data,
            id: String(response.data.id || Date.now()),
            categoryName: selectedCategory?.name,
            amount: formattedAmount,
            balance: String(response.data.balance || '0'),
          };
          setTransactions(prevTransactions => [newTransaction, ...prevTransactions]);
        }

        // Reset form and close modal
        form.reset({
          date: '',
          type: 'Debit',
          categoryId: '',
          paymentType: 'cash',
          chequeNumber: '',
          amount: '',
        });
        setEditingTransaction(null);
        setIsModalOpen(false);
        // Refetch to ensure data is in sync
        await fetchTransactions();
      } else {
        setError(response.message || `Failed to ${editingTransaction ? 'update' : 'create'} transaction`);
      }
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to create transaction';
      console.error('[BankTransaction] Error:', err);
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = useCallback((transaction: BankTransaction) => {
    setEditingTransaction(transaction);
    setError(null);
    
    // Convert original ISO date to dd/mm/yyyy format for form
    let dateValue = '';
    if (transaction.originalDate) {
      const date = new Date(transaction.originalDate);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        dateValue = `${day}/${month}/${year}`;
      }
    } else {
      // Fallback: try to parse formatted date
      const parts = transaction.date.split('-');
      if (parts.length === 3) {
        const months: { [key: string]: string } = {
          'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
          'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        const month = months[parts[1]] || '01';
        dateValue = `${parts[0]}/${month}/${parts[2]}`;
      }
    }
    
    // Determine type and amount from debit/credit
    const transactionType = transaction.debit ? 'Debit' : 'Credit';
    const amountValue = transaction.debit 
      ? String(transaction.debit).replace(/,/g, '')
      : String(transaction.credit || 0).replace(/,/g, '');
    
    // Find category ID from category name - search in the correct list based on type
    const categoryList = transactionType === 'Debit' ? payablesCategories : receivablesCategories;
    const category = categoryList.find(cat => cat.name === transaction.categoryName);
    
    // Ensure paymentType is 'banktransfer' not 'online' for form
    const formPaymentType = transaction.paymentType === 'online' ? 'banktransfer' : transaction.paymentType;
    
    form.reset({
      date: dateValue,
      type: transactionType as 'Debit' | 'Credit',
      categoryId: category ? String(category.id) : '',
      paymentType: formPaymentType as 'creditcard' | 'cheque' | 'cash' | 'banktransfer',
      chequeNumber: transaction.chequeNumber && transaction.chequeNumber !== '-' ? transaction.chequeNumber : '',
      amount: amountValue,
    });
    setIsModalOpen(true);
  }, [form, payablesCategories, receivablesCategories]);

  const handleDeleteClick = useCallback((id: string) => {
    setDeletingTransactionId(id);
    setError(null);
    setIsDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingTransactionId) return;

    try {
      setIsDeleting(true);
      setError(null);
      const response: ApiResponse<void> = await transactionService.deleteBankTransaction(deletingTransactionId);
      
      if (response.success) {
        setTransactions(prevTransactions =>
          prevTransactions.filter(t => String(t.id) !== deletingTransactionId)
        );
        setDeletingTransactionId(null);
        setIsDeleteModalOpen(false);
        // Refetch to ensure data is in sync
        await fetchTransactions();
      } else {
        setError(response.message || 'Failed to delete transaction');
      }
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to delete transaction';
      console.error('[BankTransaction] Error deleting transaction:', err);
      setError(errorMessage);
    } finally {
      setIsDeleting(false);
    }
  }, [deletingTransactionId, fetchTransactions]);

  const handleAddNew = useCallback(() => {
    setEditingTransaction(null);
    setError(null);
    form.reset({
      date: '',
      type: 'Debit',
      categoryId: '',
      paymentType: 'cash',
      chequeNumber: '',
      amount: '',
    });
    setIsModalOpen(true);
  }, [form]);

  const getTransactionDescription = useCallback(() => {
    if (!deletingTransactionId) return '';
    const transaction = transactions.find(t => String(t.id) === deletingTransactionId);
    if (!transaction) return '';
    const amount = transaction.debitFormatted || transaction.creditFormatted || '0';
    return `${transaction.categoryName || 'Transaction'} - ${amount} AED`;
  }, [deletingTransactionId, transactions]);

  // Calculate summary values
  const totalDebit = transactions.reduce((sum, t) => sum + (t.debit || 0), 0);
  const totalCredit = transactions.reduce((sum, t) => sum + (t.credit || 0), 0);
  // Get the latest balance (first transaction in the list as they're sorted by date descending)
  const currentBalance = transactions.length > 0 
    ? (() => {
        const balance = transactions[0].balance;
        if (typeof balance === 'string') {
          return parseFloat(balance.replace(/,/g, '')) || 0;
        }
        return (balance as number) || 0;
      })()
    : 0;

  // Summary cards data
  const summaryCards = [
    {
      title: 'Current Balance',
      value: currentBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      currency: 'AED',
      textColor: currentBalance < 0 ? 'text-red-600' : 'text-gray-900',
    },
    {
      title: 'Total Debits',
      value: totalDebit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      currency: 'AED',
      textColor: 'text-gray-900',
    },
    {
      title: 'Total Credits',
      value: totalCredit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      currency: 'AED',
      textColor: 'text-gray-900',
    },
  
  ];

  // Filter transactions based on active tab
  const filteredTransactions = transactions.filter(transaction => {
    // Filter by payment type
    // 'online' tab shows both creditcard and banktransfer (which comes as 'online' from API)
    if (activeTab === 'online' && transaction.paymentType !== 'creditcard' && transaction.paymentType !== 'banktransfer') return false;
    if (activeTab === 'cheque' && transaction.paymentType !== 'cheque') return false;
    if (activeTab === 'cash' && transaction.paymentType !== 'cash') return false;
    
    return true;
  });

  // CSV Download function
  const handleDownloadCSV = useCallback(() => {
    // Parse dates from transactions
    const parseDate = (t: any) => {
      if (t.originalDate) return new Date(t.originalDate);
      const parts = t.date?.split('-');
      if (parts?.length === 3) {
        const months: any = { 
          Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
          Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' 
        };
        return new Date(`${parts[2]}-${months[parts[1]]}-${parts[0]}`);
      }
      return null;
    };

    const dates = filteredTransactions.map(parseDate).filter(Boolean) as Date[];
    const startDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const endDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

    const formatDate = (d: Date) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };

    // Get closing balance
    const latestBalance = filteredTransactions[0]?.balance || 0;
    const closingBalanceValue = Number(String(latestBalance).replace(/,/g, '').replace('AED', '').trim()) || 0;
    const closingBalance = closingBalanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const csvRows: string[] = [];

    // ----- COMPANY HEADER (outside table) -----
    csvRows.push('GCEC CLOUD SECURITY & SURVEILLANCE');
    csvRows.push('');
    csvRows.push('');

    // ----- ACCOUNT INFORMATION (outside table - using quotes and empty columns to separate from table) -----
    csvRows.push(`"Account No.","12990685920001 - AED","","","",""`);
    csvRows.push(`"IBAN","AE720030012990685920001","","","",""`);
    csvRows.push(`"Start Date","${formatDate(startDate)}","","","",""`);
    csvRows.push(`"End Date","${formatDate(endDate)}","","","",""`);
    csvRows.push(`"Closing (Available) Balance","AED ${closingBalance}","","","",""`);
    csvRows.push('');
    csvRows.push('');
    csvRows.push('');

    // ----- TABLE HEADER -----
    csvRows.push('Date,Description,Details,Debit,Credit,Balance');

    // ----- TABLE ROWS -----
    filteredTransactions.forEach(t => {
      // Format payment type for Details column
      let details = '';
      if (t.paymentType === 'cheque' && t.chequeNumber && t.chequeNumber !== '-') {
        details = t.chequeNumber.replace('#', '').trim().padStart(6, '0');
      } else if (['banktransfer', 'creditcard'].includes(t.paymentType || '')) {
        details = 'Online';
      } else if (t.paymentType) {
        details = t.paymentType;
      }

      // Format amounts - show 0.00 for zero values (no AED prefix for zero credit)
      const debitValue = t.debit || 0;
      const creditValue = t.credit || 0;
      
      const debit = debitValue > 0 
        ? `AED ${debitValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'AED 0.00';
      
      const credit = creditValue > 0
        ? `AED ${creditValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '0.00';

      // Format balance
      const balanceStr = t.balance || '0';
      const balanceValue = Number(String(balanceStr).replace(/,/g, '').replace('AED', '').trim()) || 0;
      const balance = `AED ${balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Escape CSV values properly
      const safe = (v: string) => `"${String(v || '').replace(/"/g, '""')}"`;

      csvRows.push([
        safe(t.date || ''),
        safe(t.categoryName || 'N/A'),
        safe(details),
        safe(debit),
        safe(credit),
        safe(balance)
      ].join(','));
    });

    // ----- DOWNLOAD -----
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `GCEC-Statement-${formatDate(startDate)}-to-${formatDate(endDate)}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

  }, [filteredTransactions]);

  // Excel Download function
  const handleDownloadExcel = useCallback(() => {
    // Parse dates from transactions
    const parseDate = (t: any) => {
      if (t.originalDate) return new Date(t.originalDate);
      const parts = t.date?.split('-');
      if (parts?.length === 3) {
        const months: any = { 
          Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
          Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' 
        };
        return new Date(`${parts[2]}-${months[parts[1]]}-${parts[0]}`);
      }
      return null;
    };

    const dates = filteredTransactions.map(parseDate).filter(Boolean) as Date[];
    const startDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const endDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

    const formatDate = (d: Date) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };

    // Get closing balance
    const latestBalance = filteredTransactions[0]?.balance || 0;
    const closingBalanceValue = Number(String(latestBalance).replace(/,/g, '').replace('AED', '').trim()) || 0;
    const closingBalance = closingBalanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData: any[] = [];

    // Add company header
    excelData.push(['GCEC CLOUD SECURITY & SURVEILLANCE']);
    excelData.push([]);
    excelData.push([]);

    // Add account information
    excelData.push(['Account No.:', '12990685920001 - AED']);
    excelData.push(['IBAN:', 'AE720030012990685920001']);
    excelData.push(['Start Date:', formatDate(startDate)]);
    excelData.push(['End Date:', formatDate(endDate)]);
    excelData.push(['Closing (Available) Balance:', `AED ${closingBalance}`]);
    excelData.push([]);
    excelData.push([]);

    // Add table headers
    excelData.push(['Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance']);

    // Add transaction rows
    filteredTransactions.forEach(t => {
      // Format payment type for Details column
      let details = '';
      if (t.paymentType === 'cheque' && t.chequeNumber && t.chequeNumber !== '-') {
        details = t.chequeNumber.replace('#', '').trim().padStart(6, '0');
      } else if (['banktransfer', 'creditcard'].includes(t.paymentType || '')) {
        details = 'Online';
      } else if (t.paymentType) {
        details = t.paymentType;
      }

      // Format amounts
      const debitValue = t.debit || 0;
      const creditValue = t.credit || 0;
      
      const debit = debitValue > 0 
        ? `AED ${debitValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'AED 0.00';
      
      const credit = creditValue > 0
        ? `AED ${creditValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '0.00';

      // Format balance
      const balanceStr = t.balance || '0';
      const balanceValue = Number(String(balanceStr).replace(/,/g, '').replace('AED', '').trim()) || 0;
      const balance = `AED ${balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      excelData.push([
        t.date || '',
        t.categoryName || 'N/A',
        details,
        debit,
        credit,
        balance
      ]);
    });

    // Create worksheet from data
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 }, // Date
      { wch: 25 }, // Description
      { wch: 15 }, // Details
      { wch: 18 }, // Debit
      { wch: 18 }, // Credit
      { wch: 18 }, // Balance
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Account Statement');

    // Generate Excel file and download
    const fileName = `GCEC-Statement-${formatDate(startDate)}-to-${formatDate(endDate)}.xlsx`;
    XLSX.writeFile(workbook, fileName);

  }, [filteredTransactions]);
  
  

  return (
    <Layout>
        {/* Summary Cards */}
        <h1 className="text-2xl text-left font-bold text-gray-900  pl-8">Account Summary</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 ">
   
          {summaryCards.map((card, index) => {
            return (
              <Card key={index} className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden mt-4">
                <CardContent className="p-6">
                  <div className="flex flex-col items-center justify-center text-center">
                    {/* Title */}
                    <p className="text-base font-medium text-gray-600 mb-3">
                      {card.title}
                    </p>
                    {/* Value and Currency */}
                    <div className="flex items-baseline space-x-2">
                      <p className={`text-3xl font-bold ${card.textColor}`}>
                        {card.value}
                      </p>
                      {card.currency && (
                        <span className={`text-xl font-semibold ${card.textColor}`}>
                          {card.currency}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

   {/* Search Bar and Tabs */}
   <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
     <h2 className="text-2xl font-bold text-gray-900">Detail Statement</h2>
     {/* <div className="relative flex-1 w-full sm:max-w-md">
       <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
       <input
         type="text"
         placeholder="Search by description, customer, or reference..."
         value={searchQuery}
         onChange={(e) => setSearchQuery(e.target.value)}
         className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-gray-200 bg-white"
       />
     </div> */}
     <div className="flex gap-2">
       <button
         onClick={() => setActiveTab('all')}
         className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'all'
           ? 'bg-[#eab308] text-black'
           : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
           }`}
       >
         All
       </button>
       <button
         onClick={() => setActiveTab('online')}
         className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'online'
           ? 'bg-[#eab308] text-black'
           : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
           }`}
       >
         Online
       </button>
       <button
         onClick={() => setActiveTab('cheque')}
         className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'cheque'
           ? 'bg-[#eab308] text-black'
           : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
           }`}
       >
         Cheque
       </button>
       <button
         onClick={() => setActiveTab('cash')}
         className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'cash'
           ? 'bg-[#eab308] text-black'
           : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
           }`}
       >
         Cash
       </button>
     </div>
   </div>
      
      <div className="mb-6 flex items-center justify-end gap-3">
        <Button
          onClick={handleDownloadCSV}
          variant="outline"
          className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || filteredTransactions.length === 0}
        >
          <Download className="w-4 h-4" />
          <span>Download CSV</span>
        </Button>
        <Button
          onClick={handleDownloadExcel}
          variant="outline"
          className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || filteredTransactions.length === 0}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Download Excel</span>
        </Button>
        <Button
          onClick={handleAddNew}
          className="bg-[#eab308] hover:bg-[#d4a007] text-black flex items-center space-x-2"
          disabled={loading}
        >
          <Plus className="w-4 h-4" />
          <span>Add New</span>
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-lg text-red-600">{error}</p>
        </div>
      )}

      {/* Transactions Table */}
      <Card className="bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eab308] border-0">
                  <TableHead className="font-semibold  text-black text-lg text-left py-4">
                    Date
                  </TableHead>
                  <TableHead className="font-semibold text-black text-lg text-left py-4">
                    Category
                  </TableHead>
                  <TableHead className="font-semibold text-black text-lg text-left py-4">
                    Payment Type
                  </TableHead>
                  <TableHead className="font-semibold text-black text-lg text-left py-4">
                    Debit
                  </TableHead>
                  <TableHead className="font-semibold text-black text-lg text-left py-4">
                    Credit
                  </TableHead>
                  <TableHead className="font-semibold text-black text-lg text-left py-4">
                    Balance
                  </TableHead>
                  <TableHead className="font-semibold text-black text-lg text-left py-4">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                      <p className="text-lg text-gray-500">Loading transactions...</p>
                    </TableCell>
                  </TableRow>
                ) : !Array.isArray(filteredTransactions) || filteredTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <p className="text-lg text-gray-500 mb-1">No transactions found.</p>
                      <p className="text-sm text-gray-400">Click "Add New" to create your first transaction.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTransactions.map((transaction) => (
                    <TableRow key={transaction.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <TableCell className="text-gray-700 text-lg py-4 text-left">
                        {transaction.date}
                      </TableCell>
                      <TableCell className="text-gray-700 font-medium text-lg py-4 text-left">
                        {transaction.categoryName || 'N/A'}
                      </TableCell>
                      <TableCell className="text-gray-600 text-lg py-4 text-left">
                        {transaction.paymentType === 'cheque' && transaction.chequeNumber && transaction.chequeNumber !== '-'
                          ? `#${transaction.chequeNumber}`
                          : transaction.paymentType === 'banktransfer'
                          ? 'Online'
                          : <span className="capitalize">{transaction.paymentType || 'N/A'}</span>}
                      </TableCell>
                      <TableCell className="text-lg py-4 text-left">
                        {transaction.debitFormatted ? (
                          <span className="text-red-600 font-semibold">
                            {transaction.debitFormatted} AED
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-lg py-4 text-left">
                        {transaction.creditFormatted ? (
                          <span className="text-green-600 font-semibold">
                            {transaction.creditFormatted} AED
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-lg py-4 text-left">
                        {(() => {
                          const balanceStr = transaction.balance || '0';
                          const balanceValue = Number(String(balanceStr).replace(/,/g, '').replace('AED', '').trim()) || 0;
                          const isNegative = balanceValue < 0;
                          return (
                            <span className={isNegative ? 'text-red-600 font-bold' : 'text-gray-700 font-semibold'}>
                              {transaction.balance} AED
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-lg py-4 text-left">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleEdit(transaction)}
                            className="p-2 text-black hover:bg-blue-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                            title="Edit transaction"
                            aria-label={`Edit ${transaction.categoryName}`}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(String(transaction.id))}
                            className="p-2 text-black hover:bg-red-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                            title="Delete transaction"
                            aria-label={`Delete ${transaction.categoryName}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Bank Transaction Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          form.reset({
            date: '',
            type: 'Debit',
            categoryId: '',
            paymentType: 'cash',
            chequeNumber: '',
            amount: '',
          });
          setEditingTransaction(null);
          setError(null);
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              {editingTransaction ? 'Edit Transaction' : 'Add New Transaction'}
            </DialogTitle>
          </DialogHeader>
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-lg text-red-600">{error}</p>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              {/* Date Field */}
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => {
                  // Convert dd/mm/yyyy string to Date object
                  const parseDate = (dateString: string): Date | null => {
                    if (!dateString || dateString.length !== 10) return null;
                    const parts = dateString.split('/');
                    if (parts.length !== 3) return null;
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10);
                    const year = parseInt(parts[2], 10);
                    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
                    return new Date(year, month - 1, day);
                  };

                  // Convert Date object to dd/mm/yyyy string
                  const formatDate = (date: Date | null): string => {
                    if (!date || isNaN(date.getTime())) return '';
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    return `${day}/${month}/${year}`;
                  };

                  const [selectedDate, setSelectedDate] = useState<Date | null>(() =>
                    parseDate(field.value)
                  );
                  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

                  // Sync selectedDate with field.value when field changes externally
                  useEffect(() => {
                    const parsed = parseDate(field.value);
                    if (parsed) {
                      const currentTime = selectedDate?.getTime();
                      const parsedTime = parsed.getTime();
                      if (!currentTime || currentTime !== parsedTime) {
                        setSelectedDate(parsed);
                      }
                    } else if (field.value === '' && selectedDate !== null) {
                      setSelectedDate(null);
                    }
                    // eslint-disable-next-line react-hooks/exhaustive-deps
                  }, [field.value]);

                  const handleDateSelect = (date: Date | null) => {
                    if (date && !isNaN(date.getTime())) {
                      setSelectedDate(date);
                      const formatted = formatDate(date);
                      field.onChange(formatted);
                      setIsPopoverOpen(false);
                    }
                  };

                  return (
                    <FormItem>
                      <FormLabel className="text-lg font-medium text-gray-700">
                        Date
                      </FormLabel>
                      <FormControl>
                        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                          <div className="relative">
                            <Input
                              placeholder="dd/mm/yyyy"
                              value={field.value}
                              onChange={(e) => {
                                let value = e.target.value.replace(/\D/g, '');
                                if (value.length >= 2) value = value.slice(0, 2) + '/' + value.slice(2);
                                if (value.length >= 5) value = value.slice(0, 5) + '/' + value.slice(5, 9);
                                field.onChange(value);
                                // Update selectedDate when user types a complete date
                                if (value.length === 10) {
                                  const date = parseDate(value);
                                  if (date) {
                                    setSelectedDate(date);
                                  }
                                }
                              }}
                              maxLength={10}
                              className="w-full pr-10"
                            />
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-black hover:text-gray-600 cursor-pointer z-10"
                              >
                                <CalendarIcon className="w-5 h-5" />
                              </button>
                            </PopoverTrigger>
                          </div>
                          <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                              date={selectedDate}
                              onSelect={handleDateSelect}
                            />
                          </PopoverContent>
                        </Popover>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Type Field */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Type
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Debit">Debit</SelectItem>
                        <SelectItem value="Credit">Credit</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Category Field */}
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Category
                    </FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value}
                      disabled={loadingCategories}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={loadingCategories ? "Loading categories..." : "Select category"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {loadingCategories ? (
                          <div className="p-2 text-center text-lg text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
                            Loading categories...
                          </div>
                        ) : getAvailableCategories().length === 0 ? (
                          <div className="p-2 text-center text-lg text-gray-500">
                            {transactionType === 'Debit' 
                              ? 'No payables categories found. Please add categories in Payables List.'
                              : 'No receivables categories found. Please add categories in Receivables List.'}
                          </div>
                        ) : (
                          getAvailableCategories().map((category) => (
                            <SelectItem key={String(category.id)} value={String(category.id)}>
                              {category.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payment Type Field */}
              <FormField
                control={form.control}
                name="paymentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Payment Type
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select payment type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="creditcard">Credit Card</SelectItem>
                        <SelectItem value="banktransfer">Online</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Cheque Number Field - Conditional */}
              {paymentType === 'cheque' && (
                <FormField
                  control={form.control}
                  name="chequeNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-medium text-gray-700">
                        Cheque Number
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter cheque number"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Amount Field */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Amount (AED)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-lg text-red-600">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full bg-[#eab308] hover:bg-[#d4a007] text-black py-3 mt-6"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {editingTransaction ? 'Updating...' : 'Saving...'}
                  </>
                ) : (
                  editingTransaction ? 'Update Transaction' : 'Save Transaction'
                )}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        onConfirm={handleDeleteConfirm}
        itemName={getTransactionDescription()}
        isLoading={isDeleting}
      />
    </Layout>
  );
}

