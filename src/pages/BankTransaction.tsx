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
  type PostDatedCheque as PostDatedChequeType,
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
    ledgerApproved: bool(pick('ledgerApproved', 'ledger_approved')),
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

function pdcKindFromTypeOrRemarks(t: Pick<BankTransaction, 'pdcType' | 'remarks'>): 'gcec' | 'customer' | 'other' {
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

/** @see remarksForDailyLedgerDisplay — same rules for CSV/Excel. */
function remarksForExport(remarks?: string | null, pdcType?: string): string {
  return remarksForDailyLedgerDisplay(remarks, pdcType);
}

/** Daily Transaction table Remarks column — same rules as {@link remarksForExport}. */
function remarksForTableDisplay(remarks?: string | null, pdcType?: string): string {
  return remarksForExport(remarks, pdcType);
}

function sanitizePdcUserNote(note?: string | null): string {
  const trimmed = String(note ?? '').trim();
  if (!trimmed) return '';
  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
  if (
    normalized === 'customer pdc' ||
    normalized === 'gcec pdc' ||
    normalized === 'custom pdc' ||
    normalized === 'pdc customer' ||
    normalized === 'pdc gcec' ||
    normalized === 'pdc custom'
  ) {
    return '';
  }
  return trimmed;
}

/**
 * API may still send `approvalPendingFooterDuplicate` reminder rows (no date). We hide them:
 * the “no date” tail rows are **frontend-only** copies of unapproved PDC (`clientPendingBottomDup`)
 * until ledger approval, then they disappear — no separate API rows needed for that UX.
 */
function isPdcLedgerFooterRow(t: BankTransaction): boolean {
  return !!t.approvalPendingFooterDuplicate;
}

function hasLedgerTransactionDatePassed(t: BankTransaction): boolean {
  const parsedDate = parseTransactionDateForSort(t);
  if (!parsedDate) return true;

  const transactionDay = new Date(parsedDate);
  transactionDay.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Duplicate only after the transaction date has fully passed.
  return transactionDay.getTime() < today.getTime();
}

function isFutureLedgerTransaction(t: BankTransaction): boolean {
  const parsedDate = parseTransactionDateForSort(t);
  if (!parsedDate) return false;
  const transactionDay = new Date(parsedDate);
  transactionDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return transactionDay.getTime() > today.getTime();
}

function isWithinUpcomingDays(t: BankTransaction, days: number): boolean {
  const parsedDate = parseTransactionDateForSort(t);
  if (!parsedDate) return false;
  const transactionDay = new Date(parsedDate);
  transactionDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastAllowed = new Date(today);
  lastAllowed.setDate(lastAllowed.getDate() + days);
  return (
    transactionDay.getTime() > today.getTime() &&
    transactionDay.getTime() <= lastAllowed.getTime()
  );
}

/**
 * GCEC / Customer PDC not yet ledger-approved: duplicated at table bottom (until approved).
 * Original row stays in chronological place with date; bottom copy has no date (purely client render).
 */
function isUnapprovedPdcPinBottom(t: BankTransaction): boolean {
  if (isPdcLedgerFooterRow(t)) return false;
  if (t.ledgerApproved) return false;
  if (!hasLedgerTransactionDatePassed(t)) return false;
  if (rowIsGcecPdcHighlight(t.remarks, t.pdcType)) return true;
  if (rowIsCustomerPdcHighlight(t.remarks, t.pdcType)) return true;
  return false;
}

function shouldHideLedgerDateColumn(
  t: BankTransaction,
  clientPendingBottomDup = false
): boolean {
  if (isPdcLedgerFooterRow(t)) return true;
  if (clientPendingBottomDup) return true;
  return false;
}

/** Date in grid / exports. Use `clientPendingBottomDup` for the extra copy at the end (no date). */
function displayTransactionDate(
  t: BankTransaction,
  clientPendingBottomDup = false
): string {
  return shouldHideLedgerDateColumn(t, clientPendingBottomDup)
    ? ''
    : t.date || '';
}

/**
 * Omit balance on no-date / reminder rows so totals are not doubled — except unapproved GCEC PDC,
 * where credit and balance must stay visible until ledger approval.
 */
function shouldSuppressBalanceForDisplay(
  t: BankTransaction,
  clientPendingBottomDup = false
): boolean {
  const gcecAwaitingApproval =
    rowIsGcecPdcHighlight(t.remarks, t.pdcType) && !t.ledgerApproved;
  if (gcecAwaitingApproval) return false;
  return shouldHideLedgerDateColumn(t, clientPendingBottomDup);
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
  clientPendingBottomDup = false
): boolean {
  // Frontend duplicate rows are usually visual-only, except pending GCEC rows
  // that must show projected balance (current + pending GCEC credits above).
  if (clientPendingBottomDup) {
    return isGcecPendingBottomCreditPresentation(t, true);
  }

  // Enforce explicit precedence:
  // 1) GCEC PDC => immediate balance impact
  // 2) Customer PDC => only after approval
  const kind = pdcKindFromTypeOrRemarks(t);
  if (kind === 'gcec') {
    // Upcoming GCEC rows are display-only and must not impact balance yet.
    if (isFutureLedgerTransaction(t)) return false;
    return true;
  }
  if (kind === 'customer') return !!t.ledgerApproved;

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

/**
 * Balance after each row, chained from the first row’s API balance in sort order.
 * `finalRunning` = balance after the last row in `ordered` (chronological body only).
 */
function computeRunningBalanceAfterById(ordered: BankTransaction[]): {
  afterById: Map<string, number>;
  finalRunning: number;
} {
  const afterById = new Map<string, number>();
  if (ordered.length === 0) return { afterById, finalRunning: 0 };
  let after = parseFormattedBalance(ordered[0].balance);
  if (!shouldAffectRunningBalance(ordered[0])) {
    after = after - parseLedgerAmount(ordered[0].credit) + parseLedgerAmount(ordered[0].debit);
  }
  const id0 = String(ordered[0].id ?? '');
  if (id0) afterById.set(id0, after);
  for (let i = 1; i < ordered.length; i++) {
    const t = ordered[i];
    if (shouldAffectRunningBalance(t)) {
      after = after + parseLedgerAmount(t.credit) - parseLedgerAmount(t.debit);
    }
    const id = String(t.id ?? '');
    if (id) afterById.set(id, after);
  }
  return { afterById, finalRunning: after };
}

/**
 * Frontend “pending” copies at the bottom share the same `id` as the dated row, so their
 * balance must continue the chain after `finalRunning`, using presentation amounts
 * (`getLedgerDebitCreditNumeric(..., true)`).
 */
function computePendingDupBalanceById(
  finalRunningAfterBody: number,
  pendingBottomRows: BankTransaction[]
): Map<string, number> {
  const pendingDupById = new Map<string, number>();
  let running = finalRunningAfterBody;
  for (const t of pendingBottomRows) {
    if (shouldAffectRunningBalance(t, true)) {
      const { debit, credit } = getLedgerDebitCreditNumeric(t, true);
      running = running + credit - debit;
    }
    const id = String(t.id ?? '');
    if (id) pendingDupById.set(id, running);
  }
  return pendingDupById;
}

function buildLedgerBalanceMaps(filtered: BankTransaction[]): {
  bodyAfterById: Map<string, number>;
  pendingDupAfterById: Map<string, number>;
  statementClosing: number;
} {
  const ordered = sortTransactionsOldestFirst(filtered);
  const { afterById: bodyAfterById, finalRunning } =
    computeRunningBalanceAfterById(ordered);
  const pendingRows = filtered.filter((t) => isUnapprovedPdcPinBottom(t));
  const pendingDupAfterById = computePendingDupBalanceById(finalRunning, pendingRows);
  let statementClosing = finalRunning;
  for (const t of pendingRows) {
    if (shouldAffectRunningBalance(t, true)) {
      const { debit, credit } = getLedgerDebitCreditNumeric(t, true);
      statementClosing = statementClosing + credit - debit;
    }
  }
  return { bodyAfterById, pendingDupAfterById, statementClosing };
}

function balanceAfterForDisplay(
  t: BankTransaction,
  clientPendingBottomDup: boolean | undefined,
  bodyAfterById: Map<string, number>,
  pendingDupAfterById: Map<string, number>
): number {
  const id = String(t.id ?? '');
  const isFrontendUpcomingRow = id.startsWith('frontend-upcoming-pdc-');
  if (isFrontendUpcomingRow) {
    const pendingBalances = Array.from(pendingDupAfterById.values());
    const snapshotBalance = pendingBalances.length
      ? Math.max(...pendingBalances)
      : parseFormattedBalance(t.balance);
    // #region agent log
    fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'post-fix',hypothesisId:'H8',location:'BankTransaction.tsx:balanceAfterForDisplay',message:'Upcoming row uses pending-chain anchor balance',data:{id,snapshotBalance,pendingBalanceCount:pendingBalances.length,pendingBalanceMax:pendingBalances.length?Math.max(...pendingBalances):null,rawBalance:t.balance},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return snapshotBalance;
  }
  if (clientPendingBottomDup && id && pendingDupAfterById.has(id)) {
    return pendingDupAfterById.get(id)!;
  }
  if (id && bodyAfterById.has(id)) {
    return bodyAfterById.get(id)!;
  }
  return parseFormattedBalance(t.balance);
}

/** Debit/credit strings for grid (GCEC pending bottom row flips debit → credit column). */
function getDebitCreditDisplayForRow(
  t: BankTransaction,
  clientPendingBottomDup: boolean | undefined
): { debit: string | null; credit: string | null } {
  const id = String(t.id ?? '');
  if (id.startsWith('frontend-upcoming-pdc-')) {
    // #region agent log
    fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'pre-fix',hypothesisId:'H9',location:'BankTransaction.tsx:getDebitCreditDisplayForRow',message:'Upcoming row debit/credit source before render',data:{id,clientPendingBottomDup:!!clientPendingBottomDup,debit:t.debit ?? null,credit:t.credit ?? null,debitFormatted:t.debitFormatted ?? null,creditFormatted:t.creditFormatted ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }
  if (isGcecPendingBottomCreditPresentation(t, !!clientPendingBottomDup)) {
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
  clientPendingBottomDup: boolean
): { debit: number; credit: number } {
  if (isGcecPendingBottomCreditPresentation(t, clientPendingBottomDup)) {
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
  
  originalDate?: string; // Store original ISO date for editing
  createdAtLocal?: string;
  ledgerApprovedAt?: string;
  ledgerApprovedAtLocal?: string;
}

function parseTransactionDateForSort(t: BankTransaction): Date | null {
  if (t.originalDate) {
    const direct = new Date(t.originalDate);
    if (!Number.isNaN(direct.getTime())) return direct;

    // Fallback: support dd/mm/yyyy from API where JS Date parsing is inconsistent.
    const slashParts = t.originalDate.split('/');
    if (slashParts.length === 3) {
      const day = Number(slashParts[0]);
      const month = Number(slashParts[1]) - 1;
      const year = Number(slashParts[2]);
      const fallback = new Date(year, month, day);
      if (!Number.isNaN(fallback.getTime())) return fallback;
    }
  }
  // Support API date format: yyyy-mm-dd
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    const direct = new Date(`${t.date}T00:00:00`);
    if (!Number.isNaN(direct.getTime())) return direct;
  }
  const parts = t.date?.split('-');
  if (parts?.length === 3) {
    const months: Record<string, string> = {
      Jan: '01',
      Feb: '02',
      Mar: '03',
      Apr: '04',
      May: '05',
      Jun: '06',
      Jul: '07',
      Aug: '08',
      Sep: '09',
      Oct: '10',
      Nov: '11',
      Dec: '12',
    };
    const m = months[parts[1] || ''];
    if (m) {
      const d = new Date(`${parts[2]}-${m}-${parts[0]}`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  // Last fallback for displayed dd/mm/yyyy dates.
  const slashParts = t.date?.split('/');
  if (slashParts?.length === 3) {
    const day = Number(slashParts[0]);
    const month = Number(slashParts[1]) - 1;
    const year = Number(slashParts[2]);
    const fallback = new Date(year, month, day);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }
  return null;
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
  const local = parseLocalDateTimeForSort(t.createdAtLocal);
  if (local) return local.getTime();
  const created = parseLocalDateTimeForSort(t.createdAt);
  if (created) return created.getTime();
  const fromRowDate = parseTransactionDateForSort(t);
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

/** Strict ledger order for table: date desc, createdAt desc, id fallback. */
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

      // For approved rows, latest approval appears first.
      if (approvedA && approvedB) {
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
};

/**
 * Rows for CSV/Excel in chronological order:
 * 1) oldest to newest by date,
 * 2) unapproved no-date duplicate rows at the end.
 */
function buildLedgerExportRows(filteredTransactions: BankTransaction[]): LedgerExportRowSpec[] {
  const bodyTransactions = filteredTransactions.filter((t) => !isPdcLedgerFooterRow(t));
  const sortedBody = sortTransactionsOldestFirst(bodyTransactions);
  const pdcPendingBottomRows = sortedBody.filter((t) => isUnapprovedPdcPinBottom(t));
  const rows: LedgerExportRowSpec[] = [
    ...sortedBody.map((t) => ({
      transaction: t,
      clientPendingBottomDup: false,
    })),
    ...pdcPendingBottomRows.map((t) => ({
      transaction: t,
      clientPendingBottomDup: true,
    })),
  ];

  // Keep export deterministic: rows without visible date always at the end.
  const datedRows = rows.filter(
    ({ transaction, clientPendingBottomDup }) =>
      displayTransactionDate(transaction, clientPendingBottomDup).trim() !== ''
  );
  const blankDateRows = rows.filter(
    ({ transaction, clientPendingBottomDup }) =>
      displayTransactionDate(transaction, clientPendingBottomDup).trim() === ''
  );

  return [...datedRows, ...blankDateRows];
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

// Zod validation schema
const transactionSchema = z.object({
  editMode: z.enum(['ledger', 'pdcDue']).default('ledger'),
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

  const form = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      editMode: 'ledger',
      date: '',
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

  // Clear cheque number when payment type changes away from cheque
  useEffect(() => {
    if (!editingPdcDue && paymentType !== 'cheque') {
      form.setValue('chequeNumber', '');
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
      const [ledgerResponse, pdcResponse]: [
        ApiResponse<BankTransactionType[]>,
        ApiResponse<PostDatedChequeType[]>
      ] = await Promise.all([
        transactionService.getBankTransactions(),
        transactionService.getPostDatedCheques(),
      ]);
      
      if (ledgerResponse.success && ledgerResponse.data && Array.isArray(ledgerResponse.data)) {
        // Process transactions from API response
        const transactionsData: BankTransaction[] = ledgerResponse.data.map((transaction) => {
          const row = transaction as BankTransactionType & Record<string, unknown>;
          const flags = readPdcLedgerRowFlags(row);
          const apiDate = (row.date ?? row.transaction_date ?? row.created_at) as
            | string
            | null
            | undefined;
          const isFooterDup = flags.approvalPendingFooterDuplicate;
          const isoForEdit =
            apiDate && !isFooterDup && typeof apiDate === 'string' ? apiDate : undefined;

          const formattedDate =
            apiDate && !isFooterDup ? formatDate(String(apiDate)) : '';

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
          const isCustomerPdcRow = rowIsCustomerPdcHighlight(remarks, flags.pdcType);

          return {
            ...transaction,
            id: String(transaction.id ?? ''),
            date: formattedDate,
            originalDate: isoForEdit,
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

        const existingLedgerPdcIds = new Set(
          transactionsData
            .map((t) => (typeof t.pdcId === 'number' ? t.pdcId : null))
            .filter((id): id is number => id != null)
        );
        const existingUpcomingFingerprint = new Set(
          transactionsData.map((t) => `${t.chequeNumber || ''}|${t.originalDate || ''}|${parseLedgerAmount(t.credit)}`)
        );

        const anchorBalance = transactionsData.length
          ? parseFormattedBalance(transactionsData[0].balance)
          : 0;
        const anchorBalanceFormatted = anchorBalance.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        const upcomingMergedRows: BankTransaction[] =
          pdcResponse.success && Array.isArray(pdcResponse.data)
            ? pdcResponse.data
                .filter((pdc) => pdc.pdcType === 'GCEC PDC')
                .map((pdc) => {
                  const parsedId = Number(pdc.id);
                  const pdcIdNum = Number.isNaN(parsedId) ? undefined : parsedId;
                  const parsedAmount = parseLedgerAmount(pdc.amount);
                  const parsedDate = new Date(pdc.chequeDate);
                  const isoDate = Number.isNaN(parsedDate.getTime())
                    ? pdc.chequeDate
                    : parsedDate.toISOString().split('T')[0];
                  const fingerprint = `${pdc.chequeNumber || ''}|${isoDate || ''}|${parsedAmount}`;
                  return {
                    pdc,
                    pdcIdNum,
                    parsedAmount,
                    isoDate,
                    fingerprint,
                    within15Future:
                      !Number.isNaN(parsedDate.getTime()) &&
                      isWithinUpcomingDays(
                        {
                          id: String(pdc.id ?? ''),
                          date: formatDate(isoDate),
                          originalDate: isoDate,
                          paymentType: 'cheque',
                          balance: anchorBalanceFormatted,
                        } as BankTransaction,
                        15
                      ),
                  };
                })
                .filter(({ pdcIdNum, within15Future, fingerprint }) => {
                  if (!within15Future) return false;
                  if (pdcIdNum != null && existingLedgerPdcIds.has(pdcIdNum)) return false;
                  if (existingUpcomingFingerprint.has(fingerprint)) return false;
                  return true;
                })
                .map(({ pdc, pdcIdNum, parsedAmount, isoDate }) => ({
                  id: `frontend-upcoming-pdc-${String(pdc.id ?? '')}`,
                  date: formatDate(isoDate),
                  originalDate: isoDate,
                  categoryName: pdc.customerName || 'GCEC PDC',
                  categoryId: undefined,
                  paymentType: 'cheque',
                  chequeNumber: pdc.chequeNumber || '',
                  debit: parsedAmount,
                  credit: 0,
                  debitFormatted: parsedAmount.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  }),
                  creditFormatted: null,
                  balance: anchorBalanceFormatted,
                  remarks: 'GCEC PDC',
                  pdcId: pdcIdNum,
                  pdcType: 'GCEC PDC',
                  syntheticFromPdc: true,
                  ledgerApprovalRequired: false,
                  ledgerApproved: false,
                  showLedgerApprovalCheckbox: false,
                  approvalPendingFooterDuplicate: false,
                }))
            : [];

        // #region agent log
        fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'post-fix',hypothesisId:'H5',location:'BankTransaction.tsx:fetchTransactions',message:'Frontend upcoming PDC merge stats',data:{ledgerCount:transactionsData.length,pdcApiSuccess:!!pdcResponse.success,pdcCount:Array.isArray(pdcResponse.data)?pdcResponse.data.length:0,mergedUpcomingCount:upcomingMergedRows.length,sampleMerged:upcomingMergedRows.slice(0,5).map((r)=>({id:String(r.id ?? ''),date:r.date,originalDate:r.originalDate,pdcId:r.pdcId,credit:r.credit,remarks:r.remarks}))},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        setTransactions([...upcomingMergedRows, ...transactionsData]);
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

      if (editingTransaction && isPdcDueId(editingTransaction.id)) {
        const normalizeDate = (value: string): string => {
          const s = String(value || '').trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const dmY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
          if (dmY) {
            const day = dmY[1].padStart(2, '0');
            const month = dmY[2].padStart(2, '0');
            return `${dmY[3]}-${month}-${day}`;
          }
          return s;
        };

        const pdcUserNote = sanitizePdcUserNote(data.description);
        const pdcPayload: Record<string, unknown> = {
          date: normalizeDate(data.date),
          chequeDate: normalizeDate(data.date),
          amount: amountNumber,
          chequeNumber: data.chequeNumber?.trim() || '',
          customerName: data.customerName?.trim() || '',
          category: data.customerName?.trim() || '',
          chequeType: data.chequeType || 'Payment Cheque',
          pdcType: data.pdcType || 'GCEC PDC',
          remarks: pdcUserNote,
        };

        pendingEditPayload = { ...pdcPayload };
        response = await transactionService.updateBankTransaction(
          String(editingTransaction.id),
          pdcPayload
        );
      } else if (editingTransaction) {
        pendingEditPayload = { ...payload };
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
        form.reset({
          editMode: 'ledger',
          date: '',
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
        setApprovalOffer({
          mode: 'edit',
          resourceId: String(editingTransaction.id),
          payload: {
            ...pendingEditPayload,
            chequeNumber: pendingEditPayload.chequeNumber ?? null,
            remarks: (pendingEditPayload.remarks as string) ?? '',
          },
        });
        setIsModalOpen(false);
        setEditingTransaction(null);
        form.reset({
          editMode: 'ledger',
          date: '',
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
        mode === 'pdc_daily_ledger'
          ? await changeRequestService.submit({
              action: 'edit',
              resourceType: 'pdc',
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
      if (mode === 'edit') {
        setIsModalOpen(false);
        setEditingTransaction(null);
        form.reset({
          editMode: 'ledger',
          date: '',
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
      if (mode === 'pdc_daily_ledger') {
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
      const parts = (transaction.date || '').split('-');
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
    const initialPdcNote = String(transaction.remarks ?? '').trim();
    
    // Reset form with all values
    form.reset({
      editMode: isPdcDueId(transaction.id) ? 'pdcDue' : 'ledger',
      date: dateValue,
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
    setError(null);
    form.reset({
      editMode: 'ledger',
      date: '',
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
  const filteredTransactions = transactions.filter((transaction) => {
    if (transaction.approvalPendingFooterDuplicate) return false;

    // Show future GCEC PDC rows only in a 15-day upcoming window.
    // Use normalized kind detection (pdcType/remarks variants) for reliability.
    const isGcecPdcRow = pdcKindFromTypeOrRemarks(transaction) === 'gcec';
    if (isGcecPdcRow) {
      const parsedDate = parseTransactionDateForSort(transaction);
      const isFuture = isFutureLedgerTransaction(transaction);
      const within15 = isWithinUpcomingDays(transaction, 15);
      // #region agent log
      fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'pre-fix',hypothesisId:'H1',location:'BankTransaction.tsx:filteredTransactions',message:'GCEC row upcoming window evaluation',data:{id:String(transaction.id ?? ''),date:transaction.date ?? '',originalDate:transaction.originalDate ?? '',remarks:transaction.remarks ?? '',pdcType:transaction.pdcType ?? '',parsedDateIso:parsedDate ? parsedDate.toISOString() : null,isFuture,within15,startDate,endDate,activeTab},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!parsedDate) {
        // #region agent log
        fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'pre-fix',hypothesisId:'H2',location:'BankTransaction.tsx:filteredTransactions',message:'GCEC row has unparseable date',data:{id:String(transaction.id ?? ''),date:transaction.date ?? '',originalDate:transaction.originalDate ?? '',remarks:transaction.remarks ?? '',pdcType:transaction.pdcType ?? ''},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
    }
    if (isGcecPdcRow && isFutureLedgerTransaction(transaction)) {
      if (!isWithinUpcomingDays(transaction, 15)) {
        // #region agent log
        fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'pre-fix',hypothesisId:'H3',location:'BankTransaction.tsx:filteredTransactions',message:'GCEC future row excluded by 15-day window',data:{id:String(transaction.id ?? ''),date:transaction.date ?? '',originalDate:transaction.originalDate ?? '',remarks:transaction.remarks ?? '',pdcType:transaction.pdcType ?? ''},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return false;
      }
    }

    // Filter by payment type
    // 'online' tab shows both creditcard and banktransfer (which comes as 'online' from API)
    if (activeTab === 'online' && transaction.paymentType !== 'creditcard' && transaction.paymentType !== 'banktransfer') return false;
    if (activeTab === 'cheque' && transaction.paymentType !== 'cheque') return false;
    if (activeTab === 'cash' && transaction.paymentType !== 'cash') return false;
    
    // Filter by date range
    if (startDate || endDate) {
      const transactionDate = parseDateForFilter(transaction.date || '');
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
  const pdcPendingBottomRows = bodyTransactions.filter((t) => isUnapprovedPdcPinBottom(t));

  type PaginatedLedgerRow = {
    transaction: BankTransaction;
    clientPendingBottomDup?: boolean;
  };

  const paginatedRows: PaginatedLedgerRow[] = [
    ...bodyTransactions.map((t) => ({ transaction: t })),
    ...pdcPendingBottomRows.map((t) => ({ transaction: t, clientPendingBottomDup: true as const })),
  ];

  useEffect(() => {
    const gcecFutureRows = filteredTransactions
      .filter((t) => pdcKindFromTypeOrRemarks(t) === 'gcec' && isFutureLedgerTransaction(t))
      .slice(0, 10)
      .map((t) => ({
        id: String(t.id ?? ''),
        date: t.date ?? '',
        originalDate: t.originalDate ?? '',
        within15: isWithinUpcomingDays(t, 15),
      }));
    // #region agent log
    fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'pre-fix',hypothesisId:'H4',location:'BankTransaction.tsx:rowsLayout',message:'Row buckets after filtering',data:{totalTransactions:transactions.length,filteredCount:filteredTransactions.length,futureCount:0,pendingDupCount:pdcPendingBottomRows.length,normalCount:bodyTransactions.length,paginatedCount:paginatedRows.length,gcecFutureRows,startDate,endDate,activeTab},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [transactions.length, filteredTransactions, pdcPendingBottomRows.length, paginatedRows.length, startDate, endDate, activeTab]);

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
  const handleDownloadCSV = useCallback(() => {

    const safe = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const rowCsv = (...cols: string[]) => {
      const filled = [...cols];
      while (filled.length < 7) filled.push('');
      return filled.slice(0, 7).map((c) => safe(c)).join(',');
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
    const dateTimes = dates.map((d) => d.getTime());
    const startDate = dateTimes.length ? new Date(Math.min(...dateTimes)) : new Date();
    const endDate = dateTimes.length ? new Date(Math.max(...dateTimes)) : new Date();
  
    const formatDate = (d: Date) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };
  
    const { bodyAfterById, pendingDupAfterById, statementClosing } =
      buildLedgerBalanceMaps(filteredTransactions);
    const closingBalanceValue = statementClosing;
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
    csvRows.push(rowCsv('Start Date', formatDate(startDate)));
    csvRows.push(rowCsv('End Date', formatDate(endDate)));
    csvRows.push(rowCsv('Closing (Current)', `AED ${closingBalance}`));
    csvRows.push(rowCsv());
    csvRows.push(rowCsv());

    // ----- TABLE HEADER -----
    csvRows.push(
      rowCsv('Date', 'Description', 'Details', 'Debit', 'Credit', 'Balance', 'Remarks')
    );

    // ----- TABLE ROWS ----- (body oldest-first + unapproved PDC tail + footer — same as grid / Excel)
    buildLedgerExportRows(filteredTransactions).forEach(({ transaction: t, clientPendingBottomDup }) => {
      const details = ledgerExportDetailsColumn(t);
      const { debit: debitValue, credit: creditValue } = getLedgerDebitCreditNumeric(
        t,
        clientPendingBottomDup
      );

      const debit = `AED ${debitValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const credit = `AED ${creditValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      const balanceValue = balanceAfterForDisplay(
        t,
        clientPendingBottomDup,
        bodyAfterById,
        pendingDupAfterById
      );
      const balance = shouldSuppressBalanceForDisplay(t, clientPendingBottomDup)
        ? ''
        : `AED ${balanceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      csvRows.push(
        rowCsv(
          displayTransactionDate(t, clientPendingBottomDup),
          t.categoryName || 'N/A',
          details,
          debit,
          credit,
          balance,
          remarksForExport(t.remarks, t.pdcType)
        )
      );
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
  

  // Excel Download — ExcelJS so fills/fonts persist (.xlsx styles are not supported by `xlsx` community build).
  const handleDownloadExcel = useCallback(async () => {
    const parseDateForRange = (t: BankTransaction) => {
      if (t.originalDate) {
        const origDate = new Date(t.originalDate);
        return isNaN(origDate.getTime()) ? null : origDate;
      }
      const parts = t.date?.split('-');
      if (parts?.length === 3) {
        const months: Record<string, string> = {
          Jan: '01',
          Feb: '02',
          Mar: '03',
          Apr: '04',
          May: '05',
          Jun: '06',
          Jul: '07',
          Aug: '08',
          Sep: '09',
          Oct: '10',
          Nov: '11',
          Dec: '12',
        };
        const date = new Date(`${parts[2]}-${months[parts[1] || '']}-${parts[0]}`);
        return isNaN(date.getTime()) ? null : date;
      }
      return null;
    };

    const dates = filteredTransactions.map(parseDateForRange).filter(Boolean) as Date[];
    const dateTimes = dates.map((d) => d.getTime());
    const startDate = dateTimes.length ? new Date(Math.min(...dateTimes)) : new Date();
    const endDate = dateTimes.length ? new Date(Math.max(...dateTimes)) : new Date();

    const formatDate = (d: Date) => {
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };

    const { bodyAfterById, pendingDupAfterById, statementClosing } =
      buildLedgerBalanceMaps(filteredTransactions);
    const closingBalanceValue = statementClosing;

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
      ws.getCell(r++, 2).value = formatDate(startDate);
      ws.getCell(r, 1).value = 'End Date:';
      ws.getCell(r++, 2).value = formatDate(endDate);
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
      // #region agent log
      (() => {
        const dateFlags = exportRows.map(({ transaction: t, clientPendingBottomDup }, idx) => ({
          idx,
          id: String(t.id ?? ''),
          date: displayTransactionDate(t, clientPendingBottomDup),
          isBlankDate: !displayTransactionDate(t, clientPendingBottomDup).trim(),
          clientPendingBottomDup,
        }));
        const blankDateIndexes = dateFlags.filter((r) => r.isBlankDate).map((r) => r.idx);
        const lastDatedIndex = [...dateFlags]
          .reverse()
          .find((r) => !r.isBlankDate)?.idx ?? -1;
        fetch('http://127.0.0.1:7645/ingest/4e3d99b1-83be-4128-aa73-0b85017ae070',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a253c0'},body:JSON.stringify({sessionId:'a253c0',runId:'pre-fix',hypothesisId:'H10',location:'BankTransaction.tsx:handleDownloadExcel',message:'Excel export blank-date row positions',data:{totalRows:exportRows.length,blankDateIndexes,lastDatedIndex,sampleFirst:dateFlags.slice(0,8),sampleLast:dateFlags.slice(-8)},timestamp:Date.now()})}).catch(()=>{});
      })();
      // #endregion

      const ledgerRowFill = (t: BankTransaction): ExcelJS.Fill | undefined => {
        if (isBouncedChequeRemarks(t.remarks)) {
          return {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF95DCF7' },
          };
        }
        if (rowIsGcecPdcHighlight(t.remarks, t.pdcType)) {
          return {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF9C3' },
          };
        }
        return undefined;
      };

      for (const { transaction: t, clientPendingBottomDup } of exportRows) {
        const details = ledgerExportDetailsColumn(t);
        const remarksText = remarksForExport(t.remarks, t.pdcType);
        const { debit: debitValue, credit: creditValue } = getLedgerDebitCreditNumeric(
          t,
          clientPendingBottomDup
        );
        const balanceValue = balanceAfterForDisplay(
          t,
          clientPendingBottomDup,
          bodyAfterById,
          pendingDupAfterById
        );
        const suppressBal = shouldSuppressBalanceForDisplay(t, clientPendingBottomDup);

        const row = ws.getRow(r);
        row.getCell(1).value = displayTransactionDate(t, clientPendingBottomDup);
        row.getCell(2).value = t.categoryName || 'N/A';
        row.getCell(3).value = details;
        row.getCell(4).value = debitValue;
        row.getCell(4).numFmt = '#,##0.00';
        row.getCell(5).value = creditValue;
        row.getCell(5).numFmt = '#,##0.00';
        row.getCell(6).value = suppressBal ? null : balanceValue;
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(7).value = remarksText;

        const fillStyle = ledgerRowFill(t);
        const isAvailableBalanceRemark =
          remarksText.trim().toLowerCase() === 'available balance';
        for (let c = 1; c <= 7; c++) {
          const cell = row.getCell(c);
          if (fillStyle) {
            cell.fill = fillStyle;
          }
          cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF000000' } };
        }

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
        if (isAvailableBalanceRemark) {
          row.getCell(7).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD1FAE5' },
          };
          row.getCell(7).font = {
            ...(row.getCell(7).font ?? {}),
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: 'FF000000' },
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

      const fileName = `GCEC-Statement-${formatDate(startDate)}-to-${formatDate(endDate)}.xlsx`;
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
  }, [filteredTransactions, setError]);
  
  

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

      {/* Filter Actions */}
      <div className="flex items-end gap-2 w-full">
       
        <Button
          onClick={() => {
            handleClearFilters();
          }}
          className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black h-10 flex-1 shadow-md hover:shadow-lg transition-shadow flex items-center justify-center gap-2"
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
        <Button
          onClick={() => setBulkUploadOpen(true)}
          variant="outline"
          className="flex items-center font-semibold space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || loadingCategories}
        >
          <Upload className="w-4 h-4 font-semibold" />
          <span>Bulk upload</span>
        </Button>
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
                  paginatedRows.map(({ transaction, clientPendingBottomDup }) => {
                    const remarksDisplay = remarksForTableDisplay(
                      transaction.remarks,
                      transaction.pdcType
                    );
                    const isBouncedCheque = isBouncedChequeRemarks(
                      remarksDisplay
                    );
                    const isGcecPdc = rowIsGcecPdcHighlight(
                      transaction.remarks,
                      transaction.pdcType
                    );
                    const isGcecKind = pdcKindFromTypeOrRemarks(transaction) === 'gcec';
                    const isUpcomingGcecRow =
                      isGcecKind &&
                      !clientPendingBottomDup &&
                      isFutureLedgerTransaction(transaction);
                    const remarksCellText = isUpcomingGcecRow
                      ? remarksDisplay
                        ? `${remarksDisplay} (Upcoming)`
                        : 'Upcoming'
                      : remarksDisplay;
                    const isAvailableBalanceRemark =
                      remarksDisplay.trim().toLowerCase() === 'available balance';
                    const rowTone = isBouncedCheque
                      ? 'bounce'
                      : isGcecPdc
                        ? 'gcec'
                        : undefined;
                    const { debit: debitShown, credit: creditShown } =
                      getDebitCreditDisplayForRow(transaction, clientPendingBottomDup);
                    const debitAmount = debitShown
                      ? parseFloat(String(debitShown).replace(/,/g, ''))
                      : 0;
                    const hasDebit = !Number.isNaN(debitAmount) && debitAmount > 0;
                    return (
                    <tr 
                      key={
                        clientPendingBottomDup
                          ? `${transaction.id}-pending-dup`
                          : transaction.id
                      }
                      data-row-bg={rowTone}
                      className={`border-b border-gray-100 transition-colors ${
                        isBouncedCheque
                          ? 'bg-[#7dd3f0] hover:bg-[#67c6ea]'
                          : isGcecPdc
                          ? 'hover:bg-yellow-200/70'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td
                        className="text-gray-700 text-sm py-2 px-4 text-left align-middle"
                      >
                        {displayTransactionDate(transaction, !!clientPendingBottomDup)}
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
                        {transaction.paymentType === 'cheque' && transaction.chequeNumber && transaction.chequeNumber !== '-'
                          ? `${transaction.chequeNumber}`
                          : transaction.paymentType === 'cash'
                          ? 'Cash'
                          : transaction.paymentType === 'creditcard'
                          ? 'Credit Card'
                          : transaction.paymentType === 'banktransfer'
                          ? 'Online'
                          : transaction.paymentType?.toLowerCase() === 'dd'
                          ? 'DD'
                          : <span className="capitalize">{transaction.paymentType || 'N/A'}</span>}
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
                          !!clientPendingBottomDup
                        ) ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          (() => {
                            const balanceValue = balanceAfterForDisplay(
                              transaction,
                              clientPendingBottomDup,
                              ledgerBalanceMaps.bodyAfterById,
                              ledgerBalanceMaps.pendingDupAfterById
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
                            transaction.pdcId != null &&
                            canApprovePdcDailyLedger() && (
                              <label className="flex items-center gap-1.5 text-xs text-gray-800 whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-400 text-[#f7c46d] focus:ring-[#f7c46d] disabled:opacity-60"
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
                                <span>Approved</span>
                              </label>
                            )}
                          {transaction.showLedgerApprovalCheckbox &&
                            !transaction.approvalPendingFooterDuplicate &&
                            !canApprovePdcDailyLedger() &&
                            !isViewer &&
                            !transaction.ledgerApproved && (
                              <span className="text-xs text-amber-800 max-w-[140px] leading-tight">
                                Awaiting ledger approval (admin / accountant)
                              </span>
                            )}
                          {canMutate &&
                            !clientPendingBottomDup &&
                            (!transaction.syntheticFromPdc || isPdcDueId(transaction.id)) &&
                            !transaction.approvalPendingFooterDuplicate && (
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
                            Category
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
                        {...field}
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
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-lg text-red-600">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full bg-[#f7c46d] hover:bg-[#c9a82f] text-black py-3 mt-6 font-semibold"
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

