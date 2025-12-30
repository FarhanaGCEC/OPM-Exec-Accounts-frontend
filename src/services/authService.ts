import api from '../lib/api';
import type { ApiResponse } from '../lib/api';

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
    name: string;
  };
}

export const authService = {
  // Login
  login: async (credentials: LoginCredentials): Promise<ApiResponse<AuthResponse>> => {
    return api.post<AuthResponse>('/auth/login', credentials);
  },

  // Logout
  logout: async (): Promise<ApiResponse<void>> => {
    return api.post('/auth/logout');
  },

  // Get current user
  getCurrentUser: async (): Promise<ApiResponse<AuthResponse['user']>> => {
    return api.get<AuthResponse['user']>('/auth/me');
  },

  // Refresh token
  refreshToken: async (): Promise<ApiResponse<{ token: string }>> => {
    return api.post<{ token: string }>('/auth/refresh');
  },
};

