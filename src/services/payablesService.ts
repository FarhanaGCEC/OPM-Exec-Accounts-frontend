import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface PayablesCategory {
  id: string | number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

/** Response shape from POST /payables/bulk and /payables/bulk-csv (may be nested under `data`). */
export interface PayablesBulkResult {
  inserted?: number;
  skippedDuplicates?: string[];
  message?: string;
  success?: boolean;
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

  bulkCreatePayables: async (names: string[]): Promise<ApiResponse<PayablesBulkResult>> => {
    return api.post<PayablesBulkResult>('/payables/bulk', { names });
  },

  bulkCreatePayablesCsv: async (file: File): Promise<ApiResponse<PayablesBulkResult>> => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<PayablesBulkResult>('/payables/bulk-csv', fd);
  },
};

