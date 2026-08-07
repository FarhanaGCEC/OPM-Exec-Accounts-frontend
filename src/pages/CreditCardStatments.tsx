import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
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
import { Calendar as CalendarIcon, Loader2, Pencil, ChevronUp, Check, X, Download, Eye, EyeOff, Plus } from 'lucide-react';
import { StatementAttachmentTableCell } from '../components/StatementAttachmentTableCell';
import {
    appendStatementAttachmentToChangePayload,
    creditCardService,
    displayCreditCardBankShortName,
    displayCreditCardHolderName,
    getDefaultStatementPeriod,
    statementPaymentsPayloadFromAmounts,
    statementPeriodMonthKey,
    validateStatementPdfFile,
    type CardStatementPayment,
    type CreditCardStatement,
    type StatementPartialPaymentEdit,
    type StatementPaymentPayload,
} from '../services/creditCardService';
import Calendar from '../components/ui/calendar-tailwind';
import {
    formatDateForApi,
    formatDisplayYear,
    formatIsoDateDisplay,
    formatJsDateDisplay,
    parseCalendarDateLocal,
} from '../lib/formatDisplayDate';
import { changeRequestService } from '../services/changeRequestService';
import type { ApiResponse } from '../lib/api';
import { userMessageFromChangeRequestSubmit } from '../lib/changeRequestUi';
import { isApprovalRequiredError } from '../lib/approvalError';
import { setAppSidebarOpen } from '../lib/sidebarControl';
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
import { moneyFromApi, parseMoneyInput, roundMoney, sumMoney } from '../lib/money';
import { mutationErrorMessage } from '../lib/changeRequestUi';
import {
    useRegisterStatementApprovalSubmit,
    useStatementApprovalModal,
    type StatementApprovalOffer,
} from '../context/StatementApprovalModalContext';

// Group statements by month
interface GroupedStatements {
    [monthKey: string]: CreditCardStatement[];
}

type ToastState = { type: 'error' | 'success'; message: string };

interface StatementTotals {
    totalPaymentDue: number;
    minPaymentDue: number;
    paid: number;
    epp: number;
    amountPending: number;
}

const STATEMENT_TABLE_CLASS =
    'cc-statement-table w-full text-[14px] sm:text-[15px] border-x border-b border-gray-200 [&_th]:whitespace-normal [&_td]:whitespace-nowrap [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_th]:text-[14px] sm:[&_th]:text-[15px] [&_td]:text-[14px] sm:[&_td]:text-[15px] [&_td]:leading-tight [&_th]:leading-tight [&_tbody_td]:align-middle';

const STATEMENT_MONTH_BAR_CLASS =
    'cc-statement-month-bar px-4 py-2 border-b border-gray-200 flex items-center justify-between';

const STATEMENT_COLUMN_HEAD_CELL_CLASS =
    'bg-[#87CEEB] font-semibold text-black text-sm text-left py-1 relative select-none overflow-visible';

const STATEMENT_FOOTER_ROW_CLASS =
    'bg-[#87CEEB] border-0 font-semibold hover:bg-[#87CEEB]';

const STATEMENT_FOOTER_CELL_CLASS =
    'bg-[#87CEEB] font-semibold text-sm py-1 text-black';

const STATEMENT_COLUMN_MIN_WIDTH_PX = 56;

type StatementColumnId =
    | 'card'
    | 'statementDate'
    | 'dueDate'
    | 'totalPaymentDue'
    | 'minPaymentDue'
    | 'paid'
    | 'epp'
    | 'amountPending'
    | 'file'
    | 'actions';

type StatementColumnWidths = Record<StatementColumnId, number>;

/** Relative weights — table stays full width; resize redistributes these. */
const DEFAULT_STATEMENT_COLUMN_WIDTHS_PX: StatementColumnWidths = {
    card: 180,
    statementDate: 110,
    dueDate: 110,
    totalPaymentDue: 140,
    minPaymentDue: 120,
    paid: 150,
    epp: 150,
    amountPending: 140,
    file: 56,
    actions: 64,
};

function getVisibleStatementColumnIds(showMinPaymentDue: boolean): StatementColumnId[] {
    return showMinPaymentDue
        ? [
              'card',
              'statementDate',
              'dueDate',
              'totalPaymentDue',
              'minPaymentDue',
              'paid',
              'epp',
              'amountPending',
              'file',
              'actions',
          ]
        : [
              'card',
              'statementDate',
              'dueDate',
              'totalPaymentDue',
              'paid',
              'epp',
              'amountPending',
              'file',
              'actions',
          ];
}

/** Statement identity line: holder short + bank short + last 4, e.g. "MST ENBD-EH 2427". */
function formatStatementCardIdentityLabel(
    cardHolder: string | undefined | null,
    cardNumber: string | undefined | null,
    issuingBank: string | undefined | null
): string {
    const holder = displayCreditCardHolderName(cardHolder);
    const bank = displayCreditCardBankShortName(issuingBank);
    const digits = String(cardNumber ?? '').replace(/\D/g, '');
    const last4 = digits.slice(-4);
    return [holder, bank, last4].filter(Boolean).join(' ');
}

/** Single-line Card Holder + Issuing Bank + last 4. */
function StatementCardIdentityCell({
    cardHolder,
    cardNumber,
    issuingBank,
}: {
    cardHolder: string | undefined | null;
    cardNumber: string | undefined | null;
    issuingBank: string | undefined | null;
}) {
    const label = formatStatementCardIdentityLabel(cardHolder, cardNumber, issuingBank);
    const fullBank = String(issuingBank ?? '').trim();
    const shortBank = displayCreditCardBankShortName(issuingBank);
    const title = [label, fullBank && fullBank !== shortBank ? fullBank : '']
        .filter(Boolean)
        .join(' · ');
    return (
        <div className="min-w-0 max-w-full leading-tight" title={title || undefined}>
            {label ? (
                <div className="truncate text-gray-700 !text-xs font-bold">{label}</div>
            ) : (
                <span className="text-gray-400">—</span>
            )}
        </div>
    );
}

