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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { SearchableSelect } from '../components/ui/searchable-select';
// Table components removed - using native HTML table for sticky header
import {
  Plus,
  Calendar as CalendarIcon,
  Loader2,
  Edit,
  Trash2,
  Download,
  Filter,
  X,
  Upload,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { applyArialToExcelJsWorkbook } from '../lib/excelExportFont';
import {
  expandCenturyYear,
  formatDateForApi,
  formatDisplayYear,
  formatIsoDateDisplay,
  formatJsDateDisplay,
  parseCalendarDateLocal,
} from '../lib/formatDisplayDate';
import {
  isChequePaymentType,
  ledgerAttachmentViewUrl,
  mapLedgerChequeAttachmentFromRow,
  validateLedgerChequeAttachmentFile,
} from '../lib/ledgerChequeAttachment';
import { resolveAttachmentHref } from '../lib/resolveAttachmentUrl';
import { PdcAttachmentTableCell } from '../components/PdcAttachmentTableCell';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import Calendar from '../components/ui/calendar-tailwind';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import {
  transactionService,
  type BankTransaction as BankTransactionType,
  type BankTransactionWritePayload,
  type BankTransactionWriteOptions,
} from '../services/transactionService';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import BulkTransactionUploadDialog from '../components/BulkTransactionUploadDialog';
import type { ApiResponse } from '../lib/api';
import { isApprovalRequiredError } from '../lib/approvalError';
import { changeRequestService } from '../services/changeRequestService';
import {
  isChangeRequestSubmittedEnvelope,
  userMessageFromChangeRequestSubmit,
} from '../lib/changeRequestUi';
import {
  canApprovePdcDailyLedger,
  canMutateRecords,
  isViewerRole,
  syncUserRoleFromSession,
} from '../lib/authPayload';
import {
  remarksForDailyLedgerDisplay,
  rowIsGcecPdcHighlight,
  isCustomerPdcRemarksLabel,
  type DailyLedgerRemarksDisplayOptions,
} from '../lib/dailyLedgerRemarksDisplay';

/** Normalize PDC / ledger fields from GET /transactions (camelCase or snake_case). */
function readPdcLedgerRowFlags(tx: Record<string, unknown>) {
  const pick = (camel: string, snake: string): unknown => tx[camel] ?? tx[snake];
  const bool = (v: unknown) => v === true || v === 1 || v === '1';
  const rawPdcId = pick('pdcId', 'pdc_id') as number | string | undefined;
  let pdcId: number | undefined;
  if (rawPdcId !== undefined && rawPdcId !== null && rawPdcId !== '') {
    const n = Number(rawPdcId);
    if (!Number.isNaN(n)) pdcId = n;
  }
  return {
    pdcId,
    pdcType: pick('pdcType', 'pdc_type') as string | undefined,
    syntheticFromPdc: bool(pick('syntheticFromPdc', 'synthetic_from_pdc')),
    ledgerApprovalRequired: bool(pick('ledgerApprovalRequired', 'ledger_approval_required')),
    ledgerApproved:
      bool(pick('ledgerApproved', 'ledger_approved')) ||
      bool(pick('dailyLedgerApproved', 'daily_ledger_approved')),
    showLedgerApprovalCheckbox: bool(
      pick('showLedgerApprovalCheckbox', 'show_ledger_approval_checkbox')
    ),
    approvalPendingFooterDuplicate: bool(
      pick('approvalPendingFooterDuplicate', 'approval_pending_footer_duplicate')
    ),
  };
}

/** Same detection as ledger grid row background for bounced / returned cheque. */
function isBouncedChequeRemarks(remarks?: string | null): boolean {
  const remarksLower = String(remarks || '').toLowerCase().trim() || '';
  const compact = remarksLower.replace(/[^a-z]/g, '');
  const hasBounceOrReturn =
    compact.includes('bounce') ||
    compact.includes('bounced') ||
    compact.includes('return') ||
    compact.includes('returned');
  const hasChequeWord =
    compact.includes('cheque') ||
    compact.includes('check') ||
    compact.includes('chq') ||
    compact.includes('cheq');
  const isReversedTransaction =
    remarksLower.includes('reversed transaction') ||
    compact.includes('reversedtransaction');

  return (
    remarksLower === 'bounced cheque' ||
    remarksLower === 'bouncedcheque' ||
    remarksLower === 'bouncedchecq' ||
    remarksLower === 'returned cheque' ||
    remarksLower === 'returnedcheque' ||
    (remarksLower.includes('bounced') && remarksLower.includes('cheque')) ||
    (remarksLower.includes('returned') && remarksLower.includes('cheque')) ||
    isReversedTransaction ||
    (hasBounceOrReturn && hasChequeWord)
  );
}

/** Customer PDC rows — API `pdcType` or short remark label only (not free-form sentences). */
function isExplicitCustomerPdcType(pdcType?: string): boolean {
  if (!pdcType) return false;
  const s = String(pdcType).toLowerCase().trim().replace(/\s+/g, ' ');
  return (
    s === 'customer pdc' ||
    s === 'pdc customer' ||
    s === 'customerpdc' ||
    (s.includes('customer') && s.includes('pdc'))
  );
}

function isExplicitGcecPdcType(pdcType?: string): boolean {
  if (!pdcType) return false;
  const s = String(pdcType).toLowerCase().trim().replace(/\s+/g, ' ');
  return (
    s === 'gcec pdc' ||
    s === 'pdc gcec' ||
    s === 'gcecpdc' ||
    (s.includes('gcec') && s.includes('pdc'))
  );
}

function pdcKindFromTypeOrRemarks(
  t: Pick<BankTransactionType, 'pdcType' | 'remarks'>
): 'gcec' | 'customer' | 'other' {
  if (isExplicitGcecPdcType(t.pdcType) || rowIsGcecPdcHighlight(t.remarks, t.pdcType)) {
    return 'gcec';
  }
  if (isExplicitCustomerPdcType(t.pdcType) || rowIsCustomerPdcHighlight(t.remarks, t.pdcType)) {
    return 'customer';
  }
  return 'other';
}

function rowIsCustomerPdcHighlight(remarks?: string | null, pdcType?: string): boolean {
  if (isExplicitCustomerPdcType(pdcType)) return true;
  return isCustomerPdcRemarksLabel(remarks);
}

function remarksDisplayOptsForRow(
  t: Pick<BankTransaction, 'remarks' | 'pdcType' | 'ledgerApproved' | 'pdcDescription'>
): DailyLedgerRemarksDisplayOptions {
  const approvedGcec =
    !!t.ledgerApproved && rowIsGcecPdcHighlight(t.remarks, t.pdcType);
  return {
    omitGcecFallback: approvedGcec,
    description: approvedGcec ? t.pdcDescription : undefined,
  };
}

/** @see remarksForDailyLedgerDisplay — same rules for CSV/Excel. */
function remarksForExport(t: BankTransaction): string {
  return remarksForDailyLedgerDisplay(
    t.remarks,
    t.pdcType,
    remarksDisplayOptsForRow(t)
  );
}

/** Daily Transaction table Remarks column — same rules as {@link remarksForExport}. */
function remarksForTableDisplay(transaction: BankTransaction): string {
  return remarksForDailyLedgerDisplay(
    transaction.remarks,
    transaction.pdcType,
    remarksDisplayOptsForRow(transaction)
  );
}

/**
 * API may still send `approvalPendingFooterDuplicate` reminder rows (no date). We hide them.
 * GCEC unapproved past-due may get a frontend no-date copy at the top (`clientPendingTopDup`).
 */
function isPdcLedgerFooterRow(t: BankTransaction): boolean {
  return !!t.approvalPendingFooterDuplicate;
}

/** GCEC forecast rows appear in the ledger this many days before cheque date. */
const GCEC_LEDGER_UPCOMING_DAYS = 15;

function daysUntilLedgerDate(t: BankTransaction): number | null {
  const parsedDate = parseTransactionDateForSort(t);
  if (!parsedDate) return null;
  const today = startOfLocalDay(new Date());
  const txDay = startOfLocalDay(parsedDate);
  return Math.round((txDay.getTime() - today.getTime()) / 86400000);
}

function hasLedgerTransactionDatePassed(t: BankTransaction): boolean {
  const days = daysUntilLedgerDate(t);
  if (days !== null) return days <= 0;
  const parsed = parseTransactionDateForSort(t);
  if (!parsed) return false;
  return startOfLocalDay(parsed).getTime() <= startOfLocalDay(new Date()).getTime();
}

function isFutureLedgerTransaction(t: BankTransaction): boolean {
  const days = daysUntilLedgerDate(t);
  if (days !== null) return days > 0;
  const parsed = parseTransactionDateForSort(t);
  if (!parsed) return false;
  return startOfLocalDay(parsed).getTime() > startOfLocalDay(new Date()).getTime();
}

/** GCEC PDC dated row in the 1–15 day window before cheque date (shows date + affects balance). */
function isGcecUpcomingWithinWindow(t: BankTransaction): boolean {
  if (!isGcecLedgerRow(t)) return false;
  const days = daysUntilLedgerDate(t);
  return days !== null && days > 0 && days <= GCEC_LEDGER_UPCOMING_DAYS;
}

/** Hide GCEC rows until 15 days before cheque date; always keep approved + top pending copy. */
function shouldIncludeGcecInLedger(t: BankTransaction): boolean {
  if (!isGcecLedgerRow(t)) return true;
  if (t.ledgerApproved) return true;
  if (isPdcLedgerFooterRow(t)) return false;
  const days = daysUntilLedgerDate(t);
  if (days === null) return true;
  if (days > GCEC_LEDGER_UPCOMING_DAYS) return false;
  return true;
}

function isGcecLedgerRow(t: Pick<BankTransaction, 'remarks' | 'pdcType'>): boolean {
  return pdcKindFromTypeOrRemarks(t) === 'gcec';
}

/** Yellow highlight for unapproved GCEC rows (upcoming, due, or past-due / top approval copy). */
function shouldHighlightGcecLedgerRow(
  t: BankTransaction,
  opts: {
    clientPendingBottomDup?: boolean;
    clientPendingTopDup?: boolean;
    remarksDisplay?: string;
  } = {}
): boolean {
  if (!isGcecLedgerRow(t) || t.ledgerApproved) return false;
  if (opts.clientPendingBottomDup) return false;
  if (opts.clientPendingTopDup) return true;
  if (isFutureLedgerTransaction(t) || isGcecUpcomingWithinWindow(t)) return true;
  if (hasLedgerTransactionDatePassed(t)) return true;
  const remarksBlob = `${opts.remarksDisplay ?? ''} ${t.remarks ?? ''}`
    .toLowerCase()
    .trim();
  return remarksBlob.includes('upcoming');
}

/** Unapproved GCEC PDC (cheque date arrived): extra copy at top without date until approved. */
function isUnapprovedGcecPdcPinTop(t: BankTransaction): boolean {
  if (isPdcLedgerFooterRow(t)) return false;
  if (t.ledgerApproved) return false;
  if (!isGcecLedgerRow(t)) return false;
  return hasLedgerTransactionDatePassed(t);
}

/**
 * GCEC PDC date column: show while cheque date is in the future; hide once due/today until approved.
 * Returns display text or '' when the column should be blank.
 */
function gcecLedgerDateColumnText(
  t: BankTransaction,
  opts?: { forceHide?: boolean }
): string {
  if (opts?.forceHide) return '';
  if (!isGcecLedgerRow(t) || t.ledgerApproved) {
    return ledgerRowDateLabel(t);
  }
  if (hasLedgerTransactionDatePassed(t)) return '';
  return ledgerRowDateLabel(t);
}

function shouldHideLedgerDateColumn(
  t: BankTransaction,
  clientPendingBottomDup = false,
  _clientPendingTopDup = false
): boolean {
  if (isPdcLedgerFooterRow(t)) return true;
  if (clientPendingBottomDup) return true;
  return gcecLedgerDateColumnText(t) === '';
}

/** Resolve display date text from row fields (grid + ISO). */
function ledgerRowDateLabel(t: BankTransaction): string {
  const fromGrid = t.date?.trim();
  if (fromGrid) return fromGrid;
  if (t.originalDate) {
    const fromIso = formatLedgerGridDate(t.originalDate);
    if (fromIso && fromIso !== '—') return fromIso;
  }
  return '';
}

/** Date in grid / exports. */
function displayTransactionDate(
  t: BankTransaction,
  clientPendingBottomDup = false,
  _clientPendingTopDup = false
): string {
  if (clientPendingBottomDup) return '';
  return gcecLedgerDateColumnText(t);
}

/**
 * Omit balance on no-date / reminder rows so totals are not doubled — except unapproved GCEC PDC
 * and upcoming GCEC forecast rows, where credit and balance must stay visible.
 */
function shouldSuppressBalanceForDisplay(
  t: BankTransaction,
  clientPendingBottomDup = false,
  clientPendingTopDup = false
): boolean {
  // Upcoming GCEC rows (≤15 days before cheque): show forecast / chained balance.
  if (isGcecUpcomingWithinWindow(t)) {
    return false;
  }
  const gcecAwaitingApproval =
    rowIsGcecPdcHighlight(t.remarks, t.pdcType) && !t.ledgerApproved;
  if (gcecAwaitingApproval) return false;
  // Customer PDC (unapproved): show computed running balance (excludes this row’s credit until approved).
  return shouldHideLedgerDateColumn(t, clientPendingBottomDup, clientPendingTopDup);
}

/** Bottom copy of unapproved GCEC PDC: show amount as credit (not debit) until ledger approval. */
function isGcecPendingBottomCreditPresentation(
  t: BankTransaction,
  clientPendingBottomDup: boolean
): boolean {
  return (
    clientPendingBottomDup &&
    rowIsGcecPdcHighlight(t.remarks, t.pdcType) &&
    !t.ledgerApproved
  );
}

function shouldAffectRunningBalance(
  t: BankTransaction,
  clientPendingBottomDup = false,
  clientPendingTopDup = false
): boolean {
  if (clientPendingTopDup) return false;
  // No-date bottom copy is display-only for running total (GCEC / Customer wait for ledger rules on the dated row).
  if (clientPendingBottomDup) {
    return false;
  }

  // GCEC: include upcoming (≤15 days) and matured rows in running balance; top no-date copy is display-only.
  const kind = pdcKindFromTypeOrRemarks(t);
  if (kind === 'gcec') {
    return true;
  }
  if (kind === 'customer') return true;

  return true;
}

function parseLedgerAmount(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return Number(String(v ?? 0).replace(/,/g, '').replace('AED', '').trim()) || 0;
}

function parseFormattedBalance(balance: string | number | undefined | null): number {
  if (typeof balance === 'number' && !Number.isNaN(balance)) return balance;
  return Number(String(balance ?? '0').replace(/,/g, '').replace('AED', '').trim()) || 0;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function resolveExportEndDate(
  selectedEndDate: string,
  parseFilterDate: (dateString: string) => Date | null
): Date {
  const today = startOfLocalDay(new Date());
  const trimmed = selectedEndDate.trim();
  if (trimmed) {
    const parsed = parseFilterDate(trimmed);
    if (parsed) {
      const day = startOfLocalDay(parsed);
      return day.getTime() > today.getTime() ? today : day;
    }
  }
  return today;
}

async function resolveClosingBalanceFromAccountSummary(fallback: number): Promise<number> {
  try {
    const response = await transactionService.getAccountSummary();
    if (!response.success || !response.data) return fallback;

    const topLevel = response.data as unknown as Record<string, unknown>;
    const nested =
      topLevel.data && typeof topLevel.data === 'object' && !Array.isArray(topLevel.data)
        ? (topLevel.data as Record<string, unknown>)
        : null;
    const source = nested ?? topLevel;

    for (const key of ['totalBalance', 'total_balance', 'currentBalance'] as const) {
      const raw = source[key];
      if (raw == null) continue;
      const parsed =
        typeof raw === 'number'
          ? raw
          : parseFloat(String(raw).replace(/,/g, '').trim());
      if (!Number.isNaN(parsed)) return parsed;
    }
  } catch {
    // Keep ledger-derived fallback when account summary is unavailable.
  }

  return fallback;
}

/**
 * Balance after each row, chained from the first row’s API balance in sort order.
 * `finalRunning` = balance after the last row in `ordered` (chronological body only).
 * Keyed by row object so PDC / synthetic rows with missing or duplicate ids still resolve.
 */
function computeRunningBalanceAfterByTransaction(ordered: BankTransaction[]): {
  afterByTransaction: WeakMap<BankTransaction, number>;
  finalRunning: number;
} {
  const afterByTransaction = new WeakMap<BankTransaction, number>();
  if (ordered.length === 0) return { afterByTransaction, finalRunning: 0 };
  let after = parseFormattedBalance(ordered[0].balance);
  if (!shouldAffectRunningBalance(ordered[0])) {
    after = after - parseLedgerAmount(ordered[0].credit) + parseLedgerAmount(ordered[0].debit);
  }
  afterByTransaction.set(ordered[0], after);
  for (let i = 1; i < ordered.length; i++) {
    const t = ordered[i];
    if (shouldAffectRunningBalance(t)) {
      after = after + parseLedgerAmount(t.credit) - parseLedgerAmount(t.debit);
    }
    afterByTransaction.set(t, after);
  }
  return { afterByTransaction, finalRunning: after };
}

/**
 * Frontend “pending” copies at the bottom share the same `id` as the dated row, so their
 * balance must continue the chain after `finalRunning`, using presentation amounts
 * (`getLedgerDebitCreditNumeric(..., true)`).
 */
function computePendingDupBalanceById(
  finalRunningAfterBody: number,
  pendingRows: BankTransaction[],
  clientPendingBottomDup: boolean
): Map<string, number> {
  const pendingDupById = new Map<string, number>();
  let running = finalRunningAfterBody;
  for (const t of pendingRows) {
    if (shouldAffectRunningBalance(t, clientPendingBottomDup, false)) {
      const { debit, credit } = getLedgerDebitCreditNumeric(t, clientPendingBottomDup);
      running = running + credit - debit;
    }
    const id = String(t.id ?? '');
    if (id) pendingDupById.set(id, running);
  }
  return pendingDupById;
}

function buildLedgerBalanceMaps(filtered: BankTransaction[]): {
  bodyAfterByTransaction: WeakMap<BankTransaction, number>;
  bodyAfterById: Map<string, number>;
  pendingDupAfterByTransaction: WeakMap<BankTransaction, number>;
  statementClosing: number;
} {
  const ordered = sortTransactionsOldestFirst(filtered);
  const { afterByTransaction: bodyAfterByTransaction, finalRunning } =
    computeRunningBalanceAfterByTransaction(ordered);
  const bodyAfterById = new Map<string, number>();
  for (const t of ordered) {
    const id = String(t.id ?? '').trim();
    if (!id || !bodyAfterByTransaction.has(t)) continue;
    bodyAfterById.set(id, bodyAfterByTransaction.get(t)!);
  }
  const pendingBottomRows = filtered.filter((t) => t.approvalPendingFooterDuplicate);
  const pendingDupAfterById = computePendingDupBalanceById(
    finalRunning,
    pendingBottomRows,
    true
  );
  const pendingDupAfterByTransaction = new WeakMap<BankTransaction, number>();
  for (const t of pendingBottomRows) {
    const id = String(t.id ?? '');
    if (id && pendingDupAfterById.has(id)) {
      pendingDupAfterByTransaction.set(t, pendingDupAfterById.get(id)!);
    }
  }
  return {
    bodyAfterByTransaction,
    bodyAfterById,
    pendingDupAfterByTransaction,
    statementClosing: finalRunning,
  };
}

function balanceAfterForDisplay(
  t: BankTransaction,
  clientPendingBottomDup: boolean | undefined,
  bodyAfterByTransaction: WeakMap<BankTransaction, number>,
  bodyAfterById: Map<string, number>,
  pendingDupAfterByTransaction: WeakMap<BankTransaction, number>,
  clientPendingTopDup?: boolean | undefined
): number {
  const id = String(t.id ?? '').trim();
  const resolveBodyAfter = (): number | null => {
    if (bodyAfterByTransaction.has(t)) return bodyAfterByTransaction.get(t)!;
    if (id && bodyAfterById.has(id)) return bodyAfterById.get(id)!;
    return null;
  };

  if (clientPendingTopDup) {
    const chained = resolveBodyAfter();
    if (chained != null) return chained;
  }
  if (clientPendingBottomDup && pendingDupAfterByTransaction.has(t)) {
    return pendingDupAfterByTransaction.get(t)!;
  }
  const chained = resolveBodyAfter();
  if (chained != null) return chained;
  return parseFormattedBalance(t.balance);
}

/** Debit/credit strings for grid (GCEC pending bottom row flips debit → credit column). */
function getDebitCreditDisplayForRow(
  t: BankTransaction,
  clientPendingBottomDup: boolean | undefined,
  clientPendingTopDup: boolean | undefined = false
): { debit: string | null; credit: string | null } {
  if (
    !clientPendingTopDup &&
    isGcecPendingBottomCreditPresentation(t, !!clientPendingBottomDup)
  ) {
    const d = parseLedgerAmount(t.debit);
    const c = parseLedgerAmount(t.credit);
    if (d > 0) {
      return {
        debit: null,
        credit: t.debitFormatted || d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      };
    }
    if (c > 0) {
      return {
        debit: null,
        credit: t.creditFormatted || c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      };
    }
    return { debit: null, credit: null };
  }
  return {
    debit: t.debitFormatted ?? null,
    credit: t.creditFormatted ?? null,
  };
}

/** Debit/credit amounts for CSV/Excel (GCEC pending bottom copy → credit column, same as grid). */
function getLedgerDebitCreditNumeric(
  t: BankTransaction,
  clientPendingBottomDup: boolean,
  clientPendingTopDup = false
): { debit: number; credit: number } {
  if (
    !clientPendingTopDup &&
    isGcecPendingBottomCreditPresentation(t, clientPendingBottomDup)
  ) {
    const d = parseLedgerAmount(t.debit);
    const c = parseLedgerAmount(t.credit);
    if (d > 0) return { debit: 0, credit: d };
    if (c > 0) return { debit: 0, credit: c };
    return { debit: 0, credit: 0 };
  }
  return {
    debit: parseLedgerAmount(t.debit),
    credit: parseLedgerAmount(t.credit),
  };
}

interface BankTransaction extends BankTransactionType {
  categoryName?: string;
  categoryId?: string | number; // Category ID for editing
  amount?: string | number; // For display with commas (legacy)
  balance: string; // For display
  debitFormatted?: string | null; // Formatted debit amount
  creditFormatted?: string | null; // Formatted credit amount
  remarks?: string | null; // Remarks for the transaction
  /** PDC note from API (`description`); used for Remarks when GCEC is ledger-approved. */
  pdcDescription?: string | null;

  originalDate?: string; // Store original ISO date for editing
  transactionTime?: string;
  createdAtLocal?: string;
  ledgerApprovedAt?: string;
  ledgerApprovedAtLocal?: string;
}

function parseSlashDmY(value: string): Date | null {
  const slash = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slash) return null;
  const day = parseInt(slash[1], 10);
  const month = parseInt(slash[2], 10) - 1;
  const year = expandCenturyYear(parseInt(slash[3], 10));
  const fallback = new Date(year, month, day);
  if (Number.isNaN(fallback.getTime())) return null;
  if (
    fallback.getFullYear() === year &&
    fallback.getMonth() === month &&
    fallback.getDate() === day
  ) {
    return fallback;
  }
  return null;
}

/** First usable date field from GET /transactions (ledger + synthetic PDC rows). */
function resolveLedgerRowApiDate(row: Record<string, unknown>): string {
  const keys = [
    'date',
    'transaction_date',
    'transactionDate',
    'chequeDate',
    'cheque_date',
    'payment_date',
    'paymentDate',
  ] as const;
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  const nested = row.pdc;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const pdc = nested as Record<string, unknown>;
    for (const key of ['chequeDate', 'cheque_date', 'date'] as const) {
      const v = pdc[key];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

function formatLedgerGridDate(apiDateStr: string): string {
  const raw = String(apiDateStr ?? '').trim();
  if (!raw) return '';
  const display = formatIsoDateDisplay(raw);
  if (display && display !== '—') return display;
  const normalized = formatDateForApi(raw);
  if (normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const fromNorm = formatIsoDateDisplay(normalized);
    if (fromNorm && fromNorm !== '—') return fromNorm;
  }
  return raw;
}

/** Single calendar-day parser for sort, upcoming GCEC, filters (26 → 2026; no UTC day shift). */
function parseTransactionDateForSort(t: BankTransaction): Date | null {
  if (t.originalDate) {
    const fromOriginal = parseCalendarDateLocal(t.originalDate);
    if (fromOriginal) return fromOriginal;
  }
  if (t.date) {
    const fromDisplay = parseCalendarDateLocal(t.date);
    if (fromDisplay) return fromDisplay;
    const fromSlash = parseSlashDmY(t.date);
    if (fromSlash) return fromSlash;
  }
  return null;
}

function formatTransactionDateForForm(t: BankTransaction): string {
  const parsed = parseTransactionDateForSort(t);
  if (!parsed) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = String(parsed.getFullYear());
  return `${day}/${month}/${year}`;
}

function parseLocalDateTimeForSort(value: string | null | undefined): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const localDateTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (localDateTime) {
    const year = Number(localDateTime[1]);
    const month = Number(localDateTime[2]) - 1;
    const day = Number(localDateTime[3]);
    const hour = Number(localDateTime[4]);
    const minute = Number(localDateTime[5]);
    const second = Number(localDateTime[6] ?? '0');
    const parsed = new Date(year, month, day, hour, minute, second);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTransactionDateOnlyTimestamp(t: BankTransaction): number | null {
  const parsed = parseTransactionDateForSort(t);
  if (!parsed) return null;
  const only = new Date(parsed);
  only.setHours(0, 0, 0, 0);
  return only.getTime();
}

function getTransactionCreatedTimestamp(t: BankTransaction): number | null {
  const dateOnly = parseTransactionDateForSort(t);
  const timeRaw = String(t.transactionTime || '').trim();
  let hour: number | null = null;
  let minute = 0;
  let second = 0;
  const parsedTime = timeRaw.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?/
  );
  if (parsedTime) {
    const rawHour = Number(parsedTime[1]);
    const meridian = String(parsedTime[4] ?? '').toLowerCase();
    minute = Number(parsedTime[2]);
    second = Number(parsedTime[3] ?? '0');
    if (meridian === 'am' || meridian === 'pm') {
      hour = rawHour % 12;
      if (meridian === 'pm') hour += 12;
    } else {
      hour = rawHour;
    }
  }

  if (
    dateOnly &&
    hour !== null &&
    Number.isFinite(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  ) {
    const combined = new Date(dateOnly);
    combined.setHours(hour, minute, second, 0);
    if (!Number.isNaN(combined.getTime())) return combined.getTime();
  }

  const local = parseLocalDateTimeForSort(t.createdAtLocal);
  if (local) return local.getTime();
  const created = parseLocalDateTimeForSort(t.createdAt);
  if (created) return created.getTime();
  const fromRowDate = dateOnly;
  if (fromRowDate) return fromRowDate.getTime();
  return null;
}

function getTransactionApprovalTimestamp(t: BankTransaction): number | null {
  const approvedLocal = parseLocalDateTimeForSort(t.ledgerApprovedAtLocal);
  if (approvedLocal) return approvedLocal.getTime();
  const approved = parseLocalDateTimeForSort(t.ledgerApprovedAt);
  if (approved) return approved.getTime();
  return null;
}

function getTransactionStableSortId(t: BankTransaction): number {
  if (typeof t.pdcId === 'number' && !Number.isNaN(t.pdcId)) return t.pdcId;
  const raw = String(t.id ?? '').trim();
  const direct = Number(raw);
  if (!Number.isNaN(direct)) return direct;
  const trailing = raw.match(/(\d+)\s*$/);
  if (trailing) {
    const n = Number(trailing[1]);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function sortTransactionsOldestFirst(transactions: BankTransaction[]): BankTransaction[] {
  return [...transactions].sort((a, b) => {
    const dateA = getTransactionDateOnlyTimestamp(a);
    const dateB = getTransactionDateOnlyTimestamp(b);

    if (dateA == null && dateB == null) {
      // continue to created-time tie-breaker
    } else if (dateA == null) {
      return 1;
    } else if (dateB == null) {
      return -1;
    } else {
      const byDate = dateA - dateB;
      if (byDate !== 0) return byDate;
    }

    const createdA = getTransactionCreatedTimestamp(a);
    const createdB = getTransactionCreatedTimestamp(b);
    if (createdA != null && createdB != null) {
      const byCreated = createdA - createdB;
      if (byCreated !== 0) return byCreated;
    } else if (createdA != null && createdB == null) {
      return -1;
    } else if (createdA == null && createdB != null) {
      return 1;
    }

    return (
      getTransactionStableSortId(a) - getTransactionStableSortId(b)
    );
  });
}

/** Strict ledger order for table: date desc, transaction-time desc, id fallback. */
function sortTransactionsStrictDesc(transactions: BankTransaction[]): BankTransaction[] {
  return [...transactions].sort((a, b) => {
    const kindA = pdcKindFromTypeOrRemarks(a);
    const kindB = pdcKindFromTypeOrRemarks(b);
    const isComparablePdcPair =
      (kindA === 'customer' || kindA === 'gcec') &&
      (kindB === 'customer' || kindB === 'gcec');

    // For PDC rows: keep unapproved on top, approved rows below.
    if (isComparablePdcPair) {
      const approvedA = !!a.ledgerApproved;
      const approvedB = !!b.ledgerApproved;
      if (approvedA !== approvedB) return approvedA ? 1 : -1;

      // Customer PDC after approval:
      // 1) If time exists, sort by transaction time (latest first)
      // 2) If time is missing, keep earlier-approved first
      if (approvedA && approvedB && kindA === 'customer' && kindB === 'customer') {
        const rawTimeA = String(a.transactionTime ?? '').trim();
        const rawTimeB = String(b.transactionTime ?? '').trim();
        const hasTimeA = rawTimeA.length > 0;
        const hasTimeB = rawTimeB.length > 0;

        if (hasTimeA && hasTimeB) {
          const txnTsA = getTransactionCreatedTimestamp(a);
          const txnTsB = getTransactionCreatedTimestamp(b);
          if (txnTsA != null && txnTsB != null) {
            const byTxnTime = txnTsB - txnTsA;
            if (byTxnTime !== 0) return byTxnTime;
          } else if (txnTsA != null && txnTsB == null) {
            return -1;
          } else if (txnTsA == null && txnTsB != null) {
            return 1;
          }
        } else if (hasTimeA !== hasTimeB) {
          return hasTimeA ? -1 : 1;
        }

        const approvedAtA = getTransactionApprovalTimestamp(a);
        const approvedAtB = getTransactionApprovalTimestamp(b);
        if (approvedAtA != null && approvedAtB != null) {
          const byApprovalTimeAsc = approvedAtA - approvedAtB;
          if (byApprovalTimeAsc !== 0) return byApprovalTimeAsc;
        } else if (approvedAtA != null && approvedAtB == null) {
          return -1;
        } else if (approvedAtA == null && approvedAtB != null) {
          return 1;
        }
      }

      // For approved GCEC PDC rows, use transaction date+time ordering first.
      if (approvedA && approvedB && kindA === 'gcec' && kindB === 'gcec') {
        const txnTsA = getTransactionCreatedTimestamp(a);
        const txnTsB = getTransactionCreatedTimestamp(b);
        if (txnTsA != null && txnTsB != null) {
          const byTxnTime = txnTsB - txnTsA;
          if (byTxnTime !== 0) return byTxnTime;
        } else if (txnTsA != null && txnTsB == null) {
          return -1;
        } else if (txnTsA == null && txnTsB != null) {
          return 1;
        }
      }

      // For approved rows, latest approval appears first (except Customer PDC block above).
      if (approvedA && approvedB && !(kindA === 'customer' && kindB === 'customer')) {
        const approvedAtA = getTransactionApprovalTimestamp(a);
        const approvedAtB = getTransactionApprovalTimestamp(b);
        if (approvedAtA != null && approvedAtB != null) {
          const byApprovalTime = approvedAtB - approvedAtA;
          if (byApprovalTime !== 0) return byApprovalTime;
        } else if (approvedAtA != null && approvedAtB == null) {
          return -1;
        } else if (approvedAtA == null && approvedAtB != null) {
          return 1;
        }
      }
    }

    const dateA = getTransactionDateOnlyTimestamp(a);
    const dateB = getTransactionDateOnlyTimestamp(b);

    if (dateA == null && dateB == null) {
      // continue to createdAt tie-breaker
    } else if (dateA == null) {
      return 1;
    } else if (dateB == null) {
      return -1;
    } else {
      const byDate = dateB - dateA;
      if (byDate !== 0) return byDate;
    }

    const createdA = getTransactionCreatedTimestamp(a);
    const createdB = getTransactionCreatedTimestamp(b);
    if (createdA != null && createdB != null) {
      const byCreated = createdB - createdA;
      if (byCreated !== 0) return byCreated;
    } else if (createdA == null && createdB != null) {
      return 1;
    } else if (createdA != null && createdB == null) {
      return -1;
    }

    return getTransactionStableSortId(b) - getTransactionStableSortId(a);
  });
}

type LedgerExportRowSpec = {
  transaction: BankTransaction;
  clientPendingBottomDup: boolean;
  clientPendingTopDup?: boolean;
};

/**
 * Rows for CSV/Excel (same order as grid): GCEC unapproved no-date at top, then full dated body
 * (Customer PDC in cheque-date order).
 */
function buildLedgerExportRows(filteredTransactions: BankTransaction[]): LedgerExportRowSpec[] {
  const bodyTransactions = filteredTransactions.filter((t) => !isPdcLedgerFooterRow(t));
  const sortedBody = sortTransactionsOldestFirst(bodyTransactions);
  const pdcPendingTopRows = sortedBody.filter((t) => isUnapprovedGcecPdcPinTop(t));
  const sortedBodyDatedOnly = sortedBody.filter((t) => !isUnapprovedGcecPdcPinTop(t));

  return [
    ...pdcPendingTopRows.map((t) => ({
      transaction: t,
      clientPendingBottomDup: false,
      clientPendingTopDup: true as const,
    })),
    ...sortedBodyDatedOnly.map((t) => ({
      transaction: t,
      clientPendingBottomDup: false,
      clientPendingTopDup: false,
    })),
  ];
}

function ledgerExportDetailsColumn(t: BankTransaction): string {
  if (t.paymentType === 'cheque' && t.chequeNumber && t.chequeNumber !== '-') {
    return String(t.chequeNumber).replace(/,/g, '').trim().padStart(6, '0');
  }
  if (t.paymentType === 'cash') return 'Cash';
  if (t.paymentType === 'creditcard') return 'Credit Card';
  if (t.paymentType === 'banktransfer') return 'Online';
  if (t.paymentType?.toLowerCase() === 'dd') return 'DD';
  if (t.paymentType) return t.paymentType;
  return '';
}

function isPdcDueId(id: string | number | undefined | null): boolean {
  if (id === undefined || id === null) return false;
  return String(id).trim().toLowerCase().startsWith('pdc-due-');
}

/** Ledger / PDC rows that may carry a cheque scan in Actions. */
function rowMayHaveChequeScan(t: BankTransaction): boolean {
  if (isChequePaymentType(t.paymentType)) return true;
  if (t.pdcId != null) return true;
  if (rowIsGcecPdcHighlight(t.remarks, t.pdcType)) return true;
  if (rowIsCustomerPdcHighlight(t.remarks, t.pdcType)) return true;
  if (t.syntheticFromPdc && t.chequeNumber && t.chequeNumber !== '-') return true;
  return false;
}

function chequeAttachmentHrefForRow(t: BankTransaction): string | null {
  if (!rowMayHaveChequeScan(t)) return null;
  const meta =
    t.attachment ??
    mapLedgerChequeAttachmentFromRow({
      attachment: t.attachment,
      attachment_name: t.attachmentName,
      attachment_url: t.attachmentUrl,
    });
  const raw = ledgerAttachmentViewUrl(meta);
  return raw ? resolveAttachmentHref(raw) : null;
}

function enrichLedgerRowsWithPdcAttachments(
  rows: BankTransaction[],
  pdcs: Array<{
    id?: string | number;
    chequeDate?: string;
    attachmentName?: string | null;
    attachmentUrl?: string | null;
  }>
): BankTransaction[] {
  if (!pdcs.length) return rows;
  const pdcById = new Map<
    string,
    {
      id?: string | number;
      chequeDate?: string;
      attachmentName?: string | null;
      attachmentUrl?: string | null;
    }
  >();
  for (const p of pdcs) {
    const id = String(p.id ?? '').trim();
    if (id) pdcById.set(id, p);
  }

  return rows.map((t) => {
    const pid =
      t.pdcId != null ? String(t.pdcId) : resolvePdcIdFromLedgerRow(t);
    const pdc = pid ? pdcById.get(pid) : undefined;

    let next = t;
    const missingGridDate = !String(t.date ?? '').trim();
    const missingIsoDate = !String(t.originalDate ?? '').trim();
    if (pdc?.chequeDate && (missingGridDate || missingIsoDate)) {
      const apiDateStr = String(pdc.chequeDate).trim();
      const isoForEdit =
        formatDateForApi(apiDateStr) ||
        (/^\d{4}-\d{2}-\d{2}/.test(apiDateStr) ? apiDateStr.slice(0, 10) : undefined);
      const formattedDate = formatLedgerGridDate(apiDateStr);
      next = {
        ...next,
        date: missingGridDate ? formattedDate || next.date : next.date,
        originalDate: missingIsoDate ? isoForEdit || next.originalDate : next.originalDate,
      };
    }

    const existingMeta =
      next.attachment ??
      mapLedgerChequeAttachmentFromRow({
        attachment_name: next.attachmentName,
        attachment_url: next.attachmentUrl,
      });
    if (ledgerAttachmentViewUrl(existingMeta)) return next;

    if (!pdc) return next;

    const fromPdc = mapLedgerChequeAttachmentFromRow({
      attachment: {
        name: pdc.attachmentName,
        url: pdc.attachmentUrl,
        cloudinaryUrl: pdc.attachmentUrl,
      },
    });
    const href = ledgerAttachmentViewUrl(fromPdc);
    if (!href) return next;

    return {
      ...next,
      attachment: fromPdc,
      attachmentName: fromPdc.name ?? next.attachmentName,
      attachmentUrl: resolveAttachmentHref(href) ?? href,
    };
  });
}

function resolvePdcIdFromLedgerRow(t: Pick<BankTransaction, 'id' | 'pdcId'>): string | null {
  if (t.pdcId != null && String(t.pdcId).trim() !== '') {
    const n = Number(t.pdcId);
    if (!Number.isNaN(n)) return String(n);
  }
  const m = /^pdc-due-(\d+)$/i.exec(String(t.id ?? '').trim());
  return m ? m[1] : null;
}

// Zod validation schema
const transactionSchema = z.object({
  editMode: z.enum(['ledger', 'pdcDue']).default('ledger'),
  date: z.string()
    .min(10, 'Date is required')
    .regex(/^\d{2}\/\d{2}\/\d{2,4}$/, 'Date must be in dd/mm/yy format'),
  entryTime: z.string().optional(),
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
  customerName: z.string().optional(),
  pdcType: z.enum(['GCEC PDC', 'Customer PDC', 'Custom PDC']).optional(),
  chequeType: z.enum(['Payment Cheque', 'Security Cheque']).optional(),
  description: z.string().optional(),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
}).refine((data) => {
  // If payment type is cheque, chequeNumber is required
  if (data.editMode !== 'pdcDue' && data.paymentType === 'cheque') {
    return data.chequeNumber && data.chequeNumber.trim().length > 0;
  }
  return true;
}, {
  message: 'Cheque number is required when payment type is cheque',
  path: ['chequeNumber'],
}).superRefine((data, ctx) => {
  if (data.editMode !== 'pdcDue') return;
  if (!data.chequeNumber || !data.chequeNumber.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chequeNumber'],
      message: 'Cheque number is required',
    });
  }
  if (!data.customerName || !data.customerName.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customerName'],
      message: 'Customer name is required',
    });
  }
  if (!data.pdcType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pdcType'],
      message: 'PDC type is required',
    });
  }
  if (!data.chequeType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chequeType'],
      message: 'Cheque type is required',
    });
  }
  if (data.pdcType === 'Custom PDC' && !data.description?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['description'],
      message: 'Description is required for Custom PDC',
    });
  }
});

