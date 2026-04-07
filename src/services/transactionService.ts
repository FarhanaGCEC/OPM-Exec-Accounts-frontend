import api from '../lib/api';
import type { ApiResponse } from '../lib/api';
import type { BulkApiTransactionRow } from '../lib/bulkTransactionCsv';

export interface BankTransaction {
  id?: string | number;
  /** ISO date string from API; `null` for synthetic footer duplicate rows */
  date: string | null;
  category?: string; // Category name from API
  categoryId?: string | number; // For POST/PUT requests
  type?: 'Debit' | 'Credit'; // For POST/PUT requests
  paymentType: 'creditcard' | 'cheque' | 'cash' | 'banktransfer' | 'online';
  chequeNumber?: string;
  debit?: number | null; // From API response
  credit?: number | null; // From API response
  amount?: number | string; // For POST/PUT requests
  balance?: string | number;
  remarks?: string | null;
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
  /** Matured PDC synthetic ledger rows (GET /transactions) */
  pdcId?: number;
  pdcType?: string;
  syntheticFromPdc?: boolean;
  ledgerApprovalRequired?: boolean;
  ledgerApproved?: boolean;
  showLedgerApprovalCheckbox?: boolean;
  approvalPendingFooterDuplicate?: boolean;
}

// API Response interface (snake_case from backend)
export interface PostDatedChequeApiResponse {
  id: number;
  cheque_date: string;
  cheque_number: string;
  customer_name?: string | null;
  amount: string | number;
  cheque_type?: string; // "Payment Cheque" or "Security Cheque"
  pdc_type?: 'GCEC PDC' | 'Customer PDC' | 'Custom PDC';
  /** Some responses use camelCase only */
  pdcType?: 'GCEC PDC' | 'Customer PDC' | 'Custom PDC';
  description?: string | null; // For Custom PDC details
  attachment_name?: string | null;
  attachment_url?: string | null;
  /** New API shape: `{ name, url }` (e.g. Cloudinary). */
  attachment?: { name?: string | null; url?: string | null } | null;
  created_by?: number;
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
}

// Internal interface (camelCase for frontend)
export interface PostDatedCheque {
  id?: string | number;
  chequeDate: string;
  chequeNumber: string;
  customerName?: string;
  amount: string | number;
  chequeType?: string; // "Payment Cheque" or "Security Cheque" (legacy)
  pdcType: 'GCEC PDC' | 'Customer PDC' | 'Custom PDC';
  // Additional fields for Custom PDC
  description?: string; // Custom details
  customField1?: string;
  customField2?: string;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
}

const LEGAL_PDC_LABELS = ['GCEC PDC', 'Customer PDC', 'Custom PDC'] as const;

/** Map API `pdc_type` / `pdcType` (any casing or minor spelling) to canonical labels. */
export function normalizePdcTypeFromApi(raw: unknown): PostDatedCheque['pdcType'] {
  if (raw == null || raw === '') {
    return 'Customer PDC';
  }
  const str = String(raw).trim();
  const exact = LEGAL_PDC_LABELS.find((l) => l.toLowerCase() === str.toLowerCase());
  if (exact) return exact;

  const s = str.toLowerCase().replace(/\s+/g, ' ').trim();
  if (s === 'pdc customer' || (s.includes('customer') && s.includes('pdc'))) {
    return 'Customer PDC';
  }
  if (s.includes('gcec') && s.includes('pdc')) {
    return 'GCEC PDC';
  }
  if (s.includes('custom') && s.includes('pdc')) {
    return 'Custom PDC';
  }

  return 'Customer PDC';
}

