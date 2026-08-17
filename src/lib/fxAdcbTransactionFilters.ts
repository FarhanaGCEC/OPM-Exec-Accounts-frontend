import { parseCalendarDateLocal } from './formatDisplayDate';
import {
  fxAdcbDetailsDisplayLabel,
  fxAdcbInferPaymentTab,
} from './fxAdcbPaymentDetails';
import type { FxAdcbActiveTab, FxAdcbFilterState } from '@/components/FxAdcbTransactionFilterBar';

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface FxAdcbTransactionRow {
  date: string;
  description: string;
  details: string;
  debit?: number | string | null;
  credit?: number | string | null;
}

export function filterFxAdcbTransactions<T extends FxAdcbTransactionRow>(
  transactions: T[],
  filters: FxAdcbFilterState,
  activeTab: FxAdcbActiveTab,
  parseTxnDate: (date: string) => Date | null
): T[] {
  return transactions.filter((transaction) => {
    const detailsTab = fxAdcbInferPaymentTab(transaction.details);
    if (activeTab === 'online' && detailsTab !== 'online') return false;
    if (activeTab === 'cheque' && detailsTab !== 'cheque') return false;
    if (activeTab === 'cash' && detailsTab !== 'cash') return false;

    if (activeTab === 'debit') {
      const debit = parseFloat(String(transaction.debit ?? 0).replace(/,/g, ''));
      if (!(debit > 0)) return false;
    }
    if (activeTab === 'credit') {
      const credit = parseFloat(String(transaction.credit ?? 0).replace(/,/g, ''));
      if (!(credit > 0)) return false;
    }

    if (filters.startDate || filters.endDate) {
      const transactionDate = parseTxnDate(transaction.date);
      if (!transactionDate) return false;
      const txDay = startOfLocalDay(transactionDate).getTime();

      if (filters.startDate) {
        const start = parseCalendarDateLocal(filters.startDate);
        if (start && txDay < startOfLocalDay(start).getTime()) return false;
      }
      if (filters.endDate) {
        const end = parseCalendarDateLocal(filters.endDate);
        if (end && txDay > startOfLocalDay(end).getTime()) return false;
      }
    }

    if (filters.searchDetails.trim()) {
      const label = fxAdcbDetailsDisplayLabel(transaction.details).toLowerCase();
      if (!label.includes(filters.searchDetails.toLowerCase().trim())) return false;
    }

    if (filters.searchDescription.trim()) {
      const description = String(transaction.description ?? '').toLowerCase();
      if (!description.includes(filters.searchDescription.toLowerCase().trim())) return false;
    }

    if (filters.searchAmount.trim()) {
      const debitStr = String(transaction.debit ?? '');
      const creditStr = String(transaction.credit ?? '');
      const haystack = `${debitStr} ${creditStr}`.toLowerCase();
      if (!haystack.includes(filters.searchAmount.toLowerCase().trim())) return false;
    }

    return true;
  });
}

export const emptyFxAdcbFilters: FxAdcbFilterState = {
  startDate: '',
  endDate: '',
  searchDetails: '',
  searchAmount: '',
  searchDescription: '',
};
