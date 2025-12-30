import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface PayablesCategory {
  id: string | number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export const payablesService = {
  // Get all payables categories
  getPayables: async (): Promise<ApiResponse<PayablesCategory[]>> => {
    return api.get<PayablesCategory[]>('/payables');
  },

  // Create new payables category
  createPayable: async (data: { name: string }): Promise<ApiResponse<PayablesCategory>> => {
    return api.post<PayablesCategory>('/payables', data);
  },

  // Update payables category
  updatePayable: async (id: string, data: { name: string }): Promise<ApiResponse<PayablesCategory>> => {
    return api.put<PayablesCategory>(`/payables/${id}`, data);
  },

  // Delete payables category
  deletePayable: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/payables/${id}`);
  },
};