function mapPostDatedChequeFromApi(item: PostDatedChequeApiResponse): PostDatedCheque {
  const anyItem = item as PostDatedChequeApiResponse & {
    attachmentName?: string | null;
    attachmentUrl?: string | null;
  };
  const row = item as unknown as Record<string, unknown>;
  const rawPdcType = row.pdc_type ?? row.pdcType;
  const nested = item.attachment;
  const nestedName =
    nested && typeof nested === 'object' ? nested.name ?? null : null;
  const nestedUrl =
    nested && typeof nested === 'object' ? nested.url ?? null : null;
  const chequeDateRaw =
    item.cheque_date ?? (row.chequeDate as string | undefined);
  const chequeNumberRaw =
    item.cheque_number ?? (row.chequeNumber as string | undefined);
  const customerNameRaw =
    item.customer_name ?? (row.customerName as string | null | undefined);
  return {
    id: String(item.id),
    chequeDate: String(chequeDateRaw ?? ''),
    chequeNumber: String(chequeNumberRaw ?? ''),
    customerName: customerNameRaw || undefined,
    amount: item.amount,
    chequeType: item.cheque_type ?? (row.chequeType as string | undefined),
    pdcType: normalizePdcTypeFromApi(rawPdcType),
    description: item.description || undefined,
    attachmentName:
      item.attachment_name ?? anyItem.attachmentName ?? nestedName ?? null,
    attachmentUrl:
      item.attachment_url ?? anyItem.attachmentUrl ?? nestedUrl ?? null,
    createdBy: item.created_by,
    createdByUsername: item.created_by_username,
    createdAt: item.created_at,
  };
}

/**
 * Multipart PDC expects chequeDate as YYYY-MM-DD (Postman). UI often uses dd/mm/yyyy.
 */
