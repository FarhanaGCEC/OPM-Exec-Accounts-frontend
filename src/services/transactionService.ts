import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface BankTransaction {
  id?: string | number;
  date: string;
  category?: string; // Category name from API
  categoryId?: string | number; // For POST/PUT requests
  type?: 'Debit' | 'Credit'; // For POST/PUT requests
  paymentType: 'creditcard' | 'cheque' | 'cash' | 'banktransfer' | 'online';
  chequeNumber?: string;
  debit?: number | null; // From API response
  credit?: number | null; // From API response
  amount?: number | string; // For POST/PUT requests
  balance?: string | number;
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
}

// API Response interface (snake_case from backend)
export interface PostDatedChequeApiResponse {
  id: number;
  cheque_date: string;
  cheque_number: string;
  customer_name?: string | null;
  amount: string | number;
  cheque_type?: string; // "Payment Cheque" or "Security Cheque"
  pdc_type: 'GCEC PDC' | 'Customer PDC' | 'Custom PDC';
  description?: string | null; // For Custom PDC details
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
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
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

  updateBankTransaction: async (id: string, data: Partial<BankTransaction>): Promise<ApiResponse<BankTransaction>> => {
    return api.put<BankTransaction>(`/transactions/${id}`, data);
  },

  deleteBankTransaction: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/transactions/${id}`);
  },

  // Post-Dated Cheques (PDC)
  getPostDatedCheques: async (): Promise<ApiResponse<PostDatedCheque[]>> => {
    const response = await api.get<PostDatedChequeApiResponse[]>('/pdc');
    if (response.success && response.data) {
      // Map snake_case API response to camelCase
      const mappedData: PostDatedCheque[] = response.data.map((item) => ({
        id: String(item.id),
        chequeDate: item.cheque_date,
        chequeNumber: item.cheque_number,
        customerName: item.customer_name || undefined,
        amount: item.amount,
        chequeType: item.cheque_type,
        pdcType: item.pdc_type,
        description: item.description || undefined,
        createdBy: item.created_by,
        createdByUsername: item.created_by_username,
        createdAt: item.created_at,
      }));
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<PostDatedCheque[]>;
  },

  createPostDatedCheque: async (data: Omit<PostDatedCheque, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt'>): Promise<ApiResponse<PostDatedCheque>> => {
    // Send payload in camelCase format as API expects
    const apiData: any = {
      chequeDate: data.chequeDate, // Keep as dd/mm/yyyy format
      chequeNumber: data.chequeNumber,
      pdcType: data.pdcType,
      amount: typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount,
      chequeType: data.chequeType || 'Payment Cheque', // Always include, default if not provided
      customerName: data.customerName || '', // Always include, empty string if not provided
    };
    
    // Add description only if provided (for Custom PDC)
    if (data.description) {
      apiData.description = data.description;
    }
    
    console.log('[transactionService] createPostDatedCheque - API payload:', JSON.stringify(apiData, null, 2));
    
    const response = await api.post<PostDatedChequeApiResponse>('/pdc', apiData);
    if (response.success && response.data) {
      // Map response back to camelCase
      const mappedData: PostDatedCheque = {
        id: String(response.data.id),
        chequeDate: response.data.cheque_date,
        chequeNumber: response.data.cheque_number,
        customerName: response.data.customer_name || undefined,
        amount: response.data.amount,
        chequeType: response.data.cheque_type,
        pdcType: response.data.pdc_type,
        description: response.data.description || undefined,
        createdBy: response.data.created_by,
        createdByUsername: response.data.created_by_username,
        createdAt: response.data.created_at,
      };
      return {
        ...response,
        data: mappedData,
      };
    }
    return response as unknown as ApiResponse<PostDatedCheque>;
  },

  updatePostDatedCheque: async (id: string, data: Partial<Omit<PostDatedCheque, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt'>>): Promise<ApiResponse<PostDatedCheque>> => {
    // Send payload in camelCase format as API expects
    const apiData: any = {};
    
    if (data.chequeDate) apiData.chequeDate = data.chequeDate;
    if (data.chequeNumber) apiData.chequeNumber = data.chequeNumber;
    // Always include customerName (even if empty string)
    if (data.customerName !== undefined) {
      apiData.customerName = data.customerName || '';
    }
    if (data.amount !== undefined) {
      apiData.amount = typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount;
    }
    if (data.pdcType) apiData.pdcType = data.pdcType;
    // Always include chequeType
    if (data.chequeType !== undefined) {
      apiData.chequeType = data.chequeType || 'Payment Cheque';
    }
    if (data.description !== undefined) apiData.description = data.description;
    
    const response = await api.put<PostDatedChequeApiResponse>(`/pdc/${id}`, apiData);
    if (response.success && response.data) {
      // Map response back to camelCase
      const mappedData: PostDatedCheque = {
        id: String(response.data.id),
        chequeDate: response.data.cheque_date,
        chequeNumber: response.data.cheque_number,
        customerName: response.data.customer_name || undefined,
        amount: response.data.amount,
        chequeType: response.data.cheque_type,
        pdcType: response.data.pdc_type,
        description: response.data.description || undefined,
        createdBy: response.data.created_by,
        createdByUsername: response.data.created_by_username,
        createdAt: response.data.created_at,
      };
      return {
        ...response,
        data: mappedData,
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
  getReminders: async (days: number = 7): Promise<ApiResponse<Reminder[]>> => {
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

