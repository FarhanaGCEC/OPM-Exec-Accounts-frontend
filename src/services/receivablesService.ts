import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface ReceivablesCategory {
  id: string | number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface ReceivablesBulkResult {
  inserted?: number;
  skippedDuplicates?: string[];
  message?: string;
  success?: boolean;
}

export const receivablesService = {
  // Get all receivables categories
  getReceivables: async (): Promise<ApiResponse<ReceivablesCategory[]>> => {
    return api.get<ReceivablesCategory[]>('/receivables');
  },

  // Create new receivables category
  createReceivable: async (data: { name: string }): Promise<ApiResponse<ReceivablesCategory>> => {
    return api.post<ReceivablesCategory>('/receivables', data);
  },

  // Update receivables category
  updateReceivable: async (id: string, data: { name: string }): Promise<ApiResponse<ReceivablesCategory>> => {
    return api.put<ReceivablesCategory>(`/receivables/${id}`, data);
  },

  // Delete receivables category
  deleteReceivable: async (id: string): Promise<ApiResponse<void>> => {
    return api.delete<void>(`/receivables/${id}`);
  },

  bulkCreateReceivables: async (names: string[]): Promise<ApiResponse<ReceivablesBulkResult>> => {
    return api.post<ReceivablesBulkResult>('/receivables/bulk', { names });
  },

  bulkCreateReceivablesCsv: async (file: File): Promise<ApiResponse<ReceivablesBulkResult>> => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<ReceivablesBulkResult>('/receivables/bulk-csv', fd);
  },
};

