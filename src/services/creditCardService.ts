import api from '../lib/api';
import type { ApiResponse } from '../lib/api';
import { resolveAttachmentHref } from '../lib/resolveAttachmentUrl';
import { expandCenturyYear } from '../lib/formatDisplayDate';
import { moneyFromApi } from '../lib/money';

// API Response interface for Credit Card Details (snake_case from backend)
export interface CreditCardDetailApiResponse {
  id: string | number;
  issuing_bank: string;
  card_holder: string;
  card_number: string;
  expiry?: string;
  expiry_date?: string;
  cvv: string | null;
  amount_limit: number | null;
  is_system?: boolean;
  is_default?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Internal interface for Credit Card Details (camelCase for frontend)
export interface CreditCardDetail {
  id: string;
  issuingBank: string;
  cardHolder: string;
  cardNo: string;
  expiry_date: string;
  cvv: string;
  amountLimit: number;
  isActive: boolean;
}

// Helper function to map API response to component interface
export const mapApiResponseToCreditCardDetail = (
  apiCard: CreditCardDetailApiResponse | any
): CreditCardDetail => {
  return {
    id: String(apiCard.id),
    issuingBank: apiCard.issuing_bank,
    cardHolder: apiCard.card_holder,
    cardNo: apiCard.card_number,
    expiry_date: apiCard.expiry || apiCard.expiry_date || '',
    cvv: apiCard.cvv || '',
    amountLimit: apiCard.amount_limit || 0,
    isActive: apiCard.is_active !== undefined ? apiCard.is_active : true,
  };
};

/** Label shown in credit card pickers (maps internal holder name to display name). */
export function displayCreditCardHolderName(holder: string | undefined | null): string {
  const t = String(holder ?? '').trim();
  if (t.toLowerCase() === 'suleman') return 'MST';
  return t;
}

// API Response interface for Credit Card Statements (snake_case from backend)
export interface CreditCardStatementApiResponse {
  id: number;
  issuing_bank: string;
  card_holder: string;
  card_no: string;
  statement_date: string | null;
  due_date: string | null;
  due_month: string | null;
  total_payment_due: number;
  paid: number;
  epp: number;
  amount_pending: number;
  credit_balance?: number;
}

// Internal interface for Credit Card Statements (camelCase for frontend)
export interface CreditCardStatement {
  id: string;
  issuingBank: string;
  cardHolder: string;
  card_number: string;
  statement_date: string | null;
  due_date: string | null;
  due_month: string | null;
  totalPaymentDue: number;
  paid: number;
  epp: number;
  amountPending: number;
  creditBalance: number;
  /** Stored attachment filename from API */
  attachmentName?: string | null;
  /** URL or path to open/download the PDF */
  attachmentUrl?: string | null;
}

export interface PaidAgainstOptionApiResponse {
  value: string;
  label: string;
  billNumber?: string | null;
  invoiceNumber?: string | null;
  vendorName?: string | null;
  billDate?: string | null;
  paymentStatus?: string | null;
}

export interface PaidAgainstOption {
  value: string;
  label: string;
  billNumber?: string;
  invoiceNumber?: string;
  vendorName?: string;
  billDate?: string;
  paymentStatus?: string;
}

function mapStatementAttachmentFields(item: any): {
  attachmentName: string | null;
  attachmentUrl: string | null;
} {
  const nested = item?.attachment;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const name = nested.name ?? item.attachment_name ?? item.attachmentName ?? null;
    const url = nested.url ?? item.attachment_url ?? item.attachmentUrl ?? null;
    return {
      attachmentName: name != null ? String(name) : null,
      attachmentUrl: url != null ? String(url) : null,
    };
  }
  return {
    attachmentName:
      item.attachment_name != null
        ? String(item.attachment_name)
        : item.attachmentName != null
          ? String(item.attachmentName)
          : null,
    attachmentUrl:
      item.attachment_url != null
        ? String(item.attachment_url)
        : item.attachmentUrl != null
          ? String(item.attachmentUrl)
          : null,
  };
}

