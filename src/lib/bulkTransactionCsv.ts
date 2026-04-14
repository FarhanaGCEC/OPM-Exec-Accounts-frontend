import ExcelJS from 'exceljs';
import type { PayablesCategory } from '../services/payablesService';
import type { ReceivablesCategory } from '../services/receivablesService';

export const BULK_TX_MAX_ROWS = 500;

export type BulkApiTransactionRow = {
  date: string;
  type: 'Debit' | 'Credit';
  paymentType: 'cash' | 'cheque' | 'creditcard' | 'online' | 'dd';
  amount: number;
  categoryId?: number;
  chequeNumber?: string;
  remarks?: string;
};

export type BulkParseRowIssue = { csvRow: number; message: string };

/** Parse one CSV row with RFC4180-style quoted fields. */
export function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur.trim());
  return out;
}

export function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
    if (!inQuotes && (c === '\n' || (c === '\r' && text[i + 1] === '\n'))) {
      if (c === '\r') i++;
      const t = cur.trim();
      if (t.length) lines.push(t);
      cur = '';
      continue;
    }
    if (!inQuotes && c === '\r') {
      const t = cur.trim();
      if (t.length) lines.push(t);
      cur = '';
      continue;
    }
    cur += c;
  }
  const last = cur.trim();
  if (last.length) lines.push(last);
  return lines;
}

function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_-]+/g, '');
}

/** Accept YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, ISO; return YYYY-MM-DD or null. */
export function normalizeBulkTransactionDate(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmY = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dmY) {
    const d = parseInt(dmY[1], 10);
    const m = parseInt(dmY[2], 10);
    const y = parseInt(dmY[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return null;
}

export function normalizeBulkPaymentType(raw: string): BulkApiTransactionRow['paymentType'] | null {
  const x = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (x === 'cash') return 'cash';
  if (x === 'cheque' || x === 'check' || x === 'chq') return 'cheque';
  if (x === 'creditcard' || x === 'credit card' || x === 'card') return 'creditcard';
  if (
    x === 'online' ||
    x === 'banktransfer' ||
    x === 'bank transfer' ||
    x === 'transfer' ||
    x === 'wire'
  ) {
    return 'online';
  }
  if (x === 'dd' || x === 'direct debit' || x === 'directdebit') return 'dd';
  return null;
}

function normalizeType(raw: string): 'Debit' | 'Credit' | null {
  const x = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (x === 'debit' || x === 'dr' || x === 'd') return 'Debit';
  if (x === 'credit' || x === 'cr' || x === 'c') return 'Credit';
  return null;
}

function resolveCategoryId(
  type: 'Debit' | 'Credit',
  rawCategory: string | undefined,
  payables: PayablesCategory[],
  receivables: ReceivablesCategory[]
): { id?: number; error?: string } {
  if (rawCategory === undefined || String(rawCategory).trim() === '') {
    return { error: 'categoryId or category is required' };
  }
  const s = String(rawCategory).trim();
  if (/^\d+$/.test(s.replace(/,/g, ''))) {
    return { id: Number(s.replace(/,/g, '')) };
  }
  const list = type === 'Debit' ? payables : receivables;
  const lower = s.toLowerCase();
  const hit = list.find((c) => c.name.trim().toLowerCase() === lower);
  if (hit) return { id: Number(hit.id) };
  const partial = list.find(
    (c) =>
      c.name.trim().toLowerCase().includes(lower) || lower.includes(c.name.trim().toLowerCase())
  );
  if (partial) return { id: Number(partial.id) };
  return { error: `Unknown category "${s}" for ${type}` };
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: [
    'date',
    'transactiondate',
    'txndate',
    'valuedate',
    'postingdate',
    'postdate',
    'bookeddate',
    'transdate',
    'trandate',
  ],
  type: ['type', 'debitcredit', 'drcr'],
  paymenttype: ['paymenttype', 'paymentmethod', 'payment', 'paytype'],
  amount: ['amount', 'amt', 'value'],
  /** Bank statement-style debit column (use with stmtcredit). */
  stmtdebit: [
    'debit',
    'debits',
    'dr',
    'withdrawal',
    'withdrawals',
    'moneyout',
    'paidout',
    'outflow',
  ],
  /** Bank statement-style credit column. */
  stmtcredit: [
    'credit',
    'credits',
    'cr',
    'deposit',
    'deposits',
    'moneyin',
    'paidin',
    'inflow',
  ],
  categoryid: ['categoryid', 'category_id', 'catid'],
  category: [
    'category',
    'categoryname',
    'description',
    'particulars',
    'narration',
    'narrations',
    'details',
    'detail',
    'memo',
    'transactiondetails',
    'transdetails',
    'payee',
    'merchant',
  ],
  chequenumber: ['chequenumber', 'cheque_number', 'cheque', 'checkno', 'checknumber'],
  remarks: ['remarks', 'remark', 'note', 'notes'],
};

function mapHeader(cell: string): string | null {
  const n = normKey(cell);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => normKey(a) === n || a === n)) return canonical;
  }
  return null;
}

