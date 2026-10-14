import { useState, useEffect, useCallback, useMemo } from 'react';
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
  DialogFooter,
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
  SelectItem,
} from '../components/ui/select';
import { SearchableSelect } from '../components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Plus, Calendar as CalendarIcon, Loader2, Edit, Trash2, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  applyXlsxArialToWorkbook,
  xlsxSheetFontArial,
  XLSX_WRITE_WITH_STYLES,
} from '../lib/excelExportFont';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import Calendar from '../components/ui/calendar-tailwind';
import {
  transactionService,
  type PaymentMatching as PaymentMatchingType,
} from '../services/transactionService';
import { receivablesService } from '../services/receivablesService';
import { payablesService } from '../services/payablesService';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import type { ApiResponse } from '../lib/api';
import { isApprovalRequiredError } from '../lib/approvalError';
import { changeRequestService } from '../services/changeRequestService';
import {
  isChangeRequestQueuedResponse,
  isChangeRequestSubmittedEnvelope,
  userMessageFromChangeRequestSubmit,
} from '../lib/changeRequestUi';
import { canMutateRecords } from '../lib/authPayload';
import { expandCenturyYear, formatDisplayYear } from '../lib/formatDisplayDate';

interface PaymentMatching extends PaymentMatchingType {
  date?: string; // Formatted date for display
  amountFormatted?: string; // Formatted amount for display
}

const isValidPaymentFormDate = (val: string): boolean => {
  const m = val.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return false;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const yPart = parseInt(m[3], 10);
  const year = m[3].length === 2 ? expandCenturyYear(yPart) : yPart;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
};

/** Purchase-bill API accepts dd/mm/yyyy; expand yy → yyyy when needed. */
const normalizePaymentDateForApi = (dateStr: string): string => {
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return dateStr;
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  const year =
    parts[2].length === 2
      ? String(expandCenturyYear(parseInt(parts[2], 10)))
      : parts[2];
  return `${day}/${month}/${year}`;
};

// Zod validation schema
const paymentSchema = z.object({
  paymentDate: z.string()
    .min(1, 'Payment date is required')
    .refine(isValidPaymentFormDate, 'Enter a valid date (dd/mm/yy)'),
  invoiceNumber: z.string().optional(),
  customerName: z.string()
    .min(1, 'Customer name is required')
    .min(3, 'Customer name must be at least 3 characters'),
  paymentMethod: z.string({
    required_error: 'Please select a payment method',
  }).min(1, 'Payment method is required'),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
  remarks: z.string().optional(),
  paidAgainst: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

/** Backend change-request resource type for Customer Credit Card Payments / purchase bills. */
const PURCHASE_BILL_RESOURCE_TYPE = 'purchase_bill';

type PurchaseBillApprovalOffer =
  | { mode: 'edit'; resourceId: string; payload: Record<string, unknown> }
  | { mode: 'delete'; resourceId: string }
  | { mode: 'success'; message: string };

// Format date from ISO to DD-MMM-YY (e.g., "01-Jan-26")
const formatDateForDisplay = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = String(date.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = formatDisplayYear(date.getFullYear());
    return `${day}-${month}-${year}`;
  } catch {
    return dateString;
  }
};

// Convert DD-MMM-YY or ISO to dd/mm/yy for form
const convertDateForForm = (dateString: string): string => {
  try {
    // Try ISO format first
    const isoDate = new Date(dateString);
    if (!isNaN(isoDate.getTime())) {
      const day = String(isoDate.getDate()).padStart(2, '0');
      const month = String(isoDate.getMonth() + 1).padStart(2, '0');
      const year = formatDisplayYear(isoDate.getFullYear());
      return `${day}/${month}/${year}`;
    }
    
    // Try DD-MMM-YY format
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = months.findIndex(m => m === parts[1]);
      if (monthIndex !== -1) {
        const month = String(monthIndex + 1).padStart(2, '0');
        const year =
          parts[2].length === 2
            ? parts[2].padStart(2, '0')
            : formatDisplayYear(parseInt(parts[2], 10));
        return `${day}/${month}/${year}`;
      }
    }
    
    return dateString;
  } catch {
    return dateString;
  }
};

