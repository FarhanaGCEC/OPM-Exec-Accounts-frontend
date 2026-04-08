import api from '../lib/api';
import type { ApiResponse } from '../lib/api';
import { AUTH_STORAGE_KEYS } from '../lib/authPayload';

/** Roles exposed in admin UI; API may return other strings — we map unknown → user in forms. */
export const MANAGEABLE_USER_ROLES = ['user', 'accountant', 'admin'] as const;
export type ManageableUserRole = (typeof MANAGEABLE_USER_ROLES)[number];

export type AppUserRole = ManageableUserRole | string;

export function normalizeManageableRole(role: string | undefined | null): ManageableUserRole {
  const r = String(role ?? '')
    .toLowerCase()
    .trim();
  if (r === 'admin') return 'admin';
  if (r === 'accountant') return 'accountant';
  return 'user';
}

export interface AppUser {
  id: number;
  username: string;
  role: AppUserRole;
  name?: string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role?: AppUserRole;
  /**
   * When role is `user`, sent once on create (same shape as PUT .../sidebar-permissions).
   * Prefer `permissions`; use `sidebarPermissions` if you only have that shape — send one, not both.
   */
  permissions?: Record<string, boolean>;
  sidebarPermissions?: Record<string, boolean>;
}

function extractUsers(payload: unknown): AppUser[] {
  if (Array.isArray(payload)) {
    return payload as AppUser[];
  }
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (Array.isArray(o.users)) return o.users as AppUser[];
    if (Array.isArray(o.data)) return o.data as AppUser[];
    const inner = o.data;
    if (inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>).users)) {
      return (inner as { users: AppUser[] }).users;
    }
  }
  return [];
}

export const userService = {
  /** GET /api/admin/users (baseURL `/api` → `/admin/users`). Sends Bearer token when logged in. */
  listUsers: async (): Promise<AppUser[]> => {
    if (!localStorage.getItem(AUTH_STORAGE_KEYS.token)?.trim()) {
      throw new Error('No auth token — log in again. (The app sends Authorization: Bearer … only after login.)');
    }
    const res: ApiResponse<unknown> = await api.get<unknown>('/admin/users');
    if (!res.success || res.data === undefined || res.data === null) {
      return [];
    }
    const raw = res.data as Record<string, unknown>;
    if (typeof raw === 'object' && 'data' in raw && raw.data !== undefined) {
      return extractUsers((raw as { data: unknown }).data);
    }
    return extractUsers(res.data);
  },

  /**
   * POST /api/admin/create-user (baseURL `/api` → `/admin/create-user`).
   * For role `user`, optional `permissions` or `sidebarPermissions` is applied in the same request (only one field sent).
   */
  createUser: async (payload: CreateUserPayload): Promise<ApiResponse<unknown>> => {
    const body: Record<string, unknown> = {
      username: payload.username.trim(),
      password: payload.password,
      role: payload.role ?? 'user',
    };
    const role = String(payload.role ?? 'user').toLowerCase();
    if (role === 'user') {
      if (payload.permissions) {
        body.permissions = payload.permissions;
      } else if (payload.sidebarPermissions) {
        body.sidebarPermissions = payload.sidebarPermissions;
      }
    }
    return api.post<unknown>('/admin/create-user', body);
  },

  /** PUT /api/admin/update-role/:id — body { role: "admin" | "accountant" | "user" } */
  updateRole: async (userId: number, role: AppUserRole): Promise<ApiResponse<unknown>> => {
    return api.put<unknown>(`/admin/update-role/${userId}`, { role });
  },

  /** PUT /api/admin/update-password/:id — body { password } (min 6 chars) */
  updatePassword: async (userId: number, password: string): Promise<ApiResponse<unknown>> => {
    return api.put<unknown>(`/admin/update-password/${userId}`, {
      password: password.trim(),
    });
  },

  /** DELETE /api/admin/users/:id */
  deleteUser: async (userId: number): Promise<ApiResponse<unknown>> => {
    return api.delete<unknown>(`/admin/users/${userId}`);
  },
};
