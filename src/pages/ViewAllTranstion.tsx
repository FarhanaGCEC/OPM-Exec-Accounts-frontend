import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import {
  transactionService,
  normalizePdcTypeFromApi,
  type PostDatedCheque,
} from '../services/transactionService';
import api, { type ApiResponse } from '../lib/api';
import { formatIsoDateDisplay, formatDisplayYear, formatJsDateDisplay } from '../lib/formatDisplayDate';
import {
  remarksForDailyLedgerDisplay,
  isBouncedChequeRemarks,
  rowIsGcecPdcHighlight,
} from '../lib/dailyLedgerRemarksDisplay';
import { canUploadStatements } from '../lib/authPayload';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Calendar, ChevronDown, Download, Eye, Upload, X } from 'lucide-react';
import ExcelJS from 'exceljs';
import { applyArialToExcelJsWorkbook, excelExportFont } from '../lib/excelExportFont';



// Transaction type definitions
interface DailyTransaction {
  id: string | number;
  date: string;
  transactionType: 'Daily Transaction';
  category: string;
  paymentType: string;
  chequeNumber: string | null;
  debit: string | null;
  credit: string | null;
  balance: string;
  remarks: string | null;
  /** API may send camelCase or snake_case — used for Remarks display (GCEC vs Customer PDC). */
  pdcType?: string;
  pdc_type?: string;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
  transactionTime?: string;
  createdAtDisplay?: string;
  createdAtLocal?: string;
  ledgerApproved?: boolean;
  ledgerApprovedAt?: string;
  ledgerApprovedAtLocal?: string;
  affectsBalance?: boolean;
}

interface GCECPDC {
  id: string | number;
  date: string;
  transactionType: 'GCEC PDC';
  customerName: string;
  chequeNumber: string;
  chequeType: string;
  amount: string;
  description: string | null;
  approved?: boolean;
  ledgerApproved?: boolean;
  showLedgerApprovalCheckbox?: boolean;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
  transactionTime?: string;
  createdAtDisplay?: string;
  createdAtLocal?: string;
  ledgerApprovedAt?: string;
  ledgerApprovedAtLocal?: string;
}

interface CustomerPDC {
  id: string | number;
  date: string;
  transactionType: 'Customer PDC';
  customerName: string;
  chequeNumber: string;
  chequeType: string;
  amount: string;
  description: string | null;
  approved?: boolean;
  ledgerApproved?: boolean;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
  transactionTime?: string;
  createdAtDisplay?: string;
  createdAtLocal?: string;
  ledgerApprovedAt?: string;
  ledgerApprovedAtLocal?: string;
}

interface PurchaseBill {
  id: string | number;
  date: string;
  transactionType: 'Purchase Bill';
  vendorName: string;
  invoiceNumber: string;
  billNumber: string | null;
  paymentMethod: string;
  amount: string;
  description: string | null;
  paymentStatus: string;
  createdBy: number;
  createdByUsername: string;
  createdAt: string;
  transactionTime?: string;
  createdAtDisplay?: string;
  createdAtLocal?: string;
}

type AllTransaction = DailyTransaction | GCECPDC | CustomerPDC | PurchaseBill;

interface TransactionSummary {
  dailyTransactions: number;
  gcecPdc: number;
  customerPdc: number;
  purchaseBills: number;
  total: number;
}

interface DailyBankStatementMeta {
  id?: number;
  fileName?: string;
  filename?: string;
  originalName?: string;
  original_filename?: string;
}

type OtherTransactionFilterOption =
  | 'all'
  | 'customer-credit-card-adcb-usd'
  | 'customer-credit-card-gbp'
  | 'customer-credit-card-fk-enbd';



const parseTransactionDate = (value: string): Date | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed;

  // Fallback for dd/mm/yyyy values.
  const parts = raw.split('/');
  if (parts.length === 3) {
    const day = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const year = Number(parts[2]);
    const fallback = new Date(year, month, day);
    if (!isNaN(fallback.getTime())) return fallback;
  }

  // Fallback for dd-mmm-yy / dd-mmm-yyyy values.
  const mmm = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (mmm) {
    const day = Number(mmm[1]);
    const monthText = mmm[2].toLowerCase();
    const yearText = mmm[3];
    const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
      monthText
    );
    if (monthIndex >= 0) {
      const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
      const fallback = new Date(year, monthIndex, day);
      if (
        !isNaN(fallback.getTime()) &&
        fallback.getFullYear() === year &&
        fallback.getMonth() === monthIndex &&
        fallback.getDate() === day
      ) {
        return fallback;
      }
    }
  }

  return null;
};

const parseLocalDateTimeForSort = (value: string): Date | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Handle "YYYY-MM-DD HH:mm:ss" explicitly as local time.
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
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return parseTransactionDate(raw);
};

const getTransactionSortTimestamp = (item: AllTransaction): number | null => {
  const dateOnly = parseTransactionDate(item.date);
  const timeRaw = String((item as DailyTransaction).transactionTime ?? '').trim();
  const parsedTime = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeRaw);
  if (dateOnly && parsedTime) {
    const combined = new Date(dateOnly);
    combined.setHours(
      Number(parsedTime[1]),
      Number(parsedTime[2]),
      Number(parsedTime[3] ?? '0'),
      0
    );
    if (!Number.isNaN(combined.getTime())) return combined.getTime();
  }

  const localCreated = parseLocalDateTimeForSort((item as DailyTransaction).createdAtLocal ?? '');
  if (localCreated) return localCreated.getTime();
  const displayCreated = parseLocalDateTimeForSort((item as DailyTransaction).createdAtDisplay ?? '');
  if (displayCreated) return displayCreated.getTime();
  const created = parseLocalDateTimeForSort(item.createdAt ?? '');
  if (created) return created.getTime();
  if (dateOnly) return dateOnly.getTime();
  return null;
};

const getTransactionDateOnlyTimestamp = (item: AllTransaction): number | null => {
  const date = parseTransactionDate(item.date);
  if (!date) return null;
  const only = new Date(date);
  only.setHours(0, 0, 0, 0);
  return only.getTime();
};

const getTransactionStableSortId = (item: AllTransaction): number => {
  const raw = String(item.id ?? '').trim();
  const direct = Number(raw);
  if (!Number.isNaN(direct)) return direct;
  const trailing = raw.match(/(\d+)\s*$/);
  if (trailing) {
    const n = Number(trailing[1]);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
};

const getRecordValue = (record: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const toText = (value: unknown): string => (value == null ? '' : String(value));

const resolveAllTransactionType = (
  rawType: string,
  record: Record<string, unknown>
): string | null => {
  const normalized = rawType.replace(/_/g, ' ').trim();
  const lower = normalized.toLowerCase();

  if (lower === 'daily transaction') return 'Daily Transaction';
  if (lower === 'gcec pdc' || (lower.includes('gcec') && lower.includes('pdc') && !lower.includes('customer'))) {
    return 'GCEC PDC';
  }
  if (lower === 'customer pdc' || (lower.includes('customer') && lower.includes('pdc'))) {
    return 'Customer PDC';
  }
  if (lower === 'purchase bill') return 'Purchase Bill';

  if (!normalized) {
    const pdcType = normalizePdcTypeFromApi(getRecordValue(record, ['pdcType', 'pdc_type']));
    const hasChequeNumber = Boolean(
      toText(getRecordValue(record, ['chequeNumber', 'cheque_number'])).trim()
    );
    if (hasChequeNumber && pdcType === 'GCEC PDC') return 'GCEC PDC';
    if (hasChequeNumber && pdcType === 'Customer PDC') return 'Customer PDC';
  }

  return normalized || null;
};

const mapPostDatedChequeToGcecPdcRow = (cheque: PostDatedCheque): GCECPDC => ({
  id: cheque.id ?? `gcec-pdc-${cheque.chequeNumber}-${cheque.chequeDate}`,
  date: cheque.chequeDate,
  transactionType: 'GCEC PDC',
  customerName: cheque.customerName?.trim() || '-',
  chequeNumber: cheque.chequeNumber,
  chequeType: cheque.chequeType || '',
  amount: toText(cheque.amount),
  description: cheque.description || null,
  createdBy: cheque.createdBy ?? 0,
  createdByUsername: cheque.createdByUsername || '',
  createdAt: cheque.createdAt || '',
  transactionTime: cheque.transactionTime,
});

const UPCOMING_GCEC_DAILY_LEDGER_DAYS = 15;

const startOfDay = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const toDateOnlyKey = (date: Date): string => String(startOfDay(date).getTime());

const normalizeChequeNumberKey = (value: string | null | undefined): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
};

const isDailyGcecPdcRow = (txn: DailyTransaction): boolean =>
  rowIsGcecPdcHighlight(txn.remarks, txn.pdcType ?? txn.pdc_type);

const isGcecPdcMirroredInDailyLedger = (date: Date): boolean => {
  const today = startOfDay(new Date());
  const txnDay = startOfDay(date);
  if (txnDay.getTime() <= today.getTime()) return true;

  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + UPCOMING_GCEC_DAILY_LEDGER_DAYS);
  return txnDay.getTime() <= startOfDay(horizon).getTime();
};

