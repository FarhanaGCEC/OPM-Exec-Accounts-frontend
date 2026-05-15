/** Matches BankTransaction-style display: DD-MMM-YY from an ISO or parseable date string. */
const MONTHS = [
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
] as const;

/** Render a calendar year as two digits (e.g. 2026 → 26). */
export function formatDisplayYear(year: number): string {
  return String(year).slice(-2).padStart(2, '0');
}

/** Expand a two-digit year to a full calendar year for parsing and API payloads. */
export function expandCenturyYear(yearPart: number): number {
  if (yearPart >= 100) return yearPart;
  return 2000 + yearPart;
}

/**
 * Parse API / user input to a local calendar date (midnight local).
 * Avoids showing 14-May in the edit form when the grid shows 15-May for `…T00:00:00.000Z` in UTC+ timezones.
 */
export function parseCalendarDateLocal(input: string | null | undefined): Date | null {
  const s = String(input ?? '').trim();
  if (!s) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10) - 1;
    const day = parseInt(ymd[3], 10);
    const d = new Date(year, month, day);
    if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
      return d;
    }
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    return null;
  }

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const day = parseInt(slash[1], 10);
    const month = parseInt(slash[2], 10) - 1;
    const year = expandCenturyYear(parseInt(slash[3], 10));
    const d = new Date(year, month, day);
    if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
      return d;
    }
    return null;
  }

  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/i);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const monthIndex = MONTHS.findIndex(
      (m) => m.toLowerCase() === dmy[2].toLowerCase()
    );
    if (monthIndex >= 0) {
      const year = expandCenturyYear(parseInt(dmy[3], 10));
      const d = new Date(year, monthIndex, day);
      if (d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day) {
        return d;
      }
    }
  }

  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }
  return null;
}

function parseDisplayDateInput(input: string): Date | null {
  return parseCalendarDateLocal(input);
}

export function formatIsoDateDisplay(isoOrDateString: string | null | undefined): string {
  if (isoOrDateString == null || isoOrDateString === '') return '—';
  try {
    const date = parseDisplayDateInput(String(isoOrDateString));
    if (date == null) return String(isoOrDateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = MONTHS[date.getMonth()];
    const year = formatDisplayYear(date.getFullYear());
    return `${day}-${month}-${year}`;
  } catch {
    return String(isoOrDateString);
  }
}

/** Same date part as {@link formatIsoDateDisplay}, plus local 24h time (HH:mm). */
/** Format a local `Date` as DD-MMM-YY (for pickers / `Date` objects without string parse). */
export function formatJsDateDisplay(date: Date): string {
  if (isNaN(date.getTime())) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const year = formatDisplayYear(date.getFullYear());
  return `${day}-${month}-${year}`;
}

/** Bank write APIs and MySQL DATE columns expect YYYY-MM-DD (not ISO datetime). */
export function formatDateForApi(input: string | null | undefined): string {
  const date = parseCalendarDateLocal(input);
  if (date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  const s = String(input ?? '').trim();
  return s;
}

export function formatIsoDateTimeDisplay(isoOrDateString: string | null | undefined): string {
  if (isoOrDateString == null || isoOrDateString === '') return '—';
  try {
    const date = new Date(isoOrDateString);
    if (isNaN(date.getTime())) return String(isoOrDateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = MONTHS[date.getMonth()];
    const year = formatDisplayYear(date.getFullYear());
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${h}:${m}`;
  } catch {
    return isoOrDateString;
  }
}
