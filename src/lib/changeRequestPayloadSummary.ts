import type { ChangeRequestRow } from '../services/changeRequestService';
import { moneyFromApi } from './money';

export type PayloadSummaryLine = {
  label: string;
  value: string;
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const FIELD_LABELS: Record<string, string> = {
  statementmonth: 'Statement period',
  statement_month: 'Statement period',
  total_due: 'Total payment due',
  total_payment_due: 'Total payment due',
  paid_amount: 'Paid',
  paid: 'Paid',
  epp_balance: 'EPP',
  epp: 'EPP',
  amount_pending: 'Amount pending',
  replace_attachment_requested: 'Replace statement PDF',
  attachmentfilename: 'New statement PDF',
  attachment_filename: 'New statement PDF',
  removeattachment: 'Remove cheque scan',
  remove_attachment: 'Remove attachment',
  amount: 'Amount',
  date: 'Date',
  chequedate: 'Cheque date',
  cheque_date: 'Cheque date',
  type: 'Type',
  categoryid: 'Category',
  category_id: 'Category',
  category: 'Category',
  paymenttype: 'Payment type',
  payment_type: 'Payment type',
  payment_method: 'Payment method',
  chequenumber: 'Cheque number',
  cheque_number: 'Cheque number',
  chequetype: 'Cheque type',
  cheque_type: 'Cheque type',
  pdctype: 'PDC type',
  pdc_type: 'PDC type',
  customername: 'Customer / vendor',
  customer_name: 'Customer / vendor',
  vendor_name: 'Vendor',
  bill_date: 'Bill date',
  invoice_number: 'Invoice number',
  paid_against: 'Paid against',
  remarks: 'Remarks',
  description: 'Description',
  transactiontime: 'Entry time',
  transaction_time: 'Entry time',
  name: 'Name',
  entrytime: 'Entry time',
  entry_time: 'Entry time',
};

const MONEY_KEYS = new Set([
  'total_due',
  'total_payment_due',
  'paid_amount',
  'paid',
  'epp_balance',
  'epp',
  'amount_pending',
  'amount',
  'credit_balance',
]);

const RESOURCE_FIELD_ORDER: Record<string, string[]> = {
  card_statement: [
    'statementMonth',
    'statement_month',
    'total_due',
    'total_payment_due',
    'paid_amount',
    'paid',
    'epp_balance',
    'epp',
    'amount_pending',
    'attachmentFilename',
    'attachment_filename',
    'replace_attachment_requested',
  ],
  transaction: [
    'date',
    'type',
    'amount',
    'categoryId',
    'category_id',
    'category',
    'paymentType',
    'payment_type',
    'chequeNumber',
    'cheque_number',
    'remarks',
    'transactionTime',
    'transaction_time',
    'removeAttachment',
    'remove_attachment',
  ],
  post_dated_cheque: [
    'date',
    'chequeDate',
    'cheque_date',
    'amount',
    'chequeNumber',
    'cheque_number',
    'customerName',
    'customer_name',
    'chequeType',
    'cheque_type',
    'pdcType',
    'pdc_type',
    'remarks',
    'transactionTime',
    'transaction_time',
    'removeAttachment',
    'remove_attachment',
  ],
  purchase_bill: [
    'bill_date',
    'vendor_name',
    'payment_method',
    'amount',
    'invoice_number',
    'paid_against',
    'remarks',
  ],
  credit_card_payment: [
    'paymentDate',
    'payment_date',
    'amount',
    'cardNo',
    'card_no',
    'cardHolder',
    'card_holder',
    'remarks',
  ],
  payables_category: ['name'],
  receivables_category: ['name'],
};

function normalizeResourceType(resourceType: string): string {
  return resourceType.toLowerCase().replace(/-/g, '_');
}

function fieldLabel(key: string): string {
  const direct = FIELD_LABELS[key.toLowerCase()];
  if (direct) return direct;
  const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (FIELD_LABELS[snake]) return FIELD_LABELS[snake];
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatYearMonthBucket(value: string): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
  if (!m) return value;
  const monthIndex = parseInt(m[2], 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${MONTH_NAMES[monthIndex]} ${m[1]}`;
}

function formatPayloadValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') {
    if (key.toLowerCase().includes('replace') || key.toLowerCase().includes('remove')) {
      return value ? 'Yes' : 'No';
    }
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number' || MONEY_KEYS.has(key) || MONEY_KEYS.has(key.toLowerCase())) {
    if (typeof value === 'string' && !/^-?\d/.test(value.trim())) {
      /* not numeric string */
    } else {
      const n = moneyFromApi(value);
      return `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return formatYearMonthBucket(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.split('T')[0].split('-');
    if (parts.length === 3) {
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parts[2];
      const shortMonth = MONTH_NAMES[monthIndex]?.slice(0, 3) ?? parts[1];
      return `${day}-${shortMonth}-${parts[0].slice(-2)}`;
    }
  }
  return s;
}

function orderedKeys(resourceType: string, payload: Record<string, unknown>): string[] {
  const rt = normalizeResourceType(resourceType);
  const preferred = RESOURCE_FIELD_ORDER[rt] ?? [];
  const keys = Object.keys(payload);
  const sorted: string[] = [];
  for (const k of preferred) {
    if (keys.includes(k)) sorted.push(k);
  }
  for (const k of keys) {
    if (!sorted.includes(k)) sorted.push(k);
  }
  return sorted;
}

function lineForKey(
  resourceType: string,
  action: string,
  key: string,
  value: unknown
): PayloadSummaryLine | null {
  if (value === null || value === undefined) return null;
  if (key === 'id' || key === 'resourceId' || key === 'resource_id') return null;

  const label = fieldLabel(key);
  const formatted = formatPayloadValue(key, value);

  if (key === 'replace_attachment_requested' && value === false) return null;
  if (key === 'attachmentBase64' || key === 'attachment_base64') return null;

  const rt = normalizeResourceType(resourceType);
  if (rt === 'card_statement' && action === 'delete') {
    if (key === 'statementMonth' || key === 'statement_month') {
      return { label: 'Action', value: `Remove statement PDF for ${formatted}` };
    }
  }

  return { label, value: formatted };
}

function summarizeCardStatementDelete(payload: Record<string, unknown>): PayloadSummaryLine[] {
  const month = payload.statementMonth ?? payload.statement_month;
  if (month != null && String(month).trim()) {
    return [
      {
        label: 'Action',
        value: `Remove statement PDF for ${formatPayloadValue('statementMonth', month)}`,
      },
    ];
  }
  return [{ label: 'Action', value: 'Remove statement PDF' }];
}

function summarizeDeleteAction(
  resourceType: string,
  payload: Record<string, unknown>
): PayloadSummaryLine[] {
  const rt = normalizeResourceType(resourceType);
  if (rt === 'card_statement') return summarizeCardStatementDelete(payload);
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return [{ label: 'Action', value: 'Delete this record' }];
  }
  return orderedKeys(resourceType, payload)
    .map((k) => lineForKey(resourceType, 'delete', k, payload[k]))
    .filter((x): x is PayloadSummaryLine => x != null);
}

/** Human-readable summary of a change-request payload for admins and standard users. */
export function summarizeChangeRequestPayload(
  row: Pick<ChangeRequestRow, 'action' | 'resourceType' | 'payload'>
): PayloadSummaryLine[] {
  const payload = row.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const action = row.action.toLowerCase();
    if (action === 'delete') {
      return [{ label: 'Action', value: 'Delete this record' }];
    }
    return [];
  }

  const action = row.action.toLowerCase();
  if (action === 'delete') {
    return summarizeDeleteAction(row.resourceType, payload as Record<string, unknown>);
  }

  const lines = orderedKeys(row.resourceType, payload as Record<string, unknown>)
    .map((k) => lineForKey(row.resourceType, action, k, (payload as Record<string, unknown>)[k]))
    .filter((x): x is PayloadSummaryLine => x != null);

  if (lines.length === 0 && action === 'edit') {
    return [{ label: 'Update', value: 'Edit requested (see technical details)' }];
  }

  return lines;
}

export function payloadSummaryHeadline(
  row: Pick<ChangeRequestRow, 'action' | 'resourceType' | 'payload'>
): string {
  const lines = summarizeChangeRequestPayload(row);
  if (lines.length === 0) return 'No change details';
  if (lines.length === 1) return `${lines[0].label}: ${lines[0].value}`;
  return `${lines.length} fields updated`;
}