const gcecDailyLedgerMatchKey = (
  date: string,
  chequeNumber: string | null | undefined
): string | null => {
  const parsedDate = parseTransactionDate(date);
  const chequeKey = normalizeChequeNumberKey(chequeNumber);
  if (!parsedDate || !chequeKey) return null;
  return `${toDateOnlyKey(parsedDate)}:${chequeKey}`;
};

const buildGcecPdcDailyLedgerHideKeys = (rows: AllTransaction[]): Set<string> => {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.transactionType !== 'Daily Transaction') continue;
    const dailyTxn = row as DailyTransaction;
    if (!isDailyGcecPdcRow(dailyTxn)) continue;

    const parsedDate = parseTransactionDate(dailyTxn.date);
    if (!parsedDate || !isGcecPdcMirroredInDailyLedger(parsedDate)) continue;

    const key = gcecDailyLedgerMatchKey(dailyTxn.date, dailyTxn.chequeNumber);
    if (key) keys.add(key);
  }
  return keys;
};

const hideGcecPdcRowsAlreadyInDailyLedger = (rows: AllTransaction[]): AllTransaction[] => {
  const hideKeys = buildGcecPdcDailyLedgerHideKeys(rows);
  if (hideKeys.size === 0) return rows;

  return rows.filter((row) => {
    if (row.transactionType !== 'GCEC PDC') return true;
    const gcecRow = row as GCECPDC;
    const key = gcecDailyLedgerMatchKey(gcecRow.date, gcecRow.chequeNumber);
    return !key || !hideKeys.has(key);
  });
};

const mergeGcecPdcFromChequeRegister = (
  rows: AllTransaction[],
  cheques: PostDatedCheque[]
): AllTransaction[] => {
  const existingGcecIds = new Set(
    rows
      .filter((row): row is GCECPDC => row.transactionType === 'GCEC PDC')
      .map((row) => String(row.id))
  );

  const supplement = cheques
    .filter((cheque) => normalizePdcTypeFromApi(cheque.pdcType) === 'GCEC PDC')
    .filter((cheque) => {
      const id = String(cheque.id ?? '');
      if (!id) return true;
      return !existingGcecIds.has(id) && !existingGcecIds.has(`pdc-${id}`);
    })
    .map((cheque) => mapPostDatedChequeToGcecPdcRow(cheque));

  if (supplement.length === 0) return rows;
  return [...rows, ...supplement];
};

