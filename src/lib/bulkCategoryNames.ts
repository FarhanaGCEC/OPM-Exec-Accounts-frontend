import * as XLSX from 'xlsx';

export const BULK_CATEGORY_NAMES_MAX = 2000;

const HEADER_LINE_TOKENS = new Set([
  'name',
  'creditor',
  'creditors',
  'debtor',
  'debtors',
  'vendor',
  'customer',
  'category',
]);

export function isLikelyCategoryNamesHeader(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (!t) return false;
  return HEADER_LINE_TOKENS.has(t);
}

/** One name per line, or first column when the line contains commas (matches server CSV rules). */
export function lineToCategoryName(line: string): string {
  const t = line.trim();
  if (!t) return '';
  const comma = t.indexOf(',');
  if (comma === -1) return t;
  let first = t.slice(0, comma).trim();
  if (first.startsWith('"') && first.endsWith('"') && first.length >= 2) {
    first = first.slice(1, -1).replace(/""/g, '"');
  }
  return first;
}

export function parseCategoryNamesFromText(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  for (const line of lines) {
    const name = lineToCategoryName(line);
    if (!name) continue;
    if (i === 0 && isLikelyCategoryNamesHeader(name)) {
      i++;
      continue;
    }
    i++;
    out.push(name);
  }
  return dedupeCategoryNamesCaseInsensitive(out);
}

export function dedupeCategoryNamesCaseInsensitive(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** First worksheet, first column; header row optional (name / creditor / debtor). */
export function parseCategoryNamesFromExcelBuffer(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  });
  const out: string[] = [];
  let rowIndex = 0;
  for (const row of rows) {
    const cell = row?.[0];
    const s =
      cell === undefined || cell === null ? '' : String(cell).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (rowIndex === 0 && isLikelyCategoryNamesHeader(s)) {
      rowIndex++;
      continue;
    }
    rowIndex++;
    out.push(s);
  }
  return dedupeCategoryNamesCaseInsensitive(out);
}

export function capCategoryNames(names: string[]): { names: string[]; truncated: number } {
  if (names.length <= BULK_CATEGORY_NAMES_MAX) {
    return { names, truncated: 0 };
  }
  return {
    names: names.slice(0, BULK_CATEGORY_NAMES_MAX),
    truncated: names.length - BULK_CATEGORY_NAMES_MAX,
  };
}