type TransactionFormData = z.infer<typeof transactionSchema>;

export default function BankTransaction() {
  const canMutate = canMutateRecords();
  const isViewer = isViewerRole(syncUserRoleFromSession());
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
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchDetails, setSearchDetails] = useState<string>('');
  const [searchAmount, setSearchAmount] = useState<string>('');
  const [searchDescription, setSearchDescription] = useState<string>('');
  const [searchRemarks, setSearchRemarks] = useState<string>('');

  type ApprovalOffer =
    | { mode: 'edit'; resourceId: string; payload: Record<string, unknown> }
    | { mode: 'pdc_edit'; resourceId: string; payload: Record<string, unknown> }
    | { mode: 'delete'; resourceId: string }
    | { mode: 'pdc_daily_ledger'; resourceId: string; payload: Record<string, unknown> }
    | { mode: 'success'; message: string };
  const [approvalOffer, setApprovalOffer] = useState<ApprovalOffer | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pdcLedgerApproving, setPdcLedgerApproving] = useState<number | null>(null);
  const [pdcApproveDialogOpen, setPdcApproveDialogOpen] = useState(false);
  const [pdcApprovePdcId, setPdcApprovePdcId] = useState<number | null>(null);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [chequeAttachmentFile, setChequeAttachmentFile] = useState<File | null>(null);
  const [removeChequeAttachmentOnSave, setRemoveChequeAttachmentOnSave] = useState(false);

  const form = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      editMode: 'ledger',
      date: '',
      entryTime: '',
      type: 'Debit',
      categoryId: '',
      paymentType: 'cash',
      chequeNumber: '',
      remarks: '',
      customerName: '',
      pdcType: 'GCEC PDC',
      chequeType: 'Payment Cheque',
      description: '',
      amount: '',
    },
  });

  const paymentType = form.watch('paymentType');
  const transactionType = form.watch('type');
  const editingPdcDue = !!editingTransaction && isPdcDueId(editingTransaction.id);
  const editingPdcType = form.watch('pdcType');

  const notifyTransactionDataChanged = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('gcec:transactions-updated'));
    }
  }, []);

  // Clear cheque fields when payment type changes away from cheque
  useEffect(() => {
    if (!editingPdcDue && paymentType !== 'cheque') {
      form.setValue('chequeNumber', '');
      setChequeAttachmentFile(null);
      setRemoveChequeAttachmentOnSave(false);
    }
  }, [editingPdcDue, paymentType, form]);

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
  const availableCategories = useMemo(
    () => (transactionType === 'Debit' ? payablesCategories : receivablesCategories),
    [transactionType, payablesCategories, receivablesCategories]
  );

  // Keep selected category valid when edit/type/category-lists change.
  useEffect(() => {
    if (!editingTransaction) return;
    const currentValue = form.getValues('categoryId');
    if (!currentValue) return;
    const categoryExists = availableCategories.some(
      (cat) => String(cat.id) === String(currentValue)
    );
    if (!categoryExists && availableCategories.length > 0) {
      form.setValue('categoryId', '');
    }
  }, [editingTransaction, availableCategories, form]);

  // Fetch transactions on component mount
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const ledgerResponse: ApiResponse<BankTransactionType[]> =
        await transactionService.getBankTransactions();
      
      if (ledgerResponse.success && ledgerResponse.data && Array.isArray(ledgerResponse.data)) {
        // Process transactions from API response
        let transactionsData: BankTransaction[] = ledgerResponse.data.map((transaction) => {
          const row = transaction as BankTransactionType & Record<string, unknown>;
          const flags = readPdcLedgerRowFlags(row);
          const isFooterDup = flags.approvalPendingFooterDuplicate;
          const apiDateStr = !isFooterDup ? resolveLedgerRowApiDate(row) : '';
          const isoForEdit = apiDateStr
            ? formatDateForApi(apiDateStr) ||
              (/^\d{4}-\d{2}-\d{2}/.test(apiDateStr) ? apiDateStr.slice(0, 10) : undefined)
            : undefined;

          const formattedDate = apiDateStr ? formatLedgerGridDate(apiDateStr) : '';

          const normalizedDebit = parseLedgerAmount(
            row.debit ?? row.debit_amount ?? row.debitAmount ?? transaction.debit
          );
          const normalizedCredit = parseLedgerAmount(
            row.credit ?? row.credit_amount ?? row.creditAmount ?? transaction.credit
          );
          const rawBalance = row.balance ?? row.running_balance ?? transaction.balance;

          const debitAmount = normalizedDebit
            ? normalizedDebit.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : null;
          const creditAmount = normalizedCredit
            ? normalizedCredit.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : null;

          const formattedBalance =
            typeof rawBalance === 'number'
              ? rawBalance.toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })
              : parseLedgerAmount(rawBalance).toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                });

          const frontendPaymentType =
            (String(row.paymentType ?? row.payment_type ?? transaction.paymentType ?? '')
              .trim()
              .toLowerCase() === 'online'
              ? 'banktransfer'
              : String(row.paymentType ?? row.payment_type ?? transaction.paymentType ?? '')) as
              | 'creditcard'
              | 'cheque'
              | 'cash'
              | 'banktransfer';

          const remarksRaw = row.remarks;
          const remarks =
            remarksRaw === undefined || remarksRaw === null ? undefined : String(remarksRaw);
          const descriptionRaw = row.description ?? row.pdc_description;
          const pdcDescription =
            descriptionRaw === undefined
              ? undefined
              : descriptionRaw === null
                ? null
                : String(descriptionRaw);
          const isCustomerPdcRow = rowIsCustomerPdcHighlight(remarks, flags.pdcType);
          const attachmentMeta = mapLedgerChequeAttachmentFromRow(row);

          return {
            ...transaction,
            attachment: attachmentMeta,
            attachmentName:
              transaction.attachmentName ?? attachmentMeta.name ?? undefined,
            attachmentUrl:
              transaction.attachmentUrl ??
              attachmentMeta.cloudinaryUrl ??
              attachmentMeta.url ??
              undefined,
            id: String(transaction.id ?? ''),
            date: formattedDate,
            originalDate: isoForEdit,
            transactionTime: String(
              row.transactionTime ??
                row.transaction_time ??
                row.transactionTimeDisplay ??
                row.transaction_time_display ??
                row.entryTime ??
                row.entry_time ??
                row.time ??
                ''
            ) || undefined,
            createdAt: String(row.createdAt ?? row.created_at ?? transaction.createdAt ?? ''),
            createdAtLocal: String(
              row.createdAtLocal ?? row.created_at_local ?? ''
            ) || undefined,
            ledgerApprovedAt: String(
              row.dailyLedgerApprovedAt ??
                row.daily_ledger_approved_at ??
                row.ledgerApprovedAt ??
                row.ledger_approved_at ??
                row.approvedAt ??
                row.approved_at ??
                row.updatedAt ??
                row.updated_at ??
                ''
            ) || undefined,
            ledgerApprovedAtLocal: String(
              row.dailyLedgerApprovedAtDisplay ??
                row.daily_ledger_approved_at_display ??
                row.ledgerApprovedAtLocal ??
                row.ledger_approved_at_local ??
                row.approvedAtLocal ??
                row.approved_at_local ??
                ''
            ) || undefined,
            categoryName: String(row.category ?? row.category_name ?? transaction.category ?? 'N/A'),
            categoryId: (row.categoryId ?? row.category_id) as string | number | undefined,
            paymentType: frontendPaymentType,
            debit: normalizedDebit,
            credit: normalizedCredit,
            debitFormatted: debitAmount,
            creditFormatted: creditAmount,
            balance: formattedBalance,
            remarks,
            pdcDescription,
            pdcId: flags.pdcId,
            pdcType: flags.pdcType,
            syntheticFromPdc: flags.syntheticFromPdc,
            ledgerApprovalRequired: flags.ledgerApprovalRequired,
            ledgerApproved: flags.ledgerApproved,
            showLedgerApprovalCheckbox:
              flags.showLedgerApprovalCheckbox || (!!flags.pdcId && isCustomerPdcRow),
            approvalPendingFooterDuplicate: flags.approvalPendingFooterDuplicate,
          };
        });

        try {
          const pdcRes = await transactionService.getPostDatedCheques();
          if (pdcRes.success && Array.isArray(pdcRes.data) && pdcRes.data.length > 0) {
            transactionsData = enrichLedgerRowsWithPdcAttachments(
              transactionsData,
              pdcRes.data
            );
          }
        } catch (pdcErr) {
          console.warn('[BankTransaction] PDC list for attachments:', pdcErr);
        }

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

  const approvePdcDailyLedger = useCallback(
    async (pdcId: number) => {
      try {
        setPdcLedgerApproving(pdcId);
        setError(null);
        setSuccessMessage(null);
        const response = await transactionService.patchPdcDailyLedgerApproved(pdcId, true);
        if (
          response.success &&
          isChangeRequestSubmittedEnvelope(response.data)
        ) {
          const apiMessage = userMessageFromChangeRequestSubmit(
            response as ApiResponse<unknown>
          );
          setSuccessMessage(apiMessage);
          await fetchTransactions();
          return;
        }
        if (response.success === false) {
          throw new Error(response.message || response.error || 'Approval failed');
        }
        setSuccessMessage('Daily ledger approval saved.');
        await fetchTransactions();
      } catch (e: unknown) {
        if (isApprovalRequiredError(e)) {
          setPdcApproveDialogOpen(false);
          setPdcApprovePdcId(null);
          setApprovalOffer({
            mode: 'pdc_daily_ledger',
            resourceId: String(pdcId),
            payload: { approved: true },
          });
          setError(null);
        } else {
          const err = e as Error & { status?: number };
          if (err.status === 403) {
            setError('You do not have permission to approve. Admin or accountant only.');
          } else {
            setError(err.message || 'Approval failed');
          }
        }
      } finally {
        setPdcLedgerApproving(null);
      }
    },
    [fetchTransactions]
  );

  const handlePdcApproveConfirm = useCallback(async () => {
    if (pdcApprovePdcId == null) return;
    const id = pdcApprovePdcId;
    await approvePdcDailyLedger(id);
    setPdcApproveDialogOpen(false);
    setPdcApprovePdcId(null);
  }, [pdcApprovePdcId, approvePdcDailyLedger]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const onSubmit = async (data: TransactionFormData) => {
    let pendingEditPayload: Record<string, unknown> | null = null;
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccessMessage(null);

      const amountNumber = parseFloat(data.amount.replace(/,/g, ''));
      const apiPaymentType = data.paymentType === 'banktransfer' ? 'online' : data.paymentType;
      const normalizedDate = formatDateForApi(data.date) || data.date.trim();

      const payload: BankTransactionWritePayload = {
        date: normalizedDate,
        type: data.type,
        categoryId: data.categoryId,
        paymentType: apiPaymentType as BankTransactionWritePayload['paymentType'],
        amount: amountNumber,
      };

      if (data.paymentType === 'cheque' && data.chequeNumber) {
        payload.chequeNumber = data.chequeNumber.trim();
      }
      if (editingTransaction && !isPdcDueId(editingTransaction.id)) {
        payload.remarks = data.remarks?.trim() ?? '';
      } else if (data.remarks?.trim()) {
        payload.remarks = data.remarks.trim();
      }
      if (data.entryTime && data.entryTime.trim()) {
        payload.transactionTime = data.entryTime.trim();
      }

      const includeChequeAttachment =
        chequeAttachmentFile &&
        chequeAttachmentFile.size > 0 &&
        (data.paymentType === 'cheque' ||
          (!!editingTransaction && isPdcDueId(editingTransaction.id)));

      if (includeChequeAttachment && chequeAttachmentFile) {
        const fileErr = validateLedgerChequeAttachmentFile(chequeAttachmentFile);
        if (fileErr) {
          setError(fileErr);
          return;
        }
      }

      const wantsRemoveScan =
        !!editingTransaction &&
        removeChequeAttachmentOnSave &&
        !chequeAttachmentFile &&
        (data.paymentType === 'cheque' || isPdcDueId(editingTransaction.id));

      const attachmentOpts: BankTransactionWriteOptions | undefined =
        data.paymentType === 'cheque' &&
        chequeAttachmentFile &&
        chequeAttachmentFile.size > 0
          ? { attachmentFile: chequeAttachmentFile }
          : wantsRemoveScan
            ? { removeAttachment: true }
            : undefined;

      let response: ApiResponse<BankTransactionType>;

      if (editingTransaction && isPdcDueId(editingTransaction.id)) {
        const noteText = String(data.description ?? '');
        const pdcId = resolvePdcIdFromLedgerRow(editingTransaction);
        const pdcUpdateBody = {
          chequeDate: data.date.trim(),
          chequeNumber: data.chequeNumber?.trim() || '',
          customerName: data.customerName?.trim() || '',
          amount: amountNumber,
          chequeType: data.chequeType || 'Payment Cheque',
          pdcType: (data.pdcType || 'GCEC PDC') as 'GCEC PDC' | 'Customer PDC' | 'Custom PDC',
          remarks: noteText,
        };

        const pdcPayload: Record<string, unknown> = {
          date: normalizedDate,
          chequeDate: normalizedDate,
          amount: amountNumber,
          chequeNumber: pdcUpdateBody.chequeNumber,
          customerName: pdcUpdateBody.customerName,
          category: pdcUpdateBody.customerName,
          chequeType: pdcUpdateBody.chequeType,
          pdcType: pdcUpdateBody.pdcType,
          remarks: noteText,
        };

        pendingEditPayload = { ...pdcPayload };
        if (wantsRemoveScan) {
          pendingEditPayload.removeAttachment = true;
        }

        if (pdcId) {
          if (wantsRemoveScan && !chequeAttachmentFile) {
            try {
              await transactionService.deletePostDatedChequeAttachment(pdcId);
            } catch (deleteErr) {
              console.warn('[BankTransaction] PDC attachment remove:', deleteErr);
            }
          }
          const pdcRes = await transactionService.updatePostDatedCheque(
            pdcId,
            pdcUpdateBody,
            chequeAttachmentFile,
            null
          );
          response = pdcRes as unknown as ApiResponse<BankTransactionType>;
        } else {
          const pdcDuePayload: BankTransactionWritePayload = {
            date: normalizedDate,
            type: data.type,
            categoryId: data.categoryId,
            paymentType: 'cheque',
            amount: amountNumber,
            chequeNumber: pdcUpdateBody.chequeNumber,
            remarks: noteText,
          };
          response = await transactionService.updateBankTransaction(
            String(editingTransaction.id),
            pdcDuePayload,
            attachmentOpts
          );
        }
      } else if (editingTransaction) {
        pendingEditPayload = { ...payload };
        response = await transactionService.updateBankTransaction(
          String(editingTransaction.id),
          payload,
          attachmentOpts
        );
      } else {
        response = await transactionService.createBankTransaction(payload, attachmentOpts);
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

        if (editingTransaction && isPdcDueId(editingTransaction.id)) {
          setSuccessMessage('PDC due transaction updated successfully.');
        } else if (editingTransaction) {
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
        setChequeAttachmentFile(null);
        setRemoveChequeAttachmentOnSave(false);
        form.reset({
          editMode: 'ledger',
          date: '',
          entryTime: '',
          type: 'Debit',
          categoryId: '',
          paymentType: 'cash',
          chequeNumber: '',
          remarks: '',
          customerName: '',
          pdcType: 'GCEC PDC',
          chequeType: 'Payment Cheque',
          description: '',
          amount: '',
        });
        setEditingTransaction(null);
        setIsModalOpen(false);
        // Refetch to ensure data is in sync
        await fetchTransactions();
        notifyTransactionDataChanged();
      } else {
        setError(response.message || `Failed to ${editingTransaction ? 'update' : 'create'} transaction`);
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err) && editingTransaction && pendingEditPayload) {
        let changePayload: Record<string, unknown> = {
          ...pendingEditPayload,
          chequeNumber: pendingEditPayload.chequeNumber ?? null,
          remarks: (pendingEditPayload.remarks as string) ?? '',
        };
        const removeScanOnApproval =
          removeChequeAttachmentOnSave &&
          !chequeAttachmentFile &&
          (form.getValues('paymentType') === 'cheque' ||
            isPdcDueId(editingTransaction.id));
        if (removeScanOnApproval) {
          changePayload =
            await transactionService.appendChequeAttachmentToChangePayload(
              changePayload,
              null,
              { removeAttachment: true }
            );
        } else if (
          chequeAttachmentFile &&
          (form.getValues('paymentType') === 'cheque' ||
            (editingTransaction && isPdcDueId(editingTransaction.id)))
        ) {
          const fileErr = validateLedgerChequeAttachmentFile(chequeAttachmentFile);
          if (fileErr) {
            setError(fileErr);
            return;
          }
          changePayload =
            await transactionService.appendChequeAttachmentToChangePayload(
              changePayload,
              chequeAttachmentFile
            );
        }
        const pdcIdForChange = isPdcDueId(editingTransaction.id)
          ? resolvePdcIdFromLedgerRow(editingTransaction)
          : null;
        setApprovalOffer({
          mode: pdcIdForChange ? 'pdc_edit' : 'edit',
          resourceId: pdcIdForChange ?? String(editingTransaction.id),
          payload: changePayload,
        });
        setIsModalOpen(false);
        setEditingTransaction(null);
        setChequeAttachmentFile(null);
        setRemoveChequeAttachmentOnSave(false);
        form.reset({
          editMode: 'ledger',
          date: '',
          entryTime: '',
          type: 'Debit',
          categoryId: '',
          paymentType: 'cash',
          chequeNumber: '',
          remarks: '',
          customerName: '',
          pdcType: 'GCEC PDC',
          chequeType: 'Payment Cheque',
          description: '',
          amount: '',
        });
        setError(null);
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create transaction';
        console.error('[BankTransaction] Error:', err);
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitApprovalRequest = async () => {
    if (!approvalOffer || approvalOffer.mode === 'success') return;
    const offer = approvalOffer;
    const mode = offer.mode;
    setApprovalSubmitting(true);
    setError(null);
    try {
      const res =
        mode === 'pdc_daily_ledger' || mode === 'pdc_edit'
          ? await changeRequestService.submit({
              action: 'edit',
              resourceType: 'post_dated_cheque',
              resourceId: offer.resourceId,
              payload: offer.payload,
            })
          : await changeRequestService.submit({
              action: mode === 'edit' ? 'edit' : 'delete',
              resourceType: 'transaction',
              resourceId: offer.resourceId,
              ...(mode === 'edit' ? { payload: offer.payload } : {}),
            });
      const apiMessage = userMessageFromChangeRequestSubmit(res);
      if (mode === 'edit' || mode === 'pdc_edit') {
        setIsModalOpen(false);
        setEditingTransaction(null);
        setChequeAttachmentFile(null);
        setRemoveChequeAttachmentOnSave(false);
        form.reset({
          editMode: 'ledger',
          date: '',
          entryTime: '',
          type: 'Debit',
          categoryId: '',
          paymentType: 'cash',
          chequeNumber: '',
          remarks: '',
          customerName: '',
          pdcType: 'GCEC PDC',
          chequeType: 'Payment Cheque',
          description: '',
          amount: '',
        });
      }
      setSuccessMessage(apiMessage);
      setApprovalOffer({ mode: 'success', message: apiMessage });
      if (mode === 'pdc_daily_ledger' || mode === 'pdc_edit') {
        await fetchTransactions();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit change request');
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleEdit = useCallback((transaction: BankTransaction) => {
    if (
      (transaction.syntheticFromPdc && !isPdcDueId(transaction.id)) ||
      transaction.approvalPendingFooterDuplicate
    ) {
      return;
    }

    setEditingTransaction(transaction);
    setChequeAttachmentFile(null);
    setRemoveChequeAttachmentOnSave(false);
    setError(null);
    
    const dateValue = formatTransactionDateForForm(transaction);
    let entryTimeValue = '';

    const sourceTime = String(transaction.transactionTime || '').trim();
    const normalizedTime = sourceTime.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (normalizedTime) {
      entryTimeValue = `${normalizedTime[1].padStart(2, '0')}:${normalizedTime[2]}`;
    } else {
      const sourceDateTime = String(
        transaction.createdAtLocal ?? transaction.createdAt ?? ''
      ).trim();
      if (sourceDateTime) {
        const parsedDateTime = parseLocalDateTimeForSort(sourceDateTime);
        if (parsedDateTime) {
          entryTimeValue = `${String(parsedDateTime.getHours()).padStart(2, '0')}:${String(
            parsedDateTime.getMinutes()
          ).padStart(2, '0')}`;
        } else {
          const extracted = sourceDateTime.match(/\b(\d{2}):(\d{2})\b/);
          if (extracted) entryTimeValue = `${extracted[1]}:${extracted[2]}`;
        }
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

        if (foundByName) {
          categoryId = String(foundByName.id);
          console.log('[handleEdit] Found in fallback list:', foundByName.name, '->', categoryId);
        } else {
          console.log('[handleEdit] Category name not found in either list:', transaction.categoryName);
        }
      }
    }
    
    console.log('[handleEdit] Final categoryId:', categoryId);
    
    // Ensure paymentType is 'banktransfer' not 'online' for form
    const formPaymentType = isPdcDueId(transaction.id)
      ? 'cheque'
      : transaction.paymentType === 'online'
      ? 'banktransfer'
      : transaction.paymentType;
    const initialPdcType =
      transaction.pdcType === 'Custom PDC' || transaction.pdcType === 'Customer PDC'
        ? transaction.pdcType
        : rowIsGcecPdcHighlight(transaction.remarks, transaction.pdcType)
        ? 'GCEC PDC'
        : 'Customer PDC';
    const initialPdcNote =
      transaction.pdcDescription !== undefined
        ? String(transaction.pdcDescription ?? '')
        : String(transaction.remarks ?? '').trim();
    
    // Reset form with all values
    form.reset({
      editMode: isPdcDueId(transaction.id) ? 'pdcDue' : 'ledger',
      date: dateValue,
      entryTime: entryTimeValue,
      type: transactionType as 'Debit' | 'Credit',
      categoryId: categoryId,
      paymentType: formPaymentType as 'creditcard' | 'cheque' | 'cash' | 'banktransfer',
      chequeNumber: transaction.chequeNumber && transaction.chequeNumber !== '-' ? transaction.chequeNumber : '' ,
      remarks: transaction.remarks || '',
      customerName: transaction.categoryName || '',
      pdcType: initialPdcType,
      chequeType: 'Payment Cheque',
      description: initialPdcNote,
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

  const handleDeleteClick = useCallback(
    (id: string) => {
      const t = transactions.find((x) => String(x.id) === id);
      if (
        (t?.syntheticFromPdc && !isPdcDueId(t.id)) ||
        t?.approvalPendingFooterDuplicate
      )
        return;
      setDeletingTransactionId(id);
      setError(null);
      setIsDeleteModalOpen(true);
    },
    [transactions]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingTransactionId) return;

    try {
      setIsDeleting(true);
      setError(null);
      const response: ApiResponse<void> = await transactionService.deleteBankTransaction(deletingTransactionId);
      
      if (response.success) {
        if (isChangeRequestSubmittedEnvelope(response.data)) {
          const apiMessage = userMessageFromChangeRequestSubmit(
            response as ApiResponse<unknown>
          );
          setSuccessMessage(apiMessage);
          setApprovalOffer({ mode: 'success', message: apiMessage });
          setDeletingTransactionId(null);
          setIsDeleteModalOpen(false);
        } else {
          setTransactions(prevTransactions =>
            prevTransactions.filter(t => String(t.id) !== deletingTransactionId)
          );
          setDeletingTransactionId(null);
          setIsDeleteModalOpen(false);
          // Refetch to ensure data is in sync
          await fetchTransactions();
          notifyTransactionDataChanged();
        }
      } else {
        setError(response.message || 'Failed to delete transaction');
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err) && deletingTransactionId) {
        setApprovalOffer({ mode: 'delete', resourceId: deletingTransactionId });
        setDeletingTransactionId(null);
        setIsDeleteModalOpen(false);
        setError(null);
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete transaction';
        console.error('[BankTransaction] Error deleting transaction:', err);
        setError(errorMessage);
      }
    } finally {
      setIsDeleting(false);
    }
  }, [deletingTransactionId, fetchTransactions, notifyTransactionDataChanged]);

  const handleAddNew = useCallback(() => {
    setEditingTransaction(null);
    setChequeAttachmentFile(null);
    setRemoveChequeAttachmentOnSave(false);
    setError(null);
    form.reset({
      editMode: 'ledger',
      date: '',
      entryTime: '',
      type: 'Debit',
      categoryId: '',
      paymentType: 'cash',
      chequeNumber: '',
      remarks: '',
      customerName: '',
      pdcType: 'GCEC PDC',
      chequeType: 'Payment Cheque',
      description: '',
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





  const parseDateForFilter = useCallback(
    (dateString: string): Date | null => parseCalendarDateLocal(dateString),
    []
  );

  // Filter transactions based on active tab, date range, and search
  const filteredTransactions = transactions.filter((transaction) => {
    if (transaction.approvalPendingFooterDuplicate) return false;
    if (!shouldIncludeGcecInLedger(transaction)) return false;

    // Filter by payment type
    // 'online' tab shows both creditcard and banktransfer (which comes as 'online' from API)
    if (activeTab === 'online' && transaction.paymentType !== 'creditcard' && transaction.paymentType !== 'banktransfer') return false;
    if (activeTab === 'cheque' && transaction.paymentType !== 'cheque') return false;
    if (activeTab === 'cash' && transaction.paymentType !== 'cash') return false;
    
    // Filter by date range (calendar day, local timezone)
    if (startDate || endDate) {
      const transactionDate =
        parseDateForFilter(transaction.originalDate || transaction.date || '') ??
        parseTransactionDateForSort(transaction);
      if (!transactionDate) return false;

      const txDay = startOfLocalDay(transactionDate).getTime();

      if (startDate) {
        const start = parseDateForFilter(startDate);
        if (start && txDay < startOfLocalDay(start).getTime()) return false;
      }
      if (endDate) {
        const end = parseDateForFilter(endDate);
        if (end && txDay > startOfLocalDay(end).getTime()) return false;
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
        : transaction.paymentType?.toLowerCase() === 'dd'
        ? 'DD'
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

  const ledgerBalanceMaps = useMemo(
    () => buildLedgerBalanceMaps(filteredTransactions),
    [filteredTransactions]
  );

  // No pagination: render all rows in strict reverse chronological order.
  const bodyTransactions = sortTransactionsStrictDesc(
    filteredTransactions.filter((t) => !isPdcLedgerFooterRow(t))
  );
  const pdcPendingTopRows = bodyTransactions.filter((t) => isUnapprovedGcecPdcPinTop(t));
  /** Customer PDC stays in date order; only GCEC may add a no-date copy at the top. */
  const bodyTransactionsDatedOnly = bodyTransactions.filter(
    (t) => !isUnapprovedGcecPdcPinTop(t)
  );

  type PaginatedLedgerRow = {
    transaction: BankTransaction;
    clientPendingBottomDup?: boolean;
    clientPendingTopDup?: boolean;
  };

  const paginatedRows: PaginatedLedgerRow[] = [
    ...pdcPendingTopRows.map((t) => ({ transaction: t, clientPendingTopDup: true as const })),
    ...bodyTransactionsDatedOnly.map((t) => ({ transaction: t })),
  ];

  // Clear all filters
  const handleClearFilters = () => {
    setStartDate('');
    setEndDate('');
    setSearchDetails('');
    setSearchAmount('');
    setSearchDescription('');
    setSearchRemarks('');
  };

  // CSV Download function
  const handleDownloadCSV = useCallback(async () => {

    const safe = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const rowCsv = (...cols: string[]) => {
      const filled = [...cols];
      while (filled.length < 7) filled.push('');
      return filled.slice(0, 7).map((c) => safe(c)).join(',');
    };
  
    const parseDate = (t: BankTransaction) => parseTransactionDateForSort(t);
  
    const dates = filteredTransactions.map(parseDate).filter(Boolean) as Date[];
    const dateTimes = dates.map((d) => d.getTime());
    const exportStartDate = dateTimes.length ? new Date(Math.min(...dateTimes)) : new Date();
    const exportEndDate = resolveExportEndDate(endDate, parseDateForFilter);
  
    const { bodyAfterByTransaction, bodyAfterById, pendingDupAfterByTransaction, statementClosing } =
      buildLedgerBalanceMaps(filteredTransactions);
    const closingBalanceValue = await resolveClosingBalanceFromAccountSummary(statementClosing);
    const closingBalance = closingBalanceValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  
    const csvRows: string[] = [];
  
    // ----- HEADER -----
    csvRows.push(rowCsv('GCEC CLOUD SECURITY & SURVEILLANCE L.L.C'));
    csvRows.push(rowCsv());
    csvRows.push(rowCsv());

    csvRows.push(rowCsv('Account No.', '12990685920001 - AED'));
    csvRows.push(rowCsv('IBAN', 'AE720030012990685920001'));
    csvRows.push(rowCsv('Start Date', formatJsDateDisplay(exportStartDate)));
    csvRows.push(rowCsv('End Date', formatJsDateDisplay(exportEndDate)));
    csvRows.push(rowCsv('Closing (Current)', `AED ${closingBalance}`));
    csvRows.push(rowCsv());
    csvRows.push(rowCsv());

    // ----- TABLE HEADER -----
    csvRows.push(
      rowCsv('Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance', 'Remarks')
    );

    // ----- TABLE ROWS ----- (body oldest-first + unapproved PDC tail + footer — same as grid / Excel)
    buildLedgerExportRows(filteredTransactions).forEach(
      ({ transaction: t, clientPendingBottomDup, clientPendingTopDup = false }) => {
      const details = ledgerExportDetailsColumn(t);
      const { debit: debitValue, credit: creditValue } = getLedgerDebitCreditNumeric(
        t,
        clientPendingBottomDup,
        clientPendingTopDup
      );

      const debit = `AED ${debitValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const credit = `AED ${creditValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      const balanceValue = balanceAfterForDisplay(
        t,
        clientPendingBottomDup,
        bodyAfterByTransaction,
        bodyAfterById,
        pendingDupAfterByTransaction,
        clientPendingTopDup
      );
      const balance = shouldSuppressBalanceForDisplay(
        t,
        clientPendingBottomDup,
        clientPendingTopDup
      )
        ? ''
        : `AED ${balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      csvRows.push(
        rowCsv(
          displayTransactionDate(t, clientPendingBottomDup, clientPendingTopDup),
          t.categoryName || 'N/A',
          details,
          debit,
          credit,
          balance,
          remarksForExport(t)
        )
      );
    });
  
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
  
    const link = document.createElement('a');
    link.href = url;
    link.download = `GCEC-Statement-${formatJsDateDisplay(exportStartDate)}-to-${formatJsDateDisplay(exportEndDate)}.csv`;
    link.style.visibility = 'hidden';
  
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  
  }, [filteredTransactions, endDate, parseDateForFilter]);
  

  // Excel Download — ExcelJS so fills/fonts persist (.xlsx styles are not supported by `xlsx` community build).
  const handleDownloadExcel = useCallback(async () => {
    const parseDateForRange = (t: BankTransaction) => parseTransactionDateForSort(t);

    const dates = filteredTransactions.map(parseDateForRange).filter(Boolean) as Date[];
    const dateTimes = dates.map((d) => d.getTime());
    const exportStartDate = dateTimes.length ? new Date(Math.min(...dateTimes)) : new Date();
    const exportEndDate = resolveExportEndDate(endDate, parseDateForFilter);

    const { bodyAfterByTransaction, bodyAfterById, pendingDupAfterByTransaction, statementClosing } =
      buildLedgerBalanceMaps(filteredTransactions);
    const closingBalanceValue = await resolveClosingBalanceFromAccountSummary(statementClosing);

    try {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Account Statement');

      let r = 1;
      ws.getCell(r++, 1).value = 'GCEC CLOUD SECURITY & SURVEILLANCE L.L.C';
      r += 2;

      ws.getCell(r, 1).value = 'Account No.:';
      ws.getCell(r++, 2).value = '12990685920001 - AED';
      ws.getCell(r, 1).value = 'IBAN:';
      ws.getCell(r++, 2).value = 'AE720030012990685920001';
      ws.getCell(r, 1).value = 'Start Date:';
      ws.getCell(r++, 2).value = formatJsDateDisplay(exportStartDate);
      ws.getCell(r, 1).value = 'End Date:';
      ws.getCell(r++, 2).value = formatJsDateDisplay(exportEndDate);
      ws.getCell(r, 1).value = 'Closing (Current):';
      const closingCell = ws.getCell(r, 2);
      closingCell.value = `AED ${closingBalanceValue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
      r++;
      r += 2;

      const headers = ['Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance', 'Remarks'];
      headers.forEach((h, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FF000000' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF7C46D' },
        };
        cell.alignment = { vertical: 'middle' };
      });
      r++;

      const exportRows = buildLedgerExportRows(filteredTransactions);

      const ledgerRowFill = (t: BankTransaction): ExcelJS.Fill | undefined => {
        if (isBouncedChequeRemarks(t.remarks)) {
          return {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF95DCF7' },
          };
        }
        return undefined;
      };

      for (const {
        transaction: t,
        clientPendingBottomDup,
        clientPendingTopDup = false,
      } of exportRows) {
        const details = ledgerExportDetailsColumn(t);
        const remarksText = remarksForExport(t);
        const rowFill =
          ledgerRowFill(t) ??
          (shouldHighlightGcecLedgerRow(t, {
            clientPendingBottomDup,
            clientPendingTopDup,
            remarksDisplay: remarksText,
          })
            ? {
                type: 'pattern' as const,
                pattern: 'solid' as const,
                fgColor: { argb: 'FFFEF9C3' },
              }
            : undefined);
        const { debit: debitValue, credit: creditValue } = getLedgerDebitCreditNumeric(
          t,
          clientPendingBottomDup,
          clientPendingTopDup
        );
        const balanceValue = balanceAfterForDisplay(
          t,
          clientPendingBottomDup,
          bodyAfterByTransaction,
          bodyAfterById,
          pendingDupAfterByTransaction,
          clientPendingTopDup
        );
        const suppressBal = shouldSuppressBalanceForDisplay(
          t,
          clientPendingBottomDup,
          clientPendingTopDup
        );

        const row = ws.getRow(r);
        row.getCell(1).value = displayTransactionDate(t, clientPendingBottomDup, clientPendingTopDup);
        row.getCell(2).value = t.categoryName || 'N/A';
        row.getCell(3).value = details;
        row.getCell(4).value = debitValue;
        row.getCell(4).numFmt = '#,##0.00';
        row.getCell(5).value = creditValue;
        row.getCell(5).numFmt = '#,##0.00';
        row.getCell(6).value = suppressBal ? null : balanceValue;
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(7).value = remarksText;

        const fillStyle = rowFill;
        const isAvailableBalanceRemark =
          remarksText.trim().toLowerCase().replace(/\s+/g, ' ') === 'available balance';
        for (let c = 1; c <= 7; c++) {
          const cell = row.getCell(c);
          if (fillStyle) {
            cell.fill = fillStyle;
          }
        }

        // Date, Description, Details, Remarks: black. Debit: red. Credit: black.
        const blackFont: Partial<ExcelJS.Font> = {
          name: 'Calibri',
          size: 11,
          color: { argb: 'FF000000' },
        };
        row.getCell(1).font = blackFont as ExcelJS.Font;
        row.getCell(2).font = blackFont as ExcelJS.Font;
        row.getCell(3).font = blackFont as ExcelJS.Font;
        row.getCell(7).font = blackFont as ExcelJS.Font;

        row.getCell(4).font = {
          name: 'Calibri',
          size: 11,
          bold: false,
          color: { argb: 'FFDC2626' },
        };
        row.getCell(5).font = {
          name: 'Calibri',
          size: 11,
          bold: false,
          color: { argb: 'FF000000' },
        };
        if (!suppressBal) {
          row.getCell(6).font = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: balanceValue < 0 ? 'FFDC2626' : 'FF0003EB' },
          };
        } else {
          row.getCell(6).font = {
            name: 'Calibri',
            size: 11,
            color: { argb: 'FF9CA3AF' },
          };
        }
        // Match on-screen ledger: green background on Balance column for "Available balance" rows.
        if (isAvailableBalanceRemark && !suppressBal) {
          row.getCell(6).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF91D34D' },
          };
        }

        r++;
      }

      ws.columns = [
        { width: 15 },
        { width: 25 },
        { width: 15 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 28 },
      ];

      const fileName = `GCEC-Statement-${formatJsDateDisplay(exportStartDate)}-to-${formatJsDateDisplay(exportEndDate)}.xlsx`;
      applyArialToExcelJsWorkbook(workbook);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
      setError(null);
    } catch (e: unknown) {
      console.error('Excel export failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to download Excel file');
    }
  }, [filteredTransactions, endDate, parseDateForFilter, setError]);
  
  

  return (
    <Layout>
       <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
      
          <h2 className="text-2xl font-bold text-gray-900"> Daily Transactions Details</h2>
       </div>
            {canMutate && (
              <Button
                onClick={handleAddNew}
                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black flex items-center space-x-2 transition-colors rounded-lg mr-4 font-semibold"
                disabled={loading}
              >
                <Plus className="w-4 h-4 text-black" />
                <span>Add New</span>
              </Button>
            )}
        </div>
 
 <Card className="bg-white border border-gray-200 shadow-sm rounded-lg mt-18 m-4 overflow-hidden">
  <CardContent className="p-4">
    <div className="space-y-3">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">

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
              let value = e.target.value
                .replace(/[^0-9.]/g, '')
                .replace(/(\..*)\./g, '$1');
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
                    const year = formatDisplayYear(date.getFullYear());
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
              let value = e.target.value
                .replace(/[^0-9.]/g, '')
                .replace(/(\..*)\./g, '$1');
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
                    const today = startOfLocalDay(new Date());
                    const picked = startOfLocalDay(date);
                    const clamped = picked.getTime() > today.getTime() ? today : picked;
                    const day = String(clamped.getDate()).padStart(2, '0');
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const month = months[clamped.getMonth()];
                    const year = formatDisplayYear(clamped.getFullYear());
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
            className="w-full pl-3 pr-10 h-10"
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
            className="w-full pl-3 pr-10 h-10"
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
            className="w-full pl-3 pr-10 h-10"
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
            className="w-full pl-3 pr-10 h-10"
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

    </div>

      {/* Filter Actions — filters apply as you pick dates; Clear resets fields */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleClearFilters}
          className="h-10 shrink-0 border border-gray-300 bg-white text-black hover:bg-gray-50 px-3"
          title="Clear filters"
        >
          <X className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black h-10 shrink-0 whitespace-nowrap px-4 shadow-md hover:shadow-lg transition-shadow flex items-center justify-center gap-2"
          title="Filters apply automatically when you pick dates or type search text"
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
           className={`px-4 py-2 rounded-lg text-lg font-semibold transition-colors ${activeTab === 'all'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           All
         </button>
         <button
           onClick={() => setActiveTab('online')}
           className={`px-4 py-2 rounded-lg text-lg font-semibold transition-colors ${activeTab === 'online'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           Online
         </button>
         <button
           onClick={() => setActiveTab('cheque')}
           className={`px-4 py-2 rounded-lg text-lg font-semibold transition-colors ${activeTab === 'cheque'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           Cheque
         </button>
         <button
           onClick={() => setActiveTab('cash')}
           className={`px-4 py-2 rounded-lg text-lg font-semibold transition-colors ${activeTab === 'cash'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           Cash
         </button>
       </div>

       {/* Action Buttons */}
       <div className="flex items-center gap-3">
        {canMutate && (
        <Button
          onClick={() => setBulkUploadOpen(true)}
          variant="outline"
          className="flex items-center font-semibold space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || loadingCategories}
        >
          <Upload className="w-4 h-4 font-semibold" />
          <span>Bulk upload</span>
        </Button>
        )}
        <Button
          onClick={handleDownloadCSV}
          variant="outline"
          className="flex items-center font-semibold space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || filteredTransactions.length === 0}
        >
          <Download className="w-4 h-4 font-semibold" />
          <span>Download CSV</span>
        </Button>
        <Button
          onClick={handleDownloadExcel}
          variant="outline"
          className="flex items-center font-semibold space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || filteredTransactions.length === 0}
        >
          <Download className="w-4 h-4 font-semibold" />
          <span>Download Excel</span>
        </Button>
     
       </div>
     </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-lg text-red-600">{error}</p>
        </div>
      )}
      {successMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
          <p className="text-lg text-emerald-800">{successMessage}</p>
        </div>
      )}

      {/* Transactions Table */}

      <Card className="bg-white border border-gray-200 m-4">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="max-h-[600px] overflow-y-auto relative">
              <table className="bank-tx-ledger w-full caption-bottom text-base border rounded-lg [&_th]:!py-1 [&_td]:!py-1">
                <thead className="sticky top-0 z-20 bg-[#f7c46d] shadow-sm">
                  <tr className="bg-[#f7c46d] border-0">
                    <th className=" text-black text-sm text-left py-2 px-4 align-middle">
                      Date
                    </th>
                    <th className="text-black text-sm text-left py-2 px-4 align-middle">
                      Description
                    </th>
                    <th className=" text-black text-sm text-left py-2 px-4 align-middle">
                      Details
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-2 align-middle">
                      Debit
                    </th>
                    <th className=" text-black text-sm text-left py-2 px-4 align-middle">
                      Credit
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Balance
                    </th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                      Remarks
                    </th>
                    {canMutate && (
                      <th className="font-semibold text-black text-sm text-left py-2 px-4 align-middle">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                {loading ? (
                  <tr>
                    <td colSpan={canMutate ? 8 : 7} className="text-center py-4 px-4 align-middle">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                      <p className="text-sm text-gray-500">Loading transactions...</p>
                    </td>
                  </tr>
                ) : !Array.isArray(filteredTransactions) || filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={canMutate ? 8 : 7} className="text-center py-4 px-4 align-middle">
                      <p className="text-sm text-gray-500 mb-1">No transactions found.</p>
                      <p className="text-sm text-gray-400">Click "Add New" to create your first transaction.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map(({ transaction, clientPendingBottomDup, clientPendingTopDup }) => {
                    const remarksDisplay = remarksForTableDisplay(transaction);
                    const isBouncedCheque = isBouncedChequeRemarks(
                      remarksDisplay
                    );
                    const isGcecKind = isGcecLedgerRow(transaction);
                    const isUpcomingGcecRow =
                      isGcecKind &&
                      !clientPendingBottomDup &&
                      !clientPendingTopDup &&
                      !transaction.ledgerApproved &&
                      (isFutureLedgerTransaction(transaction) ||
                        isGcecUpcomingWithinWindow(transaction) ||
                        /\(upcoming\)/i.test(remarksDisplay) ||
                        /\(upcoming\)/i.test(String(transaction.remarks ?? '')));
                    /** GCEC PDC: no ledger approve until cheque date; no edit/delete until ledger-approved. */
                    const gcecChequeDateHasArrived =
                      !isGcecKind || !isFutureLedgerTransaction(transaction);
                    const gcecAllowsEditDelete =
                      !isGcecKind || !!transaction.ledgerApproved;
                    const remarksCellText = isUpcomingGcecRow
                      ? remarksDisplay
                        ? `${remarksDisplay} (Upcoming)`
                        : 'Upcoming'
                      : remarksDisplay;
                    const isAvailableBalanceRemark =
                      remarksDisplay.trim().toLowerCase().replace(/\s+/g, ' ') === 'available balance';
                    const gcecPendingHighlight = shouldHighlightGcecLedgerRow(transaction, {
                      clientPendingBottomDup: !!clientPendingBottomDup,
                      clientPendingTopDup: !!clientPendingTopDup,
                      remarksDisplay,
                    });
                    const rowTone = isBouncedCheque
                      ? 'bounce'
                      : gcecPendingHighlight
                        ? 'gcec'
                        : undefined;
                    const { debit: debitShown, credit: creditShown } =
                      getDebitCreditDisplayForRow(
                        transaction,
                        clientPendingBottomDup,
                        clientPendingTopDup
                      );
                    const debitAmount = debitShown
                      ? parseFloat(String(debitShown).replace(/,/g, ''))
                      : 0;
                    const hasDebit = !Number.isNaN(debitAmount) && debitAmount > 0;
                    return (
                    <tr 
                      key={
                        clientPendingBottomDup
                          ? `${transaction.id}-pending-bottom-dup`
                          : clientPendingTopDup
                            ? `${transaction.id}-pending-top-dup`
                            : transaction.id
                      }
                      data-row-bg={rowTone}
                      className={`border-b border-gray-100 transition-colors ${
                        isBouncedCheque
                          ? 'bg-[#7dd3f0] hover:bg-[#67c6ea]'
                          : gcecPendingHighlight
                          ? 'bg-[#fef9c3] hover:bg-yellow-200/70'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td
                        className="text-gray-700 text-sm py-2 px-4 text-left align-middle"
                      >
                        {displayTransactionDate(
                          transaction,
                          !!clientPendingBottomDup,
                          !!clientPendingTopDup
                        )}
                      </td>
                      <td
                        className="text-gray-700 text-sm py-2 px-4 text-left align-middle"
                      >
                        {(() => {
                          const description = transaction.categoryName || 'N/A';
                          const maxChars = 35;
                          const isLong = description.length > maxChars;
                          const shortText = isLong
                            ? `${description.slice(0, maxChars)}...`
                            : description;

                          if (!isLong) return shortText;

                          return (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-block cursor-default">{shortText}</span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>{description}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                      </td>
                      <td
                        className="text-gray-600 text-sm py-2 px-4 text-left align-middle"
                      >
                        {transaction.paymentType === 'cheque' &&
                        transaction.chequeNumber &&
                        transaction.chequeNumber !== '-'
                          ? `${transaction.chequeNumber}`
                          : transaction.paymentType === 'cash'
                            ? 'Cash'
                            : transaction.paymentType === 'creditcard'
                              ? 'Credit Card'
                              : transaction.paymentType === 'banktransfer'
                                ? 'Online'
                                : transaction.paymentType?.toLowerCase() === 'dd'
                                  ? 'DD'
                                  : (
                                      <span className="capitalize">
                                        {transaction.paymentType || 'N/A'}
                                      </span>
                                    )}
                      </td>
                      <td className="text-sm py-2 px-4 text-left align-middle">
                        {hasDebit ? (
                          <span className="text-red-600">
                            AED {debitShown}
                          </span>
                        ) : (
                          <span className="text-red-600">AED 0.00</span>
                        )}
                      </td>
                      <td className="text-sm py-2 px-4 text-left align-middle">
                        {creditShown ? (
                          <span className="text-black">
                            AED {creditShown}
                          </span>
                        ) : (
                          <span className="text-black">AED 0.00</span>
                        )}
                      </td>
                      <td
                        className={`text-sm py-2 px-4 text-left align-middle ${
                          isAvailableBalanceRemark ? 'bg-[#91d34d]' : ''
                        }`}
                      >
                        {shouldSuppressBalanceForDisplay(
                          transaction,
                          !!clientPendingBottomDup,
                          !!clientPendingTopDup
                        ) ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          (() => {
                            const balanceValue = balanceAfterForDisplay(
                              transaction,
                              clientPendingBottomDup,
                              ledgerBalanceMaps.bodyAfterByTransaction,
                              ledgerBalanceMaps.bodyAfterById,
                              ledgerBalanceMaps.pendingDupAfterByTransaction,
                              clientPendingTopDup
                            );
                            const formattedBalance =
                              balanceValue.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              });
                            const balanceClass =
                              balanceValue < 0 ? 'text-red-600 font-bold' : 'text-[#0003eb] font-bold';
                            return (
                              <span className={balanceClass}>
                                AED {formattedBalance}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="text-sm py-2 px-4 text-left align-middle">
                        {remarksCellText}
                      </td>
                      <td className="text-sm py-2 px-4 text-left align-middle">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {transaction.showLedgerApprovalCheckbox &&
                            !transaction.approvalPendingFooterDuplicate &&
                            !clientPendingBottomDup &&
                            transaction.pdcId != null &&
                            !transaction.ledgerApproved &&
                            gcecChequeDateHasArrived &&
                            canApprovePdcDailyLedger() && (
                              <label className="flex items-center gap-1.5 text-xs text-gray-800 whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-400 text-[#f7c46d] focus:ring-[#f7c46d] disabled:opacity-60"
                                  aria-label="Ledger approval"
                                  checked={!!transaction.ledgerApproved}
                                  disabled={
                                    !!transaction.ledgerApproved ||
                                    pdcLedgerApproving === transaction.pdcId
                                  }
                                  onChange={() => {
                                    if (
                                      transaction.ledgerApproved ||
                                      transaction.pdcId == null
                                    )
                                      return;
                                    setPdcApprovePdcId(transaction.pdcId);
                                    setPdcApproveDialogOpen(true);
                                  }}
                                />
                              </label>
                            )}
                          {transaction.showLedgerApprovalCheckbox &&
                            !transaction.approvalPendingFooterDuplicate &&
                            !clientPendingBottomDup &&
                            gcecChequeDateHasArrived &&
                            !canApprovePdcDailyLedger() &&
                            !isViewer &&
                            !transaction.ledgerApproved && (
                              <span className="text-xs text-amber-800 max-w-[140px] leading-tight">
                                Awaiting ledger approval (admin / accountant)
                              </span>
                            )}
                          {(() => {
                            const chequeHref = chequeAttachmentHrefForRow(transaction);
                            if (!chequeHref) return null;
                            return (
                              <PdcAttachmentTableCell
                                hideIfMissing
                                attachmentUrl={chequeHref}
                                attachmentName={
                                  transaction.attachment?.name ??
                                  transaction.attachmentName ??
                                  'Cheque scan'
                                }
                              />
                            );
                          })()}
                          {canMutate &&
                            !clientPendingBottomDup &&
                            !clientPendingTopDup &&
                            (!transaction.syntheticFromPdc || isPdcDueId(transaction.id)) &&
                            !transaction.approvalPendingFooterDuplicate &&
                            gcecAllowsEditDelete && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(transaction)}
                                  className="p-2 text-black hover:bg-blue-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                  title="Edit transaction"
                                  aria-label={`Edit ${transaction.categoryName}`}
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteClick(String(transaction.id))
                                  }
                                  className="p-2 text-black hover:bg-red-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                                  title="Delete transaction"
                                  aria-label={`Delete ${transaction.categoryName}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
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

      {/* Add/Edit Bank Transaction Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          form.reset({
            editMode: 'ledger',
            date: '',
            entryTime: '',
            type: 'Debit',
            categoryId: '',
            paymentType: 'cash',
            chequeNumber: '',
            remarks: '',
            customerName: '',
            pdcType: 'GCEC PDC',
            chequeType: 'Payment Cheque',
            description: '',
            amount: '',
          });
          setEditingTransaction(null);
          setChequeAttachmentFile(null);
          setRemoveChequeAttachmentOnSave(false);
          setError(null);
        }
      }}>
        <DialogContent className="sm:max-w-[760px]">
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
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
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
                    const year = expandCenturyYear(parseInt(parts[2], 10));
                    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
                    return new Date(year, month - 1, day);
                  };

                  // Convert Date object to dd/mm/yyyy string
                  const formatDate = (date: Date | null): string => {
                    if (!date || isNaN(date.getTime())) return '';
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = String(date.getFullYear());
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
                              placeholder="dd/mm/yy"
                              value={field.value}
                              onChange={(e) => {
                                let value = e.target.value
                                  .replace(/[^0-9.]/g, '')
                                  .replace(/(\..*)\./g, '$1');
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

              <FormField
                control={form.control}
                name="entryTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Time
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        step={60}
                        value={field.value || ''}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!editingPdcDue ? (
                <>
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
                      return (
                        <FormItem>
                          <FormLabel className="text-lg font-medium text-gray-700">
                            Customer Name
                          </FormLabel>
                          <FormControl>
                            {loadingCategories ? (
                              <div className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-base">
                                <span className="text-muted-foreground">Loading categories...</span>
                                <Loader2 className="h-4 w-4 animate-spin" />
                              </div>
                            ) : availableCategories.length === 0 ? (
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
                                {availableCategories.map((category) => (
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
                        <Select
                          onValueChange={(value) => field.onChange(value === 'blank' ? '' : value)}
                          value={field.value || 'blank'}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select payment type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="cheque">Cheque</SelectItem>
                           
                            <SelectItem value="banktransfer">Online</SelectItem>
                            <SelectItem value="other">DD</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-lg font-medium text-gray-700">
                          Customer Name
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Enter customer name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pdcType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-lg font-medium text-gray-700">
                          PDC Type
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select PDC type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="GCEC PDC">GCEC PDC</SelectItem>
                            <SelectItem value="Customer PDC">Customer PDC</SelectItem>
                            <SelectItem value="Custom PDC">Custom PDC</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="chequeType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-lg font-medium text-gray-700">
                          Cheque Type
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select cheque type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Payment Cheque">Payment Cheque</SelectItem>
                            <SelectItem value="Security Cheque">Security Cheque</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Cheque Number Field - Conditional */}
              {(paymentType === 'cheque' || editingPdcDue) && (
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

              {(paymentType === 'cheque' || editingPdcDue) && (
                <div className="sm:col-span-2 space-y-2">
                  <span className="text-lg font-medium text-gray-700">
                    {editingPdcDue ? 'PDC cheque scan' : 'Cheque scan'}{' '}
                    <span className="text-gray-400 font-normal text-base">
                      (optional — JPG, PNG, WEBP, GIF, HEIC, PDF, max 15 MB)
                    </span>
                  </span>
                  <Input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,image/*,application/pdf"
                    disabled={isSubmitting}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setChequeAttachmentFile(file);
                      if (file) setRemoveChequeAttachmentOnSave(false);
                    }}
                    className="cursor-pointer"
                  />
                  {chequeAttachmentFile && (
                    <p className="text-sm text-gray-600">Selected: {chequeAttachmentFile.name}</p>
                  )}
                  {editingTransaction?.attachmentUrl &&
                    !chequeAttachmentFile &&
                    !removeChequeAttachmentOnSave && (
                      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                        <span>
                          Current:{' '}
                          <a
                            href={
                              resolveAttachmentHref(editingTransaction.attachmentUrl) ?? '#'
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#c9a82f] underline"
                          >
                            {editingTransaction.attachmentName || 'View cheque'}
                          </a>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-red-700 border-red-200 hover:bg-red-50"
                          disabled={isSubmitting}
                          onClick={() => {
                            setRemoveChequeAttachmentOnSave(true);
                            setChequeAttachmentFile(null);
                          }}
                        >
                          Remove scan
                        </Button>
                      </div>
                    )}
                  {removeChequeAttachmentOnSave && !chequeAttachmentFile && (
                    <p className="text-sm text-amber-800">
                      Scan will be removed when you save. You can upload a new file or save to
                      confirm.
                    </p>
                  )}
                </div>
              )}

              {/* Remarks Field */}
              {!editingPdcDue && (
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
              )}

              {editingPdcDue && (
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-medium text-gray-700">
                        Description {editingPdcType === 'Custom PDC' ? '(Required)' : '(Optional)'}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Enter description" {...field} />
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
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.]?[0-9]*"
                        placeholder="0"
                        value={field.value ?? ''}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                        onChange={(e) => {
                          const amountValue = e.target.value
                            .replace(/[^0-9.]/g, '')
                            .replace(/(\..*)\./g, '$1');
                          field.onChange(amountValue);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div className="sm:col-span-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-lg text-red-600">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="sm:col-span-2 w-full bg-[#f7c46d] hover:bg-[#c9a82f] text-black py-3 mt-2 font-semibold"
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

      <BulkTransactionUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        payablesCategories={payablesCategories}
        receivablesCategories={receivablesCategories}
        onSuccess={() => {
          void fetchTransactions();
          setSuccessMessage('Bulk upload completed.');
          setError(null);
        }}
      />

      <DeleteConfirmationDialog
        open={pdcApproveDialogOpen}
        onOpenChange={(open) => {
          setPdcApproveDialogOpen(open);
          if (!open) setPdcApprovePdcId(null);
        }}
        onConfirm={() => void handlePdcApproveConfirm()}
        title="Approve for daily ledger?"
        description="Approve this matured PDC for the daily ledger? Confirm with Yes to continue."
        variant="activate"
        confirmButtonText="Yes"
        loadingButtonText="Approving…"
        isLoading={
          pdcApprovePdcId != null && pdcLedgerApproving === pdcApprovePdcId
        }
      />

      <Dialog
        open={!!approvalOffer}
        onOpenChange={(open) => {
          if (!open) setApprovalOffer(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {approvalOffer?.mode === 'success' ? 'Request submitted' : 'Admin approval required'}
            </DialogTitle>
          </DialogHeader>
          {approvalOffer?.mode === 'success' ? (
            <p className="text-sm text-green-800 font-medium leading-relaxed">{approvalOffer.message}</p>
          ) : (
            <p className="text-sm text-gray-600">
              {approvalOffer?.mode === 'edit'
                ? 'Your account cannot edit transactions directly. Submit this update for an admin to review and apply?'
                : approvalOffer?.mode === 'pdc_edit'
                  ? 'Your account cannot edit this PDC directly. Submit this update (including cheque scan if attached) for an admin to review?'
                  : approvalOffer?.mode === 'pdc_daily_ledger'
                    ? 'Your account cannot approve this PDC for the daily ledger directly. Submit an approval request for an admin to review?'
                    : 'Your account cannot delete transactions directly. Submit this deletion for an admin to review?'}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {approvalOffer?.mode === 'success' ? (
              <Button
                type="button"
                  className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black w-full sm:w-auto font-semibold"
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
                  className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black font-semibold"
                  onClick={() => void submitApprovalRequest()}
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
    </Layout>
  );
}

