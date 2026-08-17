import { expandCenturyYear } from './formatDisplayDate';

/** Parse dd/mm/yyyy (or dd/mm/yy) form input to a local calendar date. */
export function parseTransactionFormDate(dateString: string): Date | null {
  if (!dateString || dateString.length < 8) return null;
  const parts = dateString.split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = expandCenturyYear(parseInt(parts[2], 10));
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** Format a local calendar date as dd/mm/yyyy for transaction forms. */
export function formatTransactionFormDate(date: Date | null): string {
  if (!date || isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

/** Convert an API / display date string to dd/mm/yyyy for the form field. */
export function apiDateToTransactionFormDate(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const parsed = parseTransactionFormDate(raw);
  if (parsed) return formatTransactionFormDate(parsed);

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) {
    return formatTransactionFormDate(
      new Date(iso.getFullYear(), iso.getMonth(), iso.getDate())
    );
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const day = parseInt(slash[1], 10);
    const month = parseInt(slash[2], 10);
    const year = expandCenturyYear(parseInt(slash[3], 10));
    return formatTransactionFormDate(new Date(year, month - 1, day));
  }

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10);
    const day = parseInt(ymd[3], 10);
    return formatTransactionFormDate(new Date(year, month - 1, day));
  }

  return '';
}