function buildColMap(headerCells: string[]): Record<string, number> {
  const colMap: Record<string, number> = {};
  headerCells.forEach((h, idx) => {
    const canon = mapHeader(h);
    if (canon && colMap[canon] === undefined) colMap[canon] = idx;
  });
  return colMap;
}

type BulkLayout = 'classic' | 'statement';

function detectLayout(colMap: Record<string, number>): BulkLayout | null {
  if (colMap.date === undefined) return null;
  if (colMap.stmtdebit !== undefined && colMap.stmtcredit !== undefined) {
    return 'statement';
  }
  if (colMap.type !== undefined && colMap.amount !== undefined) {
    return 'classic';
  }
  return null;
}

/** Skip title rows: find the first row that looks like a bulk / statement header. */
function sliceTableFromDetectedHeader(table: BulkTableRow[]): BulkTableRow[] | null {
  const maxScan = Math.min(40, table.length);
  for (let h = 0; h < maxScan; h++) {
    const colMap = buildColMap(table[h].cells);
    if (detectLayout(colMap) !== null) {
      return [table[h], ...table.slice(h + 1)];
    }
  }
  return null;
}

function parseMoneyCell(raw: string): number {
  const s = String(raw ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function resolvePaymentTypeOrDefault(get: () => string): BulkApiTransactionRow['paymentType'] | null {
  const raw = String(get() ?? '').trim();
  if (!raw) return 'online';
  return normalizeBulkPaymentType(raw);
}

export type BulkTableRow = { fileRow: number; cells: string[] };

function excelCellToString(cell: ExcelJS.Cell): string {
  const text = cell.text;
  if (text != null && String(text).trim() !== '') return String(text).trim();
  const v = cell.value;
  if (v == null || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray((v as ExcelJS.CellRichTextValue).richText)) {
      return (v as ExcelJS.CellRichTextValue).richText.map((x) => x.text).join('');
    }
    if ('result' in v) {
      const r = (v as { result?: unknown }).result;
      if (r instanceof Date) {
        const y = r.getFullYear();
        const m = String(r.getMonth() + 1).padStart(2, '0');
        const d = String(r.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      return r == null ? '' : String(r);
    }
  }
  return '';
}

/** First worksheet → table rows with 1-based sheet row numbers (matches Excel row labels). */
export async function tableFromExcelBuffer(buffer: ArrayBuffer): Promise<BulkTableRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const table: BulkTableRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const lastCol = row.cellCount;
    if (lastCol < 1) return;
    const values: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      values.push(excelCellToString(row.getCell(c)));
    }
    while (values.length > 0 && values[values.length - 1].trim() === '') {
      values.pop();
    }
    if (!values.some((x) => String(x).trim() !== '')) return;
    table.push({ fileRow: rowNumber, cells: values });
  });
  return table;
}

function padTableRowsToHeaderWidth(table: BulkTableRow[]): void {
  if (table.length < 1) return;
  const w = table[0].cells.length;
  for (let i = 1; i < table.length; i++) {
    while (table[i].cells.length < w) {
      table[i].cells.push('');
    }
  }
}

