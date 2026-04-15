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
  FormDescription,
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
  FileSpreadsheet,
  Filter,
  X,
  Upload,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import Calendar from '../components/ui/calendar-tailwind';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import {
  transactionService,
  type BankTransaction as BankTransactionType,
  type BulkDeleteTransactionsResult,
  normalizePdcTypeFromApi,
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
import { canApprovePdcDailyLedger } from '../lib/authPayload';
import {
  remarksForDailyLedgerDisplay,
  rowIsGcecPdcHighlight,
  isCustomerPdcRemarksLabel,
} from '../lib/dailyLedgerRemarksDisplay';

/** Ledger primary key from GET /transactions when `id` is a different surrogate. */
function readLedgerIdFromApiPayload(row: Record<string, unknown> | undefined): number | undefined {
  if (!row) return undefined;
  const tryNum = (v: unknown): number | undefined => {
    if (v === undefined || v === null || String(v).trim() === '') return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const keys = [
    'ledgerId',
    'ledger_id',
    'dailyLedgerId',
    'daily_ledger_id',
    'ledgerEntryId',
    'ledger_entry_id',
  ] as const;
  for (const k of keys) {
    const n = tryNum(row[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}

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

/** Map GET /transactions paymentType to UI form values (online → banktransfer, DD variants → dd). */
function normalizeLedgerPaymentTypeForUi(
  pt: unknown
): 'creditcard' | 'cheque' | 'cash' | 'banktransfer' | 'dd' {
  const s = String(pt ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (s === 'online') return 'banktransfer';
  if (s === 'dd' || s === 'directdebit') return 'dd';
  if (s === 'creditcard' || s === 'cheque' || s === 'cash' || s === 'banktransfer') {
    return s;
  }
  return 'cash';
}

/**
 * When the API sends only `categoryId` or a numeric `category`, show the payables/receivables name
 * in the Description column (not the raw id).
 */
function resolveCategoryDisplayNameFromApiRow(
  row: Record<string, unknown>,
  payables: PayablesCategory[],
  receivables: ReceivablesCategory[]
): string {
  const txTypeRaw = String(row.type ?? '')
    .trim()
    .toLowerCase();
  const primary = txTypeRaw === 'credit' ? receivables : payables;
  const secondary = txTypeRaw === 'credit' ? payables : receivables;
  const catId = row.categoryId ?? row.category_id;
  const rawCat =
    row.category != null && row.category !== '' ? String(row.category).trim() : '';

  const nameById = (id: string): string | undefined => {
    const a = primary.find((c) => String(c.id) === id);
    if (a) return a.name;
    const b = secondary.find((c) => String(c.id) === id);
    return b?.name;
  };

  if (catId != null && String(catId).trim() !== '') {
    const n = nameById(String(catId));
    if (n) return n;
  }
  if (rawCat && /^\d+$/.test(rawCat)) {
    const n = nameById(rawCat);
    if (n) return n;
  }
  if (rawCat) return rawCat;
  return 'N/A';
}

/** Same detection as ledger grid row background for bounced / returned cheque. */
function isBouncedChequeRemarks(remarks?: string | null): boolean {
  const remarksLower = String(remarks || '').toLowerCase().trim() || '';
  return (
    remarksLower === 'bounced cheque' ||
    remarksLower === 'bouncedcheque' ||
    remarksLower === 'bouncedchecq' ||
    remarksLower === 'returned cheque' ||
    remarksLower === 'returnedcheque' ||
    (remarksLower.includes('bounced') && remarksLower.includes('cheque')) ||
    (remarksLower.includes('returned') && remarksLower.includes('cheque'))
  );
}

/** Customer PDC rows — API `pdcType` or short remark label only (not free-form sentences). */
function rowIsCustomerPdcHighlight(remarks?: string | null, pdcType?: string): boolean {
  if (pdcType && normalizePdcTypeFromApi(pdcType) === 'Customer PDC') return true;
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

/**
 * API may still send `approvalPendingFooterDuplicate` reminder rows (no date). We hide them:
 * the “no date” tail rows are **frontend-only** copies of unapproved PDC (`clientPendingBottomDup`)
 * until ledger approval, then they disappear — no separate API rows needed for that UX.
 */
function isPdcLedgerFooterRow(t: BankTransaction): boolean {
  return !!t.approvalPendingFooterDuplicate;
}

/**
 * GCEC / Customer PDC not yet ledger-approved: duplicated at table bottom (until approved).
 * Original row stays in chronological place with date; bottom copy has no date (purely client render).
 */
function isUnapprovedPdcPinBottom(t: BankTransaction): boolean {
  if (isPdcLedgerFooterRow(t)) return false;
  if (t.ledgerApproved) return false;
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
  const id0 = String(ordered[0].id ?? '');
  if (id0) afterById.set(id0, after);
  for (let i = 1; i < ordered.length; i++) {
    const t = ordered[i];
    after = after + parseLedgerAmount(t.credit) - parseLedgerAmount(t.debit);
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
    const { debit, credit } = getLedgerDebitCreditNumeric(t, true);
    running = running + credit - debit;
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
    const { debit, credit } = getLedgerDebitCreditNumeric(t, true);
    statementClosing = statementClosing + credit - debit;
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
  if (clientPendingBottomDup && id && pendingDupAfterById.has(id)) {
    return pendingDupAfterById.get(id)!;
  }
  if (id && bodyAfterById.has(id)) return bodyAfterById.get(id)!;
  return parseFormattedBalance(t.balance);
}

/** Debit/credit strings for grid (GCEC pending bottom row flips debit → credit column). */
function getDebitCreditDisplayForRow(
  t: BankTransaction,
  clientPendingBottomDup: boolean | undefined
): { debit: string | null; credit: string | null } {
  if (isGcecPendingBottomCreditPresentation(t, !!clientPendingBottomDup)) {
    const d = parseLedgerAmount(t.debit);
    const c = parseLedgerAmount(t.credit);
    if (d > 0) {
      return {
        debit: null,
        credit: t.debitFormatted || d.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      };
    }
    if (c > 0) {
      return {
        debit: null,
        credit: t.creditFormatted || c.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
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
  /** Raw GET /transactions row for bulk-delete `transactions` payload (typed rows). */
  bulkDeleteSourceRow?: Record<string, unknown>;

  originalDate?: string; // Store original ISO date for editing
}

const BULK_DELETE_ENTITY_TYPES = new Set([
  'GCEC PDC',
  'Customer PDC',
  'Custom PDC',
  'Purchase Bill',
]);

/** PDC rows in bulk-delete must use numeric post_dated_cheques id, not synthetic ledger keys like pdc-due-20. */
const BULK_DELETE_PDC_TRANSACTION_TYPES = new Set([
  'GCEC PDC',
  'Customer PDC',
  'Custom PDC',
]);

function numericPostDatedChequeId(t: BankTransaction): number | undefined {
  if (t.pdcId != null && String(t.pdcId).trim() !== '') {
    const n = Number(t.pdcId);
    if (!Number.isNaN(n)) return n;
  }
  const raw = t.bulkDeleteSourceRow?.pdcId ?? t.bulkDeleteSourceRow?.pdc_id;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  const m = /^pdc-due-(\d+)$/i.exec(String(t.id ?? '').trim());
  if (m) return Number(m[1]);
  return undefined;
}

/** PDC / purchase-bill rows must use `transactions[]` with transactionType — not bare numeric `ids`. */
function rowMustUseTransactionPayload(t: BankTransaction): boolean {
  const raw = t.bulkDeleteSourceRow;
  const apiT = String(raw?.transactionType ?? raw?.transaction_type ?? '').trim();
  if (BULK_DELETE_ENTITY_TYPES.has(apiT)) return true;
  if (apiT.toLowerCase().includes('purchase')) return true;
  if (rowIsGcecPdcHighlight(t.remarks, t.pdcType)) return true;
  if (rowIsCustomerPdcHighlight(t.remarks, t.pdcType)) return true;
  if (t.syntheticFromPdc) return true;
  if (raw?.vendorName != null || raw?.vendor_name != null) return true;
  return false;
}

/** Prefer real ledger id from GET /transactions; bulk-delete resolves `ids` against the ledger table. */
function readLedgerIdForBulkDelete(t: BankTransaction): number | undefined {
  return (
    readLedgerIdFromApiPayload(t.bulkDeleteSourceRow) ??
    readLedgerIdFromApiPayload(t as unknown as Record<string, unknown>)
  );
}

/** Plain ledger id (number) or synthetic string id (e.g. pdc-due-123) for `ids` only. */
function rowIdForBulkDeleteIdsArray(t: BankTransaction): string | number | null {
  const ledgerId = readLedgerIdForBulkDelete(t);
  if (ledgerId !== undefined) return ledgerId;

  const idStr = String(t.id ?? '').trim();
  if (!idStr) return null;
  if (!/^\d+$/.test(idStr)) return idStr;
  return Number(idStr);
}

/** DELETE /transactions/:id expects the same id the API uses for the ledger row (often `ledgerId`). */
function transactionIdForSingleDelete(t: BankTransaction | undefined): string | null {
  if (!t) return null;
  const ledger = readLedgerIdForBulkDelete(t);
  if (ledger !== undefined) return String(ledger);
  const idStr = String(t.id ?? '').trim();
  return idStr || null;
}

function buildBulkDeleteTransactionPayload(t: BankTransaction): Record<string, unknown> {
  const src =
    t.bulkDeleteSourceRow != null
      ? ({ ...t.bulkDeleteSourceRow } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  let transactionType = String(src.transactionType ?? src.transaction_type ?? '').trim();
  if (!transactionType) {
    if (rowIsGcecPdcHighlight(t.remarks, t.pdcType)) transactionType = 'GCEC PDC';
    else if (rowIsCustomerPdcHighlight(t.remarks, t.pdcType))
      transactionType = 'Customer PDC';
    else if (t.syntheticFromPdc) transactionType = normalizePdcTypeFromApi(t.pdcType);
    else if (
      src.vendorName != null ||
      src.vendor_name != null ||
      src.invoiceNumber != null ||
      src.invoice_number != null
    )
      transactionType = 'Purchase Bill';
  }
  if (!transactionType) transactionType = 'Daily Transaction';

  const pdcNumericId = numericPostDatedChequeId(t);
  const isPdcTypedRow = BULK_DELETE_PDC_TRANSACTION_TYPES.has(transactionType);
  const ledgerForDaily = readLedgerIdForBulkDelete(t);
  const idForApi: string | number =
    isPdcTypedRow && pdcNumericId != null
      ? pdcNumericId
      : ledgerForDaily !== undefined
        ? ledgerForDaily
        : (t.id ?? '');

  const out: Record<string, unknown> = {
    ...src,
    transactionType,
    id: idForApi,
    pdcId: pdcNumericId ?? t.pdcId ?? src.pdcId ?? src.pdc_id,
    pdcType: t.pdcType ?? src.pdcType ?? src.pdc_type,
    syntheticFromPdc:
      t.syntheticFromPdc ?? src.syntheticFromPdc ?? src.synthetic_from_pdc,
  };
  if (isPdcTypedRow && pdcNumericId != null) {
    out.post_dated_cheque_id = pdcNumericId;
    out.post_dated_cheques_id = pdcNumericId;
  }
  return out;
}

function buildBulkDeleteRequestBody(list: BankTransaction[]): {
  ids: (string | number)[];
  transactions: Record<string, unknown>[];
} {
  const ids: (string | number)[] = [];
  const transactions: Record<string, unknown>[] = [];
  const idKeys = new Set<string>();
  const txnKeys = new Set<string>();

  for (const t of list) {
    if (t.approvalPendingFooterDuplicate) continue;

    if (rowMustUseTransactionPayload(t)) {
      const payload = buildBulkDeleteTransactionPayload(t);
      const tt = String(payload.transactionType ?? '');
      const key = `${tt}:${String(payload.id)}:${String(payload.pdcId ?? '')}`;
      if (txnKeys.has(key)) continue;
      txnKeys.add(key);
      transactions.push(payload);
    } else {
      const id = rowIdForBulkDeleteIdsArray(t);
      if (id == null) continue;
      const k = `${typeof id}:${id}`;
      if (idKeys.has(k)) continue;
      idKeys.add(k);
      ids.push(id);
    }
  }
  return { ids, transactions };
}

function unwrapBulkDeleteResult(raw: unknown): BulkDeleteTransactionsResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
    return o.data as BulkDeleteTransactionsResult;
  }
  return o as BulkDeleteTransactionsResult;
}

function formatBulkDeleteSuccessMessage(raw: unknown, fallback: string): string {
  const d = unwrapBulkDeleteResult(raw);
  if (!d) return fallback;
  const parts: string[] = [];
  if (typeof d.deletedLedger === 'number') parts.push(`${d.deletedLedger} ledger`);
  if (typeof d.deletedPdc === 'number') parts.push(`${d.deletedPdc} PDC`);
  if (typeof d.deletedPurchaseBills === 'number')
    parts.push(`${d.deletedPurchaseBills} purchase bill(s)`);
  const notes: string[] = [];
  if (Array.isArray(d.missingIds) && d.missingIds.length)
    notes.push(`missing ledger ids: ${d.missingIds.length}`);
  if (Array.isArray(d.missingLedgerIds) && d.missingLedgerIds.length)
    notes.push(`missing ledger ids (detail): ${d.missingLedgerIds.length}`);
  if (Array.isArray(d.missingPdcIds) && d.missingPdcIds.length)
    notes.push(`missing PDC ids: ${d.missingPdcIds.length}`);
  if (Array.isArray(d.missingPurchaseBillIds) && d.missingPurchaseBillIds.length)
    notes.push(`missing purchase bill ids: ${d.missingPurchaseBillIds.length}`);
  let msg = parts.length ? `Deleted ${parts.join(', ')}.` : fallback;
  if (notes.length) msg += ` ${notes.join('; ')}.`;
  return msg;
}

function parseTransactionDateForSort(t: BankTransaction): Date | null {
  if (t.originalDate) {
    const d = new Date(t.originalDate);
    return Number.isNaN(d.getTime()) ? null : d;
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
  return null;
}

function sortTransactionsOldestFirst(transactions: BankTransaction[]): BankTransaction[] {
  return [...transactions].sort((a, b) => {
    const dateA = parseTransactionDateForSort(a);
    const dateB = parseTransactionDateForSort(b);
    if (!dateA && !dateB) {
      return (
        parseInt(String(a.id || '0'), 10) - parseInt(String(b.id || '0'), 10)
      );
    }
    if (!dateA) return 1;
    if (!dateB) return -1;
    const cmp = dateA.getTime() - dateB.getTime();
    if (cmp !== 0) return cmp;
    return (
      parseInt(String(a.id || '0'), 10) - parseInt(String(b.id || '0'), 10)
    );
  });
}

type LedgerExportRowSpec = {
  transaction: BankTransaction;
  clientPendingBottomDup: boolean;
};

/**
 * Rows for CSV/Excel: chronological body, then pinned copies of unapproved PDC (until approved),
 * then API footer reminder rows — mirrors the table’s last-page tail.
 */
function buildLedgerExportRows(filteredTransactions: BankTransaction[]): LedgerExportRowSpec[] {
  const bodyTransactions = filteredTransactions.filter((t) => !isPdcLedgerFooterRow(t));
  const pdcPendingBottomRows = bodyTransactions.filter((t) => isUnapprovedPdcPinBottom(t));

  return [
    ...sortTransactionsOldestFirst(bodyTransactions).map((t) => ({
      transaction: t,
      clientPendingBottomDup: false,
    })),
    ...pdcPendingBottomRows.map((t) => ({
      transaction: t,
      clientPendingBottomDup: true,
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
  if (t.paymentType === 'dd') return 'DD';
  if (t.paymentType) return t.paymentType;
  return '';
}

// Zod validation schema
const transactionSchema = z.object({
  date: z.string()
    .min(10, 'Date is required')
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in dd/mm/yyyy format'),
  type: z.enum(['Debit', 'Credit'], {
    required_error: 'Please select a type',
  }),
  categoryId: z.string(),
  paymentType: z.enum(['creditcard', 'cheque', 'cash', 'banktransfer', 'dd'], {
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
  if (data.paymentType === 'dd') return true;
  return data.categoryId.trim().length > 0;
}, {
  message: 'Category is required',
  path: ['categoryId'],
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
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchDetails, setSearchDetails] = useState<string>('');
  const [searchAmount, setSearchAmount] = useState<string>('');
  const [searchDescription, setSearchDescription] = useState<string>('');
  const [searchRemarks, setSearchRemarks] = useState<string>('');

  type ApprovalOffer =
    | { mode: 'edit'; resourceId: string; payload: Record<string, unknown> }
    | { mode: 'delete'; resourceId: string }
    | {
        mode: 'delete_bulk';
        ids: (string | number)[];
        transactions: Record<string, unknown>[];
      }
    | { mode: 'pdc_daily_ledger'; resourceId: string; payload: Record<string, unknown> }
    | { mode: 'success'; message: string };
  const [approvalOffer, setApprovalOffer] = useState<ApprovalOffer | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pdcLedgerApproving, setPdcLedgerApproving] = useState<number | null>(null);
  const [pdcApproveDialogOpen, setPdcApproveDialogOpen] = useState(false);
  const [pdcApprovePdcId, setPdcApprovePdcId] = useState<number | null>(null);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

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

  // DD (direct debit) does not use a payables/receivables category
  useEffect(() => {
    if (paymentType === 'dd') {
      form.setValue('categoryId', '');
    }
  }, [paymentType, form]);

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

  /** After categories load, replace numeric Description / category fields with real category names. */
  useEffect(() => {
    if (payablesCategories.length === 0 && receivablesCategories.length === 0) return;
    setTransactions((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const src = t.bulkDeleteSourceRow;
        if (!src) return t;
        const resolved = resolveCategoryDisplayNameFromApiRow(
          { ...src, type: t.type ?? src.type },
          payablesCategories,
          receivablesCategories
        );
        if (resolved !== t.categoryName) {
          changed = true;
          return { ...t, categoryName: resolved };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [payablesCategories, receivablesCategories]);

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
        const transactionsData: BankTransaction[] = response.data.map((transaction) => {
          const row = transaction as BankTransactionType & Record<string, unknown>;
          const flags = readPdcLedgerRowFlags(row);
          const apiDate = row.date;
          const isFooterDup = flags.approvalPendingFooterDuplicate;
          const isoForEdit =
            apiDate && !isFooterDup && typeof apiDate === 'string' ? apiDate : undefined;

          const formattedDate =
            apiDate && !isFooterDup ? formatDate(String(apiDate)) : '';

          const debitNum = parseLedgerAmount(transaction.debit);
          const creditNum = parseLedgerAmount(transaction.credit);
          const debitAmount = debitNum
            ? debitNum.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })
            : null;
          const creditAmount = creditNum
            ? creditNum.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })
            : null;

          const formattedBalance =
            typeof transaction.balance === 'number'
              ? transaction.balance.toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })
              : String(transaction.balance || '0');

          const frontendPaymentType = normalizeLedgerPaymentTypeForUi(transaction.paymentType);

          const remarksRaw = row.remarks;
          const remarks =
            remarksRaw === undefined || remarksRaw === null ? undefined : String(remarksRaw);

          const ledgerIdResolved = readLedgerIdFromApiPayload(row as Record<string, unknown>);
          return {
            ...transaction,
            bulkDeleteSourceRow: { ...row },
            ...(ledgerIdResolved !== undefined ? { ledgerId: ledgerIdResolved } : {}),
            id: String(transaction.id ?? ''),
            date: formattedDate,
            originalDate: isoForEdit,
            categoryName: transaction.category || 'N/A',
            categoryId: (row.categoryId ?? row.category_id) as string | number | undefined,
            paymentType: frontendPaymentType as
              | 'creditcard'
              | 'cheque'
              | 'cash'
              | 'banktransfer'
              | 'dd',
            debit: transaction.debit,
            credit: transaction.credit,
            debitFormatted: debitAmount,
            creditFormatted: creditAmount,
            balance: formattedBalance,
            remarks,
            pdcId: flags.pdcId,
            pdcType: flags.pdcType,
            syntheticFromPdc: flags.syntheticFromPdc,
            ledgerApprovalRequired: flags.ledgerApprovalRequired,
            ledgerApproved: flags.ledgerApproved,
            showLedgerApprovalCheckbox: flags.showLedgerApprovalCheckbox,
            approvalPendingFooterDuplicate: flags.approvalPendingFooterDuplicate,
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
      // Convert 'banktransfer' to 'online' for API; DD stays `dd`
      const apiPaymentType =
        data.paymentType === 'banktransfer'
          ? 'online'
          : data.paymentType === 'dd'
            ? 'dd'
            : data.paymentType;
      
      const payload: {
        date: string;
        type: 'Debit' | 'Credit';
        categoryId?: string | number;
        paymentType: 'creditcard' | 'cheque' | 'cash' | 'online' | 'dd';
        chequeNumber?: string;
        remarks?: string;
        amount: number;
      } = {
        date: data.date, // Format: dd/mm/yyyy
        type: data.type,
        paymentType: apiPaymentType as 'creditcard' | 'cheque' | 'cash' | 'online' | 'dd',
        amount: amountNumber,
      };
      if (data.paymentType !== 'dd' && data.categoryId.trim() !== '') {
        payload.categoryId = data.categoryId;
      }

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
        pendingEditPayload = { ...payload };
        // Update existing transaction (URL id must match ledger row when API separates list id from ledger id)
        const idForUpdate =
          transactionIdForSingleDelete(editingTransaction) ?? String(editingTransaction.id);
        response = await transactionService.updateBankTransaction(idForUpdate, payload);
      } else {
        // Create new transaction
        response = await transactionService.createBankTransaction(payload);
      }

      if (response.success && response.data) {
        // Find category name for display based on transaction type
        const categoryList = data.type === 'Debit' ? payablesCategories : receivablesCategories;
        const selectedCategory =
          data.paymentType === 'dd'
            ? undefined
            : categoryList.find((cat) => String(cat.id) === data.categoryId);
        
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
            categoryName: selectedCategory?.name ?? response.data.category ?? 'N/A',
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
            categoryName: selectedCategory?.name ?? response.data.category ?? 'N/A',
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
          date: '',
          type: 'Debit',
          categoryId: '',
          paymentType: 'cash',
          chequeNumber: '',
          remarks: '',
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
          : mode === 'delete_bulk'
            ? await changeRequestService.submit({
                action: 'delete',
                resourceType: 'transaction',
                resourceId: 'bulk',
                payload: { ids: offer.ids, transactions: offer.transactions },
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
          date: '',
          type: 'Debit',
          categoryId: '',
          paymentType: 'cash',
          chequeNumber: '',
          remarks: '',
          amount: '',
        });
      }
      setSuccessMessage(apiMessage);
      setApprovalOffer({ mode: 'success', message: apiMessage });
      if (mode === 'pdc_daily_ledger' || mode === 'delete_bulk') {
        await fetchTransactions();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit change request');
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleEdit = useCallback((transaction: BankTransaction) => {
    if (transaction.syntheticFromPdc || transaction.approvalPendingFooterDuplicate) {
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
        
     
      }
    }
    
    const formPaymentType = normalizeLedgerPaymentTypeForUi(transaction.paymentType);
    if (formPaymentType === 'dd') {
      categoryId = '';
    }

    console.log('[handleEdit] Final categoryId:', categoryId);

    // Reset form with all values
    form.reset({
      date: dateValue,
      type: transactionType as 'Debit' | 'Credit',
      categoryId: categoryId,
      paymentType: formPaymentType as 'creditcard' | 'cheque' | 'cash' | 'banktransfer' | 'dd',
      chequeNumber: transaction.chequeNumber && transaction.chequeNumber !== '-' ? transaction.chequeNumber : '' ,
      remarks: transaction.remarks || '',
      amount: amountValue,
    });
    
    // Force set categoryId after a small delay to ensure form is ready (not for DD)
    if (categoryId && formPaymentType !== 'dd') {
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
      if (t?.syntheticFromPdc || t?.approvalPendingFooterDuplicate) return;
      setDeletingTransactionId(id);
      setError(null);
      setIsDeleteModalOpen(true);
    },
    [transactions]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingTransactionId) return;

    const row = transactions.find((x) => String(x.id) === deletingTransactionId);
    const idForApi = transactionIdForSingleDelete(row);
    if (!idForApi) {
      setError('Could not resolve transaction id for delete.');
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      const response: ApiResponse<void> = await transactionService.deleteBankTransaction(idForApi);
      
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
        }
      } else {
        setError(response.message || 'Failed to delete transaction');
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err)) {
        setApprovalOffer({ mode: 'delete', resourceId: idForApi });
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
  }, [deletingTransactionId, fetchTransactions, transactions]);

  const bulkDeletePayload = useMemo(
    () => buildBulkDeleteRequestBody(transactions),
    [transactions]
  );

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (
      bulkDeletePayload.ids.length === 0 &&
      bulkDeletePayload.transactions.length === 0
    ) {
      setError('No rows to bulk-delete.');
      return;
    }
    try {
      setIsBulkDeleting(true);
      setError(null);
      const response = await transactionService.deleteBankTransactionsBulk(bulkDeletePayload);

      if (response.success) {
        if (isChangeRequestSubmittedEnvelope(response.data)) {
          const apiMessage = userMessageFromChangeRequestSubmit(
            response as ApiResponse<unknown>
          );
          setSuccessMessage(apiMessage);
          setApprovalOffer({ mode: 'success', message: apiMessage });
          setIsBulkDeleteModalOpen(false);
        } else {
          setTransactions([]);
          setIsBulkDeleteModalOpen(false);
          setSuccessMessage(
            formatBulkDeleteSuccessMessage(
              response.data,
              response.message || 'Bulk delete completed.'
            )
          );
          await fetchTransactions();
        }
      } else {
        setError(
          response.error || response.message || 'Failed to delete all transactions'
        );
      }
    } catch (err: unknown) {
      if (isApprovalRequiredError(err)) {
        setApprovalOffer({
          mode: 'delete_bulk',
          ids: bulkDeletePayload.ids,
          transactions: bulkDeletePayload.transactions,
        });
        setIsBulkDeleteModalOpen(false);
        setError(null);
      } else {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete all transactions';
        console.error('[BankTransaction] Bulk delete error:', err);
        setError(errorMessage);
      }
    } finally {
      setIsBulkDeleting(false);
    }
  }, [bulkDeletePayload, fetchTransactions]);

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
  const filteredTransactions = transactions.filter((transaction) => {
    if (transaction.approvalPendingFooterDuplicate) return false;

    // Filter by payment type
    // 'online' tab shows both creditcard and banktransfer (which comes as 'online' from API)
    if (
      activeTab === 'online' &&
      transaction.paymentType !== 'creditcard' &&
      transaction.paymentType !== 'banktransfer' &&
      transaction.paymentType !== 'dd'
    )
      return false;
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
        : transaction.paymentType === 'dd'
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

  // Full table: all body rows, then **frontend-only** copies of unapproved PDC at the end (no date).
  const bodyTransactions = filteredTransactions.filter((t) => !isPdcLedgerFooterRow(t));
  const pdcPendingBottomRows = bodyTransactions.filter((t) => isUnapprovedPdcPinBottom(t));

  type LedgerTableRow = {
    transaction: BankTransaction;
    clientPendingBottomDup?: boolean;
  };

  const ledgerTableRows: LedgerTableRow[] = [
    ...bodyTransactions.map((t) => ({ transaction: t })),
    ...pdcPendingBottomRows.map((t) => ({
      transaction: t,
      clientPendingBottomDup: true as const,
    })),
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
    const startDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const endDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();
  
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
    csvRows.push(rowCsv('GCEC CLOUD SECURITY & SURVEILLANCE'));
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
    const startDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
    const endDate = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

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
      ws.getCell(r++, 1).value = 'GCEC CLOUD SECURITY & SURVEILLANCE';
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
      closingCell.value = closingBalanceValue;
      closingCell.numFmt = '#,##0.00';
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
        row.getCell(7).value = remarksForExport(t.remarks, t.pdcType);

        const fillStyle = ledgerRowFill(t);
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
          bold: debitValue > 0,
          color: { argb: debitValue > 0 ? 'FFDC2626' : 'FF9CA3AF' },
        };
        row.getCell(5).font = {
          name: 'Calibri',
          size: 11,
          bold: creditValue > 0,
          color: { argb: creditValue > 0 ? 'FF16A34A' : 'FF9CA3AF' },
        };
        if (!suppressBal) {
          row.getCell(6).font = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: 'FF000000' },
          };
        } else {
          row.getCell(6).font = {
            name: 'Calibri',
            size: 11,
            color: { argb: 'FF9CA3AF' },
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
      
          <h2 className="text-2xl font-bold text-gray-900"> Daily Transaction</h2>
       </div>
            <Button
            onClick={handleAddNew}
            className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black flex items-center space-x-2 transition-colors rounded-lg mr-4"
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
           className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'all'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           All
         </button>
         <button
           onClick={() => setActiveTab('online')}
           className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'online'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           Online
         </button>
         <button
           onClick={() => setActiveTab('cheque')}
           className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'cheque'
             ? 'bg-[#f7c46d] text-black'
             : 'bg-white text-black border border-gray-300 hover:bg-gray-50'
             }`}
         >
           Cheque
         </button>
         <button
           onClick={() => setActiveTab('cash')}
           className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'cash'
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
          className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black"
          disabled={loading || loadingCategories}
        >
          <Upload className="w-4 h-4" />
          <span>Bulk upload</span>
        </Button>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setIsBulkDeleteModalOpen(true);
          }}
          variant="outline"
          className="flex items-center space-x-2 border-red-200 text-red-700 hover:bg-red-50"
          disabled={
            loading ||
            loadingCategories ||
            (bulkDeletePayload.ids.length === 0 &&
              bulkDeletePayload.transactions.length === 0)
          }
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete all</span>
        </Button>
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
              <table className="bank-tx-ledger w-full caption-bottom text-base border rounded-lg">
                <thead className="sticky top-0 z-20 bg-[#f7c46d] shadow-sm">
                  <tr className="bg-[#f7c46d] border-0">
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
                  ledgerTableRows.map(({ transaction, clientPendingBottomDup }) => {
                    const isBouncedCheque = isBouncedChequeRemarks(transaction.remarks);
                    const isGcecPdc = rowIsGcecPdcHighlight(
                      transaction.remarks,
                      transaction.pdcType
                    );
                    const rowTone = isBouncedCheque
                      ? 'bounce'
                      : isGcecPdc
                        ? 'gcec'
                        : undefined;
                    const { debit: debitShown, credit: creditShown } =
                      getDebitCreditDisplayForRow(transaction, clientPendingBottomDup);
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
                          ? 'hover:bg-[#7dd3f0]'
                          : isGcecPdc
                          ? 'hover:bg-yellow-200/70'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="text-gray-700 text-sm py-2 text-left p-2 align-middle">
                        {displayTransactionDate(transaction, !!clientPendingBottomDup)}
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
                          : transaction.paymentType === 'dd'
                          ? 'DD'
                          : <span className="capitalize">{transaction.paymentType || 'N/A'}</span>}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {debitShown ? (
                          <span className="text-red-600 font-semibold">
                            AED {debitShown}
                          </span>
                        ) : (
                          <span className="text-gray-400">AED 0.00</span>
                        )}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {creditShown ? (
                          <span className="text-green-600 font-semibold">
                            AED {creditShown}
                          </span>
                        ) : (
                          <span className="text-gray-400">AED 0.00</span>
                        )}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
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
                            const isNegative = balanceValue < 0;
                            const formattedBalance =
                              balanceValue.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              });
                            return (
                              <span
                                className={
                                  isNegative
                                    ? 'text-red-600 font-bold'
                                    : 'text-gray-700 font-semibold'
                                }
                              >
                                AED {formattedBalance}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        {remarksForTableDisplay(
                          transaction.remarks,
                          transaction.pdcType
                        )}
                      </td>
                      <td className="text-sm py-2 text-left p-2 align-middle">
                        <div className="flex items-center flex-wrap gap-2">
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
                            !transaction.ledgerApproved && (
                              <span className="text-xs text-amber-800 max-w-[140px] leading-tight">
                                Awaiting ledger approval (admin / accountant)
                              </span>
                            )}
                          {!clientPendingBottomDup &&
                            !transaction.syntheticFromPdc &&
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
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
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

              {/* Payment type (Cash / Cheque / … / DD) — not the same as Debit vs Credit below */}
              <FormField
                control={form.control}
                name="paymentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Payment type
                    </FormLabel>
                    <FormDescription className="text-base text-gray-600">
                      Includes <strong>DD</strong> (direct debit). This is separate from Debit/Credit below.
                    </FormDescription>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select payment type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="z-[100] max-h-72">
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="creditcard">Credit Card</SelectItem>
                        <SelectItem value="banktransfer">Online</SelectItem>
                        <SelectItem value="dd">DD (Direct Debit)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Ledger direction: Debit vs Credit (not DD — DD is payment type above) */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">
                      Debit or Credit
                    </FormLabel>
                    <FormDescription className="text-base text-gray-600">
                      Whether this entry increases debit or credit on the ledger. For bank direct debit, pick{' '}
                      <strong>DD</strong> in <strong>Payment type</strong> above.
                    </FormDescription>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Debit or Credit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="z-[100]">
                        <SelectItem value="Debit">Debit</SelectItem>
                        <SelectItem value="Credit">Credit</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Category — not used for DD (direct debit) */}
              {paymentType !== 'dd' && (
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => {
                    useEffect(() => {
                      if (editingTransaction && field.value) {
                        const currentValue = field.value;
                        const availableCategories = getAvailableCategories();
                        const categoryExists = availableCategories.some(
                          (cat) => String(cat.id) === String(currentValue)
                        );
                        if (!categoryExists && availableCategories.length > 0) {
                          console.log(
                            '[Category Field] Value not found in available categories, clearing:',
                            currentValue
                          );
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
                              placeholder={
                                loadingCategories ? 'Loading categories...' : 'Select category'
                              }
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
              )}

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
                className="w-full bg-[#f7c46d] hover:bg-[#c9a82f] text-black py-3 mt-6"
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

      <DeleteConfirmationDialog
        open={isBulkDeleteModalOpen}
        onOpenChange={setIsBulkDeleteModalOpen}
        onConfirm={() => void handleBulkDeleteConfirm()}
        title="Delete all daily transactions?"
        description={`This sends POST /transactions/bulk-delete with ${bulkDeletePayload.ids.length} ledger/synthetic id(s) and ${bulkDeletePayload.transactions.length} typed row(s) (PDC / bills include full rows with transactionType). It cannot be undone. Admin or accountant only.`}
        isLoading={isBulkDeleting}
        confirmButtonText="Delete all"
        loadingButtonText="Deleting…"
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
                  : approvalOffer?.mode === 'delete_bulk'
                    ? 'Your account cannot delete all daily transactions directly. Submit a request for an admin to review and apply POST /transactions/bulk-delete?'
                    : 'Your account cannot delete transactions directly. Submit this deletion for an admin to review?'}
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