export default function PaymentMatching() {
  const canMutate = canMutateRecords();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentMatching | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentMatching[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [purchaseBillApproval, setPurchaseBillApproval] = useState<PurchaseBillApprovalOffer | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [customerOptions, setCustomerOptions] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      paymentDate: '',
      invoiceNumber: '',
      customerName: '',
      paymentMethod: 'Credit Card',
      amount: '',
      remarks: '',
      paidAgainst: '',
    },
  });

  // Fetch payments from API
  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[PaymentMatching] Fetching payments...');
      const response: ApiResponse<PaymentMatchingType[]> = await transactionService.getPaymentMatchings();
      console.log('[PaymentMatching] API Response:', response);
      
      if (response.success && response.data && Array.isArray(response.data)) {
        const paymentsData: PaymentMatching[] = response.data.map(payment => {
          // Format date as DD-MMM-YYYY (e.g., "01-Jan-2026")
          const formattedDate = formatDateForDisplay(payment.paymentDate);
          
          // Format amount
          let formattedAmount: string;
          if (typeof payment.amount === 'number') {
            formattedAmount = payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          } else if (typeof payment.amount === 'string') {
            const numAmount = parseFloat(payment.amount);
            formattedAmount = isNaN(numAmount) ? payment.amount : numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          } else {
            formattedAmount = String(payment.amount || '0.00');
          }
          
          return {
            ...payment,
            id: String(payment.id),
            date: formattedDate,
            amountFormatted: formattedAmount,
          };
        });
        console.log('[PaymentMatching] Processed payments:', paymentsData);
        setPayments(paymentsData);
      } else {
        const errorMsg = response?.message || 'Failed to fetch payments';
        console.error('[PaymentMatching] API error:', errorMsg);
        setError(errorMsg);
        setPayments([]);
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.error || 'Failed to fetch payments';
      console.error('[PaymentMatching] Error fetching payments:', err);
      setError(errorMessage);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

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

        const debtorNames = debtorsRes.success
          ? toArray(debtorsRes.data)
              .map((item) =>
                String(item.name ?? item.customerName ?? item.customer_name ?? '').trim()
              )
              .filter(Boolean)
          : [];
        const creditorNames = creditorsRes.success
          ? toArray(creditorsRes.data)
              .map((item) =>
                String(item.name ?? item.vendorName ?? item.vendor_name ?? '').trim()
              )
              .filter(Boolean)
          : [];

        if (!cancelled) {
          setCustomerOptions(
            [...new Set([...debtorNames, ...creditorNames])].sort((a, b) =>
              a.localeCompare(b)
            )
          );
        }
      } catch (e) {
        console.error('[PaymentMatching] Failed to load debtors/creditors list', e);
        if (!cancelled) setCustomerOptions([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isModalOpen]);

  const submitPurchaseBillApproval = useCallback(async () => {
    if (!purchaseBillApproval || purchaseBillApproval.mode === 'success') return;
    const offer = purchaseBillApproval;
    setApprovalSubmitting(true);
    setError(null);
    try {
      const res = await changeRequestService.submit({
        action: offer.mode === 'edit' ? 'edit' : 'delete',
        resourceType: PURCHASE_BILL_RESOURCE_TYPE,
        resourceId: offer.resourceId,
        ...(offer.mode === 'edit' ? { payload: offer.payload } : {}),
      });
      const apiMessage = userMessageFromChangeRequestSubmit(res);
      if (offer.mode === 'edit') {
        setIsModalOpen(false);
        setEditingPayment(null);
        form.reset({
          paymentDate: '',
          invoiceNumber: '',
          customerName: '',
          paymentMethod: 'Credit Card',
          amount: '',
          remarks: '',
          paidAgainst: '',
        });
      }
      setSuccessMessage(apiMessage);
      setPurchaseBillApproval({ mode: 'success', message: apiMessage });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit change request');
    } finally {
      setApprovalSubmitting(false);
    }
  }, [purchaseBillApproval, form]);

  const onSubmit = useCallback(async (data: PaymentFormData) => {
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccessMessage(null);

      // Prepare payload - all required fields must be included
      // Keep date in dd/mm/yyyy format as API expects
      const payload: any = {
        paymentDate: normalizePaymentDateForApi(data.paymentDate),
        customerName: data.customerName,
        paymentMethod: data.paymentMethod,
        amount: parseFloat(data.amount.replace(/,/g, '')),
      };

      // Add invoiceNumber if provided
      if (data.invoiceNumber && data.invoiceNumber.trim()) {
        payload.invoiceNumber = data.invoiceNumber.trim();
      }
      if (data.remarks && data.remarks.trim()) {
        payload.remarks = data.remarks.trim();
      }
      if (data.paidAgainst && data.paidAgainst.trim()) {
        payload.paidAgainst = data.paidAgainst.trim();
      }

      console.log('[PaymentMatching] Payload being sent:', JSON.stringify(payload, null, 2));

      let response: ApiResponse<PaymentMatchingType>;
      
      if (editingPayment) {
        console.log('[PaymentMatching] Updating payment:', editingPayment.id, payload);
        response = await transactionService.updatePaymentMatching(String(editingPayment.id), payload);
      } else {
        console.log('[PaymentMatching] Creating payment:', payload);
        response = await transactionService.createPaymentMatching(payload);
      }

      if (
        response.success &&
        response.data &&
        (isChangeRequestQueuedResponse(response as ApiResponse<unknown>) ||
          isChangeRequestSubmittedEnvelope(response.data as unknown))
      ) {
        const apiMessage = userMessageFromChangeRequestSubmit(
          response as ApiResponse<unknown>
        );
        setSuccessMessage(apiMessage);
        setPurchaseBillApproval({ mode: 'success', message: apiMessage });
        form.reset({
          paymentDate: '',
          invoiceNumber: '',
          customerName: '',
          paymentMethod: 'Credit Card',
          amount: '',
          remarks: '',
          paidAgainst: '',
        });
        setEditingPayment(null);
        setError(null);
        setIsModalOpen(false);
        fetchPayments().catch(err => console.error('Error refetching after save:', err));
        return;
      }

      if (response.success && response.data) {
        const updatedPayment: PaymentMatching = {
          ...response.data,
          id: String(response.data.id),
          date: formatDateForDisplay(response.data.paymentDate),
          amountFormatted: typeof response.data.amount === 'number'
            ? response.data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : typeof response.data.amount === 'string'
            ? parseFloat(response.data.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : String(response.data.amount || '0.00'),
        };

        if (editingPayment) {
          setPayments(prevPayments =>
            prevPayments.map(payment =>
              payment.id === editingPayment.id ? updatedPayment : payment
            )
          );
        } else {
          setPayments(prevPayments => [updatedPayment, ...prevPayments]);
        }

        // Reset form with default values before closing
        form.reset({
          paymentDate: '',
          invoiceNumber: '',
          customerName: '',
          paymentMethod: 'Credit Card',
          amount: '',
          remarks: '',
          paidAgainst: '',
        });
        setEditingPayment(null);
        setError(null);
        setIsModalOpen(false);
        
        // Refetch to ensure consistency
        fetchPayments().catch(err => console.error('Error refetching after save:', err));
      } else {
        const errorMsg = response.message || 'Failed to save payment';
        setError(errorMsg);
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err) && editingPayment) {
        const payload: Record<string, unknown> = {
          bill_date: normalizePaymentDateForApi(data.paymentDate),
          vendor_name: data.customerName,
          payment_method: data.paymentMethod,
          amount: parseFloat(data.amount.replace(/,/g, '')),
        };
        if (data.invoiceNumber?.trim()) payload.invoice_number = data.invoiceNumber.trim();
        if (data.remarks?.trim()) payload.remarks = data.remarks.trim();
        if (data.paidAgainst?.trim()) payload.paid_against = data.paidAgainst.trim();
        setPurchaseBillApproval({
          mode: 'edit',
          resourceId: String(editingPayment.id),
          payload,
        });
        setIsModalOpen(false);
        setEditingPayment(null);
        form.reset({
          paymentDate: '',
          invoiceNumber: '',
          customerName: '',
          paymentMethod: 'Credit Card',
          amount: '',
          remarks: '',
          paidAgainst: '',
        });
        setError(null);
      } else {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to save payment';
        console.error('[PaymentMatching] Error saving payment:', err);
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [editingPayment, form, fetchPayments]);

  const handleEdit = useCallback((payment: PaymentMatching) => {
    setEditingPayment(payment);
    const formDate = convertDateForForm(payment.paymentDate);
    form.reset({
      paymentDate: formDate,
      invoiceNumber: payment.invoiceNumber || '',
      customerName: payment.customerName,
      paymentMethod: payment.paymentMethod,
      amount: typeof payment.amount === 'number' 
        ? payment.amount.toString() 
        : typeof payment.amount === 'string'
        ? payment.amount.replace(/,/g, '')
        : '',
      remarks: payment.remarks || payment.remark || payment.description || '',
      paidAgainst: payment.paidAgainst || '',
    });
    setError(null);
    setIsModalOpen(true);
  }, [form]);

  const handleAddNew = useCallback(() => {
    setEditingPayment(null);
    form.reset({
      paymentDate: '',
      invoiceNumber: '',
      customerName: '',
      paymentMethod: 'Credit Card',
      amount: '',
      remarks: '',
      paidAgainst: '',
    });
    setError(null);
    setIsModalOpen(true);
  }, [form]);

  const handleDeleteClick = useCallback((id: string) => {
    setDeletingPaymentId(id);
    setError(null);
    setSuccessMessage(null);
    setIsDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingPaymentId) return;

    try {
      setIsDeleting(true);
      setError(null);
      const response: ApiResponse<void> = await transactionService.deletePaymentMatching(deletingPaymentId);
      
      if (response.success) {
        if (
          isChangeRequestQueuedResponse(response as ApiResponse<unknown>) ||
          isChangeRequestSubmittedEnvelope(response.data)
        ) {
          const apiMessage = userMessageFromChangeRequestSubmit(
            response as ApiResponse<unknown>
          );
          setSuccessMessage(apiMessage);
          setPurchaseBillApproval({ mode: 'success', message: apiMessage });
          setDeletingPaymentId(null);
          setIsDeleteModalOpen(false);
        } else {
          setPayments(prevPayments =>
            prevPayments.filter(payment => payment.id !== deletingPaymentId)
          );
          setDeletingPaymentId(null);
          setIsDeleteModalOpen(false);
        }
      } else {
        setError(response.message || 'Failed to delete payment');
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err) && deletingPaymentId) {
        setPurchaseBillApproval({ mode: 'delete', resourceId: deletingPaymentId });
        setDeletingPaymentId(null);
        setIsDeleteModalOpen(false);
        setError(null);
      } else {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete payment';
        setError(errorMessage);
        console.error('Error deleting payment:', err);
      }
    } finally {
      setIsDeleting(false);
    }
  }, [deletingPaymentId]);

  const filteredPayments = useMemo(
    () =>
      payments.filter((payment) => {
        if (filterText.trim()) {
          const needle = filterText.toLowerCase().trim();
          const haystack =
            `${payment.customerName} ${payment.invoiceNumber || ''} ${payment.paymentMethod} ${payment.paidAgainst || ''} ${payment.remarks || payment.remark || payment.description || ''} ${payment.date || payment.paymentDate}`
              .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      }),
    [payments, filterText]
  );

  const handleDownloadExcel = useCallback(() => {
    if (filteredPayments.length === 0) return;

    // Create a new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData: any[] = [];

    // Add company header
    excelData.push(['GCEC CLOUD SECURITY & SURVEILLANCE L.L.C']);
    excelData.push([]);
    excelData.push(['Sales Invoice amount paid against GCEC Purchase Bills']);
    excelData.push([]);
    excelData.push([]);

    // Add table headers
    excelData.push([
      'Payment Date',
      'Customer Name',
      'Payment Method',
      'Amount (AED)',
      'Paid Against',
      'Remarks',
    ]);

    // Sort payments by date (oldest first) for better readability in Excel
    const sortedPayments = [...filteredPayments].sort((a, b) => {
      const parseDate = (payment: PaymentMatching): Date | null => {
        if (payment.date) {
          const parts = payment.date.split('-');
          if (parts.length === 3) {
            const months: any = { 
              Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
              Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' 
            };
            const date = new Date(`${parts[2]}-${months[parts[1]]}-${parts[0]}`);
            return isNaN(date.getTime()) ? null : date;
          }
        }
        // Fallback to paymentDate field
        if (payment.paymentDate) {
          const date = new Date(payment.paymentDate);
          return isNaN(date.getTime()) ? null : date;
        }
        return null;
      };

      const dateA = parseDate(a);
      const dateB = parseDate(b);
      
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.getTime() - dateB.getTime(); // Ascending order
    });

    // Add payment data rows
    sortedPayments.forEach((payment) => {
      const date = payment.date || formatDateForDisplay(payment.paymentDate);
      const customerName = payment.customerName || '';
      const paymentMethod = payment.paymentMethod || '';
      
      // Extract amount as number
      let amount: number = 0;
      if (typeof payment.amount === 'number') {
        amount = payment.amount;
      } else if (typeof payment.amount === 'string') {
        const cleanedAmount = payment.amount.replace(/,/g, '').replace(/AED/gi, '').replace(/\s+/g, '').trim();
        amount = parseFloat(cleanedAmount) || 0;
      } else if (payment.amountFormatted) {
        const cleanedAmount = payment.amountFormatted.replace(/,/g, '').replace(/AED/gi, '').replace(/\s+/g, '').trim();
        amount = parseFloat(cleanedAmount) || 0;
      }

      excelData.push([
        date,
        customerName,
        paymentMethod,
        amount,
        payment.paidAgainst || '',
        payment.remarks || payment.remark || payment.description || '',
      ]);
    });

    // Calculate total amount
    const totalAmount = sortedPayments.reduce((sum, payment) => {
      let amount: number = 0;
      if (typeof payment.amount === 'number') {
        amount = payment.amount;
      } else if (typeof payment.amount === 'string') {
        const cleanedAmount = payment.amount.replace(/,/g, '').replace(/AED/gi, '').replace(/\s+/g, '').trim();
        amount = parseFloat(cleanedAmount) || 0;
      } else if (payment.amountFormatted) {
        const cleanedAmount = payment.amountFormatted.replace(/,/g, '').replace(/AED/gi, '').replace(/\s+/g, '').trim();
        amount = parseFloat(cleanedAmount) || 0;
      }
      return sum + amount;
    }, 0);

    // Add total row
    excelData.push([]);
    excelData.push(['Total', '', '', totalAmount, '', '']);

    // Create worksheet from data
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 }, // Payment Date
      { wch: 30 }, // Customer Name
      { wch: 18 }, // Payment Method
      { wch: 18 }, // Amount (AED)
      { wch: 30 }, // Paid Against
      { wch: 30 }, // Remarks
    ];

    // Find the range of data
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    
    // Format header row (row 5, 0-indexed - after company header and empty rows)
    const headerRow = 5;
    for (let col = 0; col <= 5; col++) {
      const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
      if (worksheet[headerCellRef]) {
        if (!worksheet[headerCellRef].s) {
          worksheet[headerCellRef].s = {};
        }
        worksheet[headerCellRef].s.font = xlsxSheetFontArial({ bold: true });
        worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
      }
    }

    // Apply number formatting to Amount column (column D, index 3)
    // Data rows start at index 6 (after header row at index 5)
    const dataStartRow = 6;
    // Exclude the empty row and total row from formatting
    for (let row = dataStartRow; row < range.e.r - 1; row++) {
      const amountCellRef = XLSX.utils.encode_cell({ r: row, c: 3 });
      if (worksheet[amountCellRef]) {
        if (typeof worksheet[amountCellRef].v === 'number') {
          worksheet[amountCellRef].t = 'n'; // Number type
          worksheet[amountCellRef].z = '#,##0.00'; // Number format with 2 decimals and thousand separators
        }
      }
    }

    // Format total row (last row, excluding empty row before it)
    const totalRow = range.e.r;
    for (let col = 0; col <= 5; col++) {
      const totalCellRef = XLSX.utils.encode_cell({ r: totalRow, c: col });
      if (worksheet[totalCellRef]) {
        if (!worksheet[totalCellRef].s) {
          worksheet[totalCellRef].s = {};
        }
        if (col === 0 || col === 3) { // Total label + amount column
          worksheet[totalCellRef].s.font = xlsxSheetFontArial({ bold: true });
        }
        if (col === 3 && typeof worksheet[totalCellRef].v === 'number') {
          worksheet[totalCellRef].t = 'n';
          worksheet[totalCellRef].z = '#,##0.00';
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment Matching');

    // Generate filename with current date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const fileName = `Customer_Credit_Card_Payments_${dateStr}.xlsx`;

    // Generate Excel file and download
    applyXlsxArialToWorkbook(workbook);
    XLSX.writeFile(workbook, fileName, XLSX_WRITE_WITH_STYLES);
  }, [filteredPayments]);

  const handleModalClose = useCallback((open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      // Reset form with default values when closing
      form.reset({
        paymentDate: '',
        invoiceNumber: '',
        customerName: '',
        paymentMethod: 'Credit Card',
        amount: '',
        remarks: '',
      });
      setEditingPayment(null);
      setError(null);
    }
  }, [form]);

  const getPaymentDescription = useCallback(() => {
    if (!deletingPaymentId) return '';
    const payment = payments.find(p => p.id === deletingPaymentId);
    return payment ? `${payment.customerName} - ${payment.date || payment.paymentDate}` : '';
  }, [deletingPaymentId, payments]);

  const totalAmount = filteredPayments.reduce((sum, payment) => {
    if (typeof payment.amount === 'number') {
      return sum + payment.amount;
    }
    if (typeof payment.amount === 'string') {
      const parsed = parseFloat(payment.amount.replace(/,/g, ''));
      return sum + (isNaN(parsed) ? 0 : parsed);
    }
    return sum;
  }, 0);

  const formattedTotalAmount = `AED ${totalAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <Layout>
     <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
      
          <h2 className="text-2xl font-bold text-gray-900">Sales Invoice amount paid against GCEC Purchase Bills</h2>
       </div>
       <div className="flex items-center gap-3 mr-4">
            <Button
              onClick={handleDownloadExcel}
              variant="outline"
              className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black font-semibold"
              disabled={loading || filteredPayments.length === 0}
            >
              <Download className="w-4 h-4" />
              <span>Download Excel</span>
            </Button>
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

      {successMessage && (
        <div className="mb-4 mx-8 p-3 bg-green-50 border border-green-200 rounded-md shadow-sm">
          <p className="text-sm font-medium text-green-800">{successMessage}</p>
        </div>
      )}

      {error && !isModalOpen && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
          <p className="text-base text-red-600">{error}</p>
        </div>
      )}

      <div className="mb-4 px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter by customer, invoice, paid against, payment method, or date..."
              className="pl-10"
            />
          </div>
          <Card className="border border-gray-200 shadow-sm md:min-w-[240px]">
            <CardContent className="py-3 px-4">
              <p className="text-xs text-gray-500">Total Amount</p>
              <p className="text-lg font-bold text-black">{formattedTotalAmount}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Payments Table */}
      <Card className="bg-white border border-gray-200 shadow-sm m-8">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#a8061d] border-0 hover:bg-[#6b0210]">
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Payment Date
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Customer Name
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Payment Method
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Amount (AED)
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Paid Against
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Remarks
                  </TableHead>
                  {canMutate && (
                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                      Actions
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={canMutate ? 7 : 6} className="text-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                      <p className="text-sm text-gray-500">Loading payments...</p>
                    </TableCell>
                  </TableRow>
                ) : !Array.isArray(filteredPayments) || filteredPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canMutate ? 7 : 6} className="text-center py-4">
                      <p className="text-sm text-gray-500 mb-1">No payments found.</p>
                      <p className="text-sm text-gray-400">Try adjusting your filters.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filteredPayments.map((payment) => (
                      <TableRow
                        key={payment.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <TableCell className="text-sm py-2 text-left text-gray-700">
                          {payment.date || formatDateForDisplay(payment.paymentDate)}
                        </TableCell>
                        <TableCell className="text-sm py-2 text-left text-gray-700">
                          {payment.customerName}
                        </TableCell>
                        <TableCell className="text-gray-600 text-sm py-2 text-left">
                          {payment.paymentMethod}
                        </TableCell>
                        <TableCell className="text-gray-700 font-semibold text-sm py-2 text-left">
                          {payment.amountFormatted 
                            ? `AED ${payment.amountFormatted}`
                            : typeof payment.amount === 'number' 
                              ? `AED ${payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : typeof payment.amount === 'string'
                                ? `AED ${parseFloat(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : 'AED 0.00'}
                        </TableCell>
                        <TableCell className="text-sm py-2 text-left text-gray-700">
                          {payment.paidAgainst || '-'}
                        </TableCell>
                        <TableCell className="text-sm py-2 text-left text-gray-700">
                          {payment.remarks || payment.remark || payment.description || '-'}
                        </TableCell>
                        {canMutate && (
                          <TableCell className="text-sm py-2 text-left">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleEdit(payment)}
                                className="p-2 text-black hover:bg-gray-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1"
                                title="Edit payment"
                                aria-label={`Edit ${payment.customerName}`}
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteClick(String(payment.id))}
                                className="p-2 text-black hover:bg-gray-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1"
                                title="Delete payment"
                                aria-label={`Delete ${payment.customerName}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Payment Matching Modal */}
      <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              {editingPayment ? 'Update Credit Card Payment' : 'Add Credit Card Payment'}
            </DialogTitle>
          </DialogHeader>
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-base text-red-600">{error}</p>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              {/* Payment Date Field */}
              <FormField
                control={form.control}
                name="paymentDate"
                render={({ field }) => {
                  // Convert dd/mm/yyyy string to Date object
                  const parseDate = (dateString: string): Date | null => {
                    if (!dateString) return null;
                    if (dateString.includes('/')) {
                      const parts = dateString.split('/');
                      if (parts.length === 3) {
                        const day = parseInt(parts[0], 10);
                        const month = parseInt(parts[1], 10);
                        const yPart = parseInt(parts[2], 10);
                        if (
                          !isNaN(day) &&
                          !isNaN(month) &&
                          !isNaN(yPart) &&
                          (parts[2].length === 2 || parts[2].length === 4)
                        ) {
                          const year = expandCenturyYear(yPart);
                          const d = new Date(year, month - 1, day);
                          if (
                            d.getFullYear() === year &&
                            d.getMonth() === month - 1 &&
                            d.getDate() === day
                          ) {
                            return d;
                          }
                        }
                      }
                      return null;
                    }
                    if (
                      dateString.length >= 10 &&
                      dateString.includes('-') &&
                      !dateString.includes('T')
                    ) {
                      const date = new Date(dateString);
                      return isNaN(date.getTime()) ? null : date;
                    }
                    const date = new Date(dateString);
                    return isNaN(date.getTime()) ? null : date;
                  };

                  // Convert Date object to dd/mm/yyyy string
                  const formatDate = (date: Date | null): string => {
                    if (!date || isNaN(date.getTime())) return '';
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = formatDisplayYear(date.getFullYear());
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
                      <FormLabel className="text-base font-medium text-gray-700">
                        Payment Date <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                          <div className="relative">
                            <Input
                              placeholder="dd/mm/yy"
                              value={field.value}
                              onChange={(e) => {
                                let value = e.target.value
                                  .replace(/[^0-9.]/g, '')
                                  .replace(/(\..*)\./g, '$1');
                                if (value.length >= 2) value = value.slice(0, 2) + '/' + value.slice(2);
                                if (value.length >= 5) value = value.slice(0, 5) + '/' + value.slice(5, 9);
                                field.onChange(value);
                                const segs = value.split('/');
                                const yOk =
                                  segs.length === 3 &&
                                  (segs[2].length === 2 || segs[2].length === 4);
                                if (yOk) {
                                  const date = parseDate(value);
                                  if (date) {
                                    setSelectedDate(date);
                                  }
                                }
                              }}
                              maxLength={10}
                              className="w-full pr-10"
                              disabled={isSubmitting}
                            />
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer z-10"
                              >
                                <CalendarIcon className="w-5 h-5 text-black" />
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

            
            

              {/* Customer Name Field */}
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => {
                  const current = (field.value ?? '').trim();
                  const legacyOption =
                    current && !customerOptions.includes(current) ? current : null;
                  return (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Customer Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={current || undefined}
                        onValueChange={field.onChange}
                        placeholder="Select customer name"
                        searchPlaceholder="Search Customer Name..."
                        disabled={isSubmitting}
                      >
                        {[
                          legacyOption ? (
                            <SelectItem key={`legacy-${legacyOption}`} value={legacyOption} textValue={legacyOption}>
                              {legacyOption} (not in list)
                            </SelectItem>
                          ) : null,
                          ...customerOptions.map((name) => (
                            <SelectItem key={name} value={name} textValue={name}>
                              {name}
                            </SelectItem>
                          )),
                        ]}
                      </SearchableSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
                }}
              />

              {/* Payment Method Field */}
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Payment Method <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Select payment method"
                        searchPlaceholder="Search payment method..."
                      >
                        <SelectItem value="Credit Card">Credit Card</SelectItem>
                        <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Cheque">Cheque</SelectItem>
                      </SearchableSelect>
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
                    <FormLabel className="text-base font-medium text-gray-700">
                      Amount (AED) <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              .replace(/[^0-9.]/g, '')
                              .replace(/(\..*)\./g, '$1')
                          )
                        }
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paidAgainst"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Paid Against
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter paid against"
                        {...field}
                        value={field.value || ''}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Remarks Field */}
              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Remarks
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter remarks"
                        {...field}
                        value={field.value || ''}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <div className="flex justify-end space-x-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleModalClose(false)}
                  disabled={isSubmitting}
                  className="px-6 text-black"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#a8061d] hover:bg-[#6b0210] text-black px-6"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {editingPayment ? 'Updating...' : 'Saving...'}
                    </>
                  ) : (
                    editingPayment ? 'Update Credit Card Payment' : 'Add Credit Card Payment'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!purchaseBillApproval}
        onOpenChange={(open) => {
          if (!open) setPurchaseBillApproval(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {purchaseBillApproval?.mode === 'success'
                ? 'Request submitted'
                : 'Admin approval required'}
            </DialogTitle>
          </DialogHeader>
          {purchaseBillApproval?.mode === 'success' ? (
            <p className="text-sm text-green-800 font-medium leading-relaxed">
              {purchaseBillApproval.message}
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              {purchaseBillApproval?.mode === 'edit'
                ? 'Your account cannot edit this payment directly. Submit the changes for an admin to review and apply?'
                : 'Your account cannot delete this bill directly. Submit a delete request for an admin to review?'}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {purchaseBillApproval?.mode === 'success' ? (
              <Button
                type="button"
                className="bg-[#a8061d] hover:bg-[#6b0210] text-black w-full sm:w-auto"
                onClick={() => setPurchaseBillApproval(null)}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPurchaseBillApproval(null)}
                  disabled={approvalSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-[#a8061d] hover:bg-[#6b0210] text-black"
                  onClick={() => void submitPurchaseBillApproval()}
                  disabled={approvalSubmitting}
                >
                  {approvalSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    'Submit request'
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        onConfirm={handleDeleteConfirm}
        itemName={getPaymentDescription()}
        isLoading={isDeleting}
      />
    </Layout>
  );
}
