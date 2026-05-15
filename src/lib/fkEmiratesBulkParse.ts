import {
  normalizeBulkPaymentType,
  normalizeBulkTransactionDate,
  parseCsvRow,
  parseMoneyCell,
  splitCsvLines,
  tableFromExcelBuffer,
  type BulkTableRow,
} from './bulkTransactionCsv';

export type FkEmiratesBulkRow = {
  date: string;
  description: string;
  details: string;
  debit: number;
  credit: number;
  bankCharges: number;
};

export type FkBulkParseIssue = { csvRow: number; message: string };

const FK_MAX_ROWS = 2000;

/** Map Details / payment column to the string stored in FK `details` (matches manual form behaviour). */
export function normalizeFkDetailsForApi(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Online';
  const lower = s.toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{3,20}$/.test(s)) return s;
  if (
    lower === 'online' ||
    lower === 'bank transfer' ||
    lower === 'transfer' ||
    lower === 'wire' ||
    lower === 'neft' ||
    lower === 'rtgs' ||
    lower === 'imps'
  ) {
    return 'Online';
  }
  if (lower === 'cash') return 'Cash';
  if (lower === 'dd' || lower === 'direct debit' || lower.includes('direct debit')) return 'Online';
  if (lower.includes('credit') && lower.includes('card')) return 'Credit Card';
  if (lower === 'cheque' || lower === 'check' || lower === 'chq') return 'Cheque';
  if (lower.includes('cheque') || lower.includes('check')) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type FkFormPaymentType = 'cheque' | 'online' | 'cash' | 'creditcard';

/** Map stored `details` (and optional API payment type) back to the edit-form dropdown. */
export function detailsToFkPaymentTypeAndCheque(
  details: string,
  apiPaymentType?: string | null
): { paymentType: FkFormPaymentType | ''; chequeNumber: string } {
  const apiNorm = apiPaymentType ? normalizeBulkPaymentType(apiPaymentType) : null;
  if (apiNorm) {
    const paymentType: FkFormPaymentType =
      apiNorm === 'dd' ? 'online' : apiNorm;
    const s = String(details ?? '').trim();
    const chequeNumber =
      paymentType === 'cheque' && /^\d{3,20}$/.test(s) ? s : '';
    return { paymentType, chequeNumber };
  }

  const s = String(details ?? '').trim();
  if (!s) return { paymentType: 'online', chequeNumber: '' };

  const fromWord = normalizeBulkPaymentType(s);
  if (fromWord) {
    const paymentType: FkFormPaymentType = fromWord === 'dd' ? 'online' : fromWord;
    const chequeNumber =
      paymentType === 'cheque' && /^\d{3,20}$/.test(s) ? s : '';
    return { paymentType, chequeNumber };
  }

  if (/^\d{3,20}$/.test(s)) {
    return { paymentType: 'cheque', chequeNumber: s };
  }

  const lower = s.toLowerCase().replace(/\s+/g, ' ');
  if (lower.includes('credit') && lower.includes('card')) {
    return { paymentType: 'creditcard', chequeNumber: '' };
  }
  if (lower.includes('cheque') || lower.includes('check') || lower === 'chq') {
    return { paymentType: 'cheque', chequeNumber: '' };
  }
  if (lower.includes('cash')) {
    return { paymentType: 'cash', chequeNumber: '' };
  }
  if (
    lower.includes('online') ||
    lower.includes('transfer') ||
    lower.includes('wire') ||
    lower.includes('neft') ||
    lower.includes('rtgs') ||
    lower.includes('imps') ||
    lower.includes('debit')
  ) {
    return { paymentType: 'online', chequeNumber: '' };
  }

  return { paymentType: '', chequeNumber: '' };
}

function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+/g, '')
    .replace(/[_-]+/g, '');
}

const FK_HEADER_ALIASES: Record<string, string[]> = {
  date: ['date', 'transactiondate', 'txndate', 'valuedate', 'postingdate'],
  description: ['description', 'particulars', 'narration', 'payee', 'merchant', 'counterparty'],
  details: ['details', 'detail', 'channel', 'paymenttype', 'paymentmethod', 'mode', 'instrument'],
  stmtdebit: ['debit', 'debits', 'dr', 'withdrawal', 'withdrawals', 'moneyout', 'paidout'],
  stmtcredit: ['credit', 'credits', 'cr', 'deposit', 'deposits', 'moneyin', 'paidin'],
  bankcharges: ['bankcharges', 'bank_charges', 'charges', 'svccharges', 'fees'],
};

function mapFkHeader(cell: string): string | null {
  const n = normKey(cell);
  for (const [canonical, aliases] of Object.entries(FK_HEADER_ALIASES)) {
    if (aliases.some((a) => normKey(a) === n)) return canonical;
  }
  return null;
}

