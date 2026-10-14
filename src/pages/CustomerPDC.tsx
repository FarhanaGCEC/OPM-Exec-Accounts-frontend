import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  DialogDescription,
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
import { SelectItem } from '../components/ui/select';
import { SearchableSelect } from '../components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Plus, Calendar as CalendarIcon, Loader2, Edit, Trash2, ChevronLeft, Search, Download} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import Calendar from '../components/ui/calendar-tailwind';
import { transactionService, type PostDatedCheque as PostDatedChequeType } from '../services/transactionService';
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import { PdcAttachmentTableCell } from '../components/PdcAttachmentTableCell';
import { resolveAttachmentHref } from '../lib/resolveAttachmentUrl';
import type { ApiResponse } from '../lib/api';
import { isApprovalRequiredError } from '../lib/approvalError';
import {
  isChangeRequestQueuedResponse,
  isChangeRequestSubmittedEnvelope,
  mutationErrorMessage,
  userMessageFromChangeRequestSubmit,
} from '../lib/changeRequestUi';
import { changeRequestService } from '../services/changeRequestService';
import * as XLSX from 'xlsx';
import { canMutateRecords } from '../lib/authPayload';
import { expandCenturyYear, formatDisplayYear } from '../lib/formatDisplayDate';

interface PostDatedCheque extends PostDatedChequeType {
  date?: string; // Formatted date for display
  amountFormatted?: string; // Formatted amount for display
}

const PDC_CHANGE_REQUEST_RESOURCE = 'post_dated_cheque';

type PdcApprovalOffer =
  | { mode: 'edit'; resourceId: string; payload: Record<string, unknown>; note?: string }
  | { mode: 'delete'; resourceId: string }
  | { mode: 'success'; message: string };

const isValidChequeFormDate = (val: string): boolean => {
  const m = val.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return false;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const yPart = parseInt(m[3], 10);
  const year = m[3].length === 2 ? expandCenturyYear(yPart) : yPart;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
};

// Zod validation schema
const chequeSchema = z.object({
  chequeDate: z.string()
    .min(1, 'Cheque date is required')
    .refine(isValidChequeFormDate, 'Enter a valid date (dd/mm/yy)'),
  chequeNumber: z.string()
    .min(1, 'Cheque number is required')
    .min(3, 'Cheque number must be at least 3 digits')
    .regex(/^\d+$/, 'Cheque number must contain digits only'),
  customerName: z.string()
    .min(1, 'Customer name is required')
    .min(3, 'Customer name must be at least 3 characters'),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
  pdcType: z.enum(['GCEC PDC', 'Customer PDC', 'Custom PDC'], {
    required_error: 'Please select a PDC type',
  }),
  chequeType: z.enum(['Payment Cheque', 'Security Cheque'], {
    required_error: 'Please select a cheque type',
  }),
  // Optional fields for Custom PDC
  customDetails: z.string().optional(),
}).refine((data) => {
  // If Custom PDC, customDetails is required
  if (data.pdcType === 'Custom PDC') {
    return data.customDetails && data.customDetails.trim().length > 0;
  }
  return true;
}, {
  message: 'Custom details are required for Custom PDC',
  path: ['customDetails'],
});

type ChequeFormData = z.infer<typeof chequeSchema>;

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