function StatementColumnResizeHandle({
    columnId,
    onResizeStart,
}: {
    columnId: StatementColumnId;
    onResizeStart: (
        columnId: StatementColumnId,
        clientX: number,
        tableEl: HTMLTableElement | null
    ) => void;
}) {
    return (
        <span
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${columnId} column`}
            title="Drag to resize column"
            className="cc-statement-col-resize"
            onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const tableEl = (event.currentTarget as HTMLElement).closest(
                    'table'
                );
                onResizeStart(columnId, event.clientX, tableEl);
            }}
            onTouchStart={(event) => {
                if (event.touches.length !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                const tableEl = (event.currentTarget as HTMLElement).closest(
                    'table'
                );
                onResizeStart(columnId, event.touches[0].clientX, tableEl);
            }}
        />
    );
}

function renderStatementTableHeadRow(
    showMinPaymentDue: boolean,
    _canMutate: boolean,
    onColumnResizeStart: (
        columnId: StatementColumnId,
        clientX: number,
        tableEl: HTMLTableElement | null
    ) => void
) {
    const headers: { id: StatementColumnId; label: string; className?: string }[] = [
        { id: 'card', label: 'Card' },
        { id: 'statementDate', label: 'Statement Date' },
        { id: 'dueDate', label: 'Due Date' },
        { id: 'totalPaymentDue', label: 'Total Payment Due' },
    ];
    if (showMinPaymentDue) {
        headers.push({ id: 'minPaymentDue', label: 'Min Payment Due' });
    }
    headers.push(
        { id: 'paid', label: 'Paid' },
        { id: 'epp', label: 'EPP' },
        { id: 'amountPending', label: 'Amount Pending' },
        { id: 'file', label: 'File', className: 'px-2' },
        { id: 'actions', label: 'Actions', className: 'px-2' }
    );

    return (
        <TableRow className="bg-[#87CEEB] border-0 hover:bg-[#6bb8d9]">
            {headers.map((header) => (
                <TableHead
                    key={header.id}
                    className={`${STATEMENT_COLUMN_HEAD_CELL_CLASS}${
                        header.className ? ` ${header.className}` : ''
                    }`}
                >
                    {header.label}
                    <StatementColumnResizeHandle
                        columnId={header.id}
                        onResizeStart={onColumnResizeStart}
                    />
                </TableHead>
            ))}
        </TableRow>
    );
}

function StatementTableSection({
    monthBar,
    showMinPaymentDue,
    canMutate,
    renderColGroup,
    onColumnResizeStart,
    children,
}: {
    monthBar?: ReactNode;
    showMinPaymentDue: boolean;
    canMutate: boolean;
    renderColGroup: (showMinPaymentDue: boolean) => ReactNode;
    onColumnResizeStart: (
        columnId: StatementColumnId,
        clientX: number,
        tableEl: HTMLTableElement | null,
        showMinPaymentDue: boolean
    ) => void;
    children: ReactNode;
}) {
    return (
        <div className="cc-statement-table-section">
            {monthBar ? (
                <div className={`${STATEMENT_MONTH_BAR_CLASS} cc-statement-month-bar--sticky`}>
                    {monthBar}
                </div>
            ) : null}
            <table className={STATEMENT_TABLE_CLASS}>
                {renderColGroup(showMinPaymentDue)}
                <TableHeader className="cc-statement-thead--sticky">
                    {renderStatementTableHeadRow(
                        showMinPaymentDue,
                        canMutate,
                        (columnId, clientX, tableEl) =>
                            onColumnResizeStart(
                                columnId,
                                clientX,
                                tableEl,
                                showMinPaymentDue
                            )
                    )}
                </TableHeader>
                <TableBody>{children}</TableBody>
            </table>
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
        payments: StatementPartialPaymentEdit[];
        eppPayments: StatementPartialPaymentEdit[];
    } | null>(null);
    /** Which partial payment date popover is open: `payments-0` / `eppPayments-1`. */
    const [openPartialDateKey, setOpenPartialDateKey] = useState<string | null>(null);
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
    const [toast, setToast] = useState<ToastState | null>(null);
    const successBannerRef = useRef<HTMLDivElement>(null);
    const monthSectionRefs = useRef<Partial<Record<string, HTMLDivElement>>>({});
    const [columnWidths, setColumnWidths] = useState<StatementColumnWidths>(
        () => ({ ...DEFAULT_STATEMENT_COLUMN_WIDTHS_PX })
    );
    const columnResizeRef = useRef<{
        columnId: StatementColumnId;
        nextColumnId: StatementColumnId;
        startX: number;
        startWidth: number;
        startNextWidth: number;
        tableWidthPx: number;
        totalWeight: number;
    } | null>(null);
    const didScrollToSecondMonthOnLoad = useRef(false);

    const resetStatementTableScroll = () => {
        document.querySelectorAll('.cc-statement-table-section').forEach((section) => {
            section.scrollLeft = 0;
        });
    };

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
        payments:
            responseData.payments !== undefined ? responseData.payments : card.payments,
        epp:
            responseData.epp !== undefined && responseData.epp !== null
                ? Number(responseData.epp)
                : card.epp,
        eppPayments:
            responseData.eppPayments !== undefined ? responseData.eppPayments : card.eppPayments,
        amountPending:
            responseData.amountPending !== undefined && responseData.amountPending !== null
                ? Number(responseData.amountPending)
                : card.amountPending,
        creditBalance:
            responseData.creditBalance !== undefined && responseData.creditBalance !== null
                ? Number(responseData.creditBalance)
                : card.creditBalance,
        availableLimit:
            responseData.availableLimit !== undefined
                ? responseData.availableLimit
                : card.availableLimit,
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
        // Card, dates, amounts, pending, file, actions (+ optional min due)
        return showMinPaymentDue ? 10 : 9;
    };

    const handleColumnResizeStart = useCallback(
        (
            columnId: StatementColumnId,
            clientX: number,
            tableEl: HTMLTableElement | null,
            showMinPaymentDue: boolean
        ) => {
            const columnIds = getVisibleStatementColumnIds(showMinPaymentDue);
            const index = columnIds.indexOf(columnId);
            if (index < 0) return;
            const nextColumnId =
                index < columnIds.length - 1
                    ? columnIds[index + 1]
                    : columnIds[index - 1];
            if (!nextColumnId || nextColumnId === columnId) return;

            const tableWidthPx = tableEl?.getBoundingClientRect().width || 1;
            const totalWeight = columnIds.reduce(
                (sum, id) => sum + columnWidths[id],
                0
            );

            columnResizeRef.current = {
                columnId,
                nextColumnId,
                startX: clientX,
                startWidth: columnWidths[columnId],
                startNextWidth: columnWidths[nextColumnId],
                tableWidthPx,
                totalWeight,
            };
            document.body.classList.add('cc-statement-col-resizing');
        },
        [columnWidths]
    );

    useEffect(() => {
        const applyResizeDelta = (clientX: number) => {
            const active = columnResizeRef.current;
            if (!active) return;
            const deltaPx = clientX - active.startX;
            const weightDelta =
                (deltaPx / active.tableWidthPx) * active.totalWeight;
            const minWeight = STATEMENT_COLUMN_MIN_WIDTH_PX;
            let nextWidth = active.startWidth + weightDelta;
            let nextNeighbor = active.startNextWidth - weightDelta;

            if (nextWidth < minWeight) {
                nextNeighbor -= minWeight - nextWidth;
                nextWidth = minWeight;
            }
            if (nextNeighbor < minWeight) {
                nextWidth -= minWeight - nextNeighbor;
                nextNeighbor = minWeight;
            }
            nextWidth = Math.max(minWeight, Math.round(nextWidth));
            nextNeighbor = Math.max(minWeight, Math.round(nextNeighbor));

            setColumnWidths((prev) => {
                if (
                    prev[active.columnId] === nextWidth &&
                    prev[active.nextColumnId] === nextNeighbor
                ) {
                    return prev;
                }
                return {
                    ...prev,
                    [active.columnId]: nextWidth,
                    [active.nextColumnId]: nextNeighbor,
                };
            });
        };

        const onMouseMove = (event: MouseEvent) => {
            applyResizeDelta(event.clientX);
        };

        const onTouchMove = (event: TouchEvent) => {
            if (event.touches.length !== 1) return;
            event.preventDefault();
            applyResizeDelta(event.touches[0].clientX);
        };

        const endResize = () => {
            if (!columnResizeRef.current) return;
            columnResizeRef.current = null;
            document.body.classList.remove('cc-statement-col-resizing');
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', endResize);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', endResize);
        document.addEventListener('touchcancel', endResize);
        window.addEventListener('blur', endResize);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', endResize);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', endResize);
            document.removeEventListener('touchcancel', endResize);
            window.removeEventListener('blur', endResize);
            document.body.classList.remove('cc-statement-col-resizing');
        };
    }, []);

    const renderStatementColGroup = (showMinPaymentDue: boolean) => {
        const columnIds = getVisibleStatementColumnIds(showMinPaymentDue);
        const total = columnIds.reduce((sum, id) => sum + columnWidths[id], 0);
        return (
            <colgroup>
                {columnIds.map((columnId) => (
                    <col
                        key={columnId}
                        style={{
                            width: `${((columnWidths[columnId] / total) * 100).toFixed(4)}%`,
                        }}
                    />
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

    const formatPaymentRowDate = (paidAt: string | null | undefined): string => {
        if (!paidAt) return '—';
        const d = formatIsoDateDisplay(paidAt);
        return d === '—' ? String(paidAt) : d;
    };

    /** Resolve payment / EPP lines for accordion / edit (same synthesize rules). */
    const getStatementPaymentDetailRows = (
        rows: CreditCardStatement['payments'],
        total: number
    ): CardStatementPayment[] => {
        if (rows && rows.length > 0) return rows;
        const amount = moneyFromApi(total);
        if (amount > 0) {
            return [{ id: null, amount, paidAt: null, note: null, sortOrder: 0 }];
        }
        return [];
    };

    /** Multiple payment/EPP lines = partial breakdown → accordion always expanded. */
    const isPartialPaymentBreakdown = (rowCount: number): boolean => rowCount > 1;

    const renderPartialAmountsView = (
        card: CreditCardStatement,
        field: 'payments' | 'eppPayments',
        _periodKey?: string
    ) => {
        const total = field === 'payments' ? card.paid : card.epp;
        const rows = getStatementPaymentDetailRows(
            field === 'payments' ? card.payments : card.eppPayments,
            total
        );
        const totalMoney = moneyFromApi(total);

        // 0 or 1 line = not partial breakdown → plain total, no accordion
        if (!isPartialPaymentBreakdown(rows.length)) {
            return (
                <span className=" tabular-nums">{formatCurrency(totalMoney)}</span>
            );
        }

        return (
            <div className="min-w-[10rem] max-w-[14rem]">
                <div className="space-y-1 rounded-md border border-gray-200 bg-white/80 px-2 py-1.5">
                    {rows.map((row, index) => (
                        <div
                            key={row.id ?? `${field}-${index}`}
                            className="flex items-baseline justify-between gap-2 text-xs"
                        >
                            <span className="shrink-0 text-xs text-gray-600">
                                {formatPaymentRowDate(row.paidAt)}
                            </span>
                            <span className="tabular-nums font-medium text-gray-900 text-right">
                                {formatCurrency(moneyFromApi(row.amount))}
                            </span>
                        </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-2 border-t border-gray-100 pt-1 text-xs font-bold text-gray-900">
                        <span>Total</span>
                        <span className="tabular-nums font-bold">{formatCurrency(totalMoney)}</span>
                    </div>
                </div>
            </div>
        );
    };

    const renderStatementActionsCell = (
        card: CreditCardStatement,
        periodKey?: string
    ) => {
        const editing = isEditingStatement(card, periodKey);
        return (
            <TableCell
                className={`text-gray-700 text-sm py-1 text-left px-2${
                    editing ? ' align-top' : ''
                }`}
            >
                {editing ? (
                    <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (card.id) {
                                    void handleSave(String(card.id), periodKey);
                                }
                            }}
                            disabled={saving || deletingAttachment || !card.id}
                            className="h-8 w-8 p-0 shrink-0 bg-green-500 hover:bg-green-600 text-white border-0"
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
                            className="h-8 w-8 p-0 shrink-0 bg-red-500 hover:bg-red-600 text-white border-0"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                ) : canMutate ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (card.id) {
                                handleEdit(card, periodKey);
                            }
                        }}
                        disabled={!card.id}
                        className="h-8 w-8 p-0 text-black hover:bg-[#f7c46d]/40"
                        title="Edit statement"
                        aria-label="Edit statement"
                    >
                        <Pencil className="w-4 h-4 text-black" />
                    </Button>
                ) : (
                    <span className="text-gray-300">—</span>
                )}
            </TableCell>
        );
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

    type PartialAmountField = 'payments' | 'eppPayments';

    const toEditablePaidAtField = (paidAt: string | null | undefined): string => {
        if (!paidAt) return '';
        const formatted = formatIsoDateDisplay(paidAt);
        return formatted === '—' ? '' : formatted;
    };

    const partialAmountsToEditableRows = (
        rows: CreditCardStatement['payments'],
        total: number
    ): StatementPartialPaymentEdit[] => {
        if (rows && rows.length > 0) {
            return rows.map((p) => ({
                amount: toEditableMoneyFieldValue(p.amount),
                paidAt: toEditablePaidAtField(p.paidAt),
            }));
        }
        if (moneyFromApi(total) > 0) {
            return [{ amount: toEditableMoneyFieldValue(total), paidAt: '' }];
        }
        return [{ amount: '', paidAt: '' }];
    };

    const paymentsToEditableRows = (card: CreditCardStatement): StatementPartialPaymentEdit[] =>
        partialAmountsToEditableRows(card.payments, card.paid);

    const eppPaymentsToEditableRows = (card: CreditCardStatement): StatementPartialPaymentEdit[] =>
        partialAmountsToEditableRows(card.eppPayments, card.epp);

    const partialAmountsEditTotal = (rows: StatementPartialPaymentEdit[]): number =>
        sumMoney(
            rows
                .filter((r) => r.amount !== '' && r.amount != null)
                .map((r) => parseMoneyInput(r.amount))
        );

    const partialAmountsEditMatchesCard = (
        rows: CreditCardStatement['payments'],
        total: number,
        edited: StatementPartialPaymentEdit[]
    ): boolean => {
        const existing =
            rows && rows.length > 0
                ? rows.map((p) => ({
                      amount: moneyFromApi(p.amount),
                      paidAt: p.paidAt ? formatDateForApi(p.paidAt) : '',
                  }))
                : moneyFromApi(total) > 0
                  ? [{ amount: moneyFromApi(total), paidAt: '' }]
                  : [];
        const payload = statementPaymentsPayloadFromAmounts(edited).map((p) => ({
            amount: p.amount,
            paidAt: p.paid_at ?? '',
        }));
        if (existing.length !== payload.length) return false;
        return existing.every(
            (v, i) => v.amount === payload[i].amount && v.paidAt === payload[i].paidAt
        );
    };

    const paymentsEditMatchesCard = (
        card: CreditCardStatement,
        amounts: StatementPartialPaymentEdit[]
    ): boolean => partialAmountsEditMatchesCard(card.payments, card.paid, amounts);

    const eppPaymentsEditMatchesCard = (
        card: CreditCardStatement,
        amounts: StatementPartialPaymentEdit[]
    ): boolean => partialAmountsEditMatchesCard(card.eppPayments, card.epp, amounts);

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
        setMinPaymentDueVisibleByMonth((prev) => ({
            ...prev,
            [getMinPaymentDueMonthKey(periodKey)]: true,
        }));
        pendingApprovalAttachmentRef.current = null;
        setStatementAttachmentFile(null);
        setEditValues({
            totalPaymentDue: toEditableMoneyFieldValue(card.totalPaymentDue),
            minPaymentDue: toEditableMoneyFieldValue(card.minPaymentDue),
            payments: paymentsToEditableRows(card),
            eppPayments: eppPaymentsToEditableRows(card),
        });
        setOpenPartialDateKey(null);
        setAppSidebarOpen(false);
    }, []);

    const exitStatementEditMode = () => {
        setEditingId(null);
        setEditingMonthKey(null);
        setEditValues(null);
        setStatementAttachmentFile(null);
        setOpenPartialDateKey(null);
        resetStatementTableScroll();
        setAppSidebarOpen(true);
    };

    const handleCancelEdit = () => {
        pendingApprovalAttachmentRef.current = null;
        exitStatementEditMode();
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

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), 4500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const showToast = useCallback((type: ToastState['type'], message: string) => {
        setToast({ type, message });
    }, []);

    const reportSaveError = useCallback(
        (message: string) => {
            setError(message);
            showToast('error', message);
        },
        [showToast]
    );

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
        values: {
            totalPaymentDue: string;
            minPaymentDue: string;
            payments: StatementPartialPaymentEdit[];
            eppPayments: StatementPartialPaymentEdit[];
        }
    ): boolean =>
        parseMoneyInput(values.totalPaymentDue) === moneyFromApi(card.totalPaymentDue) &&
        parseMoneyInput(values.minPaymentDue) === moneyFromApi(card.minPaymentDue) &&
        paymentsEditMatchesCard(card, values.payments) &&
        eppPaymentsEditMatchesCard(card, values.eppPayments);

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
        payments: StatementPaymentPayload[];
        epp: number;
        eppPayments: StatementPaymentPayload[];
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
            payments: opts.payments,
            paid_amount: opts.paid,
            epp_payments: opts.eppPayments,
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
            exitStatementEditMode();
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
            reportSaveError('Invalid card ID');
            return;
        }

        const bucketKey = periodKey ?? editingMonthKey;
        const monthParam = resolveStatementMonthParam(bucketKey);
        const updateBucketKey = bucketKey ?? monthParam;
        const totalPaymentDue = parseMoneyInput(editValues.totalPaymentDue);
        const minPaymentDue = parseMoneyInput(editValues.minPaymentDue);
        const paymentPayload = statementPaymentsPayloadFromAmounts(editValues.payments);
        const paid = partialAmountsEditTotal(editValues.payments);
        const eppPaymentPayload = statementPaymentsPayloadFromAmounts(editValues.eppPayments);
        const epp = partialAmountsEditTotal(editValues.eppPayments);
        const card = findStatementCard(validCardId, bucketKey);
        const amountsUnchanged = card ? statementAmountsUnchanged(card, editValues) : false;
        const newAttachment = getPendingStatementAttachment();

        if (newAttachment) {
            const fileErr = validateStatementPdfFile(newAttachment);
            if (fileErr) {
                reportSaveError(fileErr);
                return;
            }
        } else if (amountsUnchanged) {
            reportSaveError('No changes to save');
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
                payments: paymentPayload,
                epp,
                eppPayments: eppPaymentPayload,
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
                        reportSaveError(uploadRes.message || 'Failed to upload statement PDF');
                        return;
                    }
                    applySavedStatementToState(uploadRes.data, validCardId, updateBucketKey);
                    exitStatementEditMode();
                    return;
                } catch (uploadErr: unknown) {
                    if (isApprovalRequiredError(uploadErr) && !canSaveStatementsDirectly()) {
                        openStatementApprovalOffer({
                            resourceId: validCardId,
                            statementMonth: monthParam,
                            totalPaymentDue,
                            minPaymentDue,
                            paid,
                            payments: paymentPayload,
                            epp,
                            eppPayments: eppPaymentPayload,
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
                {
                    totalPaymentDue,
                    minPaymentDue,
                    payments: paymentPayload,
                    eppPayments: eppPaymentPayload,
                },
                monthParam
            );

            if (!patchRes.success || !patchRes.data) {
                reportSaveError(patchRes.message || 'Failed to update statement');
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
                    reportSaveError(
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
            exitStatementEditMode();
        } catch (err: unknown) {
            console.error('Error updating statement:', err);
            if (isApprovalRequiredError(err) && editValues && !canSaveStatementsDirectly()) {
                openStatementApprovalOffer({
                    resourceId: validCardId,
                    statementMonth: monthParam,
                    totalPaymentDue,
                    minPaymentDue,
                    paid,
                    payments: paymentPayload,
                    epp,
                    eppPayments: eppPaymentPayload,
                    attachmentFile: newAttachment ?? null,
                    amountsUnchanged,
                });
            } else {
                reportSaveError(mutationErrorMessage(err) || 'Failed to update statement');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleEditFieldFocus = (field: 'totalPaymentDue' | 'minPaymentDue') => {
        if (!editValues) return;
        if (isLoneZeroEditString(editValues[field])) {
            setEditValues({ ...editValues, [field]: '' });
        }
    };

    const handleEditValueChange = (field: 'totalPaymentDue' | 'minPaymentDue', value: string) => {
        if (!editValues) return;
        setEditValues({
            ...editValues,
            [field]: normalizeEditFieldWhileTyping(editValues[field], value),
        });
    };

    const handlePartialAmountFocus = (field: PartialAmountField, index: number) => {
        if (!editValues) return;
        if (isLoneZeroEditString(editValues[field][index].amount)) {
            const rows = [...editValues[field]];
            rows[index] = { ...rows[index], amount: '' };
            setEditValues({ ...editValues, [field]: rows });
        }
    };

    const handlePartialAmountChange = (
        field: PartialAmountField,
        index: number,
        value: string
    ) => {
        if (!editValues) return;
        const rows = [...editValues[field]];
        rows[index] = {
            ...rows[index],
            amount: normalizeEditFieldWhileTyping(rows[index].amount, value),
        };
        setEditValues({ ...editValues, [field]: rows });
    };

    const handlePartialPaidAtChange = (
        field: PartialAmountField,
        index: number,
        value: string
    ) => {
        if (!editValues) return;
        const rows = [...editValues[field]];
        rows[index] = { ...rows[index], paidAt: value };
        setEditValues({ ...editValues, [field]: rows });
    };

    const handlePartialPaidAtSelect = (
        field: PartialAmountField,
        index: number,
        date: Date | null
    ) => {
        if (!editValues || !date) return;
        const rows = [...editValues[field]];
        rows[index] = { ...rows[index], paidAt: formatJsDateDisplay(date) };
        setEditValues({ ...editValues, [field]: rows });
        setOpenPartialDateKey(null);
    };

    const addPartialAmountLine = (field: PartialAmountField) => {
        if (!editValues) return;
        setEditValues({
            ...editValues,
            [field]: [...editValues[field], { amount: '', paidAt: '' }],
        });
    };

    const removePartialAmountLine = (field: PartialAmountField, index: number) => {
        if (!editValues) return;
        const rows = editValues[field].filter((_, i) => i !== index);
        setEditValues({
            ...editValues,
            [field]: rows.length > 0 ? rows : [{ amount: '', paidAt: '' }],
        });
        setOpenPartialDateKey(null);
    };

    const calendarDefaultMonthFromPeriod = (periodKey?: string | null): Date => {
        const key =
            periodKey ||
            editingMonthKey ||
            (selectedMonths.length > 0
                ? statementPeriodMonthKey(selectedYear, selectedMonths[0], selectedMonths)
                : null);
        if (key) {
            const [yStr, mStr] = key.split('-');
            const y = Number(yStr);
            const m = Number(mStr);
            if (!Number.isNaN(y) && !Number.isNaN(m) && m >= 1 && m <= 12) {
                return new Date(y, m - 1, 1);
            }
        }
        return new Date(
            selectedYear,
            selectedMonths.length > 0 ? selectedMonths[0] : new Date().getMonth(),
            1
        );
    };

    const renderPartialAmountsEdit = (
        field: PartialAmountField,
        addLabel: string,
        removeAriaLabel: string,
        periodKey?: string | null
    ) => {
        if (!editValues) return null;
        const rows = editValues[field];
        const total = partialAmountsEditTotal(rows);
        const calendarDefaultMonth = calendarDefaultMonthFromPeriod(periodKey);
        return (
            <div className="flex w-full min-w-[11.5rem] flex-col gap-1.5 box-border">
                {rows.map((row, index) => {
                    const dateKey = `${field}-${index}`;
                    const selectedDate = row.paidAt
                        ? parseCalendarDateLocal(row.paidAt)
                        : null;
                    const isDateOpen = openPartialDateKey === dateKey;
                    return (
                        <div key={index} className="flex w-full items-center gap-1">
                            <Popover
                                open={isDateOpen}
                                onOpenChange={(open) =>
                                    setOpenPartialDateKey(open ? dateKey : null)
                                }
                            >
                                <div className="relative min-w-0 flex-1">
                                    <input
                                        type="text"
                                        placeholder="Date"
                                        value={row.paidAt}
                                        onChange={(e) =>
                                            handlePartialPaidAtChange(
                                                field,
                                                index,
                                                e.target.value.slice(0, 11)
                                            )
                                        }
                                        maxLength={11}
                                        className="w-full min-w-0 px-1.5 py-1 pr-6 border border-gray-300 rounded text-xs !text-xs"
                                        aria-label="Payment date"
                                    />
                                    <PopoverTrigger asChild>
                                        <button
                                            type="button"
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                            aria-label="Open calendar"
                                        >
                                            <CalendarIcon className="w-3.5 h-3.5" />
                                        </button>
                                    </PopoverTrigger>
                                </div>
                                <PopoverContent
                                    className="w-auto p-0"
                                    align="start"
                                    side="bottom"
                                    sideOffset={6}
                                    collisionPadding={16}
                                >
                                    {isDateOpen ? (
                                        <Calendar
                                            key={`${dateKey}-${calendarDefaultMonth.getFullYear()}-${calendarDefaultMonth.getMonth()}`}
                                            date={selectedDate}
                                            defaultMonth={calendarDefaultMonth}
                                            onSelect={(date) =>
                                                handlePartialPaidAtSelect(field, index, date)
                                            }
                                        />
                                    ) : null}
                                </PopoverContent>
                            </Popover>
                            <input
                                type="text"
                                inputMode="decimal"
                                pattern="-?[0-9]*[.]?[0-9]*"
                                value={row.amount}
                                onFocus={() => handlePartialAmountFocus(field, index)}
                                onChange={(e) =>
                                    handlePartialAmountChange(field, index, e.target.value)
                                }
                                placeholder="Amount"
                                className="w-[42%] min-w-0 shrink px-1.5 py-1 border border-gray-300 rounded text-sm"
                                aria-label="Amount"
                            />
                            {rows.length > 1 ? (
                                <button
                                    type="button"
                                    onClick={() => removePartialAmountLine(field, index)}
                                    className="shrink-0 p-0.5 text-gray-400 hover:text-red-600"
                                    aria-label={removeAriaLabel}
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            ) : null}
                        </div>
                    );
                })}
                <button
                    type="button"
                    onClick={() => addPartialAmountLine(field)}
                    className="flex items-center gap-0.5 self-start text-xs text-blue-600 hover:text-blue-800"
                >
                    <Plus className="w-3 h-3" />
                    {addLabel}
                </button>
                <div className="text-xs text-gray-900 font-bold whitespace-nowrap border-t border-gray-100 pt-1">
                    Total: {formatCurrency(total)}
                </div>
            </div>
        );
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
                        'Card Holder',
                        'Issuing Bank',
                        'Statement Date',
                        'Due Date',
                        'Total Payment Due',
                        'Paid',
                        'EPP',
                        'Amount Pending',
                        'Attachment',
                    ]);

                    // Add statement rows
                    statements.forEach((card) => {
                        excelData.push([
                            formatStatementCardIdentityLabel(
                                card.cardHolder,
                                card.card_number,
                                card.issuingBank
                            ),
                            displayCreditCardBankShortName(card.issuingBank) || '',
                            formatDate(card.statement_date || ''),
                            formatDate(card.due_date || ''),
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
                        { wch: 28 }, // Card Holder
                        { wch: 14 }, // Issuing Bank
                        { wch: 15 }, // Statement Date
                        { wch: 15 }, // Due Date
                        { wch: 18 }, // Total Payment Due
                        { wch: 15 }, // Paid
                        { wch: 15 }, // EPP
                        { wch: 18 }, // Amount Pending
                        { wch: 28 }, // Attachment
                    ];

                    // Format header row (row 2, 0-indexed)
                    const headerRow = 2;
                    for (let col = 0; col <= 8; col++) {
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
                        // Column E (Total Payment Due) - index 4
                        const totalDueCellRef = XLSX.utils.encode_cell({ r: row, c: 4 });
                        if (worksheet[totalDueCellRef] && typeof worksheet[totalDueCellRef].v === 'number') {
                            worksheet[totalDueCellRef].t = 'n';
                            worksheet[totalDueCellRef].z = '#,##0.00';
                        }
                        // Column F (Paid) - index 5
                        const paidCellRef = XLSX.utils.encode_cell({ r: row, c: 5 });
                        if (worksheet[paidCellRef] && typeof worksheet[paidCellRef].v === 'number') {
                            worksheet[paidCellRef].t = 'n';
                            worksheet[paidCellRef].z = '#,##0.00';
                        }
                        // Column G (EPP) - index 6
                        const eppCellRef = XLSX.utils.encode_cell({ r: row, c: 6 });
                        if (worksheet[eppCellRef] && typeof worksheet[eppCellRef].v === 'number') {
                            worksheet[eppCellRef].t = 'n';
                            worksheet[eppCellRef].z = '#,##0.00';
                        }
                        // Column H (Amount Pending) - index 7
                        const pendingCellRef = XLSX.utils.encode_cell({ r: row, c: 7 });
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
                'Card Holder',
                'Issuing Bank',
                'Statement Date',
                'Due Date',
                'Total Payment Due',
                'Paid',
                'EPP',
                'Amount Pending',
                'Attachment',
            ]);

            // Add statement rows
            creditCards.forEach((card) => {
                excelData.push([
                    formatStatementCardIdentityLabel(
                        card.cardHolder,
                        card.card_number,
                        card.issuingBank
                    ),
                    displayCreditCardBankShortName(card.issuingBank) || '',
                    formatDate(card.statement_date || ''),
                    formatDate(card.due_date || ''),
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
                { wch: 28 }, // Card Holder
                { wch: 14 }, // Issuing Bank
                { wch: 15 }, // Statement Date
                { wch: 15 }, // Due Date
                { wch: 18 }, // Total Payment Due
                { wch: 15 }, // Paid
                { wch: 15 }, // EPP
                { wch: 18 }, // Amount Pending
                { wch: 28 }, // Attachment
            ];

            // Format header row (row 2, 0-indexed)
            const headerRow = 2;
            for (let col = 0; col <= 8; col++) {
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
                // Column E (Total Payment Due) - index 4
                const totalDueCellRef = XLSX.utils.encode_cell({ r: row, c: 4 });
                if (worksheet[totalDueCellRef] && typeof worksheet[totalDueCellRef].v === 'number') {
                    worksheet[totalDueCellRef].t = 'n';
                    worksheet[totalDueCellRef].z = '#,##0.00';
                }
                // Column F (Paid) - index 5
                const paidCellRef = XLSX.utils.encode_cell({ r: row, c: 5 });
                if (worksheet[paidCellRef] && typeof worksheet[paidCellRef].v === 'number') {
                    worksheet[paidCellRef].t = 'n';
                    worksheet[paidCellRef].z = '#,##0.00';
                }
                // Column G (EPP) - index 6
                const eppCellRef = XLSX.utils.encode_cell({ r: row, c: 6 });
                if (worksheet[eppCellRef] && typeof worksheet[eppCellRef].v === 'number') {
                    worksheet[eppCellRef].t = 'n';
                    worksheet[eppCellRef].z = '#,##0.00';
                }
                // Column H (Amount Pending) - index 7
                const pendingCellRef = XLSX.utils.encode_cell({ r: row, c: 7 });
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
                        className="bg-white hover:bg-[#f7c46d] text-black border-0 flex items-center gap-2 "
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
                                    <span className=" text-black">{formatSelectedPeriod()}</span>
                                </div>
                            </div>

                            {/* Year Selection */}
                            <div>
                                <div className="text-sm  text-gray-700 mb-2">Select Year</div>
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
                                <div className="text-sm  text-gray-700 mb-2">Select Month</div>
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
                                    <StatementTableSection
                                        showMinPaymentDue={showMinPaymentDue}
                                        canMutate={canMutate}
                                        renderColGroup={renderStatementColGroup}
                                        onColumnResizeStart={handleColumnResizeStart}
                                        monthBar={
                                            <>
                                                <h3 className="text-lg font-semibold text-black">
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
                                            </>
                                        }
                                    >
                                                {statements.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={getStatementTableColSpan(showMinPaymentDue)} className="text-center py-4">
                                                            <p className="text-sm font-bold text-gray-500">No statements found for {monthName} {year}.</p>
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
                                                                    <TableCell className="!text-xs text-gray-700 py-1 text-left !whitespace-normal overflow-hidden">
                                                                        <StatementCardIdentityCell
                                                                            cardHolder={card.cardHolder}
                                                                            cardNumber={card.card_number}
                                                                            issuingBank={card.issuingBank}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="!text-xs text-gray-700 py-1 text-left tabular-nums">
                                                                        {formatDate(card.statement_date || '')}
                                                                    </TableCell>
                                                                    <TableCell className="!text-xs text-gray-700 py-1 text-left tabular-nums">
                                                                        {formatDate(card.due_date || '')}
                                                                    </TableCell>
                                                                    <TableCell className="text-gray-700  text-sm py-1 text-left">
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
                                                                    <TableCell className="text-gray-700  text-sm py-1 text-left">
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
                                                                    <TableCell
                                                                        className={`text-gray-700 text-sm py-1 text-left${
                                                                            isEditingStatement(card, monthKey)
                                                                                ? ' align-top !whitespace-normal overflow-hidden'
                                                                                : ' align-top !whitespace-normal'
                                                                        }`}
                                                                    >
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            renderPartialAmountsEdit(
                                                                                'payments',
                                                                                'Add payment',
                                                                                'Remove payment',
                                                                                monthKey
                                                                            )
                                                                        ) : (
                                                                            renderPartialAmountsView(
                                                                                card,
                                                                                'payments',
                                                                                monthKey
                                                                            )
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell
                                                                        className={`text-gray-700 text-sm py-1 text-left${
                                                                            isEditingStatement(card, monthKey)
                                                                                ? ' align-top !whitespace-normal overflow-hidden'
                                                                                : ' align-top !whitespace-normal'
                                                                        }`}
                                                                    >
                                                                        {isEditingStatement(card, monthKey) ? (
                                                                            renderPartialAmountsEdit(
                                                                                'eppPayments',
                                                                                'Add EPP',
                                                                                'Remove EPP payment',
                                                                                monthKey
                                                                            )
                                                                        ) : (
                                                                            renderPartialAmountsView(
                                                                                card,
                                                                                'eppPayments',
                                                                                monthKey
                                                                            )
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className={`text-sm font-bold py-1 text-left  ${
                                                                        amountPending > 0 ? 'text-red-600' : 'text-black'
                                                                    }`}>
                                                                        {formatCurrency(amountPending)}
                                                                    </TableCell>
                                                                    <TableCell
                                                                        className={`text-gray-700 text-sm py-1 text-left px-2${
                                                                            isEditingStatement(card, monthKey)
                                                                                ? ' align-top !whitespace-normal !overflow-visible'
                                                                                : ''
                                                                        }`}
                                                                    >
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
                                                                    {renderStatementActionsCell(card, monthKey)}
                                                                </TableRow>
                                                            );
                                                        })}
                                                        <TableRow className={STATEMENT_FOOTER_ROW_CLASS}>
                                                            <TableCell colSpan={3} className={`${STATEMENT_FOOTER_CELL_CLASS} text-right`}>
                                                                Total
                                                            </TableCell>
                                                            <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                                {formatCurrency(monthlyTotals.totalPaymentDue)}
                                                            </TableCell>
                                                            {showMinPaymentDue && (
                                                            <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                                {formatCurrency(monthlyTotals.minPaymentDue)}
                                                            </TableCell>
                                                            )}
                                                            <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                                {formatCurrency(monthlyTotals.paid)}
                                                            </TableCell>
                                                            <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                                {formatCurrency(monthlyTotals.epp)}
                                                            </TableCell>
                                                            <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                                {formatCurrency(monthlyTotals.amountPending)}
                                                            </TableCell>
                                                            <TableCell colSpan={2} className={STATEMENT_FOOTER_CELL_CLASS} />
                                                        </TableRow>
                                                    </>
                                                )}
                                    </StatementTableSection>
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
                        <StatementTableSection
                            showMinPaymentDue={showMinPaymentDue}
                            canMutate={canMutate}
                            renderColGroup={renderStatementColGroup}
                            onColumnResizeStart={handleColumnResizeStart}
                            monthBar={
                                singleMonthLabel ? (
                                    <>
                                        <h3 className="text-lg font-semibold text-black">{singleMonthLabel}</h3>
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
                                    </>
                                ) : undefined
                            }
                        >
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
                                                    <TableCell className="!text-xs text-gray-700 py-1 text-left !whitespace-normal overflow-hidden">
                                                        <StatementCardIdentityCell
                                                            cardHolder={card.cardHolder}
                                                            cardNumber={card.card_number}
                                                            issuingBank={card.issuingBank}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="!text-xs text-gray-700 py-1 text-left tabular-nums">
                                                        {formatDate(card.statement_date || '')}
                                                    </TableCell>
                                                    <TableCell className="!text-xs text-gray-700 py-1 text-left tabular-nums">
                                                        {formatDate(card.due_date || '')}
                                                    </TableCell>
                                                    <TableCell className="text-gray-700  text-sm py-1 text-left">
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
                                                    <TableCell className="text-gray-700  text-sm py-1 text-left">
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
                                                    <TableCell
                                                        className={`text-gray-700 text-sm py-1 text-left${
                                                            isEditingStatement(card)
                                                                ? ' align-top !whitespace-normal overflow-hidden'
                                                                : ' align-top !whitespace-normal'
                                                        }`}
                                                    >
                                                        {isEditingStatement(card) ? (
                                                            renderPartialAmountsEdit(
                                                                'payments',
                                                                'Add payment',
                                                                'Remove payment',
                                                                singleMonthKey
                                                            )
                                                        ) : (
                                                            renderPartialAmountsView(
                                                                card,
                                                                'payments',
                                                                singleMonthKey
                                                            )
                                                        )}
                                                    </TableCell>
                                                    <TableCell
                                                        className={`text-gray-700 text-sm py-1 text-left${
                                                            isEditingStatement(card)
                                                                ? ' align-top !whitespace-normal overflow-hidden'
                                                                : ' align-top !whitespace-normal'
                                                        }`}
                                                    >
                                                        {isEditingStatement(card) ? (
                                                            renderPartialAmountsEdit(
                                                                'eppPayments',
                                                                'Add EPP',
                                                                'Remove EPP payment',
                                                                singleMonthKey
                                                            )
                                                        ) : (
                                                            renderPartialAmountsView(
                                                                card,
                                                                'eppPayments',
                                                                singleMonthKey
                                                            )
                                                        )}
                                                    </TableCell>
                                                
                                                    <TableCell className={`text-sm font-bold py-1 text-left  ${
                                                        amountPending > 0 ? 'text-red-600' : 'text-black'
                                                    }`}>
                                                        {/* amountPending is auto-calculated, so it's read-only */}
                                                        {formatCurrency(amountPending)}
                                                    </TableCell>
                                                    <TableCell
                                                        className={`text-gray-700 text-sm py-1 text-left px-2${
                                                            isEditingStatement(card)
                                                                ? ' align-top !whitespace-normal !overflow-visible'
                                                                : ''
                                                        }`}
                                                    >
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
                                                    {renderStatementActionsCell(card, singleMonthKey)}
                                                </TableRow>
                                                );
                                            })}
                                            <TableRow className={STATEMENT_FOOTER_ROW_CLASS}>
                                                <TableCell colSpan={3} className={`${STATEMENT_FOOTER_CELL_CLASS} text-right`}>
                                                    Total
                                                </TableCell>
                                                <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                    {formatCurrency(monthlyTotals.totalPaymentDue)}
                                                </TableCell>
                                                {showMinPaymentDue && (
                                                <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                    {formatCurrency(monthlyTotals.minPaymentDue)}
                                                </TableCell>
                                                )}
                                                <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                    {formatCurrency(monthlyTotals.paid)}
                                                </TableCell>
                                                <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                    {formatCurrency(monthlyTotals.epp)}
                                                </TableCell>
                                                <TableCell className={`${STATEMENT_FOOTER_CELL_CLASS} text-left`}>
                                                    {formatCurrency(monthlyTotals.amountPending)}
                                                </TableCell>
                                                <TableCell colSpan={2} className={STATEMENT_FOOTER_CELL_CLASS} />
                                            </TableRow>
                                        </>
                                    )}
                        </StatementTableSection>
                    </CardContent>
                </Card>
                    );
                })()
            )}

            {toast && (
                <div
                    className={`fixed bottom-6 right-6 z-[250] max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${
                        toast.type === 'error'
                            ? 'border-red-200 bg-red-50 text-red-800'
                            : 'border-green-200 bg-green-50 text-green-800'
                    }`}
                    role="status"
                >
                    {toast.message}
                </div>
            )}

        </Layout>
    );
}
