import { useState, useEffect, useCallback, useRef, type ReactNode, type RefObject } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarIcon, Loader2, Pencil, ChevronUp, Check, X, Download, Eye, EyeOff } from 'lucide-react';
import { StatementAttachmentTableCell } from '../components/StatementAttachmentTableCell';
import {
    appendStatementAttachmentToChangePayload,
    creditCardService,
    getDefaultStatementPeriod,
    statementPeriodMonthKey,
    validateStatementPdfFile,
    type CreditCardStatement,
} from '../services/creditCardService';
import { changeRequestService } from '../services/changeRequestService';
import type { ApiResponse } from '../lib/api';
import { userMessageFromChangeRequestSubmit } from '../lib/changeRequestUi';
import { isApprovalRequiredError } from '../lib/approvalError';
import * as XLSX from 'xlsx';
import {
  applyXlsxArialToWorkbook,
  xlsxSheetFontArial,
  XLSX_WRITE_WITH_STYLES,
} from '../lib/excelExportFont';
import {
    canMutateRecords,
    canSaveStatementsDirectly,
    usesStatementDeleteApprovalFlow,
} from '../lib/authPayload';
import { formatDisplayYear } from '../lib/formatDisplayDate';
import { moneyFromApi, parseMoneyInput, roundMoney, sumMoney } from '../lib/money';
import {
    useRegisterStatementApprovalSubmit,
    useStatementApprovalModal,
    type StatementApprovalOffer,
} from '../context/StatementApprovalModalContext';

// Group statements by month
interface GroupedStatements {
    [monthKey: string]: CreditCardStatement[];
}

interface StatementTotals {
    totalPaymentDue: number;
    minPaymentDue: number;
    paid: number;
    epp: number;
    amountPending: number;
}

const STATEMENT_TABLE_CLASS =
    'cc-statement-table w-full text-[14px] sm:text-[15px] border-x border-b border-gray-200 [&_th]:whitespace-normal [&_td]:whitespace-nowrap [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_th]:text-[14px] sm:[&_th]:text-[15px] [&_td]:text-[14px] sm:[&_td]:text-[15px] [&_td]:leading-tight [&_th]:leading-tight';

const STATEMENT_MONTH_BAR_CLASS =
    'cc-statement-month-bar px-4 py-2 border-b border-gray-200 flex items-center justify-between';

const STATEMENT_COLUMN_HEAD_CELL_CLASS =
    'bg-[#87CEEB] font-semibold text-black text-sm text-left py-1';

type PinnedHeaderMetrics = {
    pinned: boolean;
    top: number;
    left: number;
    width: number;
    height: number;
};

function usePinnedStatementHeader(
    sectionRef: RefObject<HTMLDivElement | null>,
    headerRef: RefObject<HTMLDivElement | null>
): PinnedHeaderMetrics {
    const [metrics, setMetrics] = useState<PinnedHeaderMetrics>({
        pinned: false,
        top: 0,
        left: 0,
        width: 0,
        height: 0,
    });

    useEffect(() => {
        const section = sectionRef.current;
        const header = headerRef.current;
        if (!section || !header) return;

        const getMain = () => section.closest('main');

        const update = () => {
            const main = getMain();
            if (!main) return;

            const mainRect = main.getBoundingClientRect();
            const sectionRect = section.getBoundingClientRect();
            const headerHeight = header.offsetHeight;
            const mainTop = mainRect.top;
            const pinned =
                sectionRect.top < mainTop &&
                sectionRect.bottom > mainTop + headerHeight;

            setMetrics({
                pinned,
                top: mainTop,
                left: sectionRect.left,
                width: sectionRect.width,
                height: headerHeight,
            });
        };

        const main = getMain();
        if (!main) return;

        main.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(section);
        resizeObserver.observe(header);
        update();

        return () => {
            main.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            resizeObserver.disconnect();
        };
    }, [sectionRef, headerRef]);

    return metrics;
}

function PinnedStatementTableSection({
    children,
    body,
}: {
    children: ReactNode;
    body: ReactNode;
}) {
    const sectionRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const { pinned, top, left, width, height } = usePinnedStatementHeader(sectionRef, headerRef);

    return (
        <div ref={sectionRef} className="cc-statement-table-section">
            {pinned ? <div style={{ height }} aria-hidden className="cc-statement-header-spacer" /> : null}
            <div
                ref={headerRef}
                className={`cc-statement-sticky-header${pinned ? ' cc-statement-sticky-header--pinned' : ''}`}
                style={
                    pinned
                        ? {
                              position: 'fixed',
                              top,
                              left,
                              width,
                              zIndex: 50,
                              backgroundColor: '#f7c46d',
                          }
                        : undefined
                }
            >
                {children}
            </div>
            {body}
        </div>
    );
}

