import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarIcon, Loader2, Pencil, ChevronUp, Check, X, Download } from 'lucide-react';
import { StatementAttachmentTableCell } from '../components/StatementAttachmentTableCell';
import {
    creditCardService,
    getDefaultStatementPeriod,
    statementPeriodMonthKey,
    type CreditCardStatement,
} from '../services/creditCardService';
import { changeRequestService } from '../services/changeRequestService';
import type { ApiResponse } from '../lib/api';
import { userMessageFromChangeRequestSubmit } from '../lib/changeRequestUi';
import { isApprovalRequiredError } from '../lib/approvalError';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../components/ui/dialog';
import * as XLSX from 'xlsx';
import {
  applyXlsxArialToWorkbook,
  xlsxSheetFontArial,
  XLSX_WRITE_WITH_STYLES,
} from '../lib/excelExportFont';
import { canMutateRecords } from '../lib/authPayload';
import { formatDisplayYear } from '../lib/formatDisplayDate';
import { moneyFromApi, parseMoneyInput, roundMoney, sumMoney } from '../lib/money';

type StatementApprovalOffer =
    | {
          mode: 'edit';
          resourceId: string;
          statementMonth: string;
          payload: Record<string, unknown>;
          note?: string;
      }
    | { mode: 'delete_attachment'; resourceId: string; statementMonth: string }
    /** Shown after POST /user/change-requests succeeds — keeps feedback inside the dialog. */
    | { mode: 'success'; message: string };

// Group statements by month
interface GroupedStatements {
    [monthKey: string]: CreditCardStatement[];
}

interface StatementTotals {
    totalPaymentDue: number;
    paid: number;
    epp: number;
    amountPending: number;
}

