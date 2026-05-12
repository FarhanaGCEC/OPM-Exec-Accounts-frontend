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

function parseDisplayDateInput(input: string): Date | null {
  const s = input.trim();
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const day = parseInt(slash[1], 10);
    const month = parseInt(slash[2], 10) - 1;
    const year = expandCenturyYear(parseInt(slash[3], 10));
    const d = new Date(year, month, day);
    if (
      d.getFullYear() === year &&
      d.getMonth() === month &&
      d.getDate() === day
    ) {
      return d;
    }
    return null;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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