function buildFkColMap(headerCells: string[]): Record<string, number> {
  const colMap: Record<string, number> = {};
  headerCells.forEach((h, idx) => {
    const canon = mapFkHeader(h);
    if (canon && colMap[canon] === undefined) colMap[canon] = idx;
  });
  return colMap;
}

function detectFkLayout(colMap: Record<string, number>): boolean {
  return (
    colMap.date !== undefined &&
    colMap.stmtdebit !== undefined &&
    colMap.stmtcredit !== undefined &&
    colMap.description !== undefined
  );
}

function sliceFkTableFromHeader(table: BulkTableRow[]): BulkTableRow[] | null {
  const maxScan = Math.min(40, table.length);
  for (let h = 0; h < maxScan; h++) {
    const colMap = buildFkColMap(table[h].cells);
    if (detectFkLayout(colMap)) {
      return [table[h], ...table.slice(h + 1)];
    }
  }
  return null;
}

function padFkTable(table: BulkTableRow[]): void {
  if (table.length < 1) return;
  const w = table[0].cells.length;
  for (let i = 1; i < table.length; i++) {
    while (table[i].cells.length < w) table[i].cells.push('');
  }
}

export function parseFkEmiratesBulkTable(table: BulkTableRow[]): {
  rows: FkEmiratesBulkRow[];
  sourceCsvRows: number[];
  issues: FkBulkParseIssue[];
} {
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

  const sliced = sliceFkTableFromHeader(table);
  const work = sliced ?? table;
  padFkTable(work);

  const headerRowNum = work[0].fileRow;
  const colMap = buildFkColMap(work[0].cells);
  if (!detectFkLayout(colMap)) {
    return {
      rows: [],
      sourceCsvRows: [],
      issues: [
        {
          csvRow: headerRowNum,
          message:
            'Could not find FK statement headers. Need columns: Date, Description, Debit, Credit (optional: Details, Bank charges). Extra title rows above the header are skipped when possible.',
        },
      ],
    };
  }

  const rows: FkEmiratesBulkRow[] = [];
  const sourceCsvRows: number[] = [];
  const issues: FkBulkParseIssue[] = [];

  for (let i = 1; i < work.length; i++) {
    if (rows.length >= FK_MAX_ROWS) {
      issues.push({
        csvRow: work[i].fileRow,
        message: `Stopped after ${FK_MAX_ROWS} rows (max per upload). Split the file to import more.`,
      });
      break;
    }

    const fileRow = work[i].fileRow;
    const cells = work[i].cells;
    const get = (key: string): string => {
      const idx = colMap[key];
      if (idx === undefined) return '';
      return cells[idx] ?? '';
    };

    const dateRaw = get('date');
    const date = normalizeBulkTransactionDate(dateRaw);
    if (!date) {
      if (String(dateRaw).trim()) {
        issues.push({ csvRow: fileRow, message: `Invalid date: "${dateRaw}"` });
      }
      continue;
    }

    const debit = parseMoneyCell(get('stmtdebit'));
    const credit = parseMoneyCell(get('stmtcredit'));
    const bankCharges =
      colMap.bankcharges !== undefined ? parseMoneyCell(get('bankcharges')) : 0;

    if (debit > 0 && credit > 0) {
      issues.push({
        csvRow: fileRow,
        message: 'Row has both debit and credit; leave one column empty/zero per row.',
      });
      continue;
    }
    if (debit <= 0 && credit <= 0) continue;

    const description = get('description').trim();
    if (!description) {
      issues.push({ csvRow: fileRow, message: 'Description is required.' });
      continue;
    }

    const detailsRaw = colMap.details !== undefined ? get('details').trim() : '';
    const details = normalizeFkDetailsForApi(detailsRaw);

    rows.push({
      date,
      description,
      details,
      debit: debit > 0 ? debit : 0,
      credit: credit > 0 ? credit : 0,
      bankCharges: bankCharges > 0 ? bankCharges : 0,
    });
    sourceCsvRows.push(fileRow);
  }

  return { rows, sourceCsvRows, issues };
}

export function parseFkEmiratesBulkCsv(text: string): {
  rows: FkEmiratesBulkRow[];
  sourceCsvRows: number[];
  issues: FkBulkParseIssue[];
} {
  const lines = splitCsvLines(text);
  const table: BulkTableRow[] = lines.map((line, idx) => ({
    fileRow: idx + 1,
    cells: parseCsvRow(line),
  }));
  return parseFkEmiratesBulkTable(table);
}

export async function parseFkEmiratesBulkExcel(buffer: ArrayBuffer): Promise<{
  rows: FkEmiratesBulkRow[];
  sourceCsvRows: number[];
  issues: FkBulkParseIssue[];
}> {
  const table = await tableFromExcelBuffer(buffer);
  if (table.length === 0) {
    return {
      rows: [],
      sourceCsvRows: [],
      issues: [{ csvRow: 1, message: 'Excel file has no readable rows on the first sheet.' }],
    };
  }
  return parseFkEmiratesBulkTable(table);
}
