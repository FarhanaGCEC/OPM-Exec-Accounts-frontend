import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface BankTransaction {
  id: string;
  date: string;
  type: 'Debit' | 'Credit';
  description: string;
  details: string;
  amount: string;
  balance: string;
}

export interface PostDatedCheque {
  id: string;
  chequeDate: string;
  chequeNumber: string;
  customerName: string;
  amount: string;
  chequeType: string;
}

export interface PaymentMatching {
  id: string;
  paymentDate: string;
  invoiceNumber: string;
  customerName: string;
  paymentMethod: string;
  amount: string;
}

export const transactionService = {
  // Bank Transactions
  getBankTransactions: async (): Promise<ApiResponse<BankTransaction[]>> => {
    return api.get<BankTransaction[]>('/transactions/bank');
  },

  createBankTransaction: async (data: Omit<BankTransaction, 'id' | 'balance'>): Promise<ApiResponse<BankTransaction>> => {
    return api.post<BankTransaction>('/transactions/bank', data);
  },

  updateBankTransaction: async (id: string, data: Partial<BankTransaction>): Promise<ApiResponse<BankTransaction>> => {
    return api.put<BankTransaction>(`/transactions/bank/${id}`, data);
  },

  deleteBankTransaction: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/transactions/bank/${id}`);
  },

  // Post-Dated Cheques
  getPostDatedCheques: async (): Promise<ApiResponse<PostDatedCheque[]>> => {
    return api.get<PostDatedCheque[]>('/cheques');
  },

  createPostDatedCheque: async (data: Omit<PostDatedCheque, 'id'>): Promise<ApiResponse<PostDatedCheque>> => {
    return api.post<PostDatedCheque>('/cheques', data);
  },

  updatePostDatedCheque: async (id: string, data: Partial<PostDatedCheque>): Promise<ApiResponse<PostDatedCheque>> => {
    return api.put<PostDatedCheque>(`/cheques/${id}`, data);
  },

  deletePostDatedCheque: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/cheques/${id}`);
  },

  // Payment Matching
  getPaymentMatchings: async (): Promise<ApiResponse<PaymentMatching[]>> => {
    return api.get<PaymentMatching[]>('/payments');
  },

  createPaymentMatching: async (data: Omit<PaymentMatching, 'id'>): Promise<ApiResponse<PaymentMatching>> => {
    return api.post<PaymentMatching>('/payments', data);
  },

  updatePaymentMatching: async (id: string, data: Partial<PaymentMatching>): Promise<ApiResponse<PaymentMatching>> => {
    return api.put<PaymentMatching>(`/payments/${id}`, data);
  },

  deletePaymentMatching: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/payments/${id}`);
  },
};

