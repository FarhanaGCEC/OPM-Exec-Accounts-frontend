import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

// API Response interface for Credit Card Details (snake_case from backend)
export interface CreditCardDetailApiResponse {
  id: number;
  issuing_bank: string;
  card_holder: string;
  card_number: string;
  expiry?: string;
  expiry_date?: string;
  cvv: string | null;
  amount_limit: number | null;
  is_system?: boolean;
  is_default?: boolean;
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
  };
};

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
}

export const creditCardService = {
  // Get all credit cards
  getCreditCards: async (): Promise<ApiResponse<CreditCardDetailApiResponse[]>> => {
    return api.get<CreditCardDetailApiResponse[]>('/credit-cards');
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
    return api.post<CreditCardDetailApiResponse>('/credit-cards', data);
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
    return api.put<CreditCardDetailApiResponse>(`/credit-cards/${id}`, data);
  },

  // Delete/Deactivate credit card
  deleteCreditCard: async (id: string | number): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/credit-cards/${id}`);
  },

  // Get credit card statements
  // Options:
  // - No params: Returns current month/year statements
  // - month & year: Returns statements for specific month (format: /statements/YYYY-MM)
  // - year only: Returns all months for that year
  getCreditCardStatements: async (options?: {
    month?: number; // 0-11 (0 = January)
    year?: number;
  }): Promise<ApiResponse<CreditCardStatement[]>> => {
    let url = '/statements';
    
    // If both month and year are provided, use path format: /statements/YYYY-MM
    if (options?.year !== undefined && options?.month !== undefined) {
      // Format month as 2-digit string (1-12)
      const monthStr = String(options.month + 1).padStart(2, '0');
      const yearStr = String(options.year);
      url = `/statements/${yearStr}-${monthStr}`;
    } else if (options?.year !== undefined) {
      // If only year is provided, use query parameter
      url = `/statements?year=${options.year}`;
    }
    // If no params, use /statements (returns current month/year)
    
    const response = await api.get<CreditCardStatementApiResponse[]>(url);
    
    if (response.success && response.data) {
      // Map snake_case API response to camelCase
      const mappedData: CreditCardStatement[] = response.data.map((item: any) => {
        return {
          // Use card_id as the unique identifier since id might be null in API response
          id: item.card_id ? String(item.card_id) : (item.credit_card_id ? String(item.credit_card_id) : String(item.id || '')),
          issuingBank: item.issuing_bank || '',
          cardHolder: item.card_holder || '',
          card_number: item.card_no || item.card_number || '',
          statement_date: item.statement_date ?? null,
          due_date: item.due_date ?? null,
          due_month: item.due_month ?? null,
          totalPaymentDue: item.total_payment_due !== null && item.total_payment_due !== undefined ? Number(item.total_payment_due) : 0,
          paid: item.paid !== null && item.paid !== undefined ? Number(item.paid) : 0,
          epp: item.epp !== null && item.epp !== undefined ? Number(item.epp) : 0,
          amountPending: item.amount_pending !== null && item.amount_pending !== undefined ? Number(item.amount_pending) : 0,
        };
      });
      
      return {
        ...response,
        data: mappedData,
      };
    }
    
    return response as unknown as ApiResponse<CreditCardStatement[]>;
  },

  // Update credit card statement
  updateCreditCardStatement: async (
    id: string | number,
    data: {
      totalPaymentDue?: number;
      paid?: number;
      epp?: number;
    },
    month?: string // Format: YYYY-MM (e.g., "2026-01")
  ): Promise<ApiResponse<CreditCardStatement>> => {
    // Convert to API format
    const payload: any = {};
    if (data.totalPaymentDue !== undefined) payload.total_due = data.totalPaymentDue;
    if (data.paid !== undefined) payload.paid_amount = data.paid;
    if (data.epp !== undefined) payload.epp_balance = data.epp;
    
    // Build URL with month query parameter if provided
    let url = `/statements/${id}`;
    if (month) {
      url += `?month=${month}`;
    }
    
    const response = await api.patch<CreditCardStatementApiResponse>(url, payload);
    
    if (response.success && response.data) {
      const statementData = (response.data as any).data || response.data;
      
      const mappedStatement: CreditCardStatement = {
        id: statementData.card_id ? String(statementData.card_id) : (statementData.credit_card_id ? String(statementData.credit_card_id) : String(statementData.id || '')),
        issuingBank: statementData.issuing_bank || '',
        cardHolder: statementData.card_holder || '',
        card_number: statementData.card_no || statementData.card_number || '',
        statement_date: statementData.statement_date ?? null,
        due_date: statementData.due_date ?? null,
        due_month: statementData.due_month ?? null,
        totalPaymentDue: statementData.total_payment_due !== null && statementData.total_payment_due !== undefined ? Number(statementData.total_payment_due) : 0,
        paid: statementData.paid !== null && statementData.paid !== undefined ? Number(statementData.paid) : 0,
        epp: statementData.epp !== null && statementData.epp !== undefined ? Number(statementData.epp) : 0,
        amountPending: statementData.amount_pending !== null && statementData.amount_pending !== undefined ? Number(statementData.amount_pending) : 0,
      };
      
      return {
        ...response,
        data: mappedStatement,
      };
    }
    
    return response as unknown as ApiResponse<CreditCardStatement>;
  },

  // Credit Card Payments API
  // API Response interface for Credit Card Payments (snake_case from backend)
  getCreditCardPayments: async (options?: {
    year?: number;
    months?: number[]; // Array of month indices (0-11)
  }): Promise<ApiResponse<any[]>> => {
    let url = '/credit-card-payments';
    
    // Build query parameters if provided
    const params: string[] = [];
    if (options?.year !== undefined) {
      params.push(`year=${options.year}`);
    }
    if (options?.months && options.months.length > 0) {
      // Convert month indices (0-11) to month numbers (1-12) for API
      const monthNumbers = options.months.map(m => m + 1);
      params.push(`months=${monthNumbers.join(',')}`);
    }
    
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    
    const response = await api.get<any[]>(url);
    
    if (response.success && response.data) {
      // Map snake_case API response to camelCase
      const mappedData = response.data.map((item: any) => ({
        id: String(item.id || ''),
        paymentDate: item.payment_date || '',
        cardHolder: item.card_holder || '',
        cardNo: item.card_no || item.card_number || '',
        amount: item.amount !== null && item.amount !== undefined ? Number(item.amount) : 0,
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
    
    return api.patch<any>(`/credit-card-payments/${id}`, payload);
  },
};