export default function CreditCardStatements() {
    const canMutate = canMutateRecords();
    const [creditCards, setCreditCards] = useState<CreditCardStatement[]>([]);
    const [groupedStatements, setGroupedStatements] = useState<GroupedStatements>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Period selection state (default: previous + current month)
    const currentDate = new Date();
    const defaultStatementPeriod = getDefaultStatementPeriod(currentDate);
    const [selectedYear, setSelectedYear] = useState<number>(defaultStatementPeriod.year);
    const [selectedMonths, setSelectedMonths] = useState<number[]>(defaultStatementPeriod.months);
    const [isPeriodSelectorOpen, setIsPeriodSelectorOpen] = useState(false);
    
    // Edit state - only one card can be edited at a time
    const [editingId, setEditingId] = useState<string | null>(null);
    /** YYYY-MM bucket when multiple months are shown (same card id can appear twice). */
    const [editingMonthKey, setEditingMonthKey] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{
        totalPaymentDue: string;
        paid: string;
        epp: string;
    } | null>(null);
    /** New PDF → POST /statements/:id/attachment */
    const [statementAttachmentFile, setStatementAttachmentFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingAttachment, setDeletingAttachment] = useState(false);
    const [approvalOffer, setApprovalOffer] = useState<StatementApprovalOffer | null>(null);
    const [approvalSubmitting, setApprovalSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const successBannerRef = useRef<HTMLDivElement>(null);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const years = [currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1];

    const formatSelectedPeriod = () => {
        if (selectedMonths.length === 0) return 'Select Period';
        if (selectedMonths.length === 1) {
            return `${months[selectedMonths[0]]} ${formatDisplayYear(selectedYear)}`;
        }
        return `${selectedMonths.length} months selected`;
    };

    const toggleMonth = (monthIndex: number) => {
        setSelectedMonths(prev => {
            if (prev.includes(monthIndex)) {
                return prev.filter(m => m !== monthIndex);
            } else {
                return [...prev, monthIndex].sort((a, b) => a - b);
            }
        });
    };

    // Helper function to get month from statement
    const getStatementMonth = (statement: CreditCardStatement): number | null => {
        // Try to get month from statement_date
        if (statement.statement_date) {
            const parts = statement.statement_date.split('-');
            if (parts.length === 3) {
                const monthNum = parseInt(parts[1], 10) - 1; // Convert to 0-11 index
                if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
                    return monthNum;
                }
            }
            // Fallback: try parsing as Date object
            const statementDate = new Date(statement.statement_date);
            if (!isNaN(statementDate.getTime())) {
                return statementDate.getMonth(); // 0-11
            }
        }
        
        // Try to get month from due_month
        if (statement.due_month) {
            // If it's a number (1-12), convert to index (0-11)
            const monthNum = typeof statement.due_month === 'string' 
                ? parseInt(statement.due_month, 10) 
                : statement.due_month;
            if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
                return monthNum - 1;
            }
            // If it's a month name, parse it
            const statementMonth = String(statement.due_month).toLowerCase().substring(0, 3);
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const statementMonthIndex = monthNames.findIndex((m) => statementMonth.includes(m));
            if (statementMonthIndex !== -1) {
                return statementMonthIndex;
            }
        }
        
        return null;
    };

    const statementMatchesPeriodKey = (
        statement: CreditCardStatement,
        periodKey: string
    ): boolean => {
        const statementMonth = getStatementMonth(statement);
        if (statementMonth === null) return false;
        return statementPeriodMonthKey(selectedYear, statementMonth, selectedMonths) === periodKey;
    };

    const resolveStatementMonthParam = (periodKey?: string | null): string => {
        if (periodKey) return periodKey;
        const monthIndex =
            selectedMonths.length > 0 ? selectedMonths[0] : new Date().getMonth();
        return statementPeriodMonthKey(selectedYear, monthIndex, selectedMonths);
    };

    const applyStatementPatchToCard = (
        card: CreditCardStatement,
        responseData: CreditCardStatement
    ): CreditCardStatement => ({
        ...card,
        totalPaymentDue:
            responseData.totalPaymentDue !== undefined && responseData.totalPaymentDue !== null
                ? Number(responseData.totalPaymentDue)
                : card.totalPaymentDue,
        paid:
            responseData.paid !== undefined && responseData.paid !== null
                ? Number(responseData.paid)
                : card.paid,
        epp:
            responseData.epp !== undefined && responseData.epp !== null
                ? Number(responseData.epp)
                : card.epp,
        amountPending:
            responseData.amountPending !== undefined && responseData.amountPending !== null
                ? Number(responseData.amountPending)
                : card.amountPending,
        creditBalance:
            responseData.creditBalance !== undefined && responseData.creditBalance !== null
                ? Number(responseData.creditBalance)
                : card.creditBalance,
        statement_date: responseData.statement_date || card.statement_date,
        due_date: responseData.due_date || card.due_date,
        due_month: responseData.due_month || card.due_month,
        attachmentName:
            responseData.attachmentName !== undefined
                ? responseData.attachmentName
                : card.attachmentName,
        attachmentUrl:
            responseData.attachmentUrl !== undefined ? responseData.attachmentUrl : card.attachmentUrl,
    });

    const isEditingStatement = (card: CreditCardStatement, periodKey?: string): boolean => {
        if (!editingId || String(editingId) !== String(card.id) || !editValues) return false;
        if (selectedMonths.length > 1) {
            return Boolean(periodKey && editingMonthKey === periodKey);
        }
        return true;
    };

    const fetchCreditCards = useCallback(async (year: number, months: number[]) => {
        try {
            setLoading(true);
            setError(null);
            
            const periodMonths =
                months.length > 0 ? months : getDefaultStatementPeriod().months;
            const response = await creditCardService.getCreditCardStatements({
                year,
                months: periodMonths,
            });
            const allStatements =
                response.success && Array.isArray(response.data) ? response.data : [];

            if (periodMonths.length > 1) {
                const grouped: GroupedStatements = {};
                for (const monthIndex of periodMonths) {
                    const monthKey = statementPeriodMonthKey(year, monthIndex, periodMonths);
                    grouped[monthKey] = response.groupedByMonth?.[monthKey] ?? [];
                }
                allStatements.forEach((statement) => {
                    const statementMonth = getStatementMonth(statement);
                    if (statementMonth === null || !periodMonths.includes(statementMonth)) {
                        return;
                    }
                    const monthKey = statementPeriodMonthKey(year, statementMonth, periodMonths);
                    if (!grouped[monthKey]) {
                        grouped[monthKey] = [];
                    }
                    if (!grouped[monthKey].some((row) => row.id === statement.id)) {
                        grouped[monthKey].push(statement);
                    }
                });
                setGroupedStatements(grouped);
            } else {
                setGroupedStatements({});
            }
            
            setCreditCards(allStatements);
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to fetch credit card statements';
            console.error('Error fetching credit card statements:', err);
            setError(errorMessage);
            setCreditCards([]);
            setGroupedStatements({});
        } finally {
            setLoading(false);
        }
    }, []);

    const handleApplyPeriod = () => {
        setIsPeriodSelectorOpen(false);
        fetchCreditCards(selectedYear, selectedMonths);
    };

    useEffect(() => {
        // Initial load with default period (current month/year)
        fetchCreditCards(selectedYear, selectedMonths);
      
    }, []);

    const formatCurrency = (value: number) => {
        const normalized = roundMoney(value);
        return `AED ${normalized.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const sanitizeSignedDecimalInput = (value: string): string => {
        let sanitized = value.replace(/[^0-9.-]/g, '');
        const isNegative = sanitized.startsWith('-');
        sanitized = sanitized.replace(/-/g, '').replace(/(\..*)\./g, '$1');
        return isNegative ? `-${sanitized}` : sanitized;
    };

    const getDisplayAmountPending = (statement: CreditCardStatement): number => {
        const totalPaymentDue = moneyFromApi(statement.totalPaymentDue);
        const paid = moneyFromApi(statement.paid);
        const epp = moneyFromApi(statement.epp);
        const calculatedPending = roundMoney(totalPaymentDue - paid - epp);

        if (calculatedPending !== 0 || totalPaymentDue < 0) {
            return calculatedPending;
        }

        const creditBalance = moneyFromApi(statement.creditBalance);
        if (creditBalance !== 0) {
            return roundMoney(-Math.abs(creditBalance));
        }

        return 0;
    };

    const getStatementTotals = (statements: CreditCardStatement[]): StatementTotals => {
        return {
            totalPaymentDue: sumMoney(
                statements.map((card) => moneyFromApi(card.totalPaymentDue))
            ),
            paid: sumMoney(statements.map((card) => moneyFromApi(card.paid))),
            epp: sumMoney(statements.map((card) => moneyFromApi(card.epp))),
            amountPending: sumMoney(
                statements.map((card) => getDisplayAmountPending(card))
            ),
        };
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return '-';

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const toDisplay = (day: string, monthNum: number, year: string) => {
            const monthName = monthNames[monthNum - 1] || String(monthNum);
            const yearLabel =
                year.length > 2
                    ? formatDisplayYear(parseInt(year, 10))
                    : year.padStart(2, '0');
            return `${day.padStart(2, '0')}-${monthName}-${yearLabel}`;
        };

        const parts = dateString.trim().split('-');
        if (parts.length === 3) {
            const [a, b, c] = parts;
            const yFirst = a.length === 4 && !isNaN(Number(a)) && Number(a) > 1900;
            if (yFirst) {
                // API: YYYY-MM-DD
                return toDisplay(c, parseInt(b, 10), a);
            }
            // Legacy: DD-MM-YYYY
            return toDisplay(a, parseInt(b, 10), c);
        }
        return dateString;
    };

    const formatMonth = (monthValue: string | number) => {
        if (!monthValue) return '-';
        // Convert month number to month name
        // Example: 12 -> Dec, "12" -> Dec
        const monthNum = typeof monthValue === 'string' ? parseInt(monthValue, 10) : monthValue;
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return String(monthValue);
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[monthNum - 1];
    };

    const handleEdit = useCallback((card: CreditCardStatement, periodKey?: string) => {
        if (!card.id) {
            console.error('Card ID is missing:', card);
            return;
        }
        const cardId = String(card.id);
        setEditingId(cardId);
        setEditingMonthKey(periodKey ?? null);
        setStatementAttachmentFile(null);
        setEditValues({
            totalPaymentDue: sanitizeSignedDecimalInput(String(card.totalPaymentDue ?? '')),
            paid: sanitizeSignedDecimalInput(String(card.paid ?? '')),
            epp: sanitizeSignedDecimalInput(String(card.epp ?? '')),
        });
    }, []);

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingMonthKey(null);
        setEditValues(null);
        setStatementAttachmentFile(null);
    };

    useEffect(() => {
        if (!successMessage) return;
        successBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [successMessage]);

    const submitStatementApprovalRequest = async () => {
        if (!approvalOffer || approvalOffer.mode === 'success') return;
        const offer = approvalOffer;
        setApprovalSubmitting(true);
        setError(null);
        try {
            let res: ApiResponse<unknown>;
            if (offer.mode === 'edit') {
                res = await changeRequestService.submit({
                    action: 'edit',
                    resourceType: 'card_statement',
                    resourceId: offer.resourceId,
                    payload: offer.payload,
                    ...(offer.note?.trim() ? { note: offer.note.trim() } : {}),
                });
            } else {
                res = await changeRequestService.submit({
                    action: 'delete',
                    resourceType: 'card_statement',
                    resourceId: offer.resourceId,
                    payload: { statementMonth: offer.statementMonth },
                });
            }
            const apiMessage = userMessageFromChangeRequestSubmit(res);
            setEditingId(null);
            setEditingMonthKey(null);
            setEditValues(null);
            setStatementAttachmentFile(null);
            setSuccessMessage(apiMessage);
            setApprovalOffer({ mode: 'success', message: apiMessage });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not submit change request');
        } finally {
            setApprovalSubmitting(false);
        }
    };

    const handleSave = async (cardId: string, periodKey?: string) => {
        if (!editValues) return;
        const validCardId = String(cardId);
        if (!validCardId || validCardId === 'null' || validCardId === 'undefined' || validCardId === '') {
            setError('Invalid card ID');
            return;
        }

        const bucketKey = periodKey ?? editingMonthKey;
        const monthParam = resolveStatementMonthParam(bucketKey);
        const totalPaymentDue = parseMoneyInput(editValues.totalPaymentDue);
        const paid = parseMoneyInput(editValues.paid);
        const epp = parseMoneyInput(editValues.epp);
        
        try {
            setSaving(true);
            setError(null);
            setSuccessMessage(null);
            
            // amountPending is auto-calculated by backend, so we don't send it
            const newAttachment =
                statementAttachmentFile && statementAttachmentFile.size > 0
                    ? statementAttachmentFile
                    : undefined;

            const patchRes = await creditCardService.updateCreditCardStatement(
                validCardId,
                {
                    totalPaymentDue,
                    paid,
                    epp,
                },
                monthParam
            );

            if (!patchRes.success || !patchRes.data) {
                setError(patchRes.message || 'Failed to update statement');
                return;
            }

            let merged = patchRes.data;

            if (newAttachment) {
                const uploadRes = await creditCardService.uploadCreditCardStatementPdf(
                    validCardId,
                    newAttachment,
                    monthParam
                );
                if (!uploadRes.success || !uploadRes.data) {
                    setError(uploadRes.message || 'Statement saved, but PDF upload failed — try uploading the file again.');
                    return;
                }
                merged = {
                    ...merged,
                    attachmentName: uploadRes.data.attachmentName ?? merged.attachmentName,
                    attachmentUrl: uploadRes.data.attachmentUrl ?? merged.attachmentUrl,
                };
            }

            const responseData = merged;
            const updateBucketKey = bucketKey ?? monthParam;

            const patchRowInList = (rows: CreditCardStatement[]) =>
                rows.map((c) =>
                    String(c.id) === validCardId ? applyStatementPatchToCard(c, responseData) : c
                );

            if (selectedMonths.length > 1) {
                setGroupedStatements((prevGrouped) => {
                    const updatedGrouped = { ...prevGrouped };
                    if (updatedGrouped[updateBucketKey]) {
                        updatedGrouped[updateBucketKey] = patchRowInList(updatedGrouped[updateBucketKey]);
                    } else {
                        for (const key of Object.keys(updatedGrouped)) {
                            if (updatedGrouped[key].some((c) => String(c.id) === validCardId)) {
                                updatedGrouped[key] = patchRowInList(updatedGrouped[key]);
                                break;
                            }
                        }
                    }
                    return updatedGrouped;
                });
                setCreditCards((prev) =>
                    prev.map((card) =>
                        String(card.id) === validCardId &&
                        statementMatchesPeriodKey(card, updateBucketKey)
                            ? applyStatementPatchToCard(card, responseData)
                            : card
                    )
                );
            } else {
                setCreditCards((prev) =>
                    prev.map((card) =>
                        String(card.id) === validCardId
                            ? applyStatementPatchToCard(card, responseData)
                            : card
                    )
                );
            }

            setEditingId(null);
            setEditingMonthKey(null);
            setEditValues(null);
            setStatementAttachmentFile(null);
        } catch (err: unknown) {
            console.error('Error updating statement:', err);
            if (isApprovalRequiredError(err) && editValues) {
                const payload: Record<string, unknown> = {
                    statementMonth: monthParam,
                    total_due: totalPaymentDue,
                    paid_amount: paid,
                    epp_balance: epp,
                };
                if (statementAttachmentFile && statementAttachmentFile.name) {
                    payload.replace_attachment_requested = true;
                }
                setApprovalOffer({
                    mode: 'edit',
                    resourceId: validCardId,
                    statementMonth: monthParam,
                    payload,
                    ...(statementAttachmentFile
                        ? {
                              note: `Statement figures update; also replace PDF (${statementAttachmentFile.name}). Admin may need to attach the file after approval.`,
                          }
                        : {}),
                });
                setEditingId(null);
                setEditingMonthKey(null);
                setEditValues(null);
                setStatementAttachmentFile(null);
                setError(null);
            } else {
                const errorMessage = err instanceof Error ? err.message : 'Failed to update statement';
                setError(errorMessage);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleEditValueChange = (field: 'totalPaymentDue' | 'paid' | 'epp', value: string) => {
        if (!editValues) return;
        setEditValues({
            ...editValues,
            [field]: sanitizeSignedDecimalInput(value),
        });
    };

    const handleDeleteStatementAttachment = useCallback(
        async (cardId: string, periodKey?: string) => {
            if (
                !window.confirm(
                    'Remove this statement PDF from the server? This uses DELETE …/statements/:id/attachment.'
                )
            ) {
                return;
            }
            const validCardId = String(cardId);
            const monthParam = resolveStatementMonthParam(periodKey ?? editingMonthKey);
            const updateBucketKey = periodKey ?? editingMonthKey ?? monthParam;
            try {
                setDeletingAttachment(true);
                setError(null);
                const res = await creditCardService.deleteCreditCardStatementAttachment(
                    validCardId,
                    monthParam
                );
                if (!res.success) {
                    setError(res.message || 'Failed to remove attachment');
                    return;
                }
                const patchAttachment = (card: CreditCardStatement): CreditCardStatement =>
                    res.data
                        ? {
                              ...card,
                              attachmentName: res.data!.attachmentName ?? null,
                              attachmentUrl: res.data!.attachmentUrl ?? null,
                          }
                        : { ...card, attachmentName: null, attachmentUrl: null };

                if (selectedMonths.length > 1) {
                    setGroupedStatements((prevGrouped) => {
                        const updatedGrouped = { ...prevGrouped };
                        if (updatedGrouped[updateBucketKey]) {
                            updatedGrouped[updateBucketKey] = updatedGrouped[updateBucketKey].map(
                                (c) => (String(c.id) === validCardId ? patchAttachment(c) : c)
                            );
                        }
                        return updatedGrouped;
                    });
                    setCreditCards((prev) =>
                        prev.map((card) =>
                            String(card.id) === validCardId &&
                            statementMatchesPeriodKey(card, updateBucketKey)
                                ? patchAttachment(card)
                                : card
                        )
                    );
                } else {
                    setCreditCards((prev) =>
                        prev.map((card) =>
                            String(card.id) === validCardId ? patchAttachment(card) : card
                        )
                    );
                }
                setStatementAttachmentFile(null);
            } catch (err: unknown) {
                if (isApprovalRequiredError(err)) {
                    setApprovalOffer({
                        mode: 'delete_attachment',
                        resourceId: validCardId,
                        statementMonth: monthParam,
                    });
                    setError(null);
                    setSuccessMessage(null);
                } else {
                    setError(err instanceof Error ? err.message : 'Failed to remove attachment');
                }
            } finally {
                setDeletingAttachment(false);
            }
        },
        [selectedMonths, selectedYear, editingMonthKey]
    );

    const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const handleDownloadExcel = useCallback(() => {
        if (creditCards.length === 0) {
            setError('No data to export');
            return;
        }

        // Create workbook
        const workbook = XLSX.utils.book_new();

        // If multiple months selected, create separate sheets for each month
        // If groupedStatements is empty, manually group creditCards by month
        let statementsToUse = groupedStatements;
        if (selectedMonths.length > 1 && Object.keys(groupedStatements).length === 0) {
            // Manually group creditCards by month
            const manuallyGrouped: GroupedStatements = {};
            creditCards.forEach((statement) => {
                const statementMonth = getStatementMonth(statement);
                if (statementMonth !== null && selectedMonths.includes(statementMonth)) {
                    const monthKey = `${selectedYear}-${String(statementMonth + 1).padStart(2, '0')}`;
                    if (!manuallyGrouped[monthKey]) {
                        manuallyGrouped[monthKey] = [];
                    }
                    manuallyGrouped[monthKey].push(statement);
                }
            });
            statementsToUse = manuallyGrouped;
        }

        if (selectedMonths.length > 1 && Object.keys(statementsToUse).length > 0) {
            // Multiple months: create separate sheets
            Object.keys(statementsToUse)
                .sort()
                .forEach((monthKey) => {
                    const [year, monthNum] = monthKey.split('-');
                    const monthIndex = parseInt(monthNum, 10) - 1;
                    const monthName = fullMonthNames[monthIndex];
                    const statements = statementsToUse[monthKey];

                    // Prepare data for Excel
                    const excelData: any[] = [];

                    // Add header
                    excelData.push([`Credit Card Statements - ${monthName} ${year}`]);
                    excelData.push([]);

                    // Add table headers
                    excelData.push([
                        'Issuing Bank',
                        'Card Holder',
                        'Card No',
                        'Statement Date',
                        'Due Date',
                        'Due Month',
                        'Total Payment Due',
                        'Paid',
                        'EPP',
                        'Amount Pending',
                        'Attachment',
                    ]);

                    // Add statement rows
                    statements.forEach((card) => {
                        excelData.push([
                            card.issuingBank || '',
                            card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || ''),
                            card.card_number || '',
                            formatDate(card.statement_date || ''),
                            formatDate(card.due_date || ''),
                            formatMonth(card.due_month || ''),
                            moneyFromApi(card.totalPaymentDue),
                            moneyFromApi(card.paid),
                            moneyFromApi(card.epp),
                            getDisplayAmountPending(card),
                            card.attachmentName || '',
                        ]);
                    });

                    const monthTotals = getStatementTotals(statements);
                    excelData.push([
                        'Total',
                        '',
                        '',
                        '',
                        '',
                        '',
                        monthTotals.totalPaymentDue,
                        monthTotals.paid,
                        monthTotals.epp,
                        monthTotals.amountPending,
                        '',
                    ]);

                    // Create worksheet
                    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

                    // Set column widths
                    worksheet['!cols'] = [
                        { wch: 20 }, // Issuing Bank
                        { wch: 15 }, // Card Holder
                        { wch: 20 }, // Card No
                        { wch: 15 }, // Statement Date
                        { wch: 15 }, // Due Date
                        { wch: 12 }, // Due Month
                        { wch: 18 }, // Total Payment Due
                        { wch: 15 }, // Paid
                        { wch: 15 }, // EPP
                        { wch: 18 }, // Amount Pending
                        { wch: 28 }, // Attachment
                    ];

                    // Format header row (row 2, 0-indexed)
                    const headerRow = 2;
                    for (let col = 0; col <= 10; col++) {
                        const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
                        if (worksheet[headerCellRef]) {
                            if (!worksheet[headerCellRef].s) {
                                worksheet[headerCellRef].s = {};
                            }
                            worksheet[headerCellRef].s.font = xlsxSheetFontArial({ bold: true });
                            worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
                        }
                    }

                    // Format number columns (Total Payment Due, Paid, EPP, Amount Pending)
                    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                    for (let row = 3; row <= range.e.r; row++) {
                        // Column G (Total Payment Due) - index 6
                        const totalDueCellRef = XLSX.utils.encode_cell({ r: row, c: 6 });
                        if (worksheet[totalDueCellRef] && typeof worksheet[totalDueCellRef].v === 'number') {
                            worksheet[totalDueCellRef].t = 'n';
                            worksheet[totalDueCellRef].z = '#,##0.00';
                        }
                        // Column H (Paid) - index 7
                        const paidCellRef = XLSX.utils.encode_cell({ r: row, c: 7 });
                        if (worksheet[paidCellRef] && typeof worksheet[paidCellRef].v === 'number') {
                            worksheet[paidCellRef].t = 'n';
                            worksheet[paidCellRef].z = '#,##0.00';
                        }
                        // Column I (EPP) - index 8
                        const eppCellRef = XLSX.utils.encode_cell({ r: row, c: 8 });
                        if (worksheet[eppCellRef] && typeof worksheet[eppCellRef].v === 'number') {
                            worksheet[eppCellRef].t = 'n';
                            worksheet[eppCellRef].z = '#,##0.00';
                        }
                        // Column J (Amount Pending) - index 9
                        const pendingCellRef = XLSX.utils.encode_cell({ r: row, c: 9 });
                        if (worksheet[pendingCellRef] && typeof worksheet[pendingCellRef].v === 'number') {
                            worksheet[pendingCellRef].t = 'n';
                            worksheet[pendingCellRef].z = '#,##0.00';
                        }
                    }

                    // Add worksheet to workbook
                    XLSX.utils.book_append_sheet(workbook, worksheet, monthName.substring(0, 10)); // Sheet name max 31 chars
                });
        } else {
            // Single month: create single sheet
            const excelData: any[] = [];

            // Add header
            const periodText = selectedMonths.length === 1 
                ? `${months[selectedMonths[0]]} ${formatDisplayYear(selectedYear)}`
                : formatSelectedPeriod();
            excelData.push([`Credit Card Statements - ${periodText}`]);
            excelData.push([]);

            // Add table headers
            excelData.push([
                'Issuing Bank',
                'Card Holder',
                'Card No',
                'Statement Date',
                'Due Date',
                'Due Month',
                'Total Payment Due',
                'Paid',
                'EPP',
                'Amount Pending',
                'Attachment',
            ]);

            // Add statement rows
            creditCards.forEach((card) => {
                excelData.push([
                    card.issuingBank || '',
                    card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || ''),
                    card.card_number || '',
                    formatDate(card.statement_date || ''),
                    formatDate(card.due_date || ''),
                    formatMonth(card.due_month || ''),
                    moneyFromApi(card.totalPaymentDue),
                    moneyFromApi(card.paid),
                    moneyFromApi(card.epp),
                    getDisplayAmountPending(card),
                    card.attachmentName || '',
                ]);
            });

            const sheetTotals = getStatementTotals(creditCards);
            excelData.push([
                'Total',
                '',
                '',
                '',
                '',
                '',
                sheetTotals.totalPaymentDue,
                sheetTotals.paid,
                sheetTotals.epp,
                sheetTotals.amountPending,
                '',
            ]);

            // Create worksheet
            const worksheet = XLSX.utils.aoa_to_sheet(excelData);

            // Set column widths
            worksheet['!cols'] = [
                { wch: 20 }, // Issuing Bank
                { wch: 15 }, // Card Holder
                { wch: 20 }, // Card No
                { wch: 15 }, // Statement Date
                { wch: 15 }, // Due Date
                { wch: 12 }, // Due Month
                { wch: 18 }, // Total Payment Due
                { wch: 15 }, // Paid
                { wch: 15 }, // EPP
                { wch: 18 }, // Amount Pending
                { wch: 28 }, // Attachment
            ];

            // Format header row (row 2, 0-indexed)
            const headerRow = 2;
            for (let col = 0; col <= 10; col++) {
                const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
                if (worksheet[headerCellRef]) {
                    if (!worksheet[headerCellRef].s) {
                        worksheet[headerCellRef].s = {};
                    }
                    worksheet[headerCellRef].s.font = xlsxSheetFontArial({ bold: true });
                    worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
                }
            }

            // Format number columns
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            for (let row = 3; row <= range.e.r; row++) {
                // Column G (Total Payment Due) - index 6
                const totalDueCellRef = XLSX.utils.encode_cell({ r: row, c: 6 });
                if (worksheet[totalDueCellRef] && typeof worksheet[totalDueCellRef].v === 'number') {
                    worksheet[totalDueCellRef].t = 'n';
                    worksheet[totalDueCellRef].z = '#,##0.00';
                }
                // Column H (Paid) - index 7
                const paidCellRef = XLSX.utils.encode_cell({ r: row, c: 7 });
                if (worksheet[paidCellRef] && typeof worksheet[paidCellRef].v === 'number') {
                    worksheet[paidCellRef].t = 'n';
                    worksheet[paidCellRef].z = '#,##0.00';
                }
                // Column I (EPP) - index 8
                const eppCellRef = XLSX.utils.encode_cell({ r: row, c: 8 });
                if (worksheet[eppCellRef] && typeof worksheet[eppCellRef].v === 'number') {
                    worksheet[eppCellRef].t = 'n';
                    worksheet[eppCellRef].z = '#,##0.00';
                }
                // Column J (Amount Pending) - index 9
                const pendingCellRef = XLSX.utils.encode_cell({ r: row, c: 9 });
                if (worksheet[pendingCellRef] && typeof worksheet[pendingCellRef].v === 'number') {
                    worksheet[pendingCellRef].t = 'n';
                    worksheet[pendingCellRef].z = '#,##0.00';
                }
            }

            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Statements');
        }

        // Generate Excel file and download
        const periodText = selectedMonths.length === 1 
            ? `${months[selectedMonths[0]]}-${formatDisplayYear(selectedYear)}`
            : `${selectedMonths.length}-months-${formatDisplayYear(selectedYear)}`;
        const fileName = `Credit-Card-Statements-${periodText}.xlsx`;
        applyXlsxArialToWorkbook(workbook);
        XLSX.writeFile(workbook, fileName, XLSX_WRITE_WITH_STYLES);
    }, [creditCards, selectedMonths, selectedYear, groupedStatements, months, fullMonthNames]);

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
                <div className="flex items-center gap-4 ml-16">
                    <h2 className="text-2xl font-bold text-gray-900">Credit Card Statements</h2>
                </div>
                <div className="flex items-center gap-2 mr-4">
                    <Button
                        variant="outline"
                        onClick={handleDownloadExcel}
                        disabled={loading || creditCards.length === 0}
                        className="bg-white hover:bg-[#f7c46d] text-black border-0 flex items-center gap-2 font-semibold"
                    >
                        <Download className="w-4 h-4" />
                        <span>Download Excel</span>
                    </Button>
                   
                    <Popover open={isPeriodSelectorOpen} onOpenChange={setIsPeriodSelectorOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center space-x-2 transition-colors rounded-lg mr-4 min-w-[200px] justify-between"
                            disabled={loading}
                        >
                            <div className="flex items-center space-x-2">
                                <CalendarIcon className="w-4 h-4 text-gray-600" />
                                <span className="font-medium">{formatSelectedPeriod()}</span>
                            </div>
                            <ChevronUp className="w-4 h-4 text-gray-600" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <div className="p-4 space-y-4">
                            {/* Selected Period Display */}
                            <div className="border border-gray-300 rounded-lg p-3 bg-[#f7c46d]">
                                <div className="text-xs font-medium text-gray-600 mb-1">Selected Period</div>
                                <div className="flex items-center space-x-2">
                                    <CalendarIcon className="w-4 h-4 text-gray-600" />
                                    <span className="font-semibold text-black">{formatSelectedPeriod()}</span>
                                </div>
                            </div>

                            {/* Year Selection */}
                            <div>
                                <div className="text-sm font-semibold text-gray-700 mb-2">Select Year</div>
                                <div className="flex gap-2">
                                    {years.map((year) => (
                                        <button
                                            key={year}
                                            onClick={() => setSelectedYear(year)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                selectedYear === year
                                                    ? 'bg-[#f7c46d] text-black'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            {formatDisplayYear(year)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Month Selection */}
                            <div>
                                <div className="text-sm font-semibold text-gray-700 mb-2">Select Month</div>
                                <div className="grid grid-cols-3 gap-2">
                                    {months.map((month, index) => (
                                        <button
                                            key={index}
                                            onClick={() => toggleMonth(index)}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                selectedMonths.includes(index)
                                                    ? 'bg-[#f7c46d] text-black'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            {month}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2 pt-2 border-t">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsPeriodSelectorOpen(false)}
                                    className="flex-1"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleApplyPeriod}
                                    className="flex-1 bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                                    disabled={selectedMonths.length === 0}
                                >
                                    Apply
                                </Button>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
                </div>
            </div>

            {successMessage && (
                <div
                    ref={successBannerRef}
                    role="status"
                    className="mb-4 mx-4 p-3 bg-green-50 border border-green-200 rounded-md animate-in fade-in-50 shadow-sm"
                >
                    <p className="text-sm text-green-800 font-medium">{successMessage}</p>
                </div>
            )}

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}

            {/* Render separate tables for each selected month (default: previous + current) */}
            {selectedMonths.length > 1 ? (
                loading ? (
                    <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                        <CardContent className="py-12 text-center">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                            <p className="text-sm text-gray-500">Loading credit card statements...</p>
                        </CardContent>
                    </Card>
                ) : (
                [...selectedMonths]
                    .sort((a, b) => a - b)
                    .map((monthIndex) => {
                        const monthKey = statementPeriodMonthKey(
                            selectedYear,
                            monthIndex,
                            selectedMonths
                        );
                        const [year, monthNum] = monthKey.split('-');
                        const monthName = fullMonthNames[parseInt(monthNum, 10) - 1];
                        const statements = groupedStatements[monthKey] ?? [];
                        const monthlyTotals = getStatementTotals(statements);
                        
                        return (
                            <Card key={monthKey} className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                                <CardContent className="p-0">
                                    <div className="bg-[#f7c46d] px-6 py-3 border-b border-gray-200">
                                        <h3 className="text-lg font-bold text-black">
                                            {monthName} {year}
                                        </h3>
                                    </div>
                                    <div className="overflow-x-auto rounded-lg">
                                        <Table className="w-full table-auto text-[14px] sm:text-[15px] [&_th]:whitespace-normal [&_td]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3 [&_th]:py-1.5 [&_td]:py-1.5 [&_th]:text-[14px] sm:[&_th]:text-[15px] [&_td]:text-[14px] sm:[&_td]:text-[15px] [&_td]:leading-tight [&_th]:leading-tight [&_td]:overflow-hidden [&_td]:text-clip">
                                            <TableHeader>
                                                <TableRow className="bg-[#f7c46d] border-0 hover:bg-[#c9a82f]">
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Issuing Bank
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Card Holder
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Card No
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Statement Date
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Due Date
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Due Month
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Total Payment Due
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Paid
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        EPP
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Amount Pending
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2 px-2 w-[44px]">
                                                        File
                                                    </TableHead>
                                                    {canMutate && (
                                                        <TableHead className="font-semibold text-black text-sm text-left py-2 px-2 w-[56px]">
                                                            Actions
                                                        </TableHead>
                                                    )}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {statements.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={canMutate ? 12 : 11} className="text-center py-4">
                                                            <p className="text-sm text-gray-500">No statements found for {monthName} {year}.</p>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    <>
                                                        {statements.map((card) => {
                                                            return (
                                                                <TableRow
                                                                    key={`${monthKey}-${card.id}`}
                                                                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                                                >
                                                                    <TableCell className="text-gray-700 font-medium text-sm py-2 text-left">
                                                                        <div className="w-full truncate" title={card.issuingBank || ''}>
                                                                            <span className="text-black font-bold" style={{ fontWeight: 900 }}>
                                                                                {card.issuingBank}
                                                                            </span>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        <div
                                                                            className="w-full truncate"
                                                                            title={card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || '')}
                                                                        >
                                                                            {card.cardHolder === 'Suleman' ? 'MST' : card.cardHolder}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        <div className="w-full truncate" title={card.card_number || ''}>
                                                                            {card.card_number || ''}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        {formatDate(card.statement_date || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        {formatDate(card.due_date || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        {formatMonth(card.due_month || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 font-semibold text-sm py-2 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.totalPaymentDue}
                                                                                onChange={(e) => handleEditValueChange('totalPaymentDue', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.totalPaymentDue)
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.paid}
                                                                                onChange={(e) => handleEditValueChange('paid', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.paid)
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.epp}
                                                                                onChange={(e) => handleEditValueChange('epp', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.epp)
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className={`text-sm py-2 text-left font-semibold ${
                                                                        getDisplayAmountPending(card) > 0
                                                                            ? 'text-red-600'
                                                                            : 'text-green-600'
                                                                    }`}>
                                                                        {formatCurrency(getDisplayAmountPending(card))}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left align-top px-2 w-[44px]">
                                                                        <StatementAttachmentTableCell
                                                                            card={card}
                                                                            isEditing={isEditingStatement(card, monthKey)}
                                                                            statementAttachmentFile={
                                                                                statementAttachmentFile
                                                                            }
                                                                            onAttachmentFileChange={
                                                                                setStatementAttachmentFile
                                                                            }
                                                                            onDeleteAttachment={
                                                                                canMutate && card.id
                                                                                    ? () =>
                                                                                          void handleDeleteStatementAttachment(
                                                                                              String(card.id),
                                                                                              monthKey
                                                                                          )
                                                                                    : undefined
                                                                            }
                                                                            deleteAttachmentBusy={deletingAttachment}
                                                                            onEditClick={
                                                                                canMutate
                                                                                    ? () => handleEdit(card, monthKey)
                                                                                    : undefined
                                                                            }
                                                                        />
                                                                    </TableCell>
                                                                    {canMutate && (
                                                                    <TableCell className="text-gray-700 text-sm py-2 text-left px-2 w-[56px]">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <div className="flex gap-2">
                                                                                <Button
                                                                                    variant="outline"
                                                                                    size="sm"
                                                                                    onClick={() => {
                                                                                        if (card.id) {
                                                                                            handleSave(String(card.id), monthKey);
                                                                                        }
                                                                                    }}
                                                                                    disabled={
                                                                                        saving ||
                                                                                        deletingAttachment ||
                                                                                        !card.id
                                                                                    }
                                                                                    className="bg-green-500 hover:bg-green-600 text-white border-0"
                                                                                >
                                                                                    <Check className="w-4 h-4" />
                                                                                </Button>
                                                                                <Button
                                                                                    variant="outline"
                                                                                    size="sm"
                                                                                    onClick={handleCancelEdit}
                                                                                    disabled={saving || deletingAttachment}
                                                                                    className="bg-red-500 hover:bg-red-600 text-white border-0"
                                                                                >
                                                                                    <X className="w-4 h-4" />
                                                                                </Button>
                                                                            </div>
                                                                        ) : (
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (card.id) {
                                                                                        handleEdit(card, monthKey);
                                                                                    }
                                                                                }}
                                                                                disabled={!card.id}
                                                                                className="h-8 w-8 p-0 text-black hover:bg-[#f7c46d]/40"
                                                                            >
                                                                                <Pencil className="w-4 h-4 text-black" />
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                    )}
                                                                </TableRow>
                                                            );
                                                        })}
                                                        <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                                                            <TableCell colSpan={6} className="font-bold text-gray-900 py-2 text-right">
                                                                Total
                                                            </TableCell>
                                                            <TableCell className="font-bold text-gray-900 py-2 text-left">
                                                                {formatCurrency(monthlyTotals.totalPaymentDue)}
                                                            </TableCell>
                                                            <TableCell className="font-bold text-gray-900 py-2 text-left">
                                                                {formatCurrency(monthlyTotals.paid)}
                                                            </TableCell>
                                                            <TableCell className="font-bold text-gray-900 py-2 text-left">
                                                                {formatCurrency(monthlyTotals.epp)}
                                                            </TableCell>
                                                            <TableCell
                                                                className={`font-bold py-2 text-left ${
                                                                    roundMoney(monthlyTotals.amountPending) > 0
                                                                        ? 'text-red-600'
                                                                        : 'text-green-600'
                                                                }`}
                                                            >
                                                                {formatCurrency(monthlyTotals.amountPending)}
                                                            </TableCell>
                                                            <TableCell colSpan={canMutate ? 2 : 1} />
                                                        </TableRow>
                                                    </>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })
                )
            ) : (
                // Single month: show single table
                (() => {
                    const monthlyTotals = getStatementTotals(creditCards);
                    return (
                <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto rounded-lg">
                            <Table className="w-full table-auto text-[14px] sm:text-[15px] [&_th]:whitespace-normal [&_td]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3 [&_th]:py-1.5 [&_td]:py-1.5 [&_th]:text-[14px] sm:[&_th]:text-[15px] [&_td]:text-[14px] sm:[&_td]:text-[15px] [&_td]:leading-tight [&_th]:leading-tight [&_td]:overflow-hidden [&_td]:text-clip">
                                <TableHeader>
                                    <TableRow className="bg-[#f7c46d] border-0 hover:bg-[#c9a82f]">
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Issuing Bank
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Card Holder
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Card No
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Statement Date
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Due Date
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Due Month
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Total Payment Due
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Paid
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            EPP
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Amount Pending
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2 px-2 w-[44px]">
                                            File
                                        </TableHead>
                                        {canMutate && (
                                            <TableHead className="font-semibold text-black text-sm text-left py-2 px-2 w-[56px]">
                                                Actions
                                            </TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={canMutate ? 12 : 11} className="text-center py-4">
                                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                                <p className="text-sm text-gray-500">Loading credit card statements...</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : !Array.isArray(creditCards) || creditCards.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={canMutate ? 12 : 11} className="text-center py-4">
                                                <p className="text-sm text-gray-500 mb-1">No credit card statements found for selected period.</p>
                                                <p className="text-sm text-gray-400">Select a different month/year to view statements.</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {creditCards.map((card) => {
                                                return (
                                                <TableRow
                                                    key={card.id}
                                                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                                >
                                                    <TableCell className="text-gray-700 font-medium text-sm py-2 text-left">
                                                        <div className="w-full truncate font-bold" title={card.issuingBank || ''}>
                                                            {card.issuingBank}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        <div
                                                            className="w-full truncate"
                                                            title={card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || '')}
                                                        >
                                                            {card.cardHolder === 'Suleman' ? 'MST' : card.cardHolder}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        <div className="w-full truncate" title={card.card_number || ''}>
                                                            {card.card_number || ''}
                                                        </div>
                                                    </TableCell>
                                                
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        {formatDate(card.statement_date || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        {formatDate(card.due_date || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        {formatMonth(card.due_month || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 font-semibold text-sm py-2 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.totalPaymentDue}
                                                                onChange={(e) => handleEditValueChange('totalPaymentDue', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.totalPaymentDue)
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.paid}
                                                                onChange={(e) => handleEditValueChange('paid', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.paid)
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.epp}
                                                                onChange={(e) => handleEditValueChange('epp', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.epp)
                                                        )}
                                                    </TableCell>
                                                
                                                    <TableCell className={`text-sm py-2 text-left font-semibold ${
                                                        getDisplayAmountPending(card) > 0
                                                            ? 'text-red-600'
                                                            : 'text-green-600'
                                                    }`}>
                                                        {/* amountPending is auto-calculated, so it's read-only */}
                                                        {formatCurrency(getDisplayAmountPending(card))}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left align-top px-2 w-[44px]">
                                                        <StatementAttachmentTableCell
                                                            card={card}
                                                            isEditing={isEditingStatement(card)}
                                                            statementAttachmentFile={statementAttachmentFile}
                                                            onAttachmentFileChange={setStatementAttachmentFile}
                                                            onDeleteAttachment={
                                                                canMutate && card.id
                                                                    ? () =>
                                                                          void handleDeleteStatementAttachment(
                                                                              String(card.id)
                                                                          )
                                                                    : undefined
                                                            }
                                                            deleteAttachmentBusy={deletingAttachment}
                                                            onEditClick={canMutate ? () => handleEdit(card) : undefined}
                                                        />
                                                    </TableCell>
                                                    {canMutate && (
                                                    <TableCell className="text-gray-700 text-sm py-2 text-left px-2 w-[56px]">
                                                        {isEditingStatement(card) ? (
                                                            <div className="flex gap-2">
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        if (card.id) {
                                                                            handleSave(String(card.id));
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        saving || deletingAttachment || !card.id
                                                                    }
                                                                    className="bg-green-500 hover:bg-green-600 text-white border-0"
                                                                >
                                                                    <Check className="w-4 h-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={handleCancelEdit}
                                                                    disabled={saving || deletingAttachment}
                                                                    className="bg-red-500 hover:bg-red-600 text-white border-0"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={(e) => {
                                                                
                                                                    e.stopPropagation();
                                                                    if (card.id) {
                                                                        handleEdit(card);
                                                                    }
                                                                }}
                                                                disabled={!card.id}
                                                                className="h-8 w-8 p-0 text-black hover:bg-[#f7c46d]/40"
                                                            >
                                                                <Pencil className="w-4 h-4 text-black" />
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                    )}
                                                </TableRow>
                                                );
                                            })}
                                            <TableRow className="bg-slate-100 border-t-2 border-slate-300">
                                                <TableCell colSpan={6} className="font-bold text-gray-900 py-2 text-right">
                                                    Total
                                                </TableCell>
                                                <TableCell className="font-bold text-gray-900 py-2 text-left">
                                                    {formatCurrency(monthlyTotals.totalPaymentDue)}
                                                </TableCell>
                                                <TableCell className="font-bold text-gray-900 py-2 text-left">
                                                    {formatCurrency(monthlyTotals.paid)}
                                                </TableCell>
                                                <TableCell className="font-bold text-gray-900 py-2 text-left">
                                                    {formatCurrency(monthlyTotals.epp)}
                                                </TableCell>
                                                <TableCell
                                                    className={`font-bold py-2 text-left ${
                                                        roundMoney(monthlyTotals.amountPending) > 0
                                                            ? 'text-red-600'
                                                            : 'text-green-600'
                                                    }`}
                                                >
                                                    {formatCurrency(monthlyTotals.amountPending)}
                                                </TableCell>
                                                <TableCell colSpan={canMutate ? 2 : 1} />
                                            </TableRow>
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
                    );
                })()
            )}

            <Dialog
                open={!!approvalOffer}
                onOpenChange={(open) => {
                    if (!open) setApprovalOffer(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {approvalOffer?.mode === 'success'
                                ? 'Request submitted'
                                : 'Admin approval required'}
                        </DialogTitle>
                    </DialogHeader>
                    {approvalOffer?.mode === 'success' ? (
                        <p className="text-sm text-green-800 font-medium leading-relaxed">
                            {approvalOffer.message}
                        </p>
                    ) : (
                        <p className="text-sm text-gray-600">
                            {approvalOffer?.mode === 'delete_attachment'
                                ? 'Your account cannot remove this statement PDF directly. Submit a request so an admin can review and remove it?'
                                : 'Your account cannot edit statement amounts directly. Submit these changes for an admin to review and apply?'}
                        </p>
                    )}
                    <DialogFooter className="gap-2 sm:gap-0">
                        {approvalOffer?.mode === 'success' ? (
                            <Button
                                type="button"
                                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black w-full sm:w-auto"
                                onClick={() => setApprovalOffer(null)}
                            >
                                Done
                            </Button>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setApprovalOffer(null)}
                                    disabled={approvalSubmitting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                                    onClick={() => void submitStatementApprovalRequest()}
                                    disabled={approvalSubmitting}
                                >
                                    {approvalSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
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
        </Layout>
    );
}