/** PATCH must not merge API error/hint envelopes into table rows (they map to zeros). */
function assertPatchBodyIsStatementRow(statementData: unknown): void {
  if (!statementData || typeof statementData !== 'object' || Array.isArray(statementData)) {
    throw new Error('Invalid statement update response from server.');
  }
  const o = statementData as Record<string, unknown>;
  if (typeof o.code === 'string' && o.code === 'APPROVAL_REQUIRED') {
    const e = new Error(String(o.error ?? o.message ?? 'Approval required'));
    (e as any).code = 'APPROVAL_REQUIRED';
    throw e;
  }
  const hasRowFields =
    o.issuing_bank != null ||
    o.card_holder != null ||
    o.card_no != null ||
    o.card_number != null ||
    o.credit_card_id != null ||
    o.card_id != null ||
    o.total_payment_due != null ||
    o.total_due != null ||
    o.totalDue != null ||
    o.paid != null ||
    o.paid_amount != null ||
    o.paidAmount != null ||
    o.epp != null ||
    o.epp_balance != null ||
    o.eppBalance != null ||
    o.amount_pending != null ||
    o.amountPending != null ||
    o.credit_balance != null ||
    o.creditBalance != null;
  if (hasRowFields) return;
  const msg = String(o.error ?? o.message ?? o.hint ?? '').trim();
  const e = new Error(msg || 'Statement update was not applied.');
  const lower = msg.toLowerCase();
  if (
    lower.includes('approval') ||
    lower.includes('admin') ||
    lower.includes('change request') ||
    lower.includes('cannot edit')
  ) {
    (e as any).code = 'APPROVAL_REQUIRED';
  } else if (typeof o.code === 'string') {
    (e as any).code = o.code;
  }
  throw e;
}

export type CreditCardStatementsGrouped = Record<string, CreditCardStatement[]>;

export type CreditCardStatementsListResult = ApiResponse<CreditCardStatement[]> & {
  groupedByMonth?: CreditCardStatementsGrouped;
};

function isCreditCardStatementRow(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const o = item as Record<string, unknown>;
  return (
    o.issuing_bank != null ||
    o.issuingBank != null ||
    o.card_holder != null ||
    o.cardHolder != null ||
    o.card_no != null ||
    o.card_number != null ||
    o.cardNumber != null ||
    o.card_id != null ||
    o.credit_card_id != null
  );
}

const MONTH_BUCKET_KEY_RE = /^(\d{4})-(\d{1,2})$/;
const MONTH_NUM_BUCKET_KEY_RE = /^(\d{1,2})$/;

function normalizeStatementMonthBucketKey(key: string, fallbackYear: number): string | null {
  const trimmed = key.trim();
  const yearMonth = trimmed.match(MONTH_BUCKET_KEY_RE);
  if (yearMonth) {
    return `${yearMonth[1]}-${yearMonth[2].padStart(2, '0')}`;
  }
  const monthOnly = trimmed.match(MONTH_NUM_BUCKET_KEY_RE);
  if (monthOnly) {
    const num = parseInt(monthOnly[1], 10);
    if (num >= 1 && num <= 12) {
      return `${fallbackYear}-${String(num).padStart(2, '0')}`;
    }
  }
  return null;
}

