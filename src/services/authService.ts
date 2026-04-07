import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthUser {
  id: number | string;
  username: string;
  name?: string;
  role?: string;
}

export interface AuthResponse {
  message?: string;
  token: string;
  user: AuthUser;
}

export const authService = {
  /** POST /api/auth/login */
  login: async (credentials: LoginCredentials): Promise<ApiResponse<AuthResponse>> => {
    return api.post<AuthResponse>('/auth/login', credentials);
  },

  // Logout
  logout: async (): Promise<ApiResponse<void>> => {
    return api.post('/auth/logout');
  },

  // Get current user
  getCurrentUser: async (): Promise<ApiResponse<AuthUser>> => {
    return api.get<AuthUser>('/auth/me');
  },

  // Refresh token
  refreshToken: async (): Promise<ApiResponse<{ token: string }>> => {
    return api.post<{ token: string }>('/auth/refresh');
  },
};

