import { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../components/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '../components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { SearchableSelect } from '../components/ui/searchable-select';
import {
    SelectItem,
} from '../components/ui/select';
import Calendar from '../components/ui/calendar-tailwind';
import { Loader2, Plus, Calendar as CalendarIcon, Download, Trash2 } from 'lucide-react';
import { 
    creditCardService, 
    mapApiResponseToCreditCardDetail,
    displayCreditCardHolderName,
    type CreditCardDetail,
} from '../services/creditCardService';
import * as XLSX from 'xlsx';
import {
  applyXlsxArialToWorkbook,
  xlsxSheetFontArial,
  XLSX_WRITE_WITH_STYLES,
} from '../lib/excelExportFont';
import { canCreateCreditCardPayment, canMutateRecords } from '../lib/authPayload';
import { expandCenturyYear, formatDisplayYear } from '../lib/formatDisplayDate';
import type { ApiResponse } from '../lib/api';
import {
    isChangeRequestQueuedResponse,
    isImmediateMutationSuccess,
    mutationErrorMessage,
    userMessageFromChangeRequestSubmit,
} from '../lib/changeRequestUi';

export interface CreditCardPayment {
    id: string;
    createdAt?: string;
    paymentDate: string;
    cardHolder: string;
    cardNo: string;
    issuingBank?: string;
    amount: number;
    paidAgainst?: string;
    remarks: string;
}

// Zod validation schema
const paymentSchema = z.object({
    paymentDate: z.string()
        .min(1, 'Payment date is required'),
    cardNo: z.string().optional(),
    cardHolder: z.string().optional(),
    creditCardId: z.string().optional(),
    amount: z.string()
        .min(1, 'Amount is required')
        .refine((val) => {
            const num = parseFloat(val.replace(/,/g, ''));
            return !isNaN(num) && num > 0;
        }, 'Amount must be greater than 0'),
    remarks: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

export default function CreditCardPaymentsPage() {
    const canMutate = canMutateRecords();
    const canCreatePayment = canCreateCreditCardPayment();
    const [creditCards, setCreditCards] = useState<CreditCardPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    /** Payment ids with pending admin approval (delete/edit) — row stays in list. */
    const [pendingApprovalIds, setPendingApprovalIds] = useState<Set<string>>(() => new Set());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [paymentToDelete, setPaymentToDelete] = useState<CreditCardPayment | null>(null);
    const [availableCreditCards, setAvailableCreditCards] = useState<CreditCardDetail[]>([]);
    const [loadingCreditCards, setLoadingCreditCards] = useState(false);
    const [editingPayment, setEditingPayment] = useState<CreditCardPayment | null>(null);
    
    // Period selection state
    const currentDate = new Date();
    const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');
    const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
    const [appliedMonth, setAppliedMonth] = useState<number | 'all'>('all');
    const [appliedYear, setAppliedYear] = useState<number>(currentDate.getFullYear());
    const monthOptions = useMemo(
        () => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        []
    );
    const yearOptions = useMemo(() => {
        const currentYear = currentDate.getFullYear();
        return Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
    }, [currentDate]);

    useEffect(() => {
        if (!successMessage) return;
        const timer = window.setTimeout(() => setSuccessMessage(null), 8000);
        return () => window.clearTimeout(timer);
    }, [successMessage]);

    const form = useForm<PaymentFormData>({
        resolver: zodResolver(paymentSchema),
        defaultValues: {
            paymentDate: '',
            cardNo: '',
            cardHolder: '',
            creditCardId: '',
            amount: '',
            remarks: '',
        },
    });

 
    const fetchCreditCards = useCallback(async (year: number, months?: number[]) => {
        try {
            setLoading(true);
            setError(null);
            const response = await creditCardService.getCreditCardPayments(
                months && months.length > 0 ? { year, months } : { year }
            );
            
            if (response.success && response.data) {
                setCreditCards(response.data);
            } else {
                setError('Failed to fetch credit card payments');
                setCreditCards([]);
            }
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to fetch credit card payments';
            console.error('Error fetching credit card payments:', err);
            setError(errorMessage);
            setCreditCards([]);
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch available credit cards for dropdown
    const fetchAvailableCreditCards = useCallback(async () => {
        try {
            setLoadingCreditCards(true);
            const response = await creditCardService.getCreditCards();
            if (response.success && response.data) {
                // Map API response (snake_case) to component interface (camelCase)
                const mappedCards = response.data.map(mapApiResponseToCreditCardDetail);
                setAvailableCreditCards(mappedCards);
            }
        } catch (err) {
            console.error('Error fetching credit cards:', err);
        } finally {
            setLoadingCreditCards(false);
        }
    }, []);

 

    useEffect(() => {
        if (appliedMonth === 'all') {
            void fetchCreditCards(appliedYear);
        } else {
            void fetchCreditCards(appliedYear, [appliedMonth]);
        }
    }, [appliedMonth, appliedYear, fetchCreditCards]);

    useEffect(() => {
        fetchAvailableCreditCards();
    }, [fetchAvailableCreditCards]);

    const handleAddNew = () => {
        setEditingPayment(null);
        form.reset({
            paymentDate: '',
            cardNo: '',
            cardHolder: '',
            creditCardId: '',
            amount: '',
            remarks: '',
        });
        setIsModalOpen(true);
    };

    const handleEditClick = (payment: CreditCardPayment) => {
        setEditingPayment(payment);
        setError(null);
        
        // Parse payment date - convert from API format to dd/mm/yyyy
        let formattedDate = payment.paymentDate;
        
        // Handle ISO 8601 format: "2026-01-08T20:00:00.000Z" or "2026-01-08T20:00:00Z"
        if (payment.paymentDate.includes('T')) {
            const datePart = payment.paymentDate.split('T')[0];
            const parts = datePart.split('-');
            if (parts.length === 3 && parts[0].length === 4) {
                formattedDate = `${parts[2]}/${parts[1]}/${formatDisplayYear(parseInt(parts[0], 10))}`;
            }
        } else if (payment.paymentDate.includes('-') && payment.paymentDate.length === 10) {
            // Format: yyyy-mm-dd -> dd/mm/yyyy
            const parts = payment.paymentDate.split('-');
            if (parts.length === 3 && parts[0].length === 4) {
                formattedDate = `${parts[2]}/${parts[1]}/${formatDisplayYear(parseInt(parts[0], 10))}`;
            }
        } else if (payment.paymentDate.includes('/')) {
            // Already in dd/mm/yyyy format, keep as is
            formattedDate = payment.paymentDate;
        } else {
            // Try to parse as Date object and format
            try {
                const date = new Date(payment.paymentDate);
                if (!isNaN(date.getTime())) {
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = formatDisplayYear(date.getFullYear());
                    formattedDate = `${day}/${month}/${year}`;
                }
            } catch (e) {
                // If parsing fails, use original value
                formattedDate = payment.paymentDate;
            }
        }
        
        // Find matching credit card ID if available
        let creditCardId = '';
        if (payment.cardNo) {
            const matchingCard = availableCreditCards.find(
                card => card.cardNo === payment.cardNo || card.cardNo.replace(/\s+/g, '') === payment.cardNo.replace(/\s+/g, '')
            );
            if (matchingCard) {
                creditCardId = matchingCard.id;
            }
        }
        
        form.reset({
            paymentDate: formattedDate,
            cardNo: payment.cardNo || '',
            cardHolder: displayCreditCardHolderName(payment.cardHolder || ''),
            creditCardId: creditCardId,
            amount: formatAmountInputValue(payment.amount),
            remarks: payment.remarks || '',
        });
        setIsModalOpen(true);
    };

    const handleModalClose = (open: boolean) => {
        setIsModalOpen(open);
        if (!open) {
            setEditingPayment(null);
            form.reset();
            setError(null);
        }
    };

    const onSubmit = async (data: PaymentFormData) => {
        try {
            setIsSubmitting(true);
            setError(null);
            setSuccessMessage(null);

            if (editingPayment && !canMutate) {
                setError('You do not have permission to edit payments.');
                return;
            }

            // Format payment date - API accepts "2026-01-15", "15/01/2026", or "15-Jan-2026"
            let formattedDate = data.paymentDate;
            
            // If date is in dd/mm/yy or dd/mm/yyyy, convert to yyyy-mm-dd (API / GET filters use full year)
            if (data.paymentDate.includes('/')) {
                const parts = data.paymentDate.split('/');
                if (parts.length === 3) {
                    const y = expandCenturyYear(parseInt(parts[2], 10));
                    formattedDate = `${y}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
            }

            const payload: any = {
                paymentDate: formattedDate,
                amount: parseFloat(data.amount.replace(/,/g, '')),
            };

            if (data.cardNo) {
                payload.cardNo = data.cardNo;
            }

            if (data.cardHolder) {
                payload.cardHolder = data.cardHolder;
            }

            if (data.creditCardId) {
                payload.creditCardId = data.creditCardId;
            }

            if (data.remarks) {
                payload.remarks = data.remarks;
            }

            let response;
            if (editingPayment) {
                // Update existing payment
                response = await creditCardService.updateCreditCardPayment(editingPayment.id, payload);
            } else {
                // Create new payment
                response = await creditCardService.createCreditCardPayment(payload);
            }

            if (response.success) {
                if (isChangeRequestQueuedResponse(response as ApiResponse<unknown>)) {
                    const apiMessage = userMessageFromChangeRequestSubmit(
                        response as ApiResponse<unknown>
                    );
                    setSuccessMessage(apiMessage);
                    if (editingPayment?.id) {
                        setPendingApprovalIds((prev) => new Set(prev).add(String(editingPayment.id)));
                    }
                } else if (isImmediateMutationSuccess(response as ApiResponse<unknown>)) {
                    setSuccessMessage(
                        response.message ||
                            (editingPayment ? 'Payment updated.' : 'Payment created.')
                    );
                }
                setIsModalOpen(false);
                setEditingPayment(null);
                form.reset();
                await fetchCreditCards(
                    appliedYear,
                    appliedMonth === 'all' ? undefined : [appliedMonth]
                );
            } else {
                setError(response.error || (editingPayment ? 'Failed to update payment' : 'Failed to create payment'));
            }
        } catch (err: unknown) {
            const errorMessage =
                mutationErrorMessage(err) ||
                (editingPayment ? 'Failed to update credit card payment' : 'Failed to create credit card payment');
            console.error(`Error ${editingPayment ? 'updating' : 'creating'} payment:`, err);
            setError(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeletePayment = async (payment: CreditCardPayment) => {
        try {
            setDeletingPaymentId(payment.id);
            setError(null);
            setSuccessMessage(null);
            const response = await creditCardService.deleteCreditCardPayment(payment.id);
            if (!response.success) {
                setError(response.error || 'Failed to delete payment');
                return;
            }
            if (isChangeRequestQueuedResponse(response as ApiResponse<unknown>)) {
                const apiMessage = userMessageFromChangeRequestSubmit(
                    response as ApiResponse<unknown>
                );
                setSuccessMessage(apiMessage);
                setPendingApprovalIds((prev) => new Set(prev).add(String(payment.id)));
                return;
            }
            setPendingApprovalIds((prev) => {
                const next = new Set(prev);
                next.delete(String(payment.id));
                return next;
            });
            setSuccessMessage(response.message || 'Payment deleted.');
            await fetchCreditCards(
                appliedYear,
                appliedMonth === 'all' ? undefined : [appliedMonth]
            );
        } catch (err: unknown) {
            const errorMessage = mutationErrorMessage(err) || 'Failed to delete credit card payment';
            console.error('Error deleting payment:', err);
            setError(errorMessage);
        } finally {
            setDeletingPaymentId(null);
        }
    };

    const openDeleteDialog = (payment: CreditCardPayment) => {
        setPaymentToDelete(payment);
        setIsDeleteDialogOpen(true);
    };

    const closeDeleteDialog = () => {
        if (deletingPaymentId) return;
        setIsDeleteDialogOpen(false);
        setPaymentToDelete(null);
    };

    const confirmDeletePayment = async () => {
        if (!paymentToDelete) return;
        await handleDeletePayment(paymentToDelete);
        setIsDeleteDialogOpen(false);
        setPaymentToDelete(null);
    };




    const formatPaymentAmount = (value: number | null | undefined): string =>
        new Intl.NumberFormat('en-AE', {
            style: 'currency',
            currency: 'AED',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value ?? 0);

    const formatAmountInputValue = (value: number | null | undefined): string => {
        if (value == null || Number.isNaN(Number(value))) return '';
        return Number(value).toFixed(2);
    };

    const formatDate = (dateString: string): string => {
        if (!dateString) return '';
        
        let date: Date | null = null;
        
        // Handle ISO 8601 format first: "2026-01-08T20:00:00.000Z" or "2026-01-08T20:00:00Z"
        if (dateString.includes('T')) {
            date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                // Valid ISO date, continue to formatting
            } else {
                date = null;
            }
        }
        
        // Try parsing different date formats
        // Format: yyyy-mm-dd (simple date format)
        if (!date || isNaN(date.getTime())) {
            if (dateString.includes('-') && dateString.length === 10 && !dateString.includes('T')) {
                const parts = dateString.split('-');
                if (parts.length === 3 && parts[0].length === 4) {
                    date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                }
            }
        }
        
        // Format: dd/mm/yyyy
        if (!date || isNaN(date.getTime())) {
            if (dateString.includes('/')) {
                const parts = dateString.split('/');
                if (parts.length === 3) {
                    date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                }
            }
        }
        
        // Try standard Date parsing as last resort
        if (!date || isNaN(date.getTime())) {
            date = new Date(dateString);
        }
        
        if (!date || isNaN(date.getTime())) {
            return dateString; // Return original if parsing fails
        }
        
        // Format as dd-mmm-yyyy (e.g., 02-Jan-2026)
        const day = String(date.getDate()).padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const year = formatDisplayYear(date.getFullYear());
        
        return `${day}-${month}-${year}`;
    };

    // Helper function to parse date/time for sorting (supports local datetime too)
    const parseDateForSort = useCallback((paymentDate: string): Date | null => {
        if (!paymentDate) return null;

        // Handle local datetime format explicitly: "YYYY-MM-DD HH:mm:ss"
        const localDateTime = paymentDate.match(
            /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
        );
        if (localDateTime) {
            const year = Number(localDateTime[1]);
            const month = Number(localDateTime[2]) - 1;
            const day = Number(localDateTime[3]);
            const hour = Number(localDateTime[4]);
            const minute = Number(localDateTime[5]);
            const second = Number(localDateTime[6] ?? '0');
            const date = new Date(year, month, day, hour, minute, second);
            return !isNaN(date.getTime()) ? date : null;
        }
        
        // Handle ISO 8601 format: "2026-01-08T20:00:00.000Z"
        if (paymentDate.includes('T')) {
            const date = new Date(paymentDate);
            return !isNaN(date.getTime()) ? date : null;
        }
        
        // Format: yyyy-mm-dd
        if (paymentDate.includes('-') && paymentDate.length === 10) {
            const parts = paymentDate.split('-');
            if (parts.length === 3 && parts[0].length === 4) {
                const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                return !isNaN(date.getTime()) ? date : null;
            }
        }
        
        // Format: dd/mm/yyyy
        if (paymentDate.includes('/')) {
            const parts = paymentDate.split('/');
            if (parts.length === 3) {
                const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                return !isNaN(date.getTime()) ? date : null;
            }
        }
        
        // Try standard Date parsing
        const date = new Date(paymentDate);
        return !isNaN(date.getTime()) ? date : null;
    }, []);

    // Sort payments by creation time (newest first), then payment date as fallback.
    const sortedCreditCards = useMemo(() => {
        if (!creditCards || creditCards.length === 0) return [];

        const filteredCards = creditCards.filter((card) => {
            const bank = (card.issuingBank || '').trim().toLowerCase();
            return bank !== 'scb infinite';
        });

        return [...filteredCards].sort((a, b) => {
            const createdAtA = parseDateForSort(a.createdAt || '');
            const createdAtB = parseDateForSort(b.createdAt || '');
            const dateA = parseDateForSort(a.paymentDate);
            const dateB = parseDateForSort(b.paymentDate);

            // Primary sort: createdAt descending (newly added first)
            if (createdAtA && createdAtB) {
                const createdAtDiff = createdAtB.getTime() - createdAtA.getTime();
                if (createdAtDiff !== 0) return createdAtDiff;
            } else if (createdAtA && !createdAtB) {
                return -1;
            } else if (!createdAtA && createdAtB) {
                return 1;
            }
            
            // Fallback: paymentDate descending
            if (dateA && dateB) {
                return dateB.getTime() - dateA.getTime();
            }
            
            // If only one has a valid payment date, prioritize it
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;
            
            // If neither has a valid date, maintain original order
            return 0;
        });
    }, [creditCards, parseDateForSort]);

    const totalPaymentAmount = useMemo(() => {
        return sortedCreditCards.reduce((sum, card) => sum + (card.amount || 0), 0);
    }, [sortedCreditCards]);

    // Excel Download function
    const handleDownloadExcel = useCallback(() => {
        if (!creditCards || creditCards.length === 0) {
            setError('No data to export');
            return;
        }

        // Parse dates to get date range
        const parseDateForRange = (payment: CreditCardPayment) => {
            if (payment.paymentDate.includes('T')) {
                return new Date(payment.paymentDate);
            }
            if (payment.paymentDate.includes('-') && payment.paymentDate.length === 10) {
                const parts = payment.paymentDate.split('-');
                if (parts.length === 3 && parts[0].length === 4) {
                    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                }
            }
            if (payment.paymentDate.includes('/')) {
                const parts = payment.paymentDate.split('/');
                if (parts.length === 3) {
                    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                }
            }
            return null;
        };

        const dates = creditCards.map(parseDateForRange).filter(Boolean) as Date[];
        const startDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
        const endDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

        const formatDateForFileName = (d: Date) => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${formatDisplayYear(d.getFullYear())}`;
        };

        // Create workbook
        const workbook = XLSX.utils.book_new();

        // Prepare data for Excel
        const excelData: any[] = [];

        // Add company header
        excelData.push(['GCEC CLOUD SECURITY & SURVEILLANCE L.L.C']);
        excelData.push([]);
        excelData.push(['Credit Card Payments Report']);
        excelData.push([]);

        // Add date range information
        excelData.push(['Start Date:', formatDateForFileName(startDate)]);
        excelData.push(['End Date:', formatDateForFileName(endDate)]);
        excelData.push(['Total Records:', creditCards.length]);
        excelData.push([]);

        // Add table headers
        excelData.push(['Payment Date', 'Card Holder', 'Card Number', 'Amount (AED)', 'Remarks']);

        // Sort payments by date (oldest first) for better readability in Excel
        const sortedPayments = [...creditCards].sort((a, b) => {
            const dateA = parseDateForRange(a);
            const dateB = parseDateForRange(b);
            if (!dateA && !dateB) return 0;
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateA.getTime() - dateB.getTime(); // Ascending order (oldest first)
        });

        // Calculate total amount
        let totalAmount = 0;

        // Add payment rows
        sortedPayments.forEach(payment => {
            // Format date for display
            let displayDate = payment.paymentDate;
            if (payment.paymentDate.includes('T')) {
                const date = new Date(payment.paymentDate);
                if (!isNaN(date.getTime())) {
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = formatDisplayYear(date.getFullYear());
                    displayDate = `${day}/${month}/${year}`;
                }
            } else if (payment.paymentDate.includes('-') && payment.paymentDate.length === 10) {
                // Format: yyyy-mm-dd -> dd/mm/yyyy
                const parts = payment.paymentDate.split('-');
                if (parts.length === 3 && parts[0].length === 4) {
                    displayDate = `${parts[2]}/${parts[1]}/${formatDisplayYear(parseInt(parts[0], 10))}`;
                }
            }

            // Format card holder (show MST if Suleman)
            const cardHolder = payment.cardHolder === 'Suleman' ? 'MST' : payment.cardHolder;

            // Add to total
            totalAmount += payment.amount || 0;

            excelData.push([
                displayDate,
                cardHolder,
                payment.cardNo || '',
                payment.amount || 0, // Store as number
                payment.remarks || '',
            ]);
        });

        // Add total row
        excelData.push([]);
        excelData.push(['Total Amount (AED):', '', '', totalAmount, '']);

        // Create worksheet from data
        const worksheet = XLSX.utils.aoa_to_sheet(excelData);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 18 }, // Payment Date
            { wch: 20 }, // Card Holder
            { wch: 20 }, // Card Number
            { wch: 18 }, // Amount
            { wch: 30 }, // Remarks
        ];

        // Find the range of data
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

        // Format header row (row 8, after company header and info)
        const headerRow = 8;
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

        // Format Amount column (column D, index 3) - apply number formatting
        for (let row = headerRow + 1; row <= range.e.r; row++) {
            const amountCellRef = XLSX.utils.encode_cell({ r: row, c: 3 });
            if (worksheet[amountCellRef]) {
                if (typeof worksheet[amountCellRef].v === 'number') {
                    worksheet[amountCellRef].t = 'n'; // Number type
                    worksheet[amountCellRef].z = '#,##0.00'; // Number format with 2 decimals and thousand separators
                }
            }
        }

        // Format Total Amount cell
        const totalRow = range.e.r;
        const totalAmountCellRef = XLSX.utils.encode_cell({ r: totalRow, c: 3 });
        if (worksheet[totalAmountCellRef]) {
            if (typeof worksheet[totalAmountCellRef].v === 'number') {
                worksheet[totalAmountCellRef].t = 'n';
                worksheet[totalAmountCellRef].z = '#,##0.00';
                if (!worksheet[totalAmountCellRef].s) {
                    worksheet[totalAmountCellRef].s = {};
                }
                worksheet[totalAmountCellRef].s.font = xlsxSheetFontArial({ bold: true });
            }
        }

        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Credit Card Payments');

        // Generate Excel file and download
        const fileName = `Credit-Card-Payments-${formatDateForFileName(startDate)}-to-${formatDateForFileName(endDate)}.xlsx`;
        applyXlsxArialToWorkbook(workbook);
        XLSX.writeFile(workbook, fileName, XLSX_WRITE_WITH_STYLES);

    }, [creditCards]);

    const handleApplyFilters = useCallback(() => {
        setAppliedMonth(selectedMonth);
        setAppliedYear(selectedYear);
    }, [selectedMonth, selectedYear]);

    return (
        <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
      
          <h2 className="text-2xl font-bold text-gray-900"> Credit Card Payments</h2>
       </div>
       <div className="flex items-center gap-2 mr-4">
            <Button
            onClick={handleDownloadExcel}
            variant="outline"
            className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center space-x-2 transition-colors rounded-lg font-semibold"
            disabled={loading || !creditCards || creditCards.length === 0}
            >
            <Download className="w-4 h-4" />
            <span>Download Excel</span>
            </Button>
            {canCreatePayment && (
                <Button
                onClick={handleAddNew}
                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black flex items-center space-x-2 transition-colors rounded-lg"
                disabled={loading}
                >
                <Plus className="w-4 h-4 text-black" />
                <span>Add New</span>
                </Button>
            )}
        </div>
        </div>
        <div className="mx-8 mb-4 flex flex-wrap items-end justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-600">Month</label>
                    <select
                        value={selectedMonth}
                        onChange={(e) => {
                            const value = e.target.value;
                            setSelectedMonth(value === 'all' ? 'all' : Number(value));
                        }}
                        className="h-10 min-w-32 rounded-md border border-gray-300 px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#f7c46d]"
                    >
                        <option value="all">All Months</option>
                        {monthOptions.map((month, index) => (
                            <option key={month} value={index}>
                                {month}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-600">Year</label>
                    <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                        className="h-10 min-w-28 rounded-md border border-gray-300 px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#f7c46d]"
                    >
                        {yearOptions.map((year) => (
                            <option key={year} value={year}>
                                {formatDisplayYear(year)}
                            </option>
                        ))}
                    </select>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={handleApplyFilters}
                    className="h-10 border border-gray-300 bg-white text-black hover:bg-gray-50"
                    disabled={loading}
                >
                    Apply Filter
                </Button>
            </div>
            <div className="rounded-md bg-[#fff7e8] px-4 py-2 text-right">
                <p className="text-xs font-medium text-gray-600">
                    Total Payment ({appliedMonth === 'all' ? 'All Months' : monthOptions[appliedMonth]} {formatDisplayYear(appliedYear)})
                </p>
                <p className="text-lg font-semibold text-gray-900">
                    {formatPaymentAmount(totalPaymentAmount)}
                </p>
            </div>
        </div>


            {successMessage && (
                <div className="mx-8 mb-4 p-3 bg-green-50 border border-green-200 rounded-md shadow-sm">
                    <p className="text-sm font-medium text-green-800">{successMessage}</p>
                </div>
            )}

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}

            <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                <CardContent className="p-0">
                    <div className="overflow-x-auto rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-[#f7c46d] border-0 hover:bg-[#c9a82f]">
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Payment Date
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Card Holder
                                    </TableHead>
                                    <TableHead className="text-black text-sm text-left py-2" style={{ fontWeight: 900 }}>
                                        Issuing Bank
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Card No
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Amount
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
                                        <TableCell colSpan={10} className="text-center py-4">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                            <p className="text-sm text-gray-500">Loading credit card payments...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : !Array.isArray(sortedCreditCards) || sortedCreditCards.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-center py-4">
                                            <p className="text-sm text-gray-500 mb-1">No credit card payments</p>

                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    sortedCreditCards.map((card) => (
                                        <TableRow
                                            key={card.id}
                                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                        >
                                            <TableCell className="text-gray-700 font-medium text-sm py-2 text-left">
                                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                                    {formatDate(card.paymentDate)}
                                                    {pendingApprovalIds.has(String(card.id)) && (
                                                        <span className="inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                                                            Pending approval
                                                        </span>
                                                    )}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                            {card.cardHolder === 'Suleman' ? 'MST' : card.cardHolder}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                <span className="text-black" style={{ fontWeight: 900 }}>
                                                    {card.issuingBank }
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                {card.cardNo}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                {formatPaymentAmount(card.amount)}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">    {card.remarks}</TableCell>
                                            {canMutate && (
                                                <TableCell className="text-gray-700 text-sm py-2 text-left"> 
                                                    <div className="flex items-center gap-2">
                                                        <Button 
                                                            variant="outline" 
                                                            className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                                                            onClick={() => handleEditClick(card)}
                                                            disabled={isSubmitting || deletingPaymentId === card.id}
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            className="border-red-200 text-red-600 hover:bg-red-50"
                                                            onClick={() => {
                                                                openDeleteDialog(card);
                                                            }}
                                                            disabled={isSubmitting || deletingPaymentId === card.id}
                                                        >
                                                            {deletingPaymentId === card.id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Add Payment Dialog */}
            <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
                <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-gray-900">
                            {editingPayment ? 'Edit Credit Card Payment' : 'Add Credit Card Payment'}
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

                                    useEffect(() => {
                                        const parsed = parseDate(field.value);
                                        if (parsed) {
                                            setSelectedDate(parsed);
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

                            {/* Credit Card Selection (Optional) */}
                            <FormField
                                control={form.control}
                                name="creditCardId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Credit Card <span className="text-red-500">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <SearchableSelect
                                                value={field.value || ''}
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    // Auto-fill MST and card number if credit card is selected
                                                    if (value) {
                                                        const selectedCard = availableCreditCards.find(card => card.id === value);
                                                        if (selectedCard) {
                                                            form.setValue('cardHolder', displayCreditCardHolderName(selectedCard.cardHolder));
                                                            form.setValue('cardNo', selectedCard.cardNo);
                                                        }
                                                    }
                                                }}
                                                placeholder="Select credit card"
                                                searchPlaceholder="Search credit card..."
                                                disabled={isSubmitting || loadingCreditCards}
                                            >
                                                {availableCreditCards.map((card) => {
                                                    const shown = displayCreditCardHolderName(card.cardHolder);
                                                    const line = `${shown} - ${card.cardNo.slice(-4)} (${card.issuingBank})`;
                                                    const searchText = `${card.cardHolder} ${shown} ${card.cardNo} ${card.issuingBank}`;
                                                    return (
                                                        <SelectItem key={card.id} value={card.id} textValue={searchText}>
                                                            {line}
                                                        </SelectItem>
                                                    );
                                                })}
                                            </SearchableSelect>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Card Number Field */}
                            <FormField
                                control={form.control}
                                name="cardNo"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Card Number <span className="text-red-500">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter card number"
                                                {...field}
                                                disabled={isSubmitting}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* MST Field */}
                            <FormField
                                control={form.control}
                                name="cardHolder"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Card Holder <span className="text-red-500">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter MST name"
                                                {...field}
                                                disabled={isSubmitting}
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
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Amount (AED) <span className="text-red-500">*</span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                placeholder="0.00"
                                                value={field.value ?? ''}
                                                onBlur={field.onBlur}
                                                name={field.name}
                                                ref={field.ref}
                                                onChange={(e) => {
                                                    const value = e.target.value
                                                      .replace(/[^0-9.]/g, '')
                                                      .replace(/(\..*)\./g, '$1');
                                                    field.onChange(value);
                                                }}
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
                                            Remarks (Optional)
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter remarks"
                                                {...field}
                                                disabled={isSubmitting}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Submit Button */}
                            <DialogFooter className="pt-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => handleModalClose(false)}
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {editingPayment ? 'Updating...' : 'Creating...'}
                                        </>
                                    ) : (
                                        editingPayment ? 'Update Payment' : 'Create Payment'
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
                if (!open) closeDeleteDialog();
            }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-semibold text-gray-900">
                            Are you sure you want to delete?
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-gray-600">
                        This will permanently delete the selected credit card payment transaction.
                    </p>
                    <DialogFooter className="pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={closeDeleteDialog}
                            disabled={Boolean(deletingPaymentId)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => {
                                void confirmDeletePayment();
                            }}
                            disabled={Boolean(deletingPaymentId)}
                        >
                            {deletingPaymentId ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Layout>
    );
}