const normalizeTransactionRow = (row: unknown): AllTransaction | null => {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const rawType = toText(getRecordValue(record, ['transactionType', 'transaction_type'])).trim();
  const resolvedType = resolveAllTransactionType(rawType, record);
  if (!resolvedType) return null;

  if (resolvedType === 'Daily Transaction') {
    return {
      id: toText(getRecordValue(record, ['id'])) || '0',
      date: toText(getRecordValue(record, ['date'])),
      transactionType: 'Daily Transaction',
      category: toText(getRecordValue(record, ['category'])),
      paymentType: toText(getRecordValue(record, ['paymentType', 'payment_type'])),
      chequeNumber: toText(getRecordValue(record, ['chequeNumber', 'cheque_number'])) || null,
      debit: toText(getRecordValue(record, ['debit', 'debit_amount'])) || null,
      credit: toText(getRecordValue(record, ['credit', 'credit_amount'])) || null,
      balance: toText(getRecordValue(record, ['balance'])),
      remarks: toText(getRecordValue(record, ['remarks'])) || null,
      pdcType: toText(getRecordValue(record, ['pdcType', 'pdc_type'])) || undefined,
      pdc_type: toText(getRecordValue(record, ['pdc_type', 'pdcType'])) || undefined,
      createdBy: Number(getRecordValue(record, ['createdBy', 'created_by']) ?? 0),
      createdByUsername: toText(getRecordValue(record, ['createdByUsername', 'created_by_username'])),
      createdAt: toText(getRecordValue(record, ['createdAt', 'created_at'])),
      transactionTime:
        toText(getRecordValue(record, ['transactionTime', 'transaction_time'])) || undefined,
      createdAtDisplay:
        toText(getRecordValue(record, ['createdAtDisplay', 'created_at_display'])) || undefined,
      createdAtLocal: toText(getRecordValue(record, ['createdAtLocal', 'created_at_local'])) || undefined,
      ledgerApproved: Boolean(getRecordValue(record, ['ledgerApproved', 'ledger_approved'])),
      ledgerApprovedAt: toText(
        getRecordValue(record, [
          'dailyLedgerApprovedAt',
          'daily_ledger_approved_at',
          'ledgerApprovedAt',
          'ledger_approved_at',
          'approvedAt',
          'approved_at',
        ])
      ) || undefined,
      ledgerApprovedAtLocal: toText(
        getRecordValue(record, [
          'dailyLedgerApprovedAtDisplay',
          'daily_ledger_approved_at_display',
          'ledgerApprovedAtLocal',
          'ledger_approved_at_local',
          'approvedAtLocal',
          'approved_at_local',
        ])
      ) || undefined,
      affectsBalance:
        getRecordValue(record, ['affectsBalance', 'affects_balance']) === undefined
          ? undefined
          : Boolean(getRecordValue(record, ['affectsBalance', 'affects_balance'])),
    };
  }

  if (resolvedType === 'GCEC PDC') {
    return {
      id: toText(getRecordValue(record, ['id'])) || '0',
      date: toText(getRecordValue(record, ['date'])),
      transactionType: 'GCEC PDC',
      customerName: toText(getRecordValue(record, ['customerName', 'customer_name'])),
      chequeNumber: toText(getRecordValue(record, ['chequeNumber', 'cheque_number'])),
      chequeType: toText(getRecordValue(record, ['chequeType', 'cheque_type'])),
      amount: toText(getRecordValue(record, ['amount'])),
      description: toText(getRecordValue(record, ['description'])) || null,
      approved: Boolean(getRecordValue(record, ['approved'])),
      ledgerApproved: Boolean(getRecordValue(record, ['ledgerApproved', 'ledger_approved'])),
      ledgerApprovedAt: toText(
        getRecordValue(record, [
          'dailyLedgerApprovedAt',
          'daily_ledger_approved_at',
          'ledgerApprovedAt',
          'ledger_approved_at',
          'approvedAt',
          'approved_at',
        ])
      ) || undefined,
      ledgerApprovedAtLocal: toText(
        getRecordValue(record, [
          'dailyLedgerApprovedAtDisplay',
          'daily_ledger_approved_at_display',
          'ledgerApprovedAtLocal',
          'ledger_approved_at_local',
          'approvedAtLocal',
          'approved_at_local',
        ])
      ) || undefined,
      showLedgerApprovalCheckbox: Boolean(getRecordValue(record, ['showLedgerApprovalCheckbox', 'show_ledger_approval_checkbox'])),
      createdBy: Number(getRecordValue(record, ['createdBy', 'created_by']) ?? 0),
      createdByUsername: toText(getRecordValue(record, ['createdByUsername', 'created_by_username'])),
      createdAt: toText(getRecordValue(record, ['createdAt', 'created_at'])),
      transactionTime:
        toText(getRecordValue(record, ['transactionTime', 'transaction_time'])) || undefined,
      createdAtDisplay:
        toText(getRecordValue(record, ['createdAtDisplay', 'created_at_display'])) || undefined,
      createdAtLocal: toText(getRecordValue(record, ['createdAtLocal', 'created_at_local'])) || undefined,
    };
  }

  if (resolvedType === 'Customer PDC') {
    return {
      id: toText(getRecordValue(record, ['id'])) || '0',
      date: toText(getRecordValue(record, ['date'])),
      transactionType: 'Customer PDC',
      customerName: toText(getRecordValue(record, ['customerName', 'customer_name'])),
      chequeNumber: toText(getRecordValue(record, ['chequeNumber', 'cheque_number'])),
      chequeType: toText(getRecordValue(record, ['chequeType', 'cheque_type'])),
      amount: toText(getRecordValue(record, ['amount'])),
      description: toText(getRecordValue(record, ['description'])) || null,
      approved: Boolean(getRecordValue(record, ['approved'])),
      ledgerApproved: Boolean(getRecordValue(record, ['ledgerApproved', 'ledger_approved'])),
      ledgerApprovedAt: toText(
        getRecordValue(record, [
          'dailyLedgerApprovedAt',
          'daily_ledger_approved_at',
          'ledgerApprovedAt',
          'ledger_approved_at',
          'approvedAt',
          'approved_at',
        ])
      ) || undefined,
      ledgerApprovedAtLocal: toText(
        getRecordValue(record, [
          'dailyLedgerApprovedAtDisplay',
          'daily_ledger_approved_at_display',
          'ledgerApprovedAtLocal',
          'ledger_approved_at_local',
          'approvedAtLocal',
          'approved_at_local',
        ])
      ) || undefined,
      createdBy: Number(getRecordValue(record, ['createdBy', 'created_by']) ?? 0),
      createdByUsername: toText(getRecordValue(record, ['createdByUsername', 'created_by_username'])),
      createdAt: toText(getRecordValue(record, ['createdAt', 'created_at'])),
      transactionTime:
        toText(getRecordValue(record, ['transactionTime', 'transaction_time'])) || undefined,
      createdAtDisplay:
        toText(getRecordValue(record, ['createdAtDisplay', 'created_at_display'])) || undefined,
      createdAtLocal: toText(getRecordValue(record, ['createdAtLocal', 'created_at_local'])) || undefined,
    };
  }

  if (resolvedType === 'Purchase Bill') {
    return {
      id: toText(getRecordValue(record, ['id'])) || '0',
      date: toText(getRecordValue(record, ['date'])),
      transactionType: 'Purchase Bill',
      vendorName: toText(getRecordValue(record, ['vendorName', 'vendor_name'])),
      invoiceNumber: toText(getRecordValue(record, ['invoiceNumber', 'invoice_number'])),
      billNumber: toText(getRecordValue(record, ['billNumber', 'bill_number'])) || null,
      paymentMethod: toText(getRecordValue(record, ['paymentMethod', 'payment_method'])),
      amount: toText(getRecordValue(record, ['amount'])),
      description: toText(getRecordValue(record, ['description'])) || null,
      paymentStatus: toText(getRecordValue(record, ['paymentStatus', 'payment_status'])),
      createdBy: Number(getRecordValue(record, ['createdBy', 'created_by']) ?? 0),
      createdByUsername: toText(getRecordValue(record, ['createdByUsername', 'created_by_username'])),
      createdAt: toText(getRecordValue(record, ['createdAt', 'created_at'])),
      transactionTime:
        toText(getRecordValue(record, ['transactionTime', 'transaction_time'])) || undefined,
      createdAtDisplay:
        toText(getRecordValue(record, ['createdAtDisplay', 'created_at_display'])) || undefined,
      createdAtLocal: toText(getRecordValue(record, ['createdAtLocal', 'created_at_local'])) || undefined,
    };
  }

  return null;
};

const sortTransactionsByDateAsc = (items: AllTransaction[]): AllTransaction[] => {
  return [...items].sort((a, b) => {
    const aDateTs = getTransactionDateOnlyTimestamp(a);
    const bDateTs = getTransactionDateOnlyTimestamp(b);
    const aTs = getTransactionSortTimestamp(a);
    const bTs = getTransactionSortTimestamp(b);

    // Primary sort: transaction date only (1 Jan → 31 Dec).
    if (aDateTs == null && bDateTs == null) {
      // continue to timestamp tie-breakers
    } else if (aDateTs == null) {
      return -1;
    } else if (bDateTs == null) {
      return 1;
    } else {
      const byDateOnly = aDateTs - bDateTs;
      if (byDateOnly !== 0) return byDateOnly;
    }

    if (aTs == null && bTs == null) return getTransactionStableSortId(a) - getTransactionStableSortId(b);
    if (aTs == null) return -1;
    if (bTs == null) return 1;

    // Secondary sort: datetime within the same date.
    const byTs = aTs - bTs;
    if (byTs !== 0) return byTs;

    return getTransactionStableSortId(a) - getTransactionStableSortId(b);
  });
};

const sortTransactionsByDateDesc = (items: AllTransaction[]): AllTransaction[] => {
  // Keep backend sequence and show it in reverse (latest first).
  return [...items].reverse();
};


const displayTransactionDate = (date: string | null | undefined): string => {
  if (!date || !parseTransactionDate(date)) return '';
  return formatIsoDateDisplay(date);
};

// Helper function to format amounts
const formatAmount = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0).replace(/,/g, '').trim());
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};



const ensurePdfFilename = (name: string | null | undefined): string => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'bank-statement.pdf';
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
};

const EXCEL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const getDefaultDateRange = (): { start: Date; end: Date } => {
  // Default to current year.
  const today = new Date();
  const start = new Date(today.getFullYear(), 0, 1);
  const end = new Date(today.getFullYear(), 11, 31);
  return { start, end };
};

// Helper function to format date for Excel (DD-MMM-YY)
const formatDateForExcel = (date: Date | string | null): string => {
  if (!date) return '';

  const parsed = typeof date === 'string' ? parseTransactionDate(date) : date;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = EXCEL_MONTHS[parsed.getMonth()];
  const year = formatDisplayYear(parsed.getFullYear());
  return `${day}-${month}-${year}`;
};

/** Match on-screen ledger: AED prefix + thousands separators. */
const EXCEL_AED_NUM_FMT = '"AED "#,##0.00';

const LEDGER_TABLE_HEADERS = [
  'Date',
  'Description',
  'Details',
  'Debit',
  'Credit',
  'Balance',
  'Remarks',
] as const;