export default function CreditCardStatements() {
    const canMutate = canMutateRecords();
    const {
        offer: approvalOffer,
        openApproval,
        setModalError: setApprovalModalError,
        setSubmitting: setApprovalSubmitting,
        showSuccess: showApprovalSuccess,
    } = useStatementApprovalModal();
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
        minPaymentDue: string;
        paid: string;
        epp: string;
    } | null>(null);
    /** New PDF → POST /statements/:id/attachment */
    const [statementAttachmentFile, setStatementAttachmentFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingAttachment, setDeletingAttachment] = useState(false);
    const pendingApprovalAttachmentRef = useRef<File | null>(null);
    const attachmentInputRef = useRef<HTMLInputElement | null>(null);
    const [minPaymentDueVisibleByMonth, setMinPaymentDueVisibleByMonth] = useState<
        Record<string, boolean>
    >({});
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const successBannerRef = useRef<HTMLDivElement>(null);
    const monthSectionRefs = useRef<Partial<Record<string, HTMLDivElement>>>({});
    const didScrollToSecondMonthOnLoad = useRef(false);

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
        minPaymentDue:
            responseData.minPaymentDue !== undefined && responseData.minPaymentDue !== null
                ? Number(responseData.minPaymentDue)
                : card.minPaymentDue,
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

    const getMinPaymentDueMonthKey = (monthKey?: string): string => {
        if (monthKey) return monthKey;
        if (selectedMonths.length === 1) {
            return statementPeriodMonthKey(selectedYear, selectedMonths[0], selectedMonths);
        }
        return 'default';
    };

    const isMinPaymentDueColumnVisible = (monthKey?: string): boolean => {
        const key = getMinPaymentDueMonthKey(monthKey);
        if (minPaymentDueVisibleByMonth[key]) return true;
        if (editingId && editValues) {
            if (selectedMonths.length > 1) {
                return Boolean(monthKey && editingMonthKey === monthKey);
            }
            return true;
        }
        return false;
    };

    const toggleMinPaymentDueVisibility = (monthKey?: string) => {
        const key = getMinPaymentDueMonthKey(monthKey);
        setMinPaymentDueVisibleByMonth((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const getStatementTableColSpan = (showMinPaymentDue: boolean): number => {
        const baseColumns = showMinPaymentDue ? 12 : 11;
        return canMutate ? baseColumns + 1 : baseColumns;
    };

    const renderStatementColGroup = (showMinPaymentDue: boolean) => {
        const widths = ['9%', '5%', '10%', '7%', '7%', '5%', '8%'];
        if (showMinPaymentDue) widths.push('7%');
        widths.push('8%', '8%', '8%', '3%');
        if (canMutate) widths.push('4%');
        return (
            <colgroup>
                {widths.map((width, index) => (
                    <col key={index} style={{ width }} />
                ))}
            </colgroup>
        );
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

    // On first open with multiple months, scroll the 2nd month into view (current month by default).
    useEffect(() => {
        if (didScrollToSecondMonthOnLoad.current || loading || selectedMonths.length < 2) {
            return;
        }

        const sortedMonths = [...selectedMonths].sort((a, b) => a - b);
        const secondMonthKey = statementPeriodMonthKey(
            selectedYear,
            sortedMonths[1],
            selectedMonths
        );

        const timer = window.setTimeout(() => {
            const section = monthSectionRefs.current[secondMonthKey];
            if (!section) return;
            didScrollToSecondMonthOnLoad.current = true;
            section.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 0);

        return () => window.clearTimeout(timer);
    }, [loading, selectedMonths, selectedYear, groupedStatements]);

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

    /** Lone zero placeholder only — not amounts like 207 or 1000. */
    const isLoneZeroEditString = (value: string): boolean => {
        const t = value.trim();
        return t === '0' || t === '-0' || t === '0.' || t === '-0.' || /^-?0\.0+$/.test(t);
    };

    const toEditableMoneyFieldValue = (amount: number | null | undefined): string => {
        const normalized = moneyFromApi(amount);
        if (normalized === 0) return '';
        return sanitizeSignedDecimalInput(String(normalized));
    };

    const normalizeEditFieldWhileTyping = (prev: string, rawNext: string): string => {
        const next = sanitizeSignedDecimalInput(rawNext);
        // Only strip when the field held a single "0" and typing appended a digit (05 → 5).
        // Do not touch 207, 20, or user-entered 0 / 0.5 / 0.50.
        if (prev === '0' && /^0[1-9]/.test(next)) return next.slice(1);
        if (prev === '-0' && /^-0[1-9]/.test(next)) return `-${next.slice(2)}`;
        return next;
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

    const isSettledAmountPending = (statement: CreditCardStatement): boolean => {
        const pending = getDisplayAmountPending(statement);
        if (pending < 0) return true;
        if (pending > 0) return false;

        const totalPaymentDue = moneyFromApi(statement.totalPaymentDue);
        const paid = moneyFromApi(statement.paid);
        const epp = moneyFromApi(statement.epp);
        return totalPaymentDue !== 0 || paid !== 0 || epp !== 0;
    };

    const getStatementRowClassName = (statement: CreditCardStatement): string =>
        isSettledAmountPending(statement)
            ? 'bg-[#ebf2e8] hover:bg-[#d9ead3] transition-colors [&_td]:!text-black [&_span]:!text-black [&_td]:border-b-1 [&_td]:border-[#9bc86e]'
            : 'hover:bg-gray-50 transition-colors [&_td]:border-b [&_td]:border-gray-300';

    const getStatementTotals = (statements: CreditCardStatement[]): StatementTotals => {
        return {
            totalPaymentDue: sumMoney(
                statements.map((card) => moneyFromApi(card.totalPaymentDue))
            ),
            minPaymentDue: sumMoney(
                statements.map((card) => moneyFromApi(card.minPaymentDue))
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

    const getPendingStatementAttachment = useCallback((): File | undefined => {
        if (statementAttachmentFile && statementAttachmentFile.size > 0) {
            return statementAttachmentFile;
        }
        if (pendingApprovalAttachmentRef.current && pendingApprovalAttachmentRef.current.size > 0) {
            return pendingApprovalAttachmentRef.current;
        }
        const fromInput = attachmentInputRef.current?.files?.[0];
        if (fromInput && fromInput.size > 0) {
            return fromInput;
        }
        const fromDom = document.querySelector<HTMLInputElement>(
            '[data-statement-attachment-input]'
        )?.files?.[0];
        if (fromDom && fromDom.size > 0) {
            return fromDom;
        }
        return undefined;
    }, [statementAttachmentFile]);

    const handleEdit = useCallback((card: CreditCardStatement, periodKey?: string) => {
        if (!card.id) {
            console.error('Card ID is missing:', card);
            return;
        }
        const cardId = String(card.id);
        setEditingId(cardId);
        setEditingMonthKey(periodKey ?? null);
        pendingApprovalAttachmentRef.current = null;
        setStatementAttachmentFile(null);
        setEditValues({
            totalPaymentDue: toEditableMoneyFieldValue(card.totalPaymentDue),
            minPaymentDue: toEditableMoneyFieldValue(card.minPaymentDue),
            paid: toEditableMoneyFieldValue(card.paid),
            epp: toEditableMoneyFieldValue(card.epp),
        });
    }, []);

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingMonthKey(null);
        setEditValues(null);
        pendingApprovalAttachmentRef.current = null;
        setStatementAttachmentFile(null);
    };

    const handleStatementAttachmentFileChange = useCallback((file: File | null) => {
        if (file) {
            const fileErr = validateStatementPdfFile(file);
            if (fileErr) {
                setError(fileErr);
                pendingApprovalAttachmentRef.current = null;
                return;
            }
            pendingApprovalAttachmentRef.current = file;
        } else {
            pendingApprovalAttachmentRef.current = null;
        }
        setStatementAttachmentFile(file);
    }, []);

    useEffect(() => {
        if (!successMessage) return;
        successBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [successMessage]);

    const findStatementCard = (
        cardId: string,
        periodKey?: string | null
    ): CreditCardStatement | undefined => {
        if (periodKey && groupedStatements[periodKey]) {
            return groupedStatements[periodKey].find((c) => String(c.id) === cardId);
        }
        return creditCards.find((c) => String(c.id) === cardId);
    };

    const statementAmountsUnchanged = (
        card: CreditCardStatement,
        values: { totalPaymentDue: string; minPaymentDue: string; paid: string; epp: string }
    ): boolean =>
        parseMoneyInput(values.totalPaymentDue) === moneyFromApi(card.totalPaymentDue) &&
        parseMoneyInput(values.minPaymentDue) === moneyFromApi(card.minPaymentDue) &&
        parseMoneyInput(values.paid) === moneyFromApi(card.paid) &&
        parseMoneyInput(values.epp) === moneyFromApi(card.epp);

    const applySavedStatementToState = (
        responseData: CreditCardStatement,
        validCardId: string,
        updateBucketKey: string
    ) => {
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
    };

    const openStatementApprovalOffer = (opts: {
        resourceId: string;
        statementMonth: string;
        totalPaymentDue: number;
        minPaymentDue: number;
        paid: number;
        epp: number;
        attachmentFile?: File | null;
        amountsUnchanged?: boolean;
    }): boolean => {
        const attachmentFile =
            opts.attachmentFile && opts.attachmentFile.size > 0 ? opts.attachmentFile : undefined;
        if (attachmentFile) {
            const fileErr = validateStatementPdfFile(attachmentFile);
            if (fileErr) {
                setError(fileErr);
                return false;
            }
        } else if (opts.amountsUnchanged) {
            setError('No changes to save');
            return false;
        }

        const note = attachmentFile
            ? opts.amountsUnchanged
                ? `Attach statement file (${attachmentFile.name}) for admin approval.`
                : `Statement figures update; also attach file (${attachmentFile.name}).`
            : undefined;

        const payload: Record<string, unknown> = {
            statementMonth: opts.statementMonth,
            total_due: opts.totalPaymentDue,
            min_payment_due: opts.minPaymentDue,
            paid_amount: opts.paid,
            epp_balance: opts.epp,
            ...(attachmentFile ? { replace_attachment_requested: true } : {}),
        };

        pendingApprovalAttachmentRef.current = attachmentFile ?? null;

        const offer: StatementApprovalOffer = {
            mode: 'edit',
            resourceId: opts.resourceId,
            statementMonth: opts.statementMonth,
            payload,
            ...(attachmentFile ? { hasAttachment: true, attachmentFile } : {}),
            ...(note ? { note } : {}),
        };

        setError(null);
        setSuccessMessage(null);
        openApproval(offer);
        return true;
    };

    const submitStatementApprovalRequest = useCallback(async () => {
        if (!approvalOffer || approvalOffer.mode === 'success') return;
        const offer = approvalOffer;
        setApprovalSubmitting(true);
        setError(null);
        setApprovalModalError(null);
        try {
            let res: ApiResponse<unknown>;
            if (offer.mode === 'edit') {
                let payload = { ...offer.payload };
                const hasEmbeddedAttachment =
                    payload.attachmentBase64 != null ||
                    payload.attachment_base64 != null;
                if (offer.hasAttachment && !hasEmbeddedAttachment) {
                    const attachmentFile =
                        offer.attachmentFile ?? pendingApprovalAttachmentRef.current;
                    if (!attachmentFile) {
                        setApprovalModalError(
                            'Attachment was lost — edit the row and choose the file again.'
                        );
                        return;
                    }
                    payload = await appendStatementAttachmentToChangePayload(
                        payload,
                        attachmentFile
                    );
                }
                res = await changeRequestService.submit({
                    action: 'edit',
                    resourceType: 'card_statement',
                    resourceId: offer.resourceId,
                    payload,
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
            setSuccessMessage(apiMessage);
            pendingApprovalAttachmentRef.current = null;
            showApprovalSuccess(apiMessage);
            setEditingId(null);
            setEditingMonthKey(null);
            setEditValues(null);
            setStatementAttachmentFile(null);
        } catch (e: unknown) {
            const message =
                e instanceof Error ? e.message : 'Could not submit change request';
            setApprovalModalError(message);
            setError(message);
        } finally {
            setApprovalSubmitting(false);
        }
    }, [
        approvalOffer,
        setApprovalModalError,
        setApprovalSubmitting,
        showApprovalSuccess,
    ]);

    const triggerApprovalSubmit = useCallback(() => {
        void submitStatementApprovalRequest();
    }, [submitStatementApprovalRequest]);

    useRegisterStatementApprovalSubmit(triggerApprovalSubmit);

    const handleSave = async (cardId: string, periodKey?: string) => {
        if (!editValues) return;
        const validCardId = String(cardId);
        if (!validCardId || validCardId === 'null' || validCardId === 'undefined' || validCardId === '') {
            setError('Invalid card ID');
            return;
        }

        const bucketKey = periodKey ?? editingMonthKey;
        const monthParam = resolveStatementMonthParam(bucketKey);
        const updateBucketKey = bucketKey ?? monthParam;
        const totalPaymentDue = parseMoneyInput(editValues.totalPaymentDue);
        const minPaymentDue = parseMoneyInput(editValues.minPaymentDue);
        const paid = parseMoneyInput(editValues.paid);
        const epp = parseMoneyInput(editValues.epp);
        const card = findStatementCard(validCardId, bucketKey);
        const amountsUnchanged = card ? statementAmountsUnchanged(card, editValues) : false;
        const newAttachment = getPendingStatementAttachment();

        if (newAttachment) {
            const fileErr = validateStatementPdfFile(newAttachment);
            if (fileErr) {
                setError(fileErr);
                return;
            }
        } else if (amountsUnchanged) {
            setError('No changes to save');
            return;
        }

        // Viewer cannot save. Everyone else: ✓ calls PATCH/upload immediately (no modal).
        if (!canSaveStatementsDirectly()) {
            setError(null);
            setSuccessMessage(null);
            openStatementApprovalOffer({
                resourceId: validCardId,
                statementMonth: monthParam,
                totalPaymentDue,
                minPaymentDue,
                paid,
                epp,
                attachmentFile: newAttachment ?? null,
                amountsUnchanged,
            });
            return;
        }

        try {
            setSaving(true);
            setError(null);
            setSuccessMessage(null);

            // PDF only — try upload first (skips PATCH when amounts unchanged).
            if (newAttachment && amountsUnchanged) {
                try {
                    const uploadRes = await creditCardService.uploadCreditCardStatementPdf(
                        validCardId,
                        newAttachment,
                        monthParam
                    );
                    if (!uploadRes.success || !uploadRes.data) {
                        setError(uploadRes.message || 'Failed to upload statement PDF');
                        return;
                    }
                    applySavedStatementToState(uploadRes.data, validCardId, updateBucketKey);
                    setEditingId(null);
                    setEditingMonthKey(null);
                    setEditValues(null);
                    setStatementAttachmentFile(null);
                    return;
                } catch (uploadErr: unknown) {
                    if (isApprovalRequiredError(uploadErr) && !canSaveStatementsDirectly()) {
                        openStatementApprovalOffer({
                            resourceId: validCardId,
                            statementMonth: monthParam,
                            totalPaymentDue,
                            minPaymentDue,
                            paid,
                            epp,
                            attachmentFile: newAttachment,
                            amountsUnchanged: true,
                        });
                        return;
                    }
                    throw uploadErr;
                }
            }

            const patchRes = await creditCardService.updateCreditCardStatement(
                validCardId,
                { totalPaymentDue, minPaymentDue, paid, epp },
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
                    setError(
                        uploadRes.message ||
                            'Statement saved, but PDF upload failed — try uploading the file again.'
                    );
                    return;
                }
                merged = {
                    ...merged,
                    attachmentName: uploadRes.data.attachmentName ?? merged.attachmentName,
                    attachmentUrl: uploadRes.data.attachmentUrl ?? merged.attachmentUrl,
                };
            }

            applySavedStatementToState(merged, validCardId, updateBucketKey);
            setEditingId(null);
            setEditingMonthKey(null);
            setEditValues(null);
            setStatementAttachmentFile(null);
        } catch (err: unknown) {
            console.error('Error updating statement:', err);
            if (isApprovalRequiredError(err) && editValues && !canSaveStatementsDirectly()) {
                openStatementApprovalOffer({
                    resourceId: validCardId,
                    statementMonth: monthParam,
                    totalPaymentDue,
                    minPaymentDue,
                    paid,
                    epp,
                    attachmentFile: newAttachment ?? null,
                    amountsUnchanged,
                });
            } else {
                const errorMessage = err instanceof Error ? err.message : 'Failed to update statement';
                setError(errorMessage);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleEditFieldFocus = (field: 'totalPaymentDue' | 'minPaymentDue' | 'paid' | 'epp') => {
        if (!editValues) return;
        if (isLoneZeroEditString(editValues[field])) {
            setEditValues({ ...editValues, [field]: '' });
        }
    };

    const handleEditValueChange = (field: 'totalPaymentDue' | 'minPaymentDue' | 'paid' | 'epp', value: string) => {
        if (!editValues) return;
        setEditValues({
            ...editValues,
            [field]: normalizeEditFieldWhileTyping(editValues[field], value),
        });
    };

    const handleDeleteStatementAttachment = useCallback(
        async (cardId: string, periodKey?: string) => {
            const validCardId = String(cardId);
            const monthParam = resolveStatementMonthParam(periodKey ?? editingMonthKey);
            const updateBucketKey = periodKey ?? editingMonthKey ?? monthParam;

            if (usesStatementDeleteApprovalFlow()) {
                pendingApprovalAttachmentRef.current = null;
                setError(null);
                openApproval({
                    mode: 'delete_attachment',
                    resourceId: validCardId,
                    statementMonth: monthParam,
                });
                return;
            }

            if (
                !window.confirm(
                    'Remove this statement PDF from the server? This uses DELETE …/statements/:id/attachment.'
                )
            ) {
                return;
            }
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
                    setError(null);
                    setSuccessMessage(null);
                    openApproval({
                        mode: 'delete_attachment',
                        resourceId: validCardId,
                        statementMonth: monthParam,
                    });
                } else {
                    setError(err instanceof Error ? err.message : 'Failed to remove attachment');
                }
            } finally {
                setDeletingAttachment(false);
            }
        },
        [selectedMonths, selectedYear, editingMonthKey, openApproval]
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
                        const showMinPaymentDue = isMinPaymentDueColumnVisible(monthKey);
                        
                        return (
                            <Card
                                key={monthKey}
                                ref={(el) => {
                                    if (el) monthSectionRefs.current[monthKey] = el;
                                    else delete monthSectionRefs.current[monthKey];
                                }}
                                className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg scroll-mt-24"
                            >
                                <CardContent className="p-0">
                                    <PinnedStatementTableSection
                                        body={
                                    <div className="cc-statement-table-body-wrap">
                                        <table className={`${STATEMENT_TABLE_CLASS} cc-statement-table--body`}>
                                            {renderStatementColGroup(showMinPaymentDue)}
                                            <TableBody>
                                                {statements.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={getStatementTableColSpan(showMinPaymentDue)} className="text-center py-4">
                                                            <p className="text-sm text-gray-500">No statements found for {monthName} {year}.</p>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    <>
                                                        {statements.map((card) => {
                                                            const amountPending = getDisplayAmountPending(card);
                                                            return (
                                                                <TableRow
                                                                    key={`${monthKey}-${card.id}`}
                                                                    className={getStatementRowClassName(card)}
                                                                >
                                                                    <TableCell className="text-gray-700 font-medium text-sm py-1 text-left">
                                                                        <div className="w-full" title={card.issuingBank || ''}>
                                                                            <span className="text-black font-bold" style={{ fontWeight: 900 }}>
                                                                                {card.issuingBank}
                                                                            </span>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        <div
                                                                            className="w-full"
                                                                            title={card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || '')}
                                                                        >
                                                                            {card.cardHolder === 'Suleman' ? 'MST' : card.cardHolder}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        <div className="w-full" title={card.card_number || ''}>
                                                                            {card.card_number || ''}
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        {formatDate(card.statement_date || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        {formatDate(card.due_date || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        {formatMonth(card.due_month || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 font-semibold text-sm py-1 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.totalPaymentDue}
                                                                                onFocus={() => handleEditFieldFocus('totalPaymentDue')}
                                                                                onChange={(e) => handleEditValueChange('totalPaymentDue', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.totalPaymentDue)
                                                                        )}
                                                                    </TableCell>
                                                                    {showMinPaymentDue && (
                                                                    <TableCell className="text-gray-700 font-semibold text-sm py-1 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.minPaymentDue}
                                                                                onFocus={() => handleEditFieldFocus('minPaymentDue')}
                                                                                onChange={(e) => handleEditValueChange('minPaymentDue', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.minPaymentDue)
                                                                        )}
                                                                    </TableCell>
                                                                    )}
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.paid}
                                                                                onFocus={() => handleEditFieldFocus('paid')}
                                                                                onChange={(e) => handleEditValueChange('paid', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.paid)
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                                value={editValues!.epp}
                                                                                onFocus={() => handleEditFieldFocus('epp')}
                                                                                onChange={(e) => handleEditValueChange('epp', e.target.value)}
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            />
                                                                        ) : (
                                                                            formatCurrency(card.epp)
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className={`text-sm py-1 text-left font-semibold ${
                                                                        amountPending > 0 ? 'text-red-600' : 'text-black'
                                                                    }`}>
                                                                        {formatCurrency(amountPending)}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left align-top px-2">
                                                                        <StatementAttachmentTableCell
                                                                            card={card}
                                                                            isEditing={isEditingStatement(card, monthKey)}
                                                                            statementAttachmentFile={
                                                                                statementAttachmentFile
                                                                            }
                                                                            attachmentInputRef={
                                                                                isEditingStatement(card, monthKey)
                                                                                    ? attachmentInputRef
                                                                                    : undefined
                                                                            }
                                                                            onAttachmentFileChange={
                                                                                handleStatementAttachmentFileChange
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
                                                                    <TableCell className="text-gray-700 text-sm py-1 text-left px-2">
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            <div className="flex gap-2">
                                                                                <Button
                                                                                    type="button"
                                                                                    variant="outline"
                                                                                    size="sm"
                                                                                    onClick={(e) => {
                                                                                        e.preventDefault();
                                                                                        e.stopPropagation();
                                                                                        if (card.id) {
                                                                                            void handleSave(String(card.id), monthKey);
                                                                                        }
                                                                                    }}
                                                                                    disabled={
                                                                                        saving ||
                                                                                        deletingAttachment ||
                                                                                        !card.id
                                                                                    }
                                                                                    className="bg-green-500 hover:bg-green-600 text-white border-0"
                                                                                >
                                                                                    {saving ? (
                                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                                    ) : (
                                                                                        <Check className="w-4 h-4" />
                                                                                    )}
                                                                                </Button>
                                                                                <Button
                                                                                    type="button"
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
                                                            <TableCell colSpan={6} className="font-bold text-gray-900 py-1 text-right">
                                                                Total
                                                            </TableCell>
                                                            <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                                {formatCurrency(monthlyTotals.totalPaymentDue)}
                                                            </TableCell>
                                                            {showMinPaymentDue && (
                                                            <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                                {formatCurrency(monthlyTotals.minPaymentDue)}
                                                            </TableCell>
                                                            )}
                                                            <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                                {formatCurrency(monthlyTotals.paid)}
                                                            </TableCell>
                                                            <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                                {formatCurrency(monthlyTotals.epp)}
                                                            </TableCell>
                                                            <TableCell
                                                                className={`font-bold py-1 text-left ${
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
                                        </table>
                                    </div>
                                        }
                                    >
                                        <div className={STATEMENT_MONTH_BAR_CLASS}>
                                            <h3 className="text-lg font-bold text-black">
                                                {monthName} {year}
                                            </h3>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => toggleMinPaymentDueVisibility(monthKey)}
                                                className="h-8 w-8 p-0 text-black hover:bg-black/10"
                                                aria-label={
                                                    showMinPaymentDue
                                                        ? 'Hide Min Payment Due column'
                                                        : 'Show Min Payment Due column'
                                                }
                                                title={
                                                    showMinPaymentDue
                                                        ? 'Hide Min Payment Due'
                                                        : 'Show Min Payment Due'
                                                }
                                            >
                                                {showMinPaymentDue ? (
                                                    <Eye className="w-5 h-5" />
                                                ) : (
                                                    <EyeOff className="w-5 h-5" />
                                                )}
                                            </Button>
                                        </div>
                                        <table className={`${STATEMENT_TABLE_CLASS} border-t-0`}>
                                            {renderStatementColGroup(showMinPaymentDue)}
                                            <TableHeader>
                                                <TableRow className="bg-[#87CEEB] border-0 hover:bg-[#6bb8d9]">
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Issuing Bank
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Card Holder
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Card No
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Statement Date
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Due Date
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Due Month
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Total Payment Due
                                                    </TableHead>
                                                    {showMinPaymentDue && (
                                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                            Min Payment Due
                                                        </TableHead>
                                                    )}
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Paid
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        EPP
                                                    </TableHead>
                                                    <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                        Amount Pending
                                                    </TableHead>
                                                    <TableHead className={`${STATEMENT_COLUMN_HEAD_CELL_CLASS} px-2`}>
                                                        File
                                                    </TableHead>
                                                    {canMutate && (
                                                        <TableHead className={`${STATEMENT_COLUMN_HEAD_CELL_CLASS} px-2`}>
                                                            Actions
                                                        </TableHead>
                                                    )}
                                                </TableRow>
                                            </TableHeader>
                                        </table>
                                    </PinnedStatementTableSection>
                                </CardContent>
                            </Card>
                        );
                    })
                )
            ) : (
                // Single month: show single table
                (() => {
                    const monthlyTotals = getStatementTotals(creditCards);
                    const singleMonthKey =
                        selectedMonths.length === 1
                            ? statementPeriodMonthKey(selectedYear, selectedMonths[0], selectedMonths)
                            : undefined;
                    const showMinPaymentDue = isMinPaymentDueColumnVisible(singleMonthKey);
                    const singleMonthLabel =
                        selectedMonths.length === 1
                            ? `${fullMonthNames[selectedMonths[0]]} ${formatDisplayYear(selectedYear)}`
                            : null;
                    return (
                <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg">
                    <CardContent className="p-0">
                        <PinnedStatementTableSection
                            body={
                        <div className="cc-statement-table-body-wrap">
                            <table className={`${STATEMENT_TABLE_CLASS} cc-statement-table--body`}>
                                {renderStatementColGroup(showMinPaymentDue)}
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={getStatementTableColSpan(showMinPaymentDue)} className="text-center py-4">
                                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                                <p className="text-sm text-gray-500">Loading credit card statements...</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : !Array.isArray(creditCards) || creditCards.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={getStatementTableColSpan(showMinPaymentDue)} className="text-center py-4">
                                                <p className="text-sm text-gray-500 mb-1">No credit card statements found for selected period.</p>
                                                <p className="text-sm text-gray-400">Select a different month/year to view statements.</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {creditCards.map((card) => {
                                                const amountPending = getDisplayAmountPending(card);
                                                return (
                                                <TableRow
                                                    key={card.id}
                                                    className={getStatementRowClassName(card)}
                                                >
                                                    <TableCell className="text-gray-700 font-medium text-sm py-1 text-left">
                                                        <div className="w-full font-bold" title={card.issuingBank || ''}>
                                                            {card.issuingBank}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        <div
                                                            className="w-full"
                                                            title={card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || '')}
                                                        >
                                                            {card.cardHolder === 'Suleman' ? 'MST' : card.cardHolder}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        <div className="w-full" title={card.card_number || ''}>
                                                            {card.card_number || ''}
                                                        </div>
                                                    </TableCell>
                                                
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        {formatDate(card.statement_date || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        {formatDate(card.due_date || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        {formatMonth(card.due_month || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 font-semibold text-sm py-1 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.totalPaymentDue}
                                                                onFocus={() => handleEditFieldFocus('totalPaymentDue')}
                                                                onChange={(e) => handleEditValueChange('totalPaymentDue', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.totalPaymentDue)
                                                        )}
                                                    </TableCell>
                                                    {showMinPaymentDue && (
                                                    <TableCell className="text-gray-700 font-semibold text-sm py-1 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.minPaymentDue}
                                                                onFocus={() => handleEditFieldFocus('minPaymentDue')}
                                                                onChange={(e) => handleEditValueChange('minPaymentDue', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.minPaymentDue)
                                                        )}
                                                    </TableCell>
                                                    )}
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.paid}
                                                                onFocus={() => handleEditFieldFocus('paid')}
                                                                onChange={(e) => handleEditValueChange('paid', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.paid)
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left">
                                                        {isEditingStatement(card) ? (
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                pattern="-?[0-9]*[.]?[0-9]*"
                                                                value={editValues!.epp}
                                                                onFocus={() => handleEditFieldFocus('epp')}
                                                                onChange={(e) => handleEditValueChange('epp', e.target.value)}
                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                            />
                                                        ) : (
                                                            formatCurrency(card.epp)
                                                        )}
                                                    </TableCell>
                                                
                                                    <TableCell className={`text-sm py-1 text-left font-semibold ${
                                                        amountPending > 0 ? 'text-red-600' : 'text-black'
                                                    }`}>
                                                        {/* amountPending is auto-calculated, so it's read-only */}
                                                        {formatCurrency(amountPending)}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left align-top px-2">
                                                        <StatementAttachmentTableCell
                                                            card={card}
                                                            isEditing={isEditingStatement(card)}
                                                            statementAttachmentFile={statementAttachmentFile}
                                                            attachmentInputRef={
                                                                isEditingStatement(card)
                                                                    ? attachmentInputRef
                                                                    : undefined
                                                            }
                                                            onAttachmentFileChange={
                                                                handleStatementAttachmentFileChange
                                                            }
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
                                                    <TableCell className="text-gray-700 text-sm py-1 text-left px-2">
                                                        {isEditingStatement(card) ? (
                                                            <div className="flex gap-2">
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        if (card.id) {
                                                                            void handleSave(String(card.id));
                                                                        }
                                                                    }}
                                                                    disabled={
                                                                        saving || deletingAttachment || !card.id
                                                                    }
                                                                    className="bg-green-500 hover:bg-green-600 text-white border-0"
                                                                >
                                                                    {saving ? (
                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                    ) : (
                                                                        <Check className="w-4 h-4" />
                                                                    )}
                                                                </Button>
                                                                <Button
                                                                    type="button"
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
                                                <TableCell colSpan={6} className="font-bold text-gray-900 py-1 text-right">
                                                    Total
                                                </TableCell>
                                                <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                    {formatCurrency(monthlyTotals.totalPaymentDue)}
                                                </TableCell>
                                                {showMinPaymentDue && (
                                                <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                    {formatCurrency(monthlyTotals.minPaymentDue)}
                                                </TableCell>
                                                )}
                                                <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                    {formatCurrency(monthlyTotals.paid)}
                                                </TableCell>
                                                <TableCell className="font-bold text-gray-900 py-1 text-left">
                                                    {formatCurrency(monthlyTotals.epp)}
                                                </TableCell>
                                                <TableCell
                                                    className={`font-bold py-1 text-left ${
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
                            </table>
                        </div>
                            }
                        >
                            {singleMonthLabel && (
                                <div className={STATEMENT_MONTH_BAR_CLASS}>
                                    <h3 className="text-lg font-bold text-black">{singleMonthLabel}</h3>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => toggleMinPaymentDueVisibility(singleMonthKey)}
                                        className="h-8 w-8 p-0 text-black hover:bg-black/10"
                                        aria-label={
                                            showMinPaymentDue
                                                ? 'Hide Min Payment Due column'
                                                : 'Show Min Payment Due column'
                                        }
                                        title={
                                            showMinPaymentDue
                                                ? 'Hide Min Payment Due'
                                                : 'Show Min Payment Due'
                                        }
                                    >
                                        {showMinPaymentDue ? (
                                            <Eye className="w-5 h-5" />
                                        ) : (
                                            <EyeOff className="w-5 h-5" />
                                        )}
                                    </Button>
                                </div>
                            )}
                            <table className={`${STATEMENT_TABLE_CLASS}${singleMonthLabel ? ' border-t-0' : ''}`}>
                                {renderStatementColGroup(showMinPaymentDue)}
                                <TableHeader>
                                    <TableRow className="bg-[#87CEEB] border-0 hover:bg-[#6bb8d9]">
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Issuing Bank
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Card Holder
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Card No
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Statement Date
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Due Date
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Due Month
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Total Payment Due
                                        </TableHead>
                                        {showMinPaymentDue && (
                                            <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                                Min Payment Due
                                            </TableHead>
                                        )}
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Paid
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            EPP
                                        </TableHead>
                                        <TableHead className={STATEMENT_COLUMN_HEAD_CELL_CLASS}>
                                            Amount Pending
                                        </TableHead>
                                        <TableHead className={`${STATEMENT_COLUMN_HEAD_CELL_CLASS} px-2`}>
                                            File
                                        </TableHead>
                                        {canMutate && (
                                            <TableHead className={`${STATEMENT_COLUMN_HEAD_CELL_CLASS} px-2`}>
                                                Actions
                                            </TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                            </table>
                        </PinnedStatementTableSection>
                    </CardContent>
                </Card>
                    );
                })()
            )}

        </Layout>
    );
}