/** UI/API month bucket key (handles Dec+Jan spanning two years). */
export function statementPeriodMonthKey(
  selectedYear: number,
  monthIndex: number,
  selectedMonthIndices: number[]
): string {
  if (selectedMonthIndices.includes(0) && selectedMonthIndices.includes(11) && monthIndex === 11) {
    return `${selectedYear - 1}-12`;
  }
  return `${selectedYear}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function monthKeyFromStatementRow(item: Record<string, unknown>, fallbackYear: number): string | null {
  const fromDate = item.statement_date ?? item.statementDate;
  if (fromDate != null) {
    const parts = String(fromDate).split('-');
    if (parts.length >= 2) {
      const y = parts[0];
      const m = parts[1].padStart(2, '0');
      if (/^\d{4}$/.test(y)) return `${y}-${m}`;
    }
  }
  const period = item.statement_month ?? item.statementMonth ?? item.month ?? item.period;
  if (period != null) {
    return normalizeStatementMonthBucketKey(String(period), fallbackYear);
  }
  return null;
}

function statementRowsFromMonthEntry(entry: Record<string, unknown>): unknown[] {
  for (const key of ['statements', 'items', 'data', 'records', 'rows']) {
    const v = entry[key];
    if (Array.isArray(v)) return v;
  }
  return isCreditCardStatementRow(entry) ? [entry] : [];
}

function emptyGroupedBuckets(year: number, monthIndices: number[]): CreditCardStatementsGrouped {
  const grouped: CreditCardStatementsGrouped = {};
  for (const m of monthIndices) {
    grouped[statementPeriodMonthKey(year, m, monthIndices)] = [];
  }
  return grouped;
}

/** Multi-month GET may return a flat array or month buckets under `data`. */
export function parseCreditCardStatementsApiData(
  data: unknown,
  year: number,
  monthIndices: number[],
  depth = 0
): { statements: CreditCardStatement[]; groupedByMonth: CreditCardStatementsGrouped } {
  const groupedByMonth = emptyGroupedBuckets(year, monthIndices);
  const statements: CreditCardStatement[] = [];

  const pushStatement = (raw: unknown, monthKey: string | null) => {
    if (!isCreditCardStatementRow(raw)) return;
    const stmt = mapCreditCardStatementFromApi(raw);
    statements.push(stmt);
    const key =
      monthKey ??
      monthKeyFromStatementRow(raw as Record<string, unknown>, year) ??
      null;
    if (key) {
      if (!groupedByMonth[key]) groupedByMonth[key] = [];
      groupedByMonth[key].push(stmt);
    }
  };

  const ingestFlat = (rows: unknown[]) => {
    for (const raw of rows) {
      pushStatement(raw, null);
    }
  };

  if (depth > 8 || data == null) {
    return { statements, groupedByMonth };
  }

  if (Array.isArray(data)) {
    ingestFlat(data);
    return { statements, groupedByMonth };
  }

  if (typeof data !== 'object') {
    return { statements, groupedByMonth };
  }

  const o = data as Record<string, unknown>;

  if (Array.isArray(o.months)) {
    let matched = false;
    for (const entry of o.months) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const monthKey = normalizeStatementMonthBucketKey(
        String(e.month ?? e.monthKey ?? e.period ?? e.statement_month ?? e.statementMonth ?? ''),
        year
      );
      const rows = statementRowsFromMonthEntry(e);
      if (rows.length === 0) continue;
      matched = true;
      for (const raw of rows) {
        pushStatement(raw, monthKey);
      }
    }
    if (matched) return { statements, groupedByMonth };
  }

  let foundBuckets = false;
  for (const [key, value] of Object.entries(o)) {
    if (!Array.isArray(value) || !value.some(isCreditCardStatementRow)) continue;
    const monthKey = normalizeStatementMonthBucketKey(key, year);
    if (!monthKey) continue;
    foundBuckets = true;
    for (const raw of value) {
      pushStatement(raw, monthKey);
    }
  }
  if (foundBuckets) return { statements, groupedByMonth };

  for (const key of ['statements', 'items', 'results', 'rows', 'records']) {
    const v = o[key];
    if (Array.isArray(v)) {
      ingestFlat(v);
      return { statements, groupedByMonth };
    }
  }

  if (isCreditCardStatementRow(o)) {
    pushStatement(o, null);
    return { statements, groupedByMonth };
  }

  if (o.data != null) {
    return parseCreditCardStatementsApiData(o.data, year, monthIndices, depth + 1);
  }

  return { statements, groupedByMonth };
}

export function mapCreditCardStatementFromApi(item: any): CreditCardStatement {
  const att = mapStatementAttachmentFields(item);
  // PATCH/POST bodies often use total_due / paid_amount / epp_balance; GET uses total_payment_due / paid / epp.
  const totalPaymentDue = item.total_payment_due ?? item.total_due ?? item.totalDue;
  const paid = item.paid ?? item.paid_amount ?? item.paidAmount;
  const epp = item.epp ?? item.epp_balance ?? item.eppBalance;
  const amountPending = item.amount_pending ?? item.amountPending;
  const creditBalance = item.credit_balance ?? item.creditBalance;
  return {
    id: item.card_id ? String(item.card_id) : (item.credit_card_id ? String(item.credit_card_id) : String(item.id || '')),
    issuingBank: item.issuing_bank || '',
    cardHolder: item.card_holder || '',
    card_number: item.card_no || item.card_number || '',
    statement_date: item.statement_date ?? null,
    due_date: item.due_date ?? null,
    due_month: item.due_month ?? null,
    totalPaymentDue: moneyFromApi(totalPaymentDue),
    paid: moneyFromApi(paid),
    epp: moneyFromApi(epp),
    amountPending: moneyFromApi(amountPending),
    creditBalance: moneyFromApi(creditBalance),
    attachmentName: att.attachmentName,
    attachmentUrl: att.attachmentUrl,
  };
}

/** Turn API attachment path into a browser-openable URL (same-origin /api proxy or absolute). */
export function resolveStatementAttachmentHref(pathOrUrl: string | null | undefined): string | null {
  return resolveAttachmentHref(pathOrUrl);
}

/** Default period: previous calendar month + current month (0-based indices). */
export function getDefaultStatementPeriod(date = new Date()): {
  year: number;
  months: number[];
} {
  const currentMonth = date.getMonth();
  const year = date.getFullYear();
  if (currentMonth === 0) {
    return { year, months: [11, 0] };
  }
  return { year, months: [currentMonth - 1, currentMonth] };
}

/** When both Dec (11) and Jan (0) are selected, December belongs to the prior year. */
function groupStatementMonthIndicesByYear(
  year: number,
  monthIndices: number[]
): { year: number; months: number[] }[] {
  if (monthIndices.includes(0) && monthIndices.includes(11)) {
    const other = monthIndices.filter((m) => m !== 0 && m !== 11);
    return [
      { year: year - 1, months: [11, ...other] },
      { year, months: [0, ...other] },
    ];
  }
  return [{ year, months: monthIndices }];
}

export const creditCardService = {
  // Get all credit cards
  getCreditCards: async (): Promise<ApiResponse<CreditCardDetailApiResponse[]>> => {
    return api.get<CreditCardDetailApiResponse[]>('/cards');
  },

  // Create new credit card (camelCase payload)
  createCreditCard: async (data: {
    issuingBank: string;
    cardHolder: string;
    cardNumber: string;
    expiry_date: string;
    cvv?: string | null;
    amountLimit?: number | null;
  }): Promise<ApiResponse<CreditCardDetailApiResponse>> => {
    return api.post<CreditCardDetailApiResponse>('/cards', data);
  },

  // Update credit card (camelCase payload)
  updateCreditCard: async (
    id: string | number,
    data: {
      issuingBank?: string;
      cardHolder?: string;
      cardNumber?: string;
      expiry_date?: string;
      cvv?: string | null;
      amountLimit?: number | null;
    }
  ): Promise<ApiResponse<CreditCardDetailApiResponse>> => {
    return api.put<CreditCardDetailApiResponse>(`/cards/${id}`, data);
  },

  // Delete/Deactivate credit card
  deleteCreditCard: async (id: string | number): Promise<ApiResponse<void>> => {
    console.log('[creditCardService] Deleting/deactivating card with ID:', id);
    return api.delete<void>(`/cards/${id}`);
  },

  // Activate credit card
  activateCreditCard: async (id: string | number): Promise<ApiResponse<CreditCardDetailApiResponse>> => {
    console.log('[creditCardService] Activating card with ID:', id);
    return api.patch<CreditCardDetailApiResponse>(`/cards/${id}/activate`, {});
  },

  // Get credit card statements via /statements?year=YYYY&months=1,2,3
  // - No params / empty months: previous + current calendar month (e.g. ?year=2026&months=5,6)
  // - month & year: single month (same query format)
  // - months & year: explicit month list (0–11 indices)
  getCreditCardStatements: async (options?: {
    month?: number; // 0-11 (0 = January) - single month
    months?: number[]; // Array of month indices (0-11) - multiple months
    year?: number;
  }): Promise<CreditCardStatementsListResult> => {
    const defaults = getDefaultStatementPeriod();
    const year = options?.year ?? defaults.year;
    let monthIndices: number[];

    if (options?.months && options.months.length > 0) {
      monthIndices = options.months;
    } else if (options?.month !== undefined) {
      monthIndices = [options.month];
    } else {
      monthIndices = defaults.months;
    }

    const yearGroups = groupStatementMonthIndicesByYear(year, monthIndices);

    const fetchQuery = async (
      groupYear: number,
      indices: number[]
    ): Promise<CreditCardStatementsListResult> => {
      const monthNumbers = indices.map((m) => m + 1);
      const url = `/statements?year=${expandCenturyYear(groupYear)}&months=${monthNumbers.join(',')}`;
      const response = await api.get<CreditCardStatementApiResponse[]>(url);

      if (response.success && response.data != null) {
        const parsed = parseCreditCardStatementsApiData(response.data, groupYear, indices);
        return { ...response, data: parsed.statements, groupedByMonth: parsed.groupedByMonth };
      }

      return response as unknown as CreditCardStatementsListResult;
    };

    if (yearGroups.length === 1) {
      return fetchQuery(yearGroups[0].year, yearGroups[0].months);
    }

    const responses = await Promise.all(
      yearGroups.map((g) => fetchQuery(g.year, g.months))
    );
    const allData: CreditCardStatement[] = [];
    const groupedByMonth: CreditCardStatementsGrouped = {};
    let success = true;
    let message: string | undefined;

    for (const response of responses) {
      if (!response.success) {
        success = false;
        message = response.message;
      }
      if (response.data) {
        allData.push(...response.data);
      }
      if (response.groupedByMonth) {
        Object.assign(groupedByMonth, response.groupedByMonth);
      }
    }

    return { success, data: allData, message, groupedByMonth };
  },

  /** PATCH numeric fields only (total_due, paid_amount, epp_balance). Does not upload PDFs. */
  updateCreditCardStatement: async (
    id: string | number,
    data: {
      totalPaymentDue?: number;
      paid?: number;
      epp?: number;
    },
    month?: string
  ): Promise<ApiResponse<CreditCardStatement>> => {
    let url = `/statements/${id}`;
    if (month) {
      url += `?month=${encodeURIComponent(month)}`;
    }

    const payload: Record<string, number> = {};
    if (data.totalPaymentDue !== undefined) payload.total_due = data.totalPaymentDue;
    if (data.paid !== undefined) payload.paid_amount = data.paid;
    if (data.epp !== undefined) payload.epp_balance = data.epp;

    const response = await api.patch<CreditCardStatementApiResponse>(url, payload);

    if (response.success && response.data) {
      const statementData = (response.data as any).data ?? response.data;
      assertPatchBodyIsStatementRow(statementData);
      const mappedStatement = mapCreditCardStatementFromApi(statementData);

      return {
        ...response,
        data: mappedStatement,
      };
    }

    return response as unknown as ApiResponse<CreditCardStatement>;
  },

  /**
   * Replace statement PDF via POST /statements/:id/attachment (multipart `attachment`).
   * Replaces Cloudinary / legacy file per backend; optional ?month=YYYY-MM when :id is card id.
   */
  uploadCreditCardStatementPdf: async (
    id: string | number,
    file: File,
    month?: string
  ): Promise<ApiResponse<CreditCardStatement>> => {
    let url = `/statements/${id}/attachment`;
    if (month) {
      url += `?month=${encodeURIComponent(month)}`;
    }
    const form = new FormData();
    form.append('attachment', file, file.name);
    const response = await api.post<CreditCardStatementApiResponse>(url, form);

    if (response.success && response.data) {
      const statementData = (response.data as any).data || response.data;
      const mappedStatement = mapCreditCardStatementFromApi(statementData);

      return {
        ...response,
        data: mappedStatement,
      };
    }

    return response as unknown as ApiResponse<CreditCardStatement>;
  },

  /**
   * Remove statement PDF: DELETE /statements/:id/attachment?month=YYYY-MM
   * (Backend must expose this route; clears DB attachment fields and Cloudinary/disk per server.)
   */
  deleteCreditCardStatementAttachment: async (
    id: string | number,
    month?: string
  ): Promise<ApiResponse<CreditCardStatement | null>> => {
    let url = `/statements/${id}/attachment`;
    if (month) {
      url += `?month=${encodeURIComponent(month)}`;
    }
    const response = await api.delete<
      CreditCardStatementApiResponse | { data?: CreditCardStatementApiResponse } | null
    >(url);

    if (!response.success) {
      return response as ApiResponse<CreditCardStatement | null>;
    }

    const body = response.data as unknown;
    if (
      body == null ||
      body === '' ||
      (typeof body === 'object' &&
        body !== null &&
        !Array.isArray(body) &&
        Object.keys(body as object).length === 0)
    ) {
      return { ...response, data: null };
    }

    const raw = body as Record<string, unknown>;
    const statementRaw =
      raw && typeof raw === 'object' && 'data' in raw && raw.data != null
        ? (raw.data as CreditCardStatementApiResponse)
        : (body as CreditCardStatementApiResponse);

    if (
      statementRaw &&
      typeof statementRaw === 'object' &&
      ('id' in statementRaw ||
        'issuing_bank' in statementRaw ||
        'card_holder' in (statementRaw as object))
    ) {
      const mapped = mapCreditCardStatementFromApi(statementRaw);
      return { ...response, data: mapped };
    }

    return { ...response, data: null };
  },

  // Credit Card Payments API
  getPaidAgainstOptions: async (): Promise<ApiResponse<PaidAgainstOption[]>> => {
    const response = await api.get<PaidAgainstOptionApiResponse[]>(
      '/purchase-bills/paid-against-options'
    );

    if (response.success && Array.isArray(response.data)) {
      return {
        ...response,
        data: response.data.map((item) => ({
          value: String(item.value ?? ''),
          label: String(item.label ?? ''),
          billNumber: item.billNumber ?? undefined,
          invoiceNumber: item.invoiceNumber ?? undefined,
          vendorName: item.vendorName ?? undefined,
          billDate: item.billDate ?? undefined,
          paymentStatus: item.paymentStatus ?? undefined,
        })),
      };
    }

    return response as ApiResponse<PaidAgainstOption[]>;
  },

  // API Response interface for Credit Card Payments (snake_case from backend)
  getCreditCardPayments: async (options?: {
    year?: number;
    /** Month indices 0–11. Omit (or pass full year) to fetch all months for the year — no `months` query param. */
    months?: number[];
  }): Promise<ApiResponse<any[]>> => {
    let url = '/credit-card-payments';
    
    // Build query parameters if provided
    const params: string[] = [];
    if (options?.year !== undefined) {
      params.push(`year=${expandCenturyYear(options.year)}`);
    }
    if (options?.months && options.months.length > 0) {
      const monthSet = new Set(options.months);
      const isAllMonths =
        monthSet.size === 12 && [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((m) => monthSet.has(m));
      if (!isAllMonths) {
        // Convert month indices (0-11) to month numbers (1-12) for API
        const monthNumbers = [...monthSet].sort((a, b) => a - b).map((m) => m + 1);
        params.push(`months=${monthNumbers.join(',')}`);
      }
    }
    
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    
    const response = await api.get<any[]>(url);
    
    if (response.success && response.data) {
      // Map snake_case API response to camelCase
      const mappedData = response.data.map((item: any) => ({
        id: String(item.id || ''),
        createdAt: item.created_at || item.createdAt || '',
        paymentDate: item.payment_date || '',
        cardHolder: item.card_holder || '',
        cardNo: item.card_no || item.card_number || '',
        issuingBank: item.issuing_bank || '',
        amount: item.amount !== null && item.amount !== undefined ? Number(item.amount) : 0,
        paidAgainst: item.paid_against || item.paidAgainst || '',
        remarks: item.remarks || '',
      }));
      
      return {
        ...response,
        data: mappedData,
      };
    }
    
    return response;
  },

  // Create credit card payment
  createCreditCardPayment: async (data: {
    paymentDate: string; // Can be "2026-01-15", "15/01/2026", or "15-Jan-2026"
    cardNo?: string; // Optional
    cardHolder?: string; // Optional if credit_card_id provided
    creditCardId?: string | number; // Optional - if provided, card_holder is optional
    amount: number;
    paidAgainst?: string;
    remarks?: string;
  }): Promise<ApiResponse<any>> => {
    // Convert to API format (snake_case)
    const payload: any = {
      payment_date: data.paymentDate,
      amount: data.amount,
    };
    
    if (data.cardNo !== undefined) {
      payload.card_no = data.cardNo;
    }
    
    if (data.cardHolder !== undefined) {
      payload.card_holder = data.cardHolder;
    }
    
    if (data.creditCardId !== undefined) {
      payload.credit_card_id = data.creditCardId;
    }
    
    if (data.remarks !== undefined) {
      payload.remarks = data.remarks;
    }

    if (data.paidAgainst !== undefined) {
      payload.paid_against = data.paidAgainst;
    }
    
    return api.post<any>('/credit-card-payments', payload);
  },

  // Update credit card payment
  updateCreditCardPayment: async (
    id: string | number,
    data: {
      paymentDate?: string; // Can be "2026-01-15", "15/01/2026", or "15-Jan-2026"
      cardNo?: string;
      cardHolder?: string;
      creditCardId?: string | number;
      amount?: number;
      paidAgainst?: string;
      remarks?: string;
    }
  ): Promise<ApiResponse<any>> => {
    // Convert to API format (snake_case)
    const payload: any = {};
    
    if (data.paymentDate !== undefined) {
      payload.payment_date = data.paymentDate;
    }
    
    if (data.amount !== undefined) {
      payload.amount = data.amount;
    }
    
    if (data.cardNo !== undefined) {
      payload.card_no = data.cardNo;
    }
    
    if (data.cardHolder !== undefined) {
      payload.card_holder = data.cardHolder;
    }
    
    if (data.creditCardId !== undefined) {
      payload.credit_card_id = data.creditCardId;
    }
    
    if (data.remarks !== undefined) {
      payload.remarks = data.remarks;
    }

    if (data.paidAgainst !== undefined) {
      payload.paid_against = data.paidAgainst;
    }
    
    return api.patch<any>(`/credit-card-payments/${id}`, payload);
  },

  // Delete credit card payment
  deleteCreditCardPayment: async (id: string | number): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/credit-card-payments/${id}`);
  },
};