const getExcelHeadersForType = (type: string): readonly string[] => {
  if (type === 'GCEC PDC') {
    return ['Date', 'Creditor', 'Cheque Number', 'Debit', 'Remarks'];
  }
  if (type === 'Customer PDC') {
    return ['Date', 'Debtor', 'Cheque Number', 'Credit', 'Remarks'];
  }
  if (type === 'Purchase Bill') {
    return ['Date', 'Vendor Name', 'Payment Method', 'Credit', 'Remarks'];
  }
  return LEDGER_TABLE_HEADERS;
};

const applyExcelAedAmount = (
  cell: ExcelJS.Cell,
  value: number,
  font?: Partial<ExcelJS.Font>
): void => {
  cell.value = value;
  cell.numFmt = EXCEL_AED_NUM_FMT;
  if (font) {
    cell.font = excelExportFont(font) as ExcelJS.Font;
  }
};

function dailyTxnPdcType(txn: DailyTransaction): string | undefined {
  return txn.pdcType ?? txn.pdc_type;
}

const toTitleCaseWords = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const getDailyPaymentTypeDisplay = (txn: DailyTransaction): string => {
  const normalizedPaymentType = (txn.paymentType || '').trim().toLowerCase();

  if (normalizedPaymentType === 'cheque') {
    return txn.chequeNumber?.trim() || 'Cheque';
  }
  if (normalizedPaymentType === 'dd') {
    return 'DD';
  }
  if (normalizedPaymentType === 'banktransfer' || normalizedPaymentType === 'online') {
    return 'Online';
  }
  if (normalizedPaymentType === 'creditcard') {
    return 'Credit Card';
  }

  return toTitleCaseWords(txn.paymentType || '');
};

// Helper function to get display name for transaction type
const getTransactionTypeDisplayName = (type: string): string => {
  if (type === 'Daily Transaction') {
    return 'Daily Transaction Detail';
  }
  if (type === 'GCEC PDC') {
    return 'GCEC PDC in Hand';
  } else if (type === 'Customer PDC') {
    return 'Customer PDC in Hand';
  } else if (type === 'Purchase Bill') {
    return 'Customers Paid through Credit Cards';
  }
  return type;
};

