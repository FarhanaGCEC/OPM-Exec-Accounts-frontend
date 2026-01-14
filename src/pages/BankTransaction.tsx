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
import { SearchableSelect } from '../components/ui/searchable-select';
// Table components removed - using native HTML table for sticky header
import { Plus, Calendar as CalendarIcon, Loader2, Edit, Trash2, Download, FileSpreadsheet,Filter, X } from 'lucide-react';
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
  categoryId?: string | number; // Category ID for editing
  amount?: string | number; // For display with commas (legacy)
  balance: string; // For display
  debitFormatted?: string | null; // Formatted debit amount
  creditFormatted?: string | null; // Formatted credit amount
  remarks?: string; // Remarks for the transaction
  
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
  remarks: z.string().optional(),
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
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchDetails, setSearchDetails] = useState<string>('');
  const [searchAmount, setSearchAmount] = useState<string>('');
  const [searchDescription, setSearchDescription] = useState<string>('');
  const [searchRemarks, setSearchRemarks] = useState<string>('');

  const form = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      date: '',
      type: 'Debit',
      categoryId: '',
      paymentType: 'cash',
      chequeNumber: '',
      remarks: '',
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
            categoryId: (transaction as any).categoryId || (transaction as any).category_id || undefined, // Preserve categoryId if available
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
        remarks?: string;
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

      // Include remarks if provided
      if (data.remarks && data.remarks.trim()) {
        payload.remarks = data.remarks.trim();
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
          // Format balance with commas
          const balanceValue = typeof response.data.balance === 'number' 
            ? response.data.balance 
            : parseFloat(String(response.data.balance || editingTransaction.balance).replace(/,/g, '')) || 0;
          const formattedBalance = balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          
          // Update existing transaction in state
          const updatedTransaction: BankTransaction = {
            ...response.data,
            id: String(response.data.id || editingTransaction.id),
            categoryName: selectedCategory?.name,
            amount: formattedAmount,
            balance: formattedBalance,
          };
          setTransactions(prevTransactions =>
            prevTransactions.map(t => 
              t.id === editingTransaction.id ? updatedTransaction : t
            )
          );
        } else {
          // Format balance with commas
          const balanceValue = typeof response.data.balance === 'number' 
            ? response.data.balance 
            : parseFloat(String(response.data.balance || '0').replace(/,/g, '')) || 0;
          const formattedBalance = balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          
          // Add new transaction to local state
          const newTransaction: BankTransaction = {
            ...response.data,
            id: String(response.data.id || Date.now()),
            categoryName: selectedCategory?.name,
            amount: formattedAmount,
            balance: formattedBalance,
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
          remarks: '',
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
    
    // Find category ID - first try to use categoryId if available, otherwise match by name
    // Check both lists if categoryId is not available
    let categoryId = '';
    
    console.log('[handleEdit] Transaction:', {
      id: transaction.id,
      type: transactionType,
      categoryName: transaction.categoryName,
      categoryId: transaction.categoryId,
      payablesCount: payablesCategories.length,
      receivablesCount: receivablesCategories.length,
    });
    
    // First, try to find by categoryId if transaction has it
    if (transaction.categoryId) {
      // Try in payables first (for Debit)
      let foundById = payablesCategories.find(cat => String(cat.id) === String(transaction.categoryId));
      if (foundById) {
        categoryId = String(foundById.id);
        console.log('[handleEdit] Found by ID in payables:', categoryId);
      } else {
        // Try in receivables (for Credit)
        foundById = receivablesCategories.find(cat => String(cat.id) === String(transaction.categoryId));
        if (foundById) {
          categoryId = String(foundById.id);
          console.log('[handleEdit] Found by ID in receivables:', categoryId);
        } else {
          console.log('[handleEdit] Category ID not found in any list:', transaction.categoryId);
        }
      }
    }
    
    // If not found by ID, try to find by name (case-insensitive, trimmed)
    // Since API doesn't return categoryId, we must match by name
    if (!categoryId && transaction.categoryName && transaction.categoryName !== 'N/A') {
      // Try in the appropriate list based on transaction type FIRST
      const categoryList = transactionType === 'Debit' ? payablesCategories : receivablesCategories;
      const otherList = transactionType === 'Debit' ? receivablesCategories : payablesCategories;
      

    
      
      // First try in the appropriate list
      let foundByName = categoryList.find(cat => {
        const catName = cat.name.trim().toLowerCase();
        const transName = transaction.categoryName?.trim().toLowerCase();
        return catName === transName;
      });
      
      if (foundByName) {
        categoryId = String(foundByName.id);
        console.log('[handleEdit] Found in primary list:', foundByName.name, '->', categoryId);
      } else {
        // If not found, try the other list as fallback
        foundByName = otherList.find(cat => {
          const catName = cat.name.trim().toLowerCase();
          const transName = transaction.categoryName?.trim().toLowerCase();
          return catName === transName;
        });
        
     
      }
    }
    
    console.log('[handleEdit] Final categoryId:', categoryId);
    
    // Ensure paymentType is 'banktransfer' not 'online' for form
    const formPaymentType = transaction.paymentType === 'online' ? 'banktransfer' : transaction.paymentType;
    
    // Reset form with all values
    form.reset({
      date: dateValue,
      type: transactionType as 'Debit' | 'Credit',
      categoryId: categoryId,
      paymentType: formPaymentType as 'creditcard' | 'cheque' | 'cash' | 'banktransfer',
      chequeNumber: transaction.chequeNumber && transaction.chequeNumber !== '-' ? transaction.chequeNumber : '' ,
      remarks: transaction.remarks || '',
      amount: amountValue,
    });
    
    // Force set categoryId after a small delay to ensure form is ready
    if (categoryId) {
      setTimeout(() => {
        form.setValue('categoryId', categoryId, { shouldValidate: false });
        console.log('[handleEdit] Force set categoryId after reset:', categoryId);
      }, 100);
    }
    
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
      remarks: '',
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





  // Helper function to parse date from DD-MMM-YYYY format
  const parseDateForFilter = useCallback((dateString: string): Date | null => {
    if (!dateString) return null;
    try {
      const parts = dateString.split('-');
      if (parts.length === 3) {
        const months: { [key: string]: string } = {
          'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
          'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        const month = months[parts[1]] || '01';
        return new Date(`${parts[2]}-${month}-${parts[0]}`);
      }
      // Try ISO format
      const isoDate = new Date(dateString);
      if (!isNaN(isoDate.getTime())) return isoDate;
    } catch {
      return null;
    }
    return null;
  }, []);

  // Filter transactions based on active tab, date range, and search
  const filteredTransactions = transactions.filter(transaction => {
    // Filter by payment type
    // 'online' tab shows both creditcard and banktransfer (which comes as 'online' from API)
    if (activeTab === 'online' && transaction.paymentType !== 'creditcard' && transaction.paymentType !== 'banktransfer') return false;
    if (activeTab === 'cheque' && transaction.paymentType !== 'cheque') return false;
    if (activeTab === 'cash' && transaction.paymentType !== 'cash') return false;
    
    // Filter by date range
    if (startDate || endDate) {
      const transactionDate = parseDateForFilter(transaction.date);
      if (transactionDate) {
        if (startDate) {
          const start = parseDateForFilter(startDate);
          if (start && transactionDate < start) return false;
        }
        if (endDate) {
          const end = parseDateForFilter(endDate);
          if (end) {
            // Set end date to end of day
            const endOfDay = new Date(end);
            endOfDay.setHours(23, 59, 59, 999);
            if (transactionDate > endOfDay) return false;
          }
        }
      }
    }
    
    // Filter by Details
    if (searchDetails.trim()) {
      const details = transaction.paymentType === 'cheque' && transaction.chequeNumber && transaction.chequeNumber !== '-'
        ? `${transaction.chequeNumber}`
        : transaction.paymentType === 'cash'
        ? 'Cash'
        : transaction.paymentType === 'creditcard'
        ? 'Credit Card'
        : transaction.paymentType === 'banktransfer'
        ? 'Online'
        : transaction.paymentType || '';
      
      if (!details.toLowerCase().includes(searchDetails.toLowerCase().trim())) return false;
    }
    
    // Filter by Amount (Debit or Credit)
    if (searchAmount.trim()) {
      const debitStr = transaction.debitFormatted || '0.00';
      const creditStr = transaction.creditFormatted || '0.00';
      const amountStr = `${debitStr} ${creditStr}`.toLowerCase();
      const searchAmountLower = searchAmount.toLowerCase().trim();
      
      if (!amountStr.includes(searchAmountLower)) return false;
    }
    
    // Filter by Description (Category Name)
    if (searchDescription.trim()) {
      const descriptionStr = (transaction.categoryName || 'N/A').toLowerCase();
      const searchDescriptionLower = searchDescription.toLowerCase().trim();
      
      if (!descriptionStr.includes(searchDescriptionLower)) return false;
    }
    
    // Filter by Remarks
    if (searchRemarks.trim()) {
      const remarksStr = (transaction.remarks || '').toLowerCase();
      const searchRemarksLower = searchRemarks.toLowerCase().trim();
      
      if (!remarksStr.includes(searchRemarksLower)) return false;
    }
    
    return true;
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, startDate, endDate, searchDetails, searchAmount, searchDescription, searchRemarks]);

  // Clear all filters
  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    setSearchDetails('');
    setSearchAmount('');
    setSearchDescription('');
    setSearchRemarks('');
    setCurrentPage(1);
  };

  // CSV Download function
  const handleDownloadCSV = useCallback(() => {

    const safe = (v: string) => `"${String(v || '').replace(/"/g, '""')}"`;
  
    const row6 = (...cols: string[]) => {
      const filled = [...cols];
      while (filled.length < 6) filled.push('');
      return filled.slice(0, 6).map(safe).join(',');
    };
  
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
  
    // Get closing balance from the LAST transaction in the filtered list
    // Sort by date first, then by ID/index to ensure we get the actual latest transaction
    const sortedByDate = [...filteredTransactions].sort((a, b) => {
      const parseDateForSort = (t: any) => {
        // Prefer originalDate (ISO format with timestamp) for accurate sorting
        if (t.originalDate) {
          const origDate = new Date(t.originalDate);
          if (!isNaN(origDate.getTime())) {
            return origDate;
          }
        }
        // Fallback to formatted date
        const parts = t.date?.split('-');
        if (parts?.length === 3) {
          const months: any = { 
            Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
            Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' 
          };
          const date = new Date(`${parts[2]}-${months[parts[1]]}-${parts[0]}`);
          return isNaN(date.getTime()) ? null : date;
        }
        return null;
      };
      const dateA = parseDateForSort(a);
      const dateB = parseDateForSort(b);
      
      // If dates are equal, sort by ID (assuming higher ID = newer transaction)
      if (dateA && dateB && dateA.getTime() === dateB.getTime()) {
        const idA = parseInt(String(a.id || '0'), 10);
        const idB = parseInt(String(b.id || '0'), 10);
        return idB - idA; // Higher ID = newer (descending)
      }
      
      if (!dateA && !dateB) {
        // If both have no date, sort by ID
        const idA = parseInt(String(a.id || '0'), 10);
        const idB = parseInt(String(b.id || '0'), 10);
        return idB - idA;
      }
      if (!dateA) return 1; // Put transactions without date at the end
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime(); // Descending order (newest first)
    });
    
    // Get the latest transaction (first in sorted array, which should be the most recent)
    const latestTransaction = sortedByDate.length > 0 ? sortedByDate[0] : null;
    
    // Extract balance value properly
    let closingBalanceValue = 0;
    if (latestTransaction) {
      const balanceStr = latestTransaction.balance || '0';
      // Handle balance as number or string
      if (typeof balanceStr === 'number') {
        closingBalanceValue = balanceStr;
      } else {
        // Remove commas, "AED", and any whitespace
        const cleanedBalance = String(balanceStr)
          .replace(/,/g, '')
          .replace(/AED/gi, '')
          .replace(/\s+/g, '')
          .trim();
        closingBalanceValue = parseFloat(cleanedBalance) || 0;
      }
    }
    
    // Format for display
    const closingBalance = closingBalanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
    const csvRows: string[] = [];
  
    // ----- HEADER -----
    csvRows.push(row6('GCEC CLOUD SECURITY & SURVEILLANCE'));
    csvRows.push(row6());
    csvRows.push(row6());
  
    csvRows.push(row6('Account No.', '12990685920001 - AED'));
    csvRows.push(row6('IBAN', 'AE720030012990685920001'));
    csvRows.push(row6('Start Date', formatDate(startDate)));
    csvRows.push(row6('End Date', formatDate(endDate)));
    csvRows.push(row6('Closing (Current)', `AED ${closingBalance}`));
    csvRows.push(row6());
    csvRows.push(row6());
  
    // ----- TABLE HEADER -----
    csvRows.push(row6('Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance'));
  
    // ----- TABLE ROWS -----
    filteredTransactions.forEach(t => {
  
      let details = '';
      if (t.paymentType === 'cheque' && t.chequeNumber && t.chequeNumber !== '-') {
        details = t.chequeNumber.replace('', '').trim().padStart(6, '0');
      } else if (t.paymentType === 'banktransfer') {
        details = 'Online';
      } else if (t.paymentType === 'cash') {
        details = 'Cash';
      } else if (t.paymentType === 'creditcard') {
        details = 'Credit Card';
      }
  
      const debitValue = t.debit || 0;
      const creditValue = t.credit || 0;
  
      const debit = `AED ${debitValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const credit = `AED ${creditValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  
      const balanceValue = Number(String(t.balance || '0').replace(/,/g, '').replace('AED', '').trim()) || 0;
      const balance = `AED ${balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  
      csvRows.push(row6(
        t.date || '',
        t.categoryName || 'N/A',
        details,
        debit,
        credit,
        balance
      ));
    });
  
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
    const parseDateForRange = (t: any) => {
      if (t.originalDate) {
        const origDate = new Date(t.originalDate);
        return isNaN(origDate.getTime()) ? null : origDate;
      }
      const parts = t.date?.split('-');
      if (parts?.length === 3) {
        const months: any = { 
          Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
          Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' 
        };
        const date = new Date(`${parts[2]}-${months[parts[1]]}-${parts[0]}`);
        return isNaN(date.getTime()) ? null : date;
      }
      return null;
    };

    const dates = filteredTransactions.map(parseDateForRange).filter(Boolean) as Date[];
    const startDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const endDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

    const formatDate = (d: Date) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };

    // Get closing balance from the LAST transaction in the filtered list
    // Sort by date first, then by ID/index to ensure we get the actual latest transaction
    const sortedByDate = [...filteredTransactions].sort((a, b) => {
      const parseDateForSort = (t: any) => {
        // Prefer originalDate (ISO format with timestamp) for accurate sorting
        if (t.originalDate) {
          const origDate = new Date(t.originalDate);
          if (!isNaN(origDate.getTime())) {
            return origDate;
          }
        }
        // Fallback to formatted date
        const parts = t.date?.split('-');
        if (parts?.length === 3) {
          const months: any = { 
            Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
            Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' 
          };
          const date = new Date(`${parts[2]}-${months[parts[1]]}-${parts[0]}`);
          return isNaN(date.getTime()) ? null : date;
        }
        return null;
      };
      const dateA = parseDateForSort(a);
      const dateB = parseDateForSort(b);
      
      // If dates are equal, sort by ID (assuming higher ID = newer transaction)
      if (dateA && dateB && dateA.getTime() === dateB.getTime()) {
        const idA = parseInt(String(a.id || '0'), 10);
        const idB = parseInt(String(b.id || '0'), 10);
        return idB - idA; // Higher ID = newer (descending)
      }
      
      if (!dateA && !dateB) {
        // If both have no date, sort by ID
        const idA = parseInt(String(a.id || '0'), 10);
        const idB = parseInt(String(b.id || '0'), 10);
        return idB - idA;
      }
      if (!dateA) return 1; // Put transactions without date at the end
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime(); // Descending order (newest first)
    });
    
    // Get the latest transaction (first in sorted array, which should be the most recent)
    const latestTransaction = sortedByDate.length > 0 ? sortedByDate[0] : null;
    
    // Extract balance value properly
    let closingBalanceValue = 0;
    if (latestTransaction) {
      const balanceStr = latestTransaction.balance || '0';
      // Handle balance as number or string
      if (typeof balanceStr === 'number') {
        closingBalanceValue = balanceStr;
      } else {
        // Remove commas, "AED", and any whitespace
        const cleanedBalance = String(balanceStr)
          .replace(/,/g, '')
          .replace(/AED/gi, '')
          .replace(/\s+/g, '')
          .trim();
        closingBalanceValue = parseFloat(cleanedBalance) || 0;
      }
    }

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
    excelData.push(['Closing (Current):', closingBalanceValue]); // Store as number
    excelData.push([]);
    excelData.push([]);

    // Add table headers
    excelData.push(['Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance']);

    // Sort transactions by date (oldest first) for better readability in Excel
    const sortedTransactionsForExcel = [...filteredTransactions].sort((a, b) => {
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
      const dateA = parseDate(a);
      const dateB = parseDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.getTime() - dateB.getTime(); // Ascending order (oldest first)
    });

    // Add transaction rows
    sortedTransactionsForExcel.forEach(t => {
      // Format payment type for Details column
      let details = '';
      if (t.paymentType === 'cheque' && t.chequeNumber && t.chequeNumber !== '-') {
        // Remove any existing padding and ensure proper formatting
        const chequeNum = String(t.chequeNumber).replace(/,/g, '').trim();
        details = chequeNum.padStart(6, '0');
      } else if (['banktransfer', 'creditcard'].includes(t.paymentType || '')) {
        details = 'Online';
      } else if (t.paymentType === 'cash') {
        details = 'Cash';
      } else if (t.paymentType) {
        details = t.paymentType;
      }

      // Extract numeric values for Excel (store as numbers, not text)
      const debitValue = typeof t.debit === 'number' ? t.debit : (Number(String(t.debit || 0).replace(/,/g, '').replace('AED', '').trim()) || 0);
      const creditValue = typeof t.credit === 'number' ? t.credit : (Number(String(t.credit || 0).replace(/,/g, '').replace('AED', '').trim()) || 0);
      
      // Format balance as number
      const balanceStr = t.balance || '0';
      const balanceValue = Number(String(balanceStr).replace(/,/g, '').replace('AED', '').trim()) || 0;

      excelData.push([
        t.date || '',
        t.categoryName || 'N/A',
        details,
        debitValue,  // Store as number
        creditValue, // Store as number
        balanceValue // Store as number
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

    // Find the range of data
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    
    // Format Closing Balance cell (row 7, column 1) - "Closing (Current):" is in column 0, value in column 1
    const closingBalanceCellRef = XLSX.utils.encode_cell({ r: 7, c: 1 });
    if (worksheet[closingBalanceCellRef]) {
      if (typeof worksheet[closingBalanceCellRef].v === 'number') {
        worksheet[closingBalanceCellRef].t = 'n'; // Ensure type is number
        worksheet[closingBalanceCellRef].z = '#,##0.00'; // Number format with 2 decimals and thousand separators
      }
    }
    
    // Apply number formatting to Debit, Credit, and Balance columns (columns D=3, E=4, F=5)
    // Header row is at index 10 (after company header, account info, and empty rows)
    // Data rows start at index 11
    const dataStartRow = 11;
    
    for (let row = dataStartRow; row <= range.e.r; row++) {
      // Column D (Debit) - index 3
      const debitCellRef = XLSX.utils.encode_cell({ r: row, c: 3 });
      if (worksheet[debitCellRef]) {
        if (typeof worksheet[debitCellRef].v === 'number') {
          worksheet[debitCellRef].t = 'n'; // Number type
          worksheet[debitCellRef].z = '#,##0.00'; // Number format with 2 decimals and thousand separators
        }
      }
      
      // Column E (Credit) - index 4
      const creditCellRef = XLSX.utils.encode_cell({ r: row, c: 4 });
      if (worksheet[creditCellRef]) {
        if (typeof worksheet[creditCellRef].v === 'number') {
          worksheet[creditCellRef].t = 'n'; // Number type
          worksheet[creditCellRef].z = '#,##0.00'; // Number format with 2 decimals and thousand separators
        }
      }
      
      // Column F (Balance) - index 5
      const balanceCellRef = XLSX.utils.encode_cell({ r: row, c: 5 });
      if (worksheet[balanceCellRef]) {
        if (typeof worksheet[balanceCellRef].v === 'number') {
          worksheet[balanceCellRef].t = 'n'; // Number type
          worksheet[balanceCellRef].z = '#,##0.00'; // Number format with 2 decimals and thousand separators
        }
      }
    }
    
    // Format header row (row 10) - make headers bold
    const headerRow = 10;
    for (let col = 0; col <= 5; col++) {
      const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
      if (worksheet[headerCellRef]) {
        if (!worksheet[headerCellRef].s) {
          worksheet[headerCellRef].s = {};
        }
        worksheet[headerCellRef].s.font = { bold: true };
        worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Account Statement');

    // Generate Excel file and download
    const fileName = `GCEC-Statement-${formatDate(startDate)}-to-${formatDate(endDate)}.xlsx`;
    XLSX.writeFile(workbook, fileName);

  }, [filteredTransactions]);
  
  

  return (
    <Layout>
       <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
      
          <h2 className="text-2xl font-bold text-gray-900"> Daily Transaction</h2>
       </div>
            <Button
            onClick={handleAddNew}
            className="bg-[#eab308] hover:bg-[#d4a007] text-black flex items-center space-x-2 transition-colors rounded-lg mr-4"
            disabled={loading}
            >
            <Plus className="w-4 h-4 text-black" />
            <span>Add New</span>
            </Button>
        </div>
 
 <Card className="bg-white border border-gray-200 shadow-sm rounded-lg mt-18 m-4">
  <CardContent className="p-4">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">

      {/* Start Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Start Date
        </label>
        <div className="relative">
          <Input
            type="text"
           
            value={startDate}
            onChange={(e) => {
              let value = e.target.value.replace(/\D/g, '');
              if (value.length >= 2) value = value.slice(0, 2) + '-' + value.slice(2);
              if (value.length >= 6) value = value.slice(0, 6) + '-' + value.slice(6, 10);
              setStartDate(value);
            }}
            maxLength={11}
            className="w-full pr-10 h-10"
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <CalendarIcon className="w-5 h-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                date={startDate ? parseDateForFilter(startDate) : null}
                onSelect={(date) => {
                  if (date) {
                    const day = String(date.getDate()).padStart(2, '0');
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const month = months[date.getMonth()];
                    const year = date.getFullYear();
                    setStartDate(`${day}-${month}-${year}`);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* End Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          End Date
        </label>
        <div className="relative">
          <Input
            type="text"
         
            value={endDate}
            onChange={(e) => {
              let value = e.target.value.replace(/\D/g, '');
              if (value.length >= 2) value = value.slice(0, 2) + '-' + value.slice(2);
              if (value.length >= 6) value = value.slice(0, 6) + '-' + value.slice(6, 10);
              setEndDate(value);
            }}
            maxLength={11}
            className="w-full pr-10 h-10"
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <CalendarIcon className="w-5 h-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                date={endDate ? parseDateForFilter(endDate) : null}
                onSelect={(date) => {
                  if (date) {
                    const day = String(date.getDate()).padStart(2, '0');
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const month = months[date.getMonth()];
                    const year = date.getFullYear();
                    setEndDate(`${day}-${month}-${year}`);
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Details */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Details</label>
        <div className="relative">
        
          <Input
            type="text"
          
            value={searchDetails}
            onChange={(e) => setSearchDetails(e.target.value)}
            className="w-full pl-10 pr-10 h-10"
          />
          {searchDetails && (
            <button
              onClick={() => setSearchDetails('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
        <div className="relative">
         
          <Input
            type="text"
           
            value={searchAmount}
            onChange={(e) => setSearchAmount(e.target.value)}
            className="w-full pl-10 pr-10 h-10"
          />
          {searchAmount && (
            <button
              onClick={() => setSearchAmount('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
        <div className="relative">
    
          <Input
            type="text"
           
            value={searchDescription}
            onChange={(e) => setSearchDescription(e.target.value)}
            className="w-full pl-10 pr-10 h-10"
          />
          {searchDescription && (
            <button
              onClick={() => setSearchDescription('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Remarks */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
        <div className="relative">

          <Input
            type="text"
           
            value={searchRemarks}
            onChange={(e) => setSearchRemarks(e.target.value)}
            className="w-full pl-10 pr-10 h-10"
          />
          {searchRemarks && (
            <button
              onClick={() => setSearchRemarks('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Actions */}
      <div className="flex items-end gap-2 w-full">
       
        <Button
          onClick={() => {
            setCurrentPage(1);
            handleClearFilters();
          }}
          className="bg-[#eab308] hover:bg-[#d4a007] text-black h-10 flex-1 shadow-md hover:shadow-lg transition-shadow flex items-center justify-center gap-2"
          title="Apply Filter"
        >
          <Filter className="w-4 h-4" />
          Apply Filter
        </Button>
      </div>

    </div>
  </CardContent>
</Card>


     {/* Tabs and Action Buttons */}
     <div className="m-4 flex items-center justify-between gap-4">
       {/* Tabs */}
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

       {/* Action Buttons */}
       <div className="flex items-center gap-3">
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
     
       </div>
     </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-lg text-red-600">{error}</p>
        </div>
      )}

      {/* Transactions Table */}

      <Card className="bg-white border border-gray-200 m-4">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="max-h-[600px] overflow-y-auto relative">
              <table className="w-full caption-bottom text-base border rounded-lg">
                <thead className="sticky top-0 z-20 bg-[#eab308] shadow-sm">
                  <tr className="bg-[#eab308] border-0">
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Date
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Description
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Details
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Debit
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Credit
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Balance
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Remarks
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 p-2 align-middle">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                      <p className="text-sm text-gray-500">Loading transactions...</p>
                    </td>
                  </tr>
                ) : !Array.isArray(filteredTransactions) || filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 p-2 align-middle">
                      <p className="text-sm text-gray-500 mb-1">No transactions found.</p>
                      <p className="text-sm text-gray-400">Click "Add New" to create your first transaction.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedTransactions.map((transaction) => {
                    const remarksLower = transaction.remarks?.toLowerCase().trim() || '';
                    const isBouncedCheque = remarksLower === 'bounced cheque' || 
                                           remarksLower === 'bouncedcheque' || 
                                           remarksLower === 'bouncedchecq' ||
                                           remarksLower === 'returned cheque' || 
                                           remarksLower === 'returnedcheque' ||  
                                           (remarksLower.includes('bounced') && remarksLower.includes('cheque')) ||
                                           (remarksLower.includes('returned') && remarksLower.includes('cheque'));
                    return (
                    <tr 
                      key={transaction.id} 
                      className={`border-b border-gray-100 transition-colors ${
                        isBouncedCheque 
                          ? 'bg-[#95dcf7] hover:bg-[#7dd3f0]' 
                          : 'hover:bg-gray-50'
                      }`}
                      style={isBouncedCheque ? { backgroundColor: '#95dcf7' } : {}}
                    >
                      <td className="text-gray-700 text-sm py-2 text-left p-2 align-middle">
                        {transaction.date}
                      </td>
                      <td className="text-gray-700 font-medium text-sm py-2 text-left p-2 align-middle">
                        {transaction.categoryName || 'N/A'}
                      </td>
                      <td className="text-gray-600 text-sm py-2 text-left p-2 align-middle">
                        {transaction.paymentType === 'cheque' && transaction.chequeNumber && transaction.chequeNumber !== '-'
                          ? `${transaction.chequeNumber}`
                          : transaction.paymentType === 'cash'
                          ? 'Cash'
                          : transaction.paymentType === 'creditcard'
                          ? 'Credit Card'
                          : transaction.paymentType === 'banktransfer'
                          ? 'Online'
                          : <span className="capitalize">{transaction.paymentType || 'N/A'}</span>}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {transaction.debitFormatted ? (
                          <span className="text-red-600 font-semibold">
                            AED {transaction.debitFormatted} 
                          </span>
                        ) : (
                          <span className="text-gray-400">AED 0.00</span>
                        )}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {transaction.creditFormatted ? (
                          <span className="text-green-600 font-semibold">
                            AED {transaction.creditFormatted} 
                          </span>
                        ) : (
                          <span className="text-gray-400">AED 0.00</span>
                        )}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {(() => {
                          const balanceStr = transaction.balance || '0';
                          const balanceValue = Number(String(balanceStr).replace(/,/g, '').replace('AED', '').trim()) || 0;
                          const isNegative = balanceValue < 0;
                          const formattedBalance = balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          return (
                            <span className={isNegative ? 'text-red-600 font-bold' : 'text-gray-700 font-semibold'}>
                              AED {formattedBalance} 
                            </span>
                          );
                        })()}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {transaction.remarks || ''}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
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
                      </td>
                    </tr>
                    );
                  })
                )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {filteredTransactions.length > itemsPerPage && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {startIndex + 1} to {Math.min(endIndex, filteredTransactions.length)} of {filteredTransactions.length} transactions
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              variant="outline"
              className="border-gray-300 hover:bg-gray-50 text-black"
            >
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                // Show first page, last page, current page, and pages around current
                if (
                  page === 1 ||
                  page === totalPages ||
                  (page >= currentPage - 1 && page <= currentPage + 1)
                ) {
                  return (
                    <Button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      variant={currentPage === page ? "default" : "outline"}
                      className={
                        currentPage === page
                          ? "bg-[#eab308] hover:bg-[#d4a007] text-black"
                          : "border-gray-300 hover:bg-gray-50 text-black"
                      }
                      size="sm"
                    >
                      {page}
                    </Button>
                  );
                } else if (
                  page === currentPage - 2 ||
                  page === currentPage + 2
                ) {
                  return <span key={page} className="px-2">...</span>;
                }
                return null;
              })}
            </div>
            <Button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              variant="outline"
              className="border-gray-300 hover:bg-gray-50 text-black"
            >
              Next
            </Button>
          </div>
        </div>
      )}

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
            remarks: '',
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
                render={({ field }) => {
                  // Ensure the field value is properly set when editing
                  useEffect(() => {
                    if (editingTransaction && field.value) {
                      // Force update if value exists but not showing
                      const currentValue = field.value;
                      const availableCategories = getAvailableCategories();
                      const categoryExists = availableCategories.some(cat => String(cat.id) === String(currentValue));
                      if (!categoryExists && availableCategories.length > 0) {
                        console.log('[Category Field] Value not found in available categories, clearing:', currentValue);
                        field.onChange('');
                      }
                    }
                    // eslint-disable-next-line react-hooks/exhaustive-deps
                  }, [editingTransaction, transactionType, payablesCategories, receivablesCategories]);
                  
                  return (
                    <FormItem>
                      <FormLabel className="text-lg font-medium text-gray-700">
                        Category
                      </FormLabel>
                      <FormControl>
                        {loadingCategories ? (
                          <div className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-base">
                            <span className="text-muted-foreground">Loading categories...</span>
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        ) : getAvailableCategories().length === 0 ? (
                          <div className="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-base text-muted-foreground">
                            {transactionType === 'Debit' 
                              ? 'No payables categories found. Please add categories in Payables List.'
                              : 'No receivables categories found. Please add categories in Receivables List.'}
                          </div>
                        ) : (
                          <SearchableSelect
                            value={field.value || ''}
                            onValueChange={(value) => {
                              console.log('[Category Field] Value changed:', value);
                              field.onChange(value);
                            }}
                            placeholder={loadingCategories ? "Loading categories..." : "Select category"}
                            disabled={loadingCategories}
                            searchPlaceholder="Search category..."
                          >
                            {getAvailableCategories().map((category) => (
                              <SelectItem key={String(category.id)} value={String(category.id)}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SearchableSelect>
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
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

              {/* Remarks Field */}
              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Remarks (Optional)
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter remarks"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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