/** Parse CSV or Excel-derived rows; `fileRow` is 1-based (CSV line or Excel sheet row). */
export function parseBulkTransactionTable(
  table: BulkTableRow[],
  payables: PayablesCategory[],
  receivables: ReceivablesCategory[]
): { rows: BulkApiTransactionRow[]; sourceCsvRows: number[]; issues: BulkParseRowIssue[] } {
  if (table.length < 2) {
    return {
      rows: [],
      sourceCsvRows: [],
      issues: [
        {
          csvRow: table[0]?.fileRow ?? 1,
          message: 'File must include a header row and at least one data row.',
        },
      ],
    };
  }

  const sliced = sliceTableFromDetectedHeader(table);
  const workTable = sliced ?? table;
  padTableRowsToHeaderWidth(workTable);

  const headerRowNum = workTable[0].fileRow;
  const colMap = buildColMap(workTable[0].cells);
  const layout = detectLayout(colMap);

  if (layout === null) {
    return {
      rows: [],
      sourceCsvRows: [],
      issues: [
        {
          csvRow: headerRowNum,
          message:
            'Could not find a valid header row. Use the bulk template (date, type, amount, category; paymentType optional, defaults to online), or a bank statement with Date plus Debit and Credit columns and a Description (or category) column. Extra title rows above the header are skipped when possible.',
        },
      ],
    };
  }

  if (layout === 'classic') {
    const missing: string[] = [];
    if (colMap.date === undefined) missing.push('date');
    if (colMap.type === undefined) missing.push('type');
    if (colMap.amount === undefined) missing.push('amount');
    if (missing.length) {
      return {
        rows: [],
        sourceCsvRows: [],
        issues: [
          {
            csvRow: headerRowNum,
            message: `Missing required column(s): ${missing.join(', ')}. paymentType is optional (defaults to online).`,
          },
        ],
      };
    }
  }

  const hasCategoryId = colMap.categoryid !== undefined;
  const hasCategoryName = colMap.category !== undefined;
  if (!hasCategoryId && !hasCategoryName) {
    return {
      rows: [],
      sourceCsvRows: [],
      issues: [
        {
          csvRow: headerRowNum,
          message:
            'Provide either categoryId (number) or a text column for category matching (category, description, narration, etc.).',
        },
      ],
    };
  }

  const rows: BulkApiTransactionRow[] = [];
  const sourceCsvRows: number[] = [];
  const issues: BulkParseRowIssue[] = [];

  if (layout === 'statement') {
    for (let i = 1; i < workTable.length; i++) {
      const fileRow = workTable[i].fileRow;
      const cells = workTable[i].cells;
      const get = (key: keyof typeof colMap): string => {
        const idx = colMap[key];
        if (idx === undefined) return '';
        return cells[idx] ?? '';
      };

      const dateRaw = get('date');
      const date = normalizeBulkTransactionDate(dateRaw);
      if (!date) {
        issues.push({ csvRow: fileRow, message: `Invalid date: "${dateRaw}"` });
        continue;
      }

      const debit = parseMoneyCell(get('stmtdebit'));
      const credit = parseMoneyCell(get('stmtcredit'));
      if (debit > 0 && credit > 0) {
        issues.push({
          csvRow: fileRow,
          message: 'Row has both debit and credit amounts; leave one column empty per row.',
        });
        continue;
      }
      if (debit <= 0 && credit <= 0) {
        continue;
      }

      const ptype = resolvePaymentTypeOrDefault(() => get('paymenttype'));
      if (!ptype) {
        issues.push({
          csvRow: fileRow,
          message: `Invalid paymentType: "${get('paymenttype')}" (cash, cheque, creditcard, dd, online, or leave blank for online)`,
        });
        continue;
      }

      const tryPush = (type: 'Debit' | 'Credit', amount: number): void => {
        const idPart = hasCategoryId ? get('categoryid').trim() : '';
        const namePart = hasCategoryName ? get('category').trim() : '';
        const catRaw = idPart || namePart;
        const resolved = resolveCategoryId(type, catRaw, payables, receivables);
        if (resolved.error || resolved.id === undefined) {
          issues.push({
            csvRow: fileRow,
            message: resolved.error || 'Category required',
          });
          return;
        }
        const categoryId = resolved.id;
        const chequeNumber = get('chequenumber');
        if (ptype === 'cheque' && !chequeNumber.trim()) {
          issues.push({
            csvRow: fileRow,
            message: 'chequeNumber is required when paymentType is cheque',
          });
          return;
        }
        const remarks = get('remarks').trim();
        const row: BulkApiTransactionRow = {
          date,
          type,
          paymentType: ptype,
          amount,
          categoryId,
        };
        if (ptype === 'cheque' && chequeNumber.trim()) {
          row.chequeNumber = chequeNumber.trim();
        }
        if (remarks) row.remarks = remarks;
        rows.push(row);
        sourceCsvRows.push(fileRow);
      };

      if (debit > 0) tryPush('Debit', debit);
      if (credit > 0) tryPush('Credit', credit);
    }

    return { rows, sourceCsvRows, issues };
  }

  for (let i = 1; i < workTable.length; i++) {
    const fileRow = workTable[i].fileRow;
    const cells = workTable[i].cells;
    const get = (key: keyof typeof colMap): string => {
      const idx = colMap[key];
      if (idx === undefined) return '';
      return cells[idx] ?? '';
    };

    const dateRaw = get('date');
    const date = normalizeBulkTransactionDate(dateRaw);
    if (!date) {
      issues.push({ csvRow: fileRow, message: `Invalid date: "${dateRaw}"` });
      continue;
    }

    const type = normalizeType(get('type'));
    if (!type) {
      issues.push({ csvRow: fileRow, message: `Invalid type: "${get('type')}" (use Debit or Credit)` });
      continue;
    }

    const ptype = resolvePaymentTypeOrDefault(() => get('paymenttype'));
    if (!ptype) {
      issues.push({
        csvRow: fileRow,
        message: `Invalid paymentType: "${get('paymenttype')}" (cash, cheque, creditcard, dd, online, or leave blank for online)`,
      });
      continue;
    }

    const amountStr = get('amount').replace(/,/g, '');
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      issues.push({ csvRow: fileRow, message: `Invalid amount: "${get('amount')}"` });
      continue;
    }

    const idPart = hasCategoryId ? get('categoryid').trim() : '';
    const namePart = hasCategoryName ? get('category').trim() : '';
    const catRaw = idPart || namePart;
    const { id: categoryId, error: catErr } = resolveCategoryId(type, catRaw, payables, receivables);
    if (catErr || categoryId === undefined) {
      issues.push({ csvRow: fileRow, message: catErr || 'Category required' });
      continue;
    }

    const chequeNumber = get('chequenumber');
    if (ptype === 'cheque' && !chequeNumber.trim()) {
      issues.push({ csvRow: fileRow, message: 'chequeNumber is required when paymentType is cheque' });
      continue;
    }

    const remarks = get('remarks').trim();
    const row: BulkApiTransactionRow = {
      date,
      type,
      paymentType: ptype,
      amount,
      categoryId,
    };
    if (ptype === 'cheque' && chequeNumber.trim()) {
      row.chequeNumber = chequeNumber.trim();
    }
    if (remarks) row.remarks = remarks;

    rows.push(row);
    sourceCsvRows.push(fileRow);
  }

  return { rows, sourceCsvRows, issues };
}

export function parseBulkTransactionCsv(
  text: string,
  payables: PayablesCategory[],
  receivables: ReceivablesCategory[]
): { rows: BulkApiTransactionRow[]; sourceCsvRows: number[]; issues: BulkParseRowIssue[] } {
  const lines = splitCsvLines(text);
  const table: BulkTableRow[] = lines.map((line, idx) => ({
    fileRow: idx + 1,
    cells: parseCsvRow(line),
  }));
  return parseBulkTransactionTable(table, payables, receivables);
}

export async function parseBulkTransactionExcel(
  buffer: ArrayBuffer,
  payables: PayablesCategory[],
  receivables: ReceivablesCategory[]
): Promise<{ rows: BulkApiTransactionRow[]; sourceCsvRows: number[]; issues: BulkParseRowIssue[] }> {
  const table = await tableFromExcelBuffer(buffer);
  if (table.length === 0) {
    return {
      rows: [],
      sourceCsvRows: [],
      issues: [{ csvRow: 1, message: 'Excel file has no readable rows on the first sheet.' }],
    };
  }
  return parseBulkTransactionTable(table, payables, receivables);
}

export function chunkBulkRows<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