export default function ViewAllTranstion() {
  const canUpload = canUploadStatements();
  const defaultDateRange = getDefaultDateRange();
  const [transactions, setTransactions] = useState<AllTransaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(defaultDateRange.start);
  const [endDate, setEndDate] = useState<Date | null>(defaultDateRange.end);
  const [otherTransactionFilter, setOtherTransactionFilter] =
    useState<OtherTransactionFilterOption>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [statementPreviewUrl, setStatementPreviewUrl] = useState<string | null>(null);
  const [statementMeta, setStatementMeta] = useState<DailyBankStatementMeta | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isViewingPdf, setIsViewingPdf] = useState(false);
  const itemsPerPage = 10;

  useEffect(() => {
    return () => {
      if (statementPreviewUrl) {
        window.URL.revokeObjectURL(statementPreviewUrl);
      }
    };
  }, [statementPreviewUrl]);

  const filteredTransactions = transactions.filter((transaction) => {
    const txnDate = parseTransactionDate(transaction.date);
    if (startDate && txnDate) {
      const startOnly = new Date(startDate);
      startOnly.setHours(0, 0, 0, 0);
      const txnOnly = new Date(txnDate);
      txnOnly.setHours(0, 0, 0, 0);
      if (txnOnly.getTime() < startOnly.getTime()) return false;
    }
    if (endDate && txnDate) {
      const endOnly = new Date(endDate);
      endOnly.setHours(0, 0, 0, 0);
      const txnOnly = new Date(txnDate);
      txnOnly.setHours(0, 0, 0, 0);
      if (txnOnly.getTime() > endOnly.getTime()) return false;
    }

    if (transaction.transactionType !== 'Purchase Bill' || otherTransactionFilter === 'all') {
      return true;
    }

    const purchaseBill = transaction as PurchaseBill;
    const searchable = [
      purchaseBill.vendorName,
      purchaseBill.paymentMethod,
      purchaseBill.description || '',
      purchaseBill.invoiceNumber || '',
      purchaseBill.billNumber || '',
    ]
      .join(' ')
      .toLowerCase();

    if (otherTransactionFilter === 'customer-credit-card-adcb-usd') {
      return searchable.includes('adcb usd');
    }
    if (otherTransactionFilter === 'customer-credit-card-gbp') {
      return searchable.includes('gbp');
    }
    return searchable.includes('fk enbd') || searchable.includes('fk emirates nbd');
  });



  // Table list: show each transaction only once.
  const tableTransactions: AllTransaction[] = filteredTransactions;

  // Group table transactions by type
  const groupedTableTransactions = tableTransactions.reduce<Record<string, AllTransaction[]>>((acc, transaction) => {
    const type = transaction.transactionType;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(transaction);
    return acc;
  }, {} as Record<string, AllTransaction[]>);

  // Flatten grouped transactions with headings
  const transactionsWithHeadings: Array<{ type: 'heading' | 'transaction'; content: string | AllTransaction }> = [];
  
  const transactionOrder = ['Daily Transaction', 'GCEC PDC', 'Customer PDC', 'Purchase Bill'];
  
  transactionOrder.forEach((type) => {
    const typeTransactions = groupedTableTransactions[type] || [];
    if (typeTransactions.length > 0) {
      transactionsWithHeadings.push({ type: 'heading', content: type });
      typeTransactions.forEach((transaction) => {
        transactionsWithHeadings.push({ type: 'transaction', content: transaction });
      });
    }
  });

  // Pagination - count only transactions (not headings)
  const transactionCount = tableTransactions.length;
  const totalPages = Math.ceil(transactionCount / itemsPerPage);
  
  // Calculate which transactions to show (10 per page)
  const startTransactionIndex = (currentPage - 1) * itemsPerPage;
  const endTransactionIndex = startTransactionIndex + itemsPerPage;
  
  // Build paginated items - show all headers first (like Excel), then transactions on current page under each
  let transactionCounter = 0;
  const paginatedItems: Array<{ type: 'heading' | 'transaction'; content: string | AllTransaction }> = [];
  
  // First, collect all transactions that should be on the current page
  const transactionsOnPage: AllTransaction[] = [];
  for (const item of transactionsWithHeadings) {
    if (item.type === 'transaction') {
      if (transactionCounter >= startTransactionIndex && transactionCounter < endTransactionIndex) {
        const txn = item.content as AllTransaction;
        transactionsOnPage.push(txn);
      }
      transactionCounter++;
    }
  }
  
  // Group transactions on page by type
  const transactionsByTypeOnPage = transactionsOnPage.reduce((acc, txn) => {
    const type = txn.transactionType;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(txn);
    return acc;
  }, {} as Record<string, AllTransaction[]>);
  
  // Get all transaction types that exist in the dataset
  const allTransactionTypes = new Set<string>();
  tableTransactions.forEach(txn => allTransactionTypes.add(txn.transactionType));
  
  // Show all headers in order (like Excel), then show transactions under each
  transactionOrder.forEach((type) => {
    if (allTransactionTypes.has(type)) {
      // Always add header if this type has any transactions in dataset
      paginatedItems.push({ type: 'heading', content: type });
      
      // Add transactions of this type that are on the current page
      const typeTransactionsOnPage = transactionsByTypeOnPage[type] || [];
      typeTransactionsOnPage.forEach(txn => {
        paginatedItems.push({ type: 'transaction', content: txn });
      });
    }
  });

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const params: { startDate?: string; endDate?: string } = {};
      
      if (startDate) {
        params.startDate = startDate.toISOString().split('T')[0];
      }
      if (endDate) {
        params.endDate = endDate.toISOString().split('T')[0];
      }
      
      const [response, pdcResponse]: [
        ApiResponse<any>,
        ApiResponse<PostDatedCheque[]>
      ] = await Promise.all([
        transactionService.getAllTransactions(params),
        transactionService.getPostDatedCheques(),
      ]);
      
      if (response.success && response.data) {
        const responseData = response.data as any;
        
        // The API returns: { success: true, data: [...], summary: {...}, filters: {...} }
        // api.get() may wrap it, so check both structures
        let transactionsData: AllTransaction[] = [];
        let summaryData: TransactionSummary | null = null;
        
        if (Array.isArray(responseData)) {
          // Direct array
          transactionsData = responseData;
        } else if (responseData?.data && Array.isArray(responseData.data)) {
          // Nested: { data: [...], summary: {...} }
          transactionsData = responseData.data;
          summaryData = responseData.summary || null;
        } else if (responseData?.success && responseData?.data && Array.isArray(responseData.data)) {
          // API response structure: { success: true, data: [...], summary: {...} }
          transactionsData = responseData.data;
          summaryData = responseData.summary || null;
        }
        
        const normalizedTransactions = transactionsData
          .map((item) => normalizeTransactionRow(item))
          .filter((item): item is AllTransaction => item !== null);

        const mergedTransactions = mergeGcecPdcFromChequeRegister(
          normalizedTransactions,
          pdcResponse.success && Array.isArray(pdcResponse.data) ? pdcResponse.data : []
        );
        const dedupedTransactions = hideGcecPdcRowsAlreadyInDailyLedger(mergedTransactions);

        const mergedGcecCount = dedupedTransactions.filter(
          (row) => row.transactionType === 'GCEC PDC'
        ).length;
        const summaryWithGcec =
          summaryData && mergedGcecCount !== (summaryData.gcecPdc ?? 0)
            ? {
                ...summaryData,
                gcecPdc: mergedGcecCount,
                total: (summaryData.total ?? 0) + (mergedGcecCount - (summaryData.gcecPdc ?? 0)),
              }
            : summaryData;

        // Latest transaction first in View All.
        setTransactions(sortTransactionsByDateDesc(dedupedTransactions));
        setSummary(summaryWithGcec);
        setCurrentPage(1); // Reset to first page when filters change
      } else {
        setTransactions([]);
        setSummary(null);
      }
    } catch (err) {
      console.error('[ViewAllTranstion] Error fetching transactions:', err);
      setTransactions([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [otherTransactionFilter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Clear filters function
  const clearFilters = () => {
    const defaults = getDefaultDateRange();
    setStartDate(defaults.start);
    setEndDate(defaults.end);
    setOtherTransactionFilter('all');
  };

  const openUploadModal = useCallback(() => {
    setUploadError(null);
    setUploadSuccess(null);
    setReportFile(null);
    setShowUploadModal(true);
  }, []);

  const closeUploadModal = useCallback(() => {
    setShowUploadModal(false);
    setReportFile(null);
    setUploadError(null);
  }, []);

  const closeViewModal = useCallback(() => {
    setShowViewModal(false);
    if (statementPreviewUrl) {
      window.URL.revokeObjectURL(statementPreviewUrl);
    }
    setStatementPreviewUrl(null);
  }, [statementPreviewUrl]);

  const loadStatementMeta = useCallback(async () => {
    try {
      setStatementLoading(true);
      const response = await api.get<any>('/daily-bank-statement');
      const body = response?.data;
      const maybeMeta =
        body?.data ??
        body?.statement ??
        body?.dailyBankStatement ??
        body;
      setStatementMeta(maybeMeta && typeof maybeMeta === 'object' ? maybeMeta : null);
    } catch {
      setStatementMeta(null);
    } finally {
      setStatementLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatementMeta();
  }, [loadStatementMeta]);

  // Convert Date to string for input (YYYY-MM-DD format)
  const dateToString = (date: Date | null): string => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getActiveMonthLabel = (): string => {
    if (!startDate || !endDate) return 'All Transactions';
    const sameYear = startDate.getFullYear() === endDate.getFullYear();
    if (sameYear) {
      return `Year ${formatDisplayYear(startDate.getFullYear())}`;
    }
    return `${formatJsDateDisplay(startDate)} - ${formatJsDateDisplay(endDate)}`;
  };

  // Convert string to Date (from input)
  const stringToDate = (dateString: string): Date | null => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  };

  // Excel Download function - exports only filtered transactions (based on startDate/endDate)
  const handleDownloadExcel = useCallback(async () => {
    // Transactions are already filtered by API date range and client-side "Other Transactions".
    if (filteredTransactions.length === 0) {
      return;
    }

    // Create workbook using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('All Transactions');
    let currentRow = 1;

    // Helper function to add a row with optional styling
    const addRow = (values: any[], style?: Partial<ExcelJS.Style>) => {
      const row = worksheet.addRow(values);
      const font = excelExportFont(
        style?.font && typeof style.font === 'object'
          ? (style.font as Partial<ExcelJS.Font>)
          : {}
      ) as ExcelJS.Font;
      if (style) {
        const { font: _omit, ...rest } = style;
        row.eachCell((cell) => {
          Object.assign(cell, { ...rest, font });
        });
      } else {
        row.eachCell((cell) => {
          cell.font = font;
        });
      }
      currentRow++;
      return row;
    };

    // Header rows
    addRow(['ADCB (AED)'], { font: { bold: true, size: 14 } });
    addRow(['GCEC CLOUD SECURITY & SURVEILLANCE L.L.C '], { font: { bold: true, size: 12 } });
    addRow([]);
    
    // Account information
    addRow(['Account No. :', '12990685920001 - AED']);
    addRow(['IBAN', 'AE720030012990685920001']);
    
    // Date range
    addRow(['Start Date:', startDate ? formatDateForExcel(startDate) : '']);
    addRow(['End Date:', endDate ? formatDateForExcel(endDate) : '']);
    addRow([]);

    // Group transactions by type
    const transactionOrder = ['Daily Transaction', 'GCEC PDC', 'Customer PDC', 'Purchase Bill'];
    
    transactionOrder.forEach((type) => {
      const typeTransactions = sortTransactionsByDateAsc(
        filteredTransactions.filter((txn) => txn.transactionType === type)
      );
      if (typeTransactions.length > 0) {
        const displayName = getTransactionTypeDisplayName(type);
        addRow([displayName], {
          font: excelExportFont({ bold: true, size: 12 }) as ExcelJS.Font,
          fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE5E7EB' },
          },
        });
        
        addRow([...getExcelHeadersForType(type)], { font: { bold: true } });

        // Transaction rows
        let sectionAmountTotal = 0;
        typeTransactions.forEach((transaction) => {
          if (type === 'Daily Transaction') {
            const txn = transaction as DailyTransaction;
            const formetpaymentType = getDailyPaymentTypeDisplay(txn);

            const debitValue = txn.debit ? parseFloat(String(txn.debit).replace(/,/g, '')) : 0;
            const creditValue = txn.credit ? parseFloat(String(txn.credit).replace(/,/g, '')) : 0;
            const balanceValue = parseFloat(String(txn.balance).replace(/,/g, '')) || 0;
            const rowAmount =
              (Number.isFinite(debitValue) ? debitValue : 0) +
              (Number.isFinite(creditValue) ? creditValue : 0);
            sectionAmountTotal += rowAmount;
            
            const rawRemarks = txn.remarks || '';
            const remarksCell = remarksForDailyLedgerDisplay(txn.remarks, dailyTxnPdcType(txn));
            const isBouncedOrReturned = isBouncedChequeRemarks(rawRemarks);
            const gcecPdcHighlight = rowIsGcecPdcHighlight(rawRemarks, dailyTxnPdcType(txn));

            const row = addRow([
              formatDateForExcel(txn.date),
              txn.category,
              formetpaymentType,
              Number.isFinite(debitValue) ? debitValue : 0,
              Number.isFinite(creditValue) ? creditValue : 0,
              balanceValue,
              remarksCell,
            ]);

            applyExcelAedAmount(row.getCell(4), Number.isFinite(debitValue) ? debitValue : 0);
            applyExcelAedAmount(row.getCell(5), Number.isFinite(creditValue) ? creditValue : 0);
            applyExcelAedAmount(row.getCell(6), balanceValue);

            // Debit column red; Date, Description, Details, Credit, Remarks black (match on-screen ledger).
            row.getCell(4).font = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
            const blackExportFont = excelExportFont({ color: { argb: 'FF000000' } }) as ExcelJS.Font;
            row.getCell(1).font = blackExportFont;
            row.getCell(2).font = blackExportFont;
            row.getCell(3).font = blackExportFont;
            row.getCell(5).font = blackExportFont;
            row.getCell(7).font = blackExportFont;
            // Balance should be blue, but red when negative.
            row.getCell(6).font = excelExportFont({
              bold: true,
              color: { argb: balanceValue < 0 ? 'FFFF0000' : 'FF0003EB' },
            }) as ExcelJS.Font;

            const isAvailableBalanceRemark =
              remarksCell.trim().toLowerCase().replace(/\s+/g, ' ') === 'available balance';

            if (isBouncedOrReturned) {
              row.eachCell((cell) => {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FF95DCF7' }
                };
              });
            } else if (gcecPdcHighlight) {
              row.eachCell((cell) => {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFEF9C3' },
                };
              });
            } else if (isAvailableBalanceRemark) {
              row.getCell(6).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF91D34D' },
              };
            }
          } else if (type === 'GCEC PDC') {
            const txn = transaction as GCECPDC;
            const amountValue = parseFloat(String(txn.amount).replace(/,/g, '')) || 0;
            sectionAmountTotal += amountValue;
            const row = addRow([
              formatDateForExcel(txn.date),
              txn.customerName,
              txn.chequeNumber || '-',
              amountValue,
              txn.description || '',
            ]);
            applyExcelAedAmount(row.getCell(4), amountValue);

            const chequeCell = row.getCell(3);
            if (txn.chequeNumber && /^\d+$/.test(txn.chequeNumber)) {
              chequeCell.value = txn.chequeNumber;
              chequeCell.numFmt = '@';
            }

            const redFont = excelExportFont({ color: { argb: 'FFFF0000' } }) as ExcelJS.Font;
            row.eachCell((cell) => {
              cell.font = redFont;
            });
          } else if (type === 'Customer PDC') {
            const txn = transaction as CustomerPDC;
            const amountValue = parseFloat(String(txn.amount).replace(/,/g, '')) || 0;
            sectionAmountTotal += amountValue;
            const chequeTypeDisplay = txn.chequeType === 'Payment Cheque' ? '' : 'Security Cheque';
            const isSecurityCheque = chequeTypeDisplay === 'Security Cheque';
            
            const row = addRow([
              formatDateForExcel(txn.date),
              txn.customerName,
              txn.chequeNumber || '-',
              amountValue,
              txn.description || chequeTypeDisplay,
            ]);
            applyExcelAedAmount(row.getCell(4), amountValue, { color: { argb: 'FF000000' } });

            const chequeCell = row.getCell(3);
            if (txn.chequeNumber && /^\d+$/.test(txn.chequeNumber)) {
              chequeCell.value = txn.chequeNumber;
              chequeCell.numFmt = '@';
            }

            const blackFont = excelExportFont({ color: { argb: 'FF000000' } }) as ExcelJS.Font;
            row.getCell(1).font = blackFont;
            row.getCell(2).font = blackFont;
            row.getCell(3).font = excelExportFont({ color: { argb: 'FF4B5563' } }) as ExcelJS.Font;
            row.getCell(5).font = excelExportFont({ color: { argb: 'FF4B5563' } }) as ExcelJS.Font;

            if (isSecurityCheque) {
              row.eachCell((cell) => {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFF0000' },
                };
                cell.font = excelExportFont({ color: { argb: 'FFFFFFFF' } }) as ExcelJS.Font;
              });
            }
          } else if (type === 'Purchase Bill') {
            const txn = transaction as PurchaseBill;
            const amountValue = parseFloat(String(txn.amount).replace(/,/g, '')) || 0;
            sectionAmountTotal += amountValue;
            const row = addRow([
              formatDateForExcel(txn.date),
              txn.vendorName,
              txn.paymentMethod,
              amountValue,
              txn.description || '',
            ]);
            applyExcelAedAmount(row.getCell(4), amountValue, { color: { argb: 'FF000000' } });

            const blackFont = excelExportFont({ color: { argb: 'FF000000' } }) as ExcelJS.Font;
            row.getCell(1).font = blackFont;
            row.getCell(2).font = blackFont;
            row.getCell(3).font = excelExportFont({ color: { argb: 'FF4B5563' } }) as ExcelJS.Font;
            row.getCell(5).font = excelExportFont({ color: { argb: 'FF4B5563' } }) as ExcelJS.Font;
          }
        });

        if (
          type === 'Daily Transaction' ||
          type === 'GCEC PDC' ||
          type === 'Customer PDC' ||
          type === 'Purchase Bill'
        ) {
          addRow([]);
          const totalRowValues =
            type === 'Daily Transaction'
              ? ['', '', 'Total', '', '', sectionAmountTotal, '']
              : ['', '', 'Total', sectionAmountTotal, ''];
          const totalRow = addRow(totalRowValues, { font: { bold: true } });
          totalRow.getCell(3).alignment = { horizontal: 'right' };
          const totalAmountCell =
            type === 'Daily Transaction' ? totalRow.getCell(6) : totalRow.getCell(4);
          applyExcelAedAmount(totalAmountCell, sectionAmountTotal);
          totalAmountCell.font =
            type === 'Daily Transaction'
              ? (excelExportFont({
                  bold: true,
                  color: { argb: 'FF0003EB' },
                }) as ExcelJS.Font)
              : (excelExportFont({ bold: true }) as ExcelJS.Font);
        }

        addRow([]); // Empty row between sections
      }
    });

    // Set column widths
    worksheet.columns = [
      { width: 15 }, // Date
      { width: 25 }, // Category/Customer/Vendor
      { width: 15 }, // Payment Type/Cheque Number/Invoice
      { width: 15 }, // Cheque Number/Cheque Type/Payment Method
      { width: 18 }, // Debit/Amount
      { width: 18 }, // Credit/Description/Payment Status
      { width: 18 }, // Balance/Description
      { width: 20 }, // Remarks/Description
    ];

    // Generate filename and download
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const fileName = `All-Transactions-${dateStr}.xlsx`;

    applyArialToExcelJsWorkbook(workbook);
    // Write to buffer and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(url);
  }, [filteredTransactions, startDate, endDate]);

  const handleViewPdf = useCallback(async () => {
    try {
      setIsViewingPdf(true);
      setUploadError(null);
      setUploadSuccess(null);
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/daily-bank-statement/file', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        let errorMessage = 'Failed to open statement PDF.';
        try {
          const errorBody = await response.json();
          errorMessage = String(errorBody?.message || errorBody?.error || errorMessage);
        } catch {
          // keep default message
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      if (statementPreviewUrl) {
        window.URL.revokeObjectURL(statementPreviewUrl);
      }
      setStatementPreviewUrl(url);
      setShowViewModal(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open statement PDF.';
      setUploadError(message);
    } finally {
      setIsViewingPdf(false);
    }
  }, [statementPreviewUrl]);

  const handleReportUpload = useCallback(async () => {
    if (!reportFile) {
      setUploadError('Please select a report file first.');
      return;
    }
    if (!reportFile.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are allowed.');
      return;
    }

    try {
      setIsUploading(true);
      setUploadError(null);
      const formData = new FormData();
      formData.append('file', reportFile, reportFile.name);
      await api.post('/daily-bank-statement', formData);
      await loadStatementMeta();
      setUploadSuccess(`Statement "${reportFile.name}" uploaded successfully.`);
      setShowUploadModal(false);
      setReportFile(null);
    } catch {
      setUploadError('Failed to upload statement. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [loadStatementMeta, reportFile]);



  // Render transaction row based on type
  const renderTransactionRow = (transaction: AllTransaction) => {
    if (transaction.transactionType === 'Daily Transaction') {
      const txn = transaction as DailyTransaction;
      const bounceHighlight = isBouncedChequeRemarks(txn.remarks);
      const gcecPdcHighlight = rowIsGcecPdcHighlight(txn.remarks, dailyTxnPdcType(txn));
      const remarksDisplay = remarksForDailyLedgerDisplay(txn.remarks, dailyTxnPdcType(txn)) || '';
      const remarksText = remarksDisplay;
      const isAvailableBalanceRemark =
        remarksDisplay.trim().toLowerCase().replace(/\s+/g, ' ') === 'available balance';
      const debitAmount = txn.debit ? parseFloat(String(txn.debit).replace(/,/g, '')) : 0;
      const hasDebit = !Number.isNaN(debitAmount) && debitAmount > 0;
      return (
        <TableRow
          key={txn.id}
          className={`border-b border-gray-100 transition-colors ${
            bounceHighlight
              ? 'bg-[#7dd3f0] hover:bg-[#67c6ea]'
              : gcecPdcHighlight
              ? 'hover:bg-yellow-200/70'
              : 'hover:bg-gray-50'
          }`}
        >
          <TableCell className="text-gray-700 text-sm py-2 px-4 text-left align-middle">
            {displayTransactionDate(txn.date)}
          </TableCell>
          <TableCell className="text-gray-700 text-sm py-2 px-4 text-left align-middle">
            {txn.category}
          </TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4 text-left align-middle">
            {getDailyPaymentTypeDisplay(txn)}
          </TableCell>

          <TableCell className="text-sm py-2 px-4 text-left align-middle">
            {hasDebit ? (
              <span className="text-red-600">AED {formatAmount(txn.debit)}</span>
            ) : (
              <span className="text-red-600">AED 0.00</span>
            )}
          </TableCell>
          <TableCell className="text-sm py-2 px-4 text-left align-middle">
            {txn.credit ? (
              <span className="text-black">AED {formatAmount(txn.credit)}</span>
            ) : (
              <span className="text-black">AED 0.00</span>
            )}
          </TableCell>
          <TableCell
            className={`text-sm py-2 px-4 text-left align-middle ${
              isAvailableBalanceRemark ? 'bg-[#91d34d]' : ''
            }`}
          >
            {(() => {
              const balanceAmount = parseFloat(String(txn.balance).replace(/,/g, '')) || 0;
              const balanceClass = balanceAmount < 0 ? 'text-red-600 font-bold' : 'text-[#0003eb] font-bold';
              return <span className={balanceClass}>AED {formatAmount(txn.balance)}</span>;
            })()}
          </TableCell>
          <TableCell className="text-sm py-2 px-4 text-left align-middle">
            {remarksText}
          </TableCell>
        </TableRow>
      );
    } else if (transaction.transactionType === 'GCEC PDC') {
      const txn = transaction as GCECPDC;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 bg-[#f3efc4] hover:bg-[#ece6ad] transition-colors">
          <TableCell className="text-red-600 text-sm py-2 px-4">{displayTransactionDate(txn.date)}</TableCell>
          <TableCell className="text-red-600 text-sm py-2 px-4">{txn.customerName}</TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-red-600">{txn.chequeNumber || '-'}</span>
          </TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-red-600">AED {formatAmount(txn.amount)}</span>
          </TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-red-600">AED 0.00</span>
          </TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4">-</TableCell>
          <TableCell className="text-red-600 text-sm py-2 px-4">{txn.description || ''}</TableCell>
        </TableRow>
      );
    } else if (transaction.transactionType === 'Customer PDC') {
      const txn = transaction as CustomerPDC;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 hover:bg-purple-50 transition-colors">
          <TableCell className="text-gray-700 text-sm py-2 px-4">{displayTransactionDate(txn.date)}</TableCell>
          <TableCell className="text-gray-700 text-sm py-2 px-4">{txn.customerName}</TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-gray-600">{txn.chequeNumber || '-'}</span>
          </TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-red-600">AED 0.00</span>
          </TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-black">AED {formatAmount(txn.amount)}</span>
          </TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4">-</TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4">{txn.description || ''}</TableCell>
        </TableRow>
      );
    } else if (transaction.transactionType === 'Purchase Bill') {
      const txn = transaction as PurchaseBill;
      return (
        <TableRow key={txn.id} className="border-b border-gray-100 hover:bg-orange-50 transition-colors">
          <TableCell className="text-gray-700 text-sm py-2 px-4">{displayTransactionDate(txn.date)}</TableCell>
          <TableCell className="text-gray-700 text-sm py-2 px-4">{txn.vendorName}</TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4">{txn.paymentMethod}</TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-red-600">AED 0.00</span>
          </TableCell>
          <TableCell className="text-sm py-2 px-4">
            <span className="text-black">AED{formatAmount(txn.amount)}</span>
          </TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4">-</TableCell>
          <TableCell className="text-gray-600 text-sm py-2 px-4">{txn.description || ''}</TableCell>
        </TableRow>
      );
    }
    return null;
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Header Section */}
    {/* Main Card */}
    <div className="bg-white rounded shadow-xl overflow-hidden">
          {/* Action Bar */}
          <div className="bg-[#f7c46d] p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-black font-bold text-lg">
                {getActiveMonthLabel()}
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded font-semibold hover:bg-blue-50 transition-all shadow-md"
              >
                <Calendar className="w-5 h-5" />
                Filter by Date
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>
              <div className="flex items-right gap-2">
              <button
                type="button"
                onClick={handleViewPdf}
                disabled={loading || statementLoading || isViewingPdf || !statementMeta}
                className="flex items-center gap-2 bg-[#ffff] text-black px-4 py-2 rounded font-semibold hover:bg-[#f1f5f9] transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="View Bank Statement PDF"
              >
                <Eye className="w-5 h-5" />
                {isViewingPdf ? 'Opening...' : 'View Bank Statement'}
              </button>
              {canUpload && (
                <button
                  type="button"
                  onClick={openUploadModal}
                  disabled={loading || statementLoading}
                  className="flex items-center gap-2 bg-[#ffff] text-black px-4 py-2 rounded font-semibold hover:bg-[#f1f5f9] transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Upload Bank Statement PDF"
                >
                  <Upload className="w-5 h-5" />
                  Upload Bank Statement
                </button>
              )}

              <button
                onClick={handleDownloadExcel}
                disabled={filteredTransactions.length === 0 || loading}
                className="flex items-center gap-2 bg-[#ffff] text-black px-4 py-2 rounded font-semibold hover:bg-[#f1f5f9] transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-5 h-5" />
                Download Excel
              </button>
              </div>
            </div>
          </div>

          {/* Filter Section */}
          {showFilters && (
            <div className="bg-slate-50 border-b border-slate-200 p-6">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={dateToString(startDate)}
                    onChange={(e) => setStartDate(stringToDate(e.target.value))}
                    max={dateToString(endDate) || undefined}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={dateToString(endDate)}
                    onChange={(e) => setEndDate(stringToDate(e.target.value))}
                    min={dateToString(startDate) || undefined}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
              
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear Filters
                </button>
              </div>
            </div>
          )}
</div>
      {/* Summary uards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-blue-700 mb-2">Daily Transaction Detail</p>
              <p className="text-3xl font-bold text-blue-900">{summary.dailyTransactions}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-black mb-2">GCEC Post Dated Cheques in Hand</p>
              <p className="text-3xl font-bold text-black">{summary.gcecPdc}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-purple-700 mb-2">Customers Post Dated Cheques in Hand</p>
              <p className="text-3xl font-bold text-purple-900">{summary.customerPdc}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-orange-700 mb-2">Sales Invoice amount paid against GCEC Purchase Bills</p>
              <p className="text-3xl font-bold text-orange-900">{summary.purchaseBills}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Transactions Table */}
      <Card className="bg-white border border-gray-200 overflow-hidden shadow-lg">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f7c46d] mx-auto mb-4"></div>
                <p className="text-base text-gray-500">Loading transactions...</p>
              </div>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-lg font-medium text-gray-500 mb-2">No transactions found</p>
                <p className="text-sm text-gray-400">Try adjusting your date filters</p>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#f1f5f9] border-0">
                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">Date</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">
                        Description
                      </TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">Details</TableHead>

                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">Debit</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">Credit</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">Balance</TableHead>
                      <TableHead className="font-semibold text-black text-sm text-left py-2 px-4">Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                          No transactions on this page
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedItems.map((item, index) => {
                        if (item.type === 'heading') {
                          const displayName = getTransactionTypeDisplayName(item.content as string);
                          return (
                            <TableRow key={`heading-${item.content}-${index}`} className="bg-gradient-to-r from-gray-100 to-gray-50 border-t-2 border-gray-300">
                              <TableCell colSpan={7} className="font-bold text-gray-900 text-lg py-4 px-4">
                                {displayName}
                              </TableCell>
                            </TableRow>
                          );
                        } else {
                          const txn = item.content as AllTransaction;
                          // Use unique key combining type and ID to prevent duplicate rendering
                          return (
                            <React.Fragment key={`${txn.transactionType}-${txn.id}-${index}`}>
                              {renderTransactionRow(txn)}
                            </React.Fragment>
                          );
                        }
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="p-6 border-t border-gray-200 bg-white">
                  <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
                    {/* Info Section */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                        <span className="text-sm text-gray-600">Showing</span>
                        <span className="text-sm font-semibold text-gray-900 px-2 py-0.5 bg-white rounded border border-gray-300">
                          {startTransactionIndex + 1}
                        </span>
                        <span className="text-sm text-gray-600">-</span>
                        <span className="text-sm font-semibold text-gray-900 px-2 py-0.5 bg-white rounded border border-gray-300">
                          {Math.min(endTransactionIndex, transactionCount)}
                        </span>
                        <span className="text-sm text-gray-600">of</span>
                        <span className="text-sm font-semibold text-gray-900 px-2 py-0.5 bg-white rounded border border-gray-300">
                          {transactionCount}
                        </span>
                      </div>
                    </div>

                    {/* Pagination Controls */}
                    <div className="flex items-center gap-3">
                      {/* Previous Button */}
                      <button
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                          currentPage === 1
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-[#f7c46d] hover:text-white hover:border-[#f7c46d] shadow-sm hover:shadow-md'
                        }`}
                      >
                        Previous
                      </button>

                      {/* Page Numbers */}
                      <div className="flex items-center gap-1">
                        {totalPages <= 7 ? (
                          // Show all pages if 7 or fewer
                          Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                currentPage === page
                                  ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                              }`}
                            >
                              {page}
                            </button>
                          ))
                        ) : (
                          // Smart pagination with ellipsis for many pages
                          <>
                            {/* First page */}
                            <button
                              onClick={() => setCurrentPage(1)}
                              className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                currentPage === 1
                                  ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                              }`}
                            >
                              1
                            </button>

                            {/* Ellipsis before current range */}
                            {currentPage > 3 && (
                              <span className="px-2 text-gray-400 font-medium">...</span>
                            )}

                            {/* Pages around current page */}
                            {Array.from({ length: 5 }, (_, i) => {
                              const page = currentPage - 2 + i;
                              if (page > 1 && page < totalPages) {
                                return (
                                  <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                      currentPage === page
                                        ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                                    }`}
                                  >
                                    {page}
                                  </button>
                                );
                              }
                              return null;
                            })}

                            {/* Ellipsis after current range */}
                            {currentPage < totalPages - 2 && (
                              <span className="px-2 text-gray-400 font-medium">...</span>
                            )}

                            {/* Last page */}
                            <button
                              onClick={() => setCurrentPage(totalPages)}
                              className={`min-w-[40px] h-10 px-3 rounded-lg font-medium text-sm transition-all ${
                                currentPage === totalPages
                                  ? 'bg-[#f7c46d] text-white shadow-md scale-105'
                                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm'
                              }`}
                            >
                              {totalPages}
                            </button>
                          </>
                        )}
                      </div>

                      {/* Next Button */}
                      <button
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                          currentPage === totalPages
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-[#f7c46d] hover:text-white hover:border-[#f7c46d] shadow-sm hover:shadow-md'
                        }`}
                      >
                        Next
                      </button>

                      {/* Go to Page Input */}
                      <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-300">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Go to:</span>
                        <input
                          type="number"
                          min={1}
                          max={totalPages}
                          value={currentPage}
                          onChange={(e) => {
                            const page = parseInt(e.target.value);
                            if (page >= 1 && page <= totalPages) {
                              setCurrentPage(page);
                            }
                          }}
                          className="w-16 h-10 px-2 text-sm text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f7c46d] focus:border-[#f7c46d] shadow-sm"
                        />
                        <span className="text-sm text-gray-500">/ {totalPages}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {statementMeta && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Current statement:{' '}
          {ensurePdfFilename(
            statementMeta.fileName ??
              statementMeta.filename ??
              statementMeta.originalName ??
              statementMeta.original_filename ??
              'bank-statement.pdf'
          )}
        </div>
      )}

      {uploadSuccess && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {uploadSuccess}
        </div>
      )}

      {canUpload && showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-lg font-semibold text-gray-900">Upload Report</h3>
              <button
                onClick={closeUploadModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close upload modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <label className="block text-sm font-medium text-gray-700">
                Select statement file
              </label>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null;
                  setReportFile(selected);
                  setUploadError(null);
                }}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f7c46d] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black"
              />
              {reportFile && (
                <p className="text-xs text-gray-600">
                  Selected: {reportFile.name}
                </p>
              )}
              {uploadError && (
                <p className="text-sm text-red-600">{uploadError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button
                onClick={closeUploadModal}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReportUpload}
                disabled={isUploading}
                className="rounded bg-[#f7c46d] px-4 py-2 text-sm font-semibold text-black hover:bg-[#e5b764] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showViewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-6xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-lg font-semibold text-gray-900">Bank Statement Preview</h3>
              <button
                onClick={closeViewModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close statement preview modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[75vh] w-full bg-gray-100">
              {statementPreviewUrl ? (
                <iframe
                  title="Bank Statement PDF"
                  src={statementPreviewUrl}
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  Unable to load statement preview.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button
                onClick={closeViewModal}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
   </div>
  );
}
