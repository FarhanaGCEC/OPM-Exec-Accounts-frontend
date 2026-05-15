import api from '../lib/api';
import type { ApiResponse } from '../lib/api';
import { extractLoginData } from '../lib/authPayload';
import type { StoredAuthUser } from '../lib/authPayload';

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
  sidebarPermissions?: Record<string, boolean>;
}

export interface UserProfileResponse {
  user: AuthUser;
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

  /** GET /api/user/profile — role + sidebarPermissions for menu / approval UI */
  getProfile: async (): Promise<StoredAuthUser | null> => {
    const res = await api.get<unknown>('/user/profile');
    const { user } = extractLoginData(res.data);
    if (!user?.role) return null;
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      ...(user.sidebarPermissions ? { sidebarPermissions: user.sidebarPermissions } : {}),
    };
  },

  // Refresh token
  refreshToken: async (): Promise<ApiResponse<{ token: string }>> => {
    return api.post<{ token: string }>('/auth/refresh');
  },
};