function formatChequeDateForPdcMultipart(input: string): string {
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmY) {
    const d = dmY[1].padStart(2, '0');
    const m = dmY[2].padStart(2, '0');
    const y = dmY[3];
    return `${y}-${m}-${d}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return s;
}

/** Multipart PDC: camelCase keys only — POST /pdc / PATCH /pdc/:id with attachment (see API docs). */
function appendPdcMultipartBodyFields(form: FormData, apiData: Record<string, unknown>) {
  if (apiData.chequeDate !== undefined) {
    form.append('chequeDate', formatChequeDateForPdcMultipart(String(apiData.chequeDate)));
  }
  if (apiData.chequeNumber !== undefined) {
    form.append('chequeNumber', String(apiData.chequeNumber));
  }
  if (apiData.customerName !== undefined) {
    form.append('customerName', String(apiData.customerName));
  }
  if (apiData.amount !== undefined) {
    form.append('amount', String(apiData.amount));
  }
  if (apiData.chequeType !== undefined) {
    form.append('chequeType', String(apiData.chequeType));
  }
  if (apiData.pdcType !== undefined) {
    form.append('pdcType', String(apiData.pdcType));
  }
  if (apiData.description !== undefined && apiData.description !== null && String(apiData.description) !== '') {
    form.append('description', String(apiData.description));
  }
}

// API Response interface (snake_case from backend) - Purchase Bills API
export interface PaymentMatchingApiResponse {
  id: number;
  bill_date: string;
  invoice_number?: string | null;
  vendor_name: string;
  payment_method: string;
  amount: string | number;
  bill_number?: string | null;
  description?: string | null;
  payment_status?: string;
  created_by?: number;
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
}

// Internal interface (camelCase for frontend)
export interface PaymentMatching {
  id?: string | number;
  paymentDate: string; // Maps to bill_date from API
  invoiceNumber?: string;
  customerName: string; // Maps to vendor_name from API
  paymentMethod: string;
  amount: string | number;
  billNumber?: string;
  description?: string;
  paymentStatus?: string;
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
}

// Analytics API Response
export interface AnalyticsDataset {
  label: string;
  data: number[];
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
}

export interface AnalyticsData {
  labels: string[];
  datasets: AnalyticsDataset[];
}

export interface AnalyticsSummary {
  totalDebit: number;
  totalCredit: number;
  totalTransactions: number;
}

export interface AnalyticsResponseData {
  period: string;
  data: AnalyticsData;
  summary: AnalyticsSummary;
}

// Account Summary
export interface PendingChecks {
  count: number;
  totalAmount: number;
}

export interface AccountSummary {
  totalBalance: number;
  totalCredit: number;
  totalDebit: number;
  pendingChecks: PendingChecks;
}

// Reminder API Response interface (snake_case from backend)
export interface ReminderApiResponse {
  id: number;
  cheque_date: string;
  cheque_number: string;
  customer_name: string;
  amount: string;
  cheque_type: string;
  pdc_type: string;
  description?: string | null;
  created_by?: number;
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
  days_remaining: number;
}

// Internal Reminder interface (camelCase for frontend)
export interface Reminder {
  id: string | number;
  chequeDate: string;
  chequeNumber: string;
  customerName: string;
  amount: string | number;
  chequeType: string;
  pdcType: string;
  description?: string;
  daysRemaining: number;
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
}

// Reminders API Response
export interface RemindersResponse {
  success: boolean;
  data: ReminderApiResponse[];
  count: number;
  days_lookahead: number;
}

export const transactionService = {
  // Bank Transactions
  getBankTransactions: async (): Promise<ApiResponse<BankTransaction[]>> => {
    return api.get<BankTransaction[]>('/transactions');
  },

  createBankTransaction: async (data: Omit<BankTransaction, 'id' | 'balance'>): Promise<ApiResponse<BankTransaction>> => {
    return api.post<BankTransaction>('/transactions', data);
  },

  /**
   * POST /transactions/bulk — max 500 rows per call; split larger sets in the UI.
   * 201 body typically includes `created` and `data` (created rows).
   */
  createBankTransactionsBulk: async (
    transactions: BulkApiTransactionRow[]
  ): Promise<
    ApiResponse<{
      created?: number;
      data?: BankTransaction[];
      success?: boolean;
      message?: string;
      errors?: Array<{ index: number; error?: string; message?: string }>;
    }>
  > => {
    return api.post('/transactions/bulk', { transactions });
  },

  updateBankTransaction: async (id: string, data: Partial<BankTransaction>): Promise<ApiResponse<BankTransaction>> => {
    return api.put<BankTransaction>(`/transactions/${id}`, data);
  },

  deleteBankTransaction: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/transactions/${id}`);
  },

  /**
   * Approve matured GCEC / Custom PDC for daily ledger (admin / accountant only).
   * PATCH /pdc/:id/daily-ledger-approved — body `{ approved: true }` or `{ dailyLedgerApproved: true }`.
   */
  patchPdcDailyLedgerApproved: async (
    pdcId: string | number,
    approved: boolean
  ): Promise<ApiResponse<unknown>> => {
    return api.patch<unknown>(`/pdc/${pdcId}/daily-ledger-approved`, { approved });
  },

  // Post-Dated Cheques (PDC)
  getPostDatedCheques: async (): Promise<ApiResponse<PostDatedCheque[]>> => {
    const response = await api.get<PostDatedChequeApiResponse[]>('/pdc');
    if (response.success && response.data) {
      const mappedData: PostDatedCheque[] = response.data.map((item) =>
        mapPostDatedChequeFromApi(item)
      );
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<PostDatedCheque[]>;
  },

  createPostDatedCheque: async (
    data: Omit<
      PostDatedCheque,
      | 'id'
      | 'createdBy'
      | 'createdByUsername'
      | 'createdAt'
      | 'attachmentName'
      | 'attachmentUrl'
    >,
    attachment?: File | null
  ): Promise<ApiResponse<PostDatedCheque>> => {
    const apiData: Record<string, unknown> = {
      chequeDate: data.chequeDate,
      chequeNumber: data.chequeNumber,
      pdcType: data.pdcType,
      amount: typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount,
      chequeType: data.chequeType || 'Payment Cheque',
      customerName: data.customerName || '',
    };

    if (data.description) {
      apiData.description = data.description;
    }

    const useMultipart = Boolean(attachment && attachment.size > 0);

    console.log(
      '[transactionService] createPostDatedCheque - API payload:',
      useMultipart ? { ...apiData, attachment: attachment?.name } : apiData
    );

    const response = useMultipart
      ? await (async () => {
          const form = new FormData();
          appendPdcMultipartBodyFields(form, apiData);
          form.append('attachment', attachment!, attachment!.name);
          return api.post<PostDatedChequeApiResponse>('/pdc', form);
        })()
      : await api.post<PostDatedChequeApiResponse>('/pdc', apiData);

    if (response.success && response.data) {
      const raw = response.data as unknown as { data?: PostDatedChequeApiResponse };
      const row = raw && typeof raw === 'object' && 'data' in raw && raw.data ? raw.data : (response.data as PostDatedChequeApiResponse);
      return {
        ...response,
        data: mapPostDatedChequeFromApi(row),
      };
    }
    return response as unknown as ApiResponse<PostDatedCheque>;
  },

  updatePostDatedCheque: async (
    id: string,
    data: Partial<
      Omit<PostDatedCheque, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt'>
    >,
    attachment?: File | null,
    /** With multipart uploads, merged into the form body so the server still receives every required field. */
    existing?: PostDatedCheque | null
  ): Promise<ApiResponse<PostDatedCheque>> => {
    const normalizeAmount = (v: unknown): number | undefined => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'number') return v;
      return parseFloat(String(v).replace(/,/g, ''));
    };

    const useMultipart = Boolean(attachment && attachment.size > 0);

    const apiData: Record<string, unknown> = {};
    const base = existing ?? undefined;

    if (useMultipart) {
      if (data.chequeDate !== undefined) apiData.chequeDate = data.chequeDate;
      else if (base?.chequeDate) apiData.chequeDate = base.chequeDate;

      if (data.chequeNumber !== undefined) apiData.chequeNumber = data.chequeNumber;
      else if (base?.chequeNumber) apiData.chequeNumber = base.chequeNumber;

      if (data.customerName !== undefined) apiData.customerName = data.customerName || '';
      else apiData.customerName = base?.customerName || '';

      if (data.amount !== undefined) apiData.amount = normalizeAmount(data.amount);
      else if (base?.amount !== undefined) apiData.amount = normalizeAmount(base.amount);

      if (data.pdcType !== undefined) apiData.pdcType = data.pdcType;
      else if (base?.pdcType) apiData.pdcType = base.pdcType;

      if (data.chequeType !== undefined) apiData.chequeType = data.chequeType || 'Payment Cheque';
      else apiData.chequeType = base?.chequeType || 'Payment Cheque';

      if (data.description !== undefined) apiData.description = data.description;
      else if (base?.description !== undefined) apiData.description = base.description;
    } else {
      if (data.chequeDate) apiData.chequeDate = data.chequeDate;
      if (data.chequeNumber) apiData.chequeNumber = data.chequeNumber;
      if (data.customerName !== undefined) {
        apiData.customerName = data.customerName || '';
      }
      if (data.amount !== undefined) {
        apiData.amount = typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount;
      }
      if (data.pdcType) apiData.pdcType = data.pdcType;
      if (data.chequeType !== undefined) {
        apiData.chequeType = data.chequeType || 'Payment Cheque';
      }
      if (data.description !== undefined) apiData.description = data.description;
    }

    const response = useMultipart
      ? await (async () => {
          const form = new FormData();
          appendPdcMultipartBodyFields(form, apiData);
          form.append('attachment', attachment!, attachment!.name);
          return api.patch<PostDatedChequeApiResponse>(`/pdc/${id}`, form);
        })()
      : await api.put<PostDatedChequeApiResponse>(`/pdc/${id}`, apiData);

    if (response.success && response.data) {
      const raw = response.data as unknown as { data?: PostDatedChequeApiResponse };
      const row = raw && typeof raw === 'object' && 'data' in raw && raw.data ? raw.data : (response.data as PostDatedChequeApiResponse);
      return {
        ...response,
        data: mapPostDatedChequeFromApi(row),
      };
    }
    return response as unknown as ApiResponse<PostDatedCheque>;
  },

  deletePostDatedCheque: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/pdc/${id}`);
  },

  // Payment Matching (Purchase Bills) - GET /purchase-bills
  getPaymentMatchings: async (): Promise<ApiResponse<PaymentMatching[]>> => {
    const response = await api.get<PaymentMatchingApiResponse[]>('/purchase-bills');
    if (response.success && response.data) {
      // Map snake_case API response to camelCase
      const mappedData: PaymentMatching[] = response.data.map((item) => ({
        id: String(item.id),
        paymentDate: item.bill_date, // bill_date -> paymentDate
        invoiceNumber: item.invoice_number || undefined,
        customerName: item.vendor_name, // vendor_name -> customerName (for display)
        paymentMethod: item.payment_method,
        amount: item.amount,
        billNumber: item.bill_number || undefined,
        description: item.description || undefined,
        paymentStatus: item.payment_status,
        createdBy: item.created_by,
        createdByUsername: item.created_by_username,
        createdAt: item.created_at,
      }));
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<PaymentMatching[]>;
  },

  // Payment Matching (Purchase Bills) - POST /purchase-bills
  createPaymentMatching: async (data: Omit<PaymentMatching, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt' | 'billNumber' | 'paymentStatus'>): Promise<ApiResponse<PaymentMatching>> => {
    // Convert to API format (snake_case) - API expects bill_date, vendor_name
    const apiData: any = {
      bill_date: data.paymentDate, // paymentDate -> bill_date (accepts dd/mm/yyyy, yyyy-mm-dd, or dd-mmm-yyyy)
      vendor_name: data.customerName, // customerName -> vendor_name
      payment_method: data.paymentMethod,
      amount: typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount,
    };
    
    if (data.invoiceNumber) {
      apiData.invoice_number = data.invoiceNumber;
    }
    
    if (data.description) {
      apiData.description = data.description;
    }
    
    console.log('[transactionService] createPaymentMatching - API payload:', JSON.stringify(apiData, null, 2));
    
    const response = await api.post<PaymentMatchingApiResponse>('/purchase-bills', apiData);
    if (response.success && response.data) {
      // Map response back to camelCase
      const mappedData: PaymentMatching = {
        id: String(response.data.id),
        paymentDate: response.data.bill_date,
        invoiceNumber: response.data.invoice_number || undefined,
        customerName: response.data.vendor_name,
        paymentMethod: response.data.payment_method,
        amount: response.data.amount,
        billNumber: response.data.bill_number || undefined,
        description: response.data.description || undefined,
        paymentStatus: response.data.payment_status,
        createdBy: response.data.created_by,
        createdByUsername: response.data.created_by_username,
        createdAt: response.data.created_at,
      };
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<PaymentMatching>;
  },

  // Payment Matching (Purchase Bills) - PATCH /purchase-bills/:id
  updatePaymentMatching: async (id: string, data: Partial<Omit<PaymentMatching, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt' | 'billNumber' | 'paymentStatus'>>): Promise<ApiResponse<PaymentMatching>> => {
    // Convert to API format (snake_case)
    const apiData: any = {};
    
    if (data.paymentDate !== undefined) apiData.bill_date = data.paymentDate;
    if (data.customerName !== undefined) apiData.vendor_name = data.customerName;
    if (data.paymentMethod !== undefined) apiData.payment_method = data.paymentMethod;
    if (data.amount !== undefined) {
      apiData.amount = typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount;
    }
    if (data.invoiceNumber !== undefined) apiData.invoice_number = data.invoiceNumber;
    if (data.description !== undefined) apiData.description = data.description;
    
    const response = await api.patch<PaymentMatchingApiResponse>(`/purchase-bills/${id}`, apiData);
    if (response.success && response.data) {
      // Map response back to camelCase
      const mappedData: PaymentMatching = {
        id: String(response.data.id),
        paymentDate: response.data.bill_date,
        invoiceNumber: response.data.invoice_number || undefined,
        customerName: response.data.vendor_name,
        paymentMethod: response.data.payment_method,
        amount: response.data.amount,
        billNumber: response.data.bill_number || undefined,
        description: response.data.description || undefined,
        paymentStatus: response.data.payment_status,
        createdBy: response.data.created_by,
        createdByUsername: response.data.created_by_username,
        createdAt: response.data.created_at,
      };
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<PaymentMatching>;
  },

  // Payment Matching (Purchase Bills) - DELETE /purchase-bills/:id
  deletePaymentMatching: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/purchase-bills/${id}`);
  },

  // Analytics
  getTransactionAnalytics: async (period: 'monthly' | 'yearly' = 'monthly'): Promise<ApiResponse<AnalyticsResponseData>> => {
    return api.get<AnalyticsResponseData>(`/analytics/transactions?period=${period}`);
  },

  // Account Summary
  getAccountSummary: async (): Promise<ApiResponse<AccountSummary>> => {
    return api.get<AccountSummary>('/account-summary');
  },

  // PDC Reminders
  getReminders: async (days: number = 30): Promise<ApiResponse<Reminder[]>> => {
    const response = await api.get<RemindersResponse>(`/pdc/reminders?days=${days}`);
    if (response.success && response.data) {
      // Handle the response structure - it could be nested or direct
      const remindersData = (response.data as any).data || response.data;
      const remindersArray = Array.isArray(remindersData) ? remindersData : [];
      
      // Map snake_case API response to camelCase
      const mappedData: Reminder[] = remindersArray.map((item: ReminderApiResponse) => ({
        id: String(item.id),
        chequeDate: item.cheque_date,
        chequeNumber: item.cheque_number,
        customerName: item.customer_name,
        amount: item.amount,
        chequeType: item.cheque_type,
        pdcType: item.pdc_type,
        description: item.description || undefined,
        daysRemaining: item.days_remaining,
        createdBy: item.created_by,
        createdByUsername: item.created_by_username,
        createdAt: item.created_at,
      }));
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<Reminder[]>;
  },

  // Get All Transactions
  getAllTransactions: async (params?: { startDate?: string; endDate?: string }): Promise<ApiResponse<any>> => {
    let url = '/transactions/all';
    const queryParams = new URLSearchParams();
    
    if (params?.startDate) {
      queryParams.append('startDate', params.startDate);
    }
    if (params?.endDate) {
      queryParams.append('endDate', params.endDate);
    }
    
    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }
    
    return api.get<any>(url);
  },

  // USD Transactions
  getUsdTransactions: async (): Promise<ApiResponse<BankTransaction[]>> => {
    return api.get<BankTransaction[]>('/usd-transactions');
  },

  createUsdTransaction: async (data: {
    date: string;
    description: string;
    details: string;
    debit?: string | number;
    credit?: string | number;
    bankCharges?: string | number;
  }): Promise<ApiResponse<BankTransaction>> => {
    const apiData: any = {
      date: data.date,
      description: data.description,
      details: data.details,
    };
    
    // Debit and credit should be sent as strings like "3.00" and "0.00"
    if (data.debit !== undefined) {
      const debitValue = typeof data.debit === 'string' ? parseFloat(data.debit.replace(/,/g, '')) : data.debit;
      apiData.debit = debitValue.toFixed(2); // Format as "3.00"
    }
    if (data.credit !== undefined) {
      const creditValue = typeof data.credit === 'string' ? parseFloat(data.credit.replace(/,/g, '')) : data.credit;
      apiData.credit = creditValue.toFixed(2); // Format as "0.00"
    }
    
    // Bank charges should be sent as number (not string)
    if (data.bankCharges !== undefined) {
      apiData.bank_charges = typeof data.bankCharges === 'string' ? parseFloat(data.bankCharges.replace(/,/g, '')) : data.bankCharges;
    }
    
    return api.post<BankTransaction>('/usd-transactions', apiData);
  },

  updateUsdTransaction: async (id: string, data: Partial<{
    date: string;
    description: string;
    details: string;
    debit?: string | number;
    credit?: string | number;
    bankCharges?: string | number;
  }>): Promise<ApiResponse<BankTransaction>> => {
    const apiData: any = {};
    
    if (data.date !== undefined) apiData.date = data.date;
    if (data.description !== undefined) apiData.description = data.description;
    if (data.details !== undefined) apiData.details = data.details;
    
    // Debit and credit should be sent as strings like "3.00" and "0.00"
    if (data.debit !== undefined) {
      const debitValue = typeof data.debit === 'string' ? parseFloat(data.debit.replace(/,/g, '')) : data.debit;
      apiData.debit = debitValue.toFixed(2); // Format as "3.00"
    }
    if (data.credit !== undefined) {
      const creditValue = typeof data.credit === 'string' ? parseFloat(data.credit.replace(/,/g, '')) : data.credit;
      apiData.credit = creditValue.toFixed(2); // Format as "0.00"
    }
    
    // Bank charges should be sent as number with key bank_charges
    if (data.bankCharges !== undefined) {
      apiData.bank_charges = typeof data.bankCharges === 'string' ? parseFloat(data.bankCharges.replace(/,/g, '')) : data.bankCharges;
    }
    
    return api.patch<BankTransaction>(`/usd-transactions/${id}`, apiData);
  },

  deleteUsdTransaction: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/usd-transactions/${id}`);
  },

  // GBP Transactions
  getGbpTransactions: async (): Promise<ApiResponse<BankTransaction[]>> => {
    return api.get<BankTransaction[]>('/gbp-transactions');
  },

  createGbpTransaction: async (data: {
    date: string;
    description: string;
    details: string;
    debit?: string | number;
    credit?: string | number;
    bankCharges?: string | number;
  }): Promise<ApiResponse<BankTransaction>> => {
    const apiData: any = {
      date: data.date,
      description: data.description,
      details: data.details,
    };
    
    // Debit and credit should be sent as strings like "3.00" and "0.00"
    if (data.debit !== undefined) {
      const debitValue = typeof data.debit === 'string' ? parseFloat(data.debit.replace(/,/g, '')) : data.debit;
      apiData.debit = debitValue.toFixed(2); // Format as "3.00"
    }
    if (data.credit !== undefined) {
      const creditValue = typeof data.credit === 'string' ? parseFloat(data.credit.replace(/,/g, '')) : data.credit;
      apiData.credit = creditValue.toFixed(2); // Format as "0.00"
    }
    
    // Bank charges should be sent as number with key bank_charges
    if (data.bankCharges !== undefined) {
      apiData.bank_charges = typeof data.bankCharges === 'string' ? parseFloat(data.bankCharges.replace(/,/g, '')) : data.bankCharges;
    }
    
    return api.post<BankTransaction>('/gbp-transactions', apiData);
  },

  updateGbpTransaction: async (id: string, data: Partial<{
    date: string;
    description: string;
    details: string;
    debit?: string | number;
    credit?: string | number;
    bankCharges?: string | number;
  }>): Promise<ApiResponse<BankTransaction>> => {
    const apiData: any = {};
    
    if (data.date !== undefined) apiData.date = data.date;
    if (data.description !== undefined) apiData.description = data.description;
    if (data.details !== undefined) apiData.details = data.details;
    
    // Debit and credit should be sent as strings like "3.00" and "0.00"
    if (data.debit !== undefined) {
      const debitValue = typeof data.debit === 'string' ? parseFloat(data.debit.replace(/,/g, '')) : data.debit;
      apiData.debit = debitValue.toFixed(2); // Format as "3.00"
    }
    if (data.credit !== undefined) {
      const creditValue = typeof data.credit === 'string' ? parseFloat(data.credit.replace(/,/g, '')) : data.credit;
      apiData.credit = creditValue.toFixed(2); // Format as "0.00"
    }
    
    // Bank charges should be sent as number with key bank_charges
    if (data.bankCharges !== undefined) {
      apiData.bank_charges = typeof data.bankCharges === 'string' ? parseFloat(data.bankCharges.replace(/,/g, '')) : data.bankCharges;
    }
    
    return api.patch<BankTransaction>(`/gbp-transactions/${id}`, apiData);
  },

  deleteGbpTransaction: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/gbp-transactions/${id}`);
  },

  // FK Emirates NBD Transactions
  getFkEmiratesTransactions: async (): Promise<ApiResponse<BankTransaction[]>> => {
    // Fetch all transactions - filtering by currency will be done on frontend
    return api.get<BankTransaction[]>('/fk-emirates');
  },

  createFkEmiratesTransaction: async (data: {
    date: string;
    description: string;
    details: string;
    debit?: string | number;
    credit?: string | number;
    bankCharges?: string | number;
    currency: 'AED' | 'USD' | 'GBP';
  }): Promise<ApiResponse<BankTransaction>> => {
    const apiData: any = {
      date: data.date,
      description: data.description,
      details: data.details,
      currency: data.currency,
    };
    
    // Debit and credit should be sent as strings like "3.00" and "0.00"
    if (data.debit !== undefined) {
      const debitValue = typeof data.debit === 'string' ? parseFloat(data.debit.replace(/,/g, '')) : data.debit;
      apiData.debit = debitValue.toFixed(2); // Format as "3.00"
    }
    if (data.credit !== undefined) {
      const creditValue = typeof data.credit === 'string' ? parseFloat(data.credit.replace(/,/g, '')) : data.credit;
      apiData.credit = creditValue.toFixed(2); // Format as "0.00"
    }
    
    // Bank charges should be sent as number with key bank_charges
    if (data.bankCharges !== undefined) {
      apiData.bank_charges = typeof data.bankCharges === 'string' ? parseFloat(data.bankCharges.replace(/,/g, '')) : data.bankCharges;
    }
    
    return api.post<BankTransaction>('/fk-emirates', apiData);
  },

  updateFkEmiratesTransaction: async (id: string, data: Partial<{
    date: string;
    description: string;
    details: string;
    debit?: string | number;
    credit?: string | number;
    bankCharges?: string | number;
    currency?: 'AED' | 'USD' | 'GBP';
  }>): Promise<ApiResponse<BankTransaction>> => {
    const apiData: any = {};
    
    if (data.date !== undefined) apiData.date = data.date;
    if (data.description !== undefined) apiData.description = data.description;
    if (data.details !== undefined) apiData.details = data.details;
    if (data.currency !== undefined) apiData.currency = data.currency;
    
    // Debit and credit should be sent as strings like "3.00" and "0.00"
    if (data.debit !== undefined) {
      const debitValue = typeof data.debit === 'string' ? parseFloat(data.debit.replace(/,/g, '')) : data.debit;
      apiData.debit = debitValue.toFixed(2); // Format as "3.00"
    }
    if (data.credit !== undefined) {
      const creditValue = typeof data.credit === 'string' ? parseFloat(data.credit.replace(/,/g, '')) : data.credit;
      apiData.credit = creditValue.toFixed(2); // Format as "0.00"
    }
    
    // Bank charges should be sent as number with key bank_charges
    if (data.bankCharges !== undefined) {
      apiData.bank_charges = typeof data.bankCharges === 'string' ? parseFloat(data.bankCharges.replace(/,/g, '')) : data.bankCharges;
    }
    
    return api.patch<BankTransaction>(`/fk-emirates/${id}`, apiData);
  },

  deleteFkEmiratesTransaction: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/fk-emirates/${id}`);
  },
};

