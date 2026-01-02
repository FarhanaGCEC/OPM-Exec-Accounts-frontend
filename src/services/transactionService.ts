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

// API Response interface (snake_case from backend)
export interface PaymentMatchingApiResponse {
  id: number;
  payment_date: string;
  invoice_number?: string | null;
  customer_name: string;
  payment_method: string;
  amount: string | number;
  created_by?: number;
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
}

// Internal interface (camelCase for frontend)
export interface PaymentMatching {
  id?: string | number;
  paymentDate: string;
  invoiceNumber?: string;
  customerName: string;
  paymentMethod: string;
  amount: string | number;
  createdBy?: number;
  createdByUsername?: string;
  createdAt?: string;
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

  // Payment Matching (Credit Card Payments)
  getPaymentMatchings: async (): Promise<ApiResponse<PaymentMatching[]>> => {
    const response = await api.get<PaymentMatchingApiResponse[]>('/credit-card-payments');
    if (response.success && response.data) {
      // Map snake_case API response to camelCase
      const mappedData: PaymentMatching[] = response.data.map((item) => ({
        id: String(item.id),
        paymentDate: item.payment_date,
        invoiceNumber: item.invoice_number || undefined,
        customerName: item.customer_name,
        paymentMethod: item.payment_method,
        amount: item.amount,
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

  createPaymentMatching: async (data: Omit<PaymentMatching, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt'>): Promise<ApiResponse<PaymentMatching>> => {
    // Send payload in camelCase format as API expects
    const apiData: any = {
      paymentDate: data.paymentDate, // Keep as dd/mm/yyyy format
      customerName: data.customerName,
      paymentMethod: data.paymentMethod,
      amount: typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount,
    };
    
    if (data.invoiceNumber) {
      apiData.invoiceNumber = data.invoiceNumber;
    }
    
    console.log('[transactionService] createPaymentMatching - API payload:', JSON.stringify(apiData, null, 2));
    
    const response = await api.post<PaymentMatchingApiResponse>('/credit-card-payments', apiData);
    if (response.success && response.data) {
      // Map response back to camelCase
      const mappedData: PaymentMatching = {
        id: String(response.data.id),
        paymentDate: response.data.payment_date,
        invoiceNumber: response.data.invoice_number || undefined,
        customerName: response.data.customer_name,
        paymentMethod: response.data.payment_method,
        amount: response.data.amount,
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

  updatePaymentMatching: async (id: string, data: Partial<Omit<PaymentMatching, 'id' | 'createdBy' | 'createdByUsername' | 'createdAt'>>): Promise<ApiResponse<PaymentMatching>> => {
    // Send payload in camelCase format as API expects
    const apiData: any = {};
    
    if (data.paymentDate) apiData.paymentDate = data.paymentDate;
    if (data.customerName !== undefined) apiData.customerName = data.customerName;
    if (data.paymentMethod) apiData.paymentMethod = data.paymentMethod;
    if (data.amount !== undefined) {
      apiData.amount = typeof data.amount === 'string' ? parseFloat(data.amount.replace(/,/g, '')) : data.amount;
    }
    if (data.invoiceNumber !== undefined) apiData.invoiceNumber = data.invoiceNumber;
    
    const response = await api.put<PaymentMatchingApiResponse>(`/credit-card-payments/${id}`, apiData);
    if (response.success && response.data) {
      // Map response back to camelCase
      const mappedData: PaymentMatching = {
        id: String(response.data.id),
        paymentDate: response.data.payment_date,
        invoiceNumber: response.data.invoice_number || undefined,
        customerName: response.data.customer_name,
        paymentMethod: response.data.payment_method,
        amount: response.data.amount,
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

  deletePaymentMatching: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/credit-card-payments/${id}`);
  },
};