export default function CustomerPDC() {
  const canMutate = canMutateRecords();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingCheque, setEditingCheque] = useState<PostDatedCheque | null>(null);
  const [deletingChequeId, setDeletingChequeId] = useState<string | null>(null);
  const [cheques, setCheques] = useState<PostDatedCheque[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pdcApproval, setPdcApproval] = useState<PdcApprovalOffer | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [pdcAttachmentFile, setPdcAttachmentFile] = useState<File | null>(null);
  const [removePdcAttachmentOnSave, setRemovePdcAttachmentOnSave] = useState(false);
  const [debtorsList, setDebtorsList] = useState<ReceivablesCategory[]>([]);
  const [creditorsList, setCreditorsList] = useState<PayablesCategory[]>([]);

  const form = useForm<ChequeFormData>({
    resolver: zodResolver(chequeSchema),
    defaultValues: {
      chequeDate: '',
      chequeNumber: '',
      customerName: '',
      amount: '',
      pdcType: 'Customer PDC',
      chequeType: 'Payment Cheque',
      customDetails: '',
    },
  });

  // Fetch cheques from API
  const fetchCheques = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[PostDatedCheque] Fetching cheques...');
      const response: ApiResponse<PostDatedChequeType[]> = await transactionService.getPostDatedCheques();
      console.log('[PostDatedCheque] API Response:', response);
      
      if (response.success && response.data && Array.isArray(response.data)) {
        const chequesData: PostDatedCheque[] = response.data.map(cheque => {
          // Format date as DD-MMM-YYYY (e.g., "01-Jan-2026")
          const formattedDate = formatDateForDisplay(cheque.chequeDate);
          
          // Format amount
          let formattedAmount: string;
          if (typeof cheque.amount === 'number') {
            formattedAmount = cheque.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          } else if (typeof cheque.amount === 'string') {
            const numAmount = parseFloat(cheque.amount);
            formattedAmount = isNaN(numAmount) ? cheque.amount : numAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          } else {
            formattedAmount = String(cheque.amount || '0.00');
          }
          
          return {
            ...cheque,
            id: String(cheque.id),
            date: formattedDate,
            amountFormatted: formattedAmount,
          };
        });
        console.log('[PostDatedCheque] Processed cheques:', chequesData);
        setCheques(chequesData);
      } else {
        const errorMsg = response?.message || 'Failed to fetch cheques';
        console.error('[PostDatedCheque] API error:', errorMsg);
        setError(errorMsg);
        setCheques([]);
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.error || 'Failed to fetch cheques';
      console.error('[PostDatedCheque] Error fetching cheques:', err);
      setError(errorMessage);
      setCheques([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCheques();
  }, [fetchCheques]);

  useEffect(() => {
    if (!isModalOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const [debtorsRes, creditorsRes] = await Promise.all([
          receivablesService.getReceivables(),
          payablesService.getPayables(),
        ]);
        if (!cancelled && debtorsRes.success && Array.isArray(debtorsRes.data)) {
          setDebtorsList(debtorsRes.data);
        }
        if (!cancelled && creditorsRes.success && Array.isArray(creditorsRes.data)) {
          setCreditorsList(creditorsRes.data);
        }
      } catch (e) {
        console.error('[CustomerPDC] Failed to load debtors/creditors list', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isModalOpen]);

  const submitPdcApproval = useCallback(async () => {
    if (!pdcApproval || pdcApproval.mode === 'success') return;
    const offer = pdcApproval;
    setApprovalSubmitting(true);
    setError(null);
    try {
      const res = await changeRequestService.submit({
        action: offer.mode === 'edit' ? 'edit' : 'delete',
        resourceType: PDC_CHANGE_REQUEST_RESOURCE,
        resourceId: offer.resourceId,
        ...(offer.mode === 'edit' ? { payload: offer.payload } : {}),
        ...(offer.mode === 'edit' && offer.note?.trim() ? { note: offer.note.trim() } : {}),
      });
      const apiMessage = userMessageFromChangeRequestSubmit(res);
      setSuccessMessage(apiMessage);
      setPdcApproval({ mode: 'success', message: apiMessage });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit change request');
    } finally {
      setApprovalSubmitting(false);
    }
  }, [pdcApproval]);

  const onSubmit = useCallback(async (data: ChequeFormData) => {
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccessMessage(null);

      // Prepare payload - all required fields must be included
      // Keep date in dd/mm/yyyy format as API expects
      const payload: any = {
        chequeDate: data.chequeDate, // Keep as dd/mm/yyyy format
        chequeNumber: data.chequeNumber,
        amount: parseFloat(data.amount.replace(/,/g, '')),
        pdcType:'Customer PDC',
        chequeType: data.chequeType,
        customerName: data.customerName ? data.customerName.trim() : '', // Always include, empty string if not provided
      };

    
   

      const wantsRemoveAttachment =
        !!editingCheque &&
        removePdcAttachmentOnSave &&
        !pdcAttachmentFile &&
        !!editingCheque.attachmentUrl;

      let response: ApiResponse<PostDatedChequeType>;
      
      if (editingCheque) {
        console.log('[PostDatedCheque] Updating cheque:', editingCheque.id, payload);
        response = await transactionService.updatePostDatedCheque(
          String(editingCheque.id),
          payload,
          pdcAttachmentFile,
          editingCheque,
          wantsRemoveAttachment ? { removeAttachment: true } : undefined
        );
      } else {
        console.log('[PostDatedCheque] Creating cheque:', payload);
        response = await transactionService.createPostDatedCheque(payload, pdcAttachmentFile);
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
        setPdcApproval({ mode: 'success', message: apiMessage });
        form.reset({
          chequeDate: '',
          chequeNumber: '',
          customerName: '',
          amount: '',
          pdcType: 'Customer PDC',
          chequeType: 'Payment Cheque',
          customDetails: '',
        });
        setEditingCheque(null);
        setPdcAttachmentFile(null);
        setRemovePdcAttachmentOnSave(false);
        setError(null);
        setIsModalOpen(false);
        fetchCheques().catch(err => console.error('Error refetching after save:', err));
        return;
      }

      if (response.success && response.data) {
        const updatedCheque: PostDatedCheque = {
          ...response.data,
          id: String(response.data.id),
          date: formatDateForDisplay(response.data.chequeDate),
          amountFormatted: typeof response.data.amount === 'number'
            ? response.data.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : typeof response.data.amount === 'string'
            ? parseFloat(response.data.amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : String(response.data.amount),
        };

        if (editingCheque) {
          setCheques(prevCheques =>
            prevCheques.map(cheque =>
              cheque.id === editingCheque.id ? updatedCheque : cheque
            )
          );
        } else {
          setCheques(prevCheques => [updatedCheque, ...prevCheques]);
        }

        // Reset form with default values before closing
        form.reset({
          chequeDate: '',
          chequeNumber: '',
          customerName: '',
          amount: '',
          pdcType: 'Customer PDC',
          chequeType: 'Payment Cheque',
          
        });
        setEditingCheque(null);
        setPdcAttachmentFile(null);
        setRemovePdcAttachmentOnSave(false);
        setError(null);
        setIsModalOpen(false);
        
        // Refetch to ensure consistency
        fetchCheques().catch(err => console.error('Error refetching after save:', err));
      } else {
        const errorMsg = response.message || 'Failed to save cheque';
        setError(errorMsg);
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err) && editingCheque) {
        let payload: Record<string, unknown> = {
          chequeDate: data.chequeDate,
          chequeNumber: data.chequeNumber,
          customerName: (data.customerName ?? '').trim(),
          amount: parseFloat(data.amount.replace(/,/g, '')),
          pdcType: 'Customer PDC',
          chequeType: data.chequeType,
        };
        if (data.pdcType === 'Custom PDC' && data.customDetails?.trim()) {
          payload.description = data.customDetails.trim();
        }
        if (removePdcAttachmentOnSave && !pdcAttachmentFile) {
          payload = await transactionService.appendChequeAttachmentToChangePayload(
            payload,
            null,
            { removeAttachment: true }
          );
        } else if (pdcAttachmentFile && pdcAttachmentFile.size > 0) {
          payload = await transactionService.appendChequeAttachmentToChangePayload(
            payload,
            pdcAttachmentFile
          );
        }
        const note =
          pdcAttachmentFile && pdcAttachmentFile.size > 0
            ? `PDC update requested; replace attachment (${pdcAttachmentFile.name}). Admin may need to attach the file after approval.`
            : removePdcAttachmentOnSave
              ? 'PDC update requested; remove existing attachment.'
              : undefined;
        setPdcApproval({
          mode: 'edit',
          resourceId: String(editingCheque.id),
          payload,
          ...(note ? { note } : {}),
        });
        form.reset({
          chequeDate: '',
          chequeNumber: '',
          customerName: '',
          amount: '',
          pdcType: 'Customer PDC',
          chequeType: 'Payment Cheque',
          customDetails: '',
        });
        setEditingCheque(null);
        setPdcAttachmentFile(null);
        setRemovePdcAttachmentOnSave(false);
        setIsModalOpen(false);
        setError(null);
      } else {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to save cheque';
        console.error('[PostDatedCheque] Error saving cheque:', err);
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [editingCheque, form, fetchCheques, pdcAttachmentFile, removePdcAttachmentOnSave]);

  const handleEdit = useCallback((cheque: PostDatedCheque) => {
    setEditingCheque(cheque);
    setPdcAttachmentFile(null);
    setRemovePdcAttachmentOnSave(false);
    const formDate = convertDateForForm(cheque.chequeDate);
    form.reset({
      chequeDate: formDate,
      chequeNumber: cheque.chequeNumber,
      customerName: cheque.customerName || '',
      amount: typeof cheque.amount === 'number' 
        ? cheque.amount.toString() 
        : typeof cheque.amount === 'string'
        ? cheque.amount.replace(/,/g, '')
        : '',
      pdcType: cheque.pdcType as 'GCEC PDC' | 'Customer PDC' | 'Custom PDC',
      chequeType: (cheque.chequeType || 'Payment Cheque') as 'Payment Cheque' | 'Security Cheque',
      customDetails: cheque.description || '',
    });
    setError(null);
    setIsModalOpen(true);
  }, [form]);

  const handleAddNew = useCallback(() => {
    setEditingCheque(null);
    setPdcAttachmentFile(null);
    setRemovePdcAttachmentOnSave(false);
    form.reset({
      chequeDate: '',
      chequeNumber: '',
      customerName: '',
      amount: '',
      pdcType: 'Customer PDC',
      chequeType: 'Payment Cheque',
      customDetails: '',
    });
    setError(null);
    setIsModalOpen(true);
  }, [form]);

  const handleDeleteClick = useCallback((id: string) => {
    setDeletingChequeId(id);
    setError(null);
    setIsDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingChequeId) return;

    try {
      setIsDeleting(true);
      setError(null);
      setSuccessMessage(null);
      const response: ApiResponse<void> = await transactionService.deletePostDatedCheque(deletingChequeId);
      
      if (response.success) {
        if (
          isChangeRequestQueuedResponse(response as ApiResponse<unknown>) ||
          isChangeRequestSubmittedEnvelope(response.data)
        ) {
          const apiMessage = userMessageFromChangeRequestSubmit(
            response as ApiResponse<unknown>
          );
          setSuccessMessage(apiMessage);
          setPdcApproval({ mode: 'success', message: apiMessage });
          setDeletingChequeId(null);
          setIsDeleteModalOpen(false);
          return;
        }
        setCheques(prevCheques =>
          prevCheques.filter(cheque => cheque.id !== deletingChequeId)
        );
        setDeletingChequeId(null);
        setIsDeleteModalOpen(false);
      } else {
        setError(response.message || 'Failed to delete cheque');
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err) && deletingChequeId) {
        setPdcApproval({ mode: 'delete', resourceId: deletingChequeId });
        setDeletingChequeId(null);
        setIsDeleteModalOpen(false);
        setError(null);
      } else {
        const errorMessage =
          mutationErrorMessage(err) || 'Failed to delete cheque';
        setError(errorMessage);
        console.error('Error deleting cheque:', err);
      }
    } finally {
      setIsDeleting(false);
    }
  }, [deletingChequeId]);

  const handleModalClose = useCallback((open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      // Reset form with default values when closing
      form.reset({
        chequeDate: '',
        chequeNumber: '',
        customerName: '',
        amount: '',
        pdcType: 'Customer PDC',
        chequeType: 'Payment Cheque',
        customDetails: '',
      });
      setEditingCheque(null);
      setPdcAttachmentFile(null);
      setRemovePdcAttachmentOnSave(false);
      setError(null);
    }
  }, [form]);

  const getChequeDescription = useCallback(() => {
    if (!deletingChequeId) return '';
    const cheque = cheques.find(c => c.id === deletingChequeId);
    return cheque ? `${cheque.chequeNumber} - ${cheque.date || cheque.chequeDate}` : '';
  }, [deletingChequeId, cheques]);

  // Filter cheques - only show Customer PDC and filter by customer name if search term exists
  const filteredCheques = cheques.filter(cheque => {
    const isCustomerPDC = cheque.pdcType === 'Customer PDC';
    if (!isCustomerPDC) return false;
    
    // If search term exists, filter by customer name
    if (searchTerm.trim()) {
      const customerName = (cheque.customerName || '').toLowerCase();
      const search = searchTerm.toLowerCase().trim();
      return customerName.includes(search);
    }
    
    return true;
  });
  const totalAmount = filteredCheques.reduce((sum, cheque) => {
    const amount =
      typeof cheque.amount === 'number'
        ? cheque.amount
        : typeof cheque.amount === 'string'
          ? parseFloat(cheque.amount.replace(/,/g, '')) || 0
          : 0;
    return sum + amount;
  }, 0);

  const handleDownloadExcel = useCallback(() => {
    if (filteredCheques.length === 0) {
      setError('No data to export');
      return;
    }

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData: any[] = [];

    // Add header
    excelData.push(['Customer PDC in hand']);
    excelData.push([]);

    // Add table headers
    excelData.push(['Date', 'Customer Name', 'Cheque No', 'Amount', 'Type']);

    // Add cheque rows
    filteredCheques.forEach((cheque) => {
      const amountValue = typeof cheque.amount === 'number' 
        ? cheque.amount 
        : typeof cheque.amount === 'string'
          ? parseFloat(cheque.amount.replace(/,/g, '')) || 0
          : 0;
      
      excelData.push([
        cheque.date || formatDateForDisplay(cheque.chequeDate),
        cheque.customerName || '-',
        cheque.chequeNumber || '',
        amountValue,
        cheque.chequeType || '-'
      ]);
    });

    excelData.push([]);
    excelData.push(['Total Amount (AED):', '', '', totalAmount, '']);

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 }, // Date
      { wch: 25 }, // Customer Name
      { wch: 15 }, // Cheque No
      { wch: 18 }, // Amount
      { wch: 20 }, // Type
    ];

    // Format header row (row 2, 0-indexed)
    const headerRow = 2;
    for (let col = 0; col <= 4; col++) {
      const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
      if (worksheet[headerCellRef]) {
        if (!worksheet[headerCellRef].s) {
          worksheet[headerCellRef].s = {};
        }
        worksheet[headerCellRef].s.font = { bold: true };
        worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
      }
    }

    // Format amount column (column D, index 3)
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let row = 3; row <= range.e.r; row++) {
      const amountCellRef = XLSX.utils.encode_cell({ r: row, c: 3 });
      if (worksheet[amountCellRef] && typeof worksheet[amountCellRef].v === 'number') {
        worksheet[amountCellRef].t = 'n';
        worksheet[amountCellRef].z = '#,##0.00';
        if (row === range.e.r) {
          if (!worksheet[amountCellRef].s) {
            worksheet[amountCellRef].s = {};
          }
          worksheet[amountCellRef].s.font = { bold: true };
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customer PDC in hand');

    // Generate Excel file and download
    const fileName = `Customer-PDC-in-hand-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }, [filteredCheques, totalAmount]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-12">
          <button
            onClick={() => navigate('/cheque')}
            className="flex items-center text-gray-700 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Customer PDC in hand</h2>
        </div>
        <div className="flex items-center gap-2 mr-4">
          <Button
            variant="outline"
            onClick={handleDownloadExcel}
            disabled={loading || filteredCheques.length === 0}
            className="bg-white hover:bg-[#a8061d] text-black border-0 flex items-center gap-2 font-semibold"
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
              <Plus className="w-4 h-4" />
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

      {/* Search Bar */}
      <div className="mb-4 px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              type="text"
              placeholder="Search by customer name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 pr-4 py-6 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#a8061d] focus:border-transparent"
            />
          </div>

          <Card className="border border-gray-200 shadow-sm md:min-w-[240px]">
            <CardContent className="py-3 px-4">
              <p className="text-xs text-gray-500">Total Amount</p>
              <p className="text-lg font-bold text-black">
                AED{' '}
                {totalAmount.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cheques Table */}
      <Card className="bg-white border border-gray-200 shadow-sm mx-8">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="[&_th]:!py-1 [&_td]:!py-1">
              <TableHeader>
                <TableRow className="bg-[#a8061d] border-0 hover:bg-[#6b0210]">
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Date
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                 Customer Name
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Cheque No
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Amount
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Type 
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Image
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
                      <p className="text-sm text-gray-500">Loading cheques...</p>
                    </TableCell>
                  </TableRow>
                ) : !Array.isArray(cheques) || cheques.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canMutate ? 7 : 6} className="text-center py-4">
                      <p className="text-sm text-gray-500 mb-1">No cheques found.</p>
                      <p className="text-sm text-gray-400">Click "Add New" to create your first cheque.</p>
                    </TableCell>
                  </TableRow>
                ) : filteredCheques.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canMutate ? 7 : 6} className="text-center py-4">
                      <p className="text-sm text-gray-500 mb-1">No cheques found.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCheques.map((cheque) => {
                    const isSecurityCheque = cheque.chequeType === 'Security Cheque';
                    return (
                      <TableRow
                        key={cheque.id}
                        className={`border-b ${isSecurityCheque
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'border-gray-100 hover:bg-gray-50'
                          }`}
                      >
                        <TableCell className={`text-sm py-2 text-left ${isSecurityCheque ? 'text-white' : 'text-gray-700'}`}>
                          {cheque.date || formatDateForDisplay(cheque.chequeDate)}
                        </TableCell>
                        <TableCell className={`text-sm py-2 text-left ${isSecurityCheque ? 'text-white' : 'text-gray-700'}`}>
                          {cheque.customerName || '-'}
                        </TableCell>
                        <TableCell className={`font-medium text-sm py-2 text-left ${isSecurityCheque ? 'text-white' : 'text-gray-700'}`}>
                          {cheque.chequeNumber}
                        </TableCell>
                        <TableCell className={`font-semibold text-sm py-2 text-left ${isSecurityCheque ? 'text-white' : 'text-gray-700'}`}>
                          {cheque.amountFormatted 
                            ? `AED ${cheque.amountFormatted}`
                            : typeof cheque.amount === 'number' 
                              ? `AED ${cheque.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : typeof cheque.amount === 'string'
                                ? `AED ${parseFloat(cheque.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : 'AED 0.00'}
                        </TableCell>
                        <TableCell className={`text-sm py-2 text-left ${isSecurityCheque ? 'text-white' : 'text-gray-600'}`}>
                          {isSecurityCheque ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white">
                              Security Cheque
                            </span>
                          ) : (
                       ''
                          )}
                        </TableCell>
                        <TableCell className="text-sm py-2 text-left align-middle">
                          <PdcAttachmentTableCell
                            attachmentUrl={cheque.attachmentUrl}
                            attachmentName={cheque.attachmentName}
                            variant={isSecurityCheque ? 'onDark' : 'default'}
                            onEditClick={canMutate ? () => handleEdit(cheque) : undefined}
                          />
                        </TableCell>
                        {canMutate && (
                          <TableCell className="text-sm py-2 text-left">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleEdit(cheque)}
                                className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                  isSecurityCheque
                                    ? 'text-white hover:bg-red-500 focus:ring-white'
                                    : 'text-black hover:bg-gray-100 focus:ring-gray-500'
                                }`}
                                title="Edit cheque"
                                aria-label={`Edit ${cheque.chequeNumber}`}
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteClick(String(cheque.id))}
                                className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                  isSecurityCheque
                                    ? 'text-white hover:bg-red-500 focus:ring-white'
                                    : 'text-black hover:bg-gray-100 focus:ring-gray-500'
                                }`}
                                title="Delete cheque"
                                aria-label={`Delete ${cheque.chequeNumber}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {/* Add/Edit Post-Dated Cheque Modal */}
      <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              {editingCheque ? 'Edit Post-Dated Cheque' : 'Add Post-Dated Cheque'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Enter cheque details and save to create or update a customer post-dated cheque.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-base text-red-600">{error}</p>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
         
            <FormField
                control={form.control}
                name="chequeDate"
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
                        Cheque Date <span className="text-red-500">*</span>
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

              {/* Cheque Type Field */}
              <FormField
                control={form.control}
                name="chequeType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Cheque Type <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Select cheque type"
                        searchPlaceholder="Search cheque type..."
                      >
                        <SelectItem value="Payment Cheque">Payment Cheque</SelectItem>
                        <SelectItem value="Security Cheque">Security Cheque</SelectItem>
                      </SearchableSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

             
           

              {/* Cheque Number Field */}
              <FormField
                control={form.control}
                name="chequeNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Cheque Number <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="2401"
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

              {/* Customer Name — Debtors List (receivables) */}
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => {
                  const debtorNames = debtorsList
                    .map((d) => String(d.name ?? '').trim())
                    .filter(Boolean);
                  const creditorNames = creditorsList
                    .map((c) => String(c.name ?? '').trim())
                    .filter(Boolean);
                  const customerNames = [
                    ...new Set(
                      [...debtorNames, ...creditorNames]
                    ),
                  ].sort((a, b) => a.localeCompare(b));
                  const current = (field.value ?? '').trim();
                  const legacyOption =
                    current && !customerNames.includes(current) ? current : null;
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
                          {legacyOption ? (
                            <SelectItem value={legacyOption} textValue={legacyOption}>
                              {legacyOption} (not in list)
                            </SelectItem>
                          ) : null}
                          {customerNames.map((name) => (
                            <SelectItem key={name} value={name} textValue={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SearchableSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
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
                        pattern="[0-9]*[.]?[0-9]*"
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

              <div className="space-y-2">
                <span className="text-base font-medium text-gray-700">
                  Cheque attachment <span className="text-gray-400 font-normal">(optional, image/PDF)</span>
                </span>
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  disabled={isSubmitting}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setPdcAttachmentFile(file);
                    if (file) setRemovePdcAttachmentOnSave(false);
                  }}
                  className="cursor-pointer"
                />
                {pdcAttachmentFile && (
                  <p className="text-sm text-gray-600">Selected: {pdcAttachmentFile.name}</p>
                )}
                {editingCheque?.attachmentUrl &&
                  !pdcAttachmentFile &&
                  !removePdcAttachmentOnSave && (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                    <span>
                      Current:{' '}
                      <a
                        href={resolveAttachmentHref(editingCheque.attachmentUrl) ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#c4122a] underline"
                      >
                        {editingCheque.attachmentName || 'View attachment'}
                      </a>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-red-700 border-red-200 hover:bg-red-50"
                      disabled={isSubmitting}
                      onClick={() => {
                        setRemovePdcAttachmentOnSave(true);
                        setPdcAttachmentFile(null);
                      }}
                    >
                      Remove image
                    </Button>
                  </div>
                )}
                {removePdcAttachmentOnSave && !pdcAttachmentFile && (
                  <p className="text-sm text-amber-800">
                    Image will be removed when you save. Upload a new file or save to confirm.
                  </p>
                )}
              </div>

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
                      {editingCheque ? 'Updating...' : 'Saving...'}
                    </>
                  ) : (
                    editingCheque ? 'Update Cheque' : 'Save Cheque'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pdcApproval}
        onOpenChange={(open) => {
          if (!open) setPdcApproval(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pdcApproval?.mode === 'success'
                ? 'Request submitted'
                : 'Admin approval required'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Submit this change for an administrator to review.
            </DialogDescription>
          </DialogHeader>
          {pdcApproval?.mode === 'success' ? (
            <p className="text-sm text-green-800 font-medium leading-relaxed">
              {pdcApproval.message}
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              {pdcApproval?.mode === 'edit'
                ? 'Your account cannot edit this PDC directly. Submit the changes for an admin to review and apply?'
                : 'Your account cannot delete this PDC directly. Submit a delete request for an admin to review?'}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {pdcApproval?.mode === 'success' ? (
              <Button
                type="button"
                className="bg-[#a8061d] hover:bg-[#6b0210] text-black w-full sm:w-auto"
                onClick={() => setPdcApproval(null)}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPdcApproval(null)}
                  disabled={approvalSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-[#a8061d] hover:bg-[#6b0210] text-black"
                  onClick={() => void submitPdcApproval()}
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
        itemName={getChequeDescription()}
        isLoading={isDeleting}
      />
    </Layout>
  );
}
