import api from '../lib/api';
import type { ApiResponse } from '../lib/api';
import { AUTH_STORAGE_KEYS } from '../lib/authPayload';
import {
  SIDEBAR_MENU_ITEMS,
  emptySidebarPermissions,
  type SidebarPermissionKey,
  type SidebarPermissionMap,
} from '../lib/sidebarMenuPermissions';

/** Roles exposed in admin UI; API may return other strings — we map unknown → user in forms. */
export const MANAGEABLE_USER_ROLES = ['user', 'viewer', 'accountant', 'admin'] as const;
export type ManageableUserRole = (typeof MANAGEABLE_USER_ROLES)[number];

export type AppUserRole = ManageableUserRole | string;

export function normalizeManageableRole(role: string | undefined | null): ManageableUserRole {
  const r = String(role ?? '')
    .toLowerCase()
    .trim();
  if (r === 'admin') return 'admin';
  if (r === 'accountant') return 'accountant';
  if (r === 'viewer' || r === 'vierer') return 'viewer';
  return 'user';
}

export interface AppUser {
  id: number;
  username: string;
  role: AppUserRole;
  name?: string;
  sidebarPermissions?: Record<string, boolean>;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role?: AppUserRole;
  sidebarPermissions?: Record<string, boolean>;
}

export interface UpdateUserPayload {
  role: ManageableUserRole;
  password?: string;
  sidebarPermissions?: Record<string, boolean>;
}

export type SidebarMenuItemDef = { key: string; label: string };

export interface UserSidebarPermissionsLoad {
  menuItems: SidebarMenuItemDef[];
  sidebarPermissions: SidebarPermissionMap;
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

function walkObjectGraph(node: unknown, visit: (o: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 8 || !node || typeof node !== 'object' || Array.isArray(node)) return;
  const o = node as Record<string, unknown>;
  visit(o);
  const inner = o.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    walkObjectGraph(inner, visit, depth + 1);
  }
}

function parseSidebarPermissionMap(raw: unknown): SidebarPermissionMap {
  const base = emptySidebarPermissions();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean' && k in base) {
      base[k as SidebarPermissionKey] = v;
    }
  }
  return base;
}

function parseMenuItems(raw: unknown): SidebarMenuItemDef[] | null {
  if (!Array.isArray(raw)) return null;
  const items: SidebarMenuItemDef[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const key = o.key ?? o.id;
    const label = o.label ?? o.name;
    if (typeof key === 'string' && typeof label === 'string') {
      items.push({ key, label });
    }
  }
  return items.length > 0 ? items : null;
}

function defaultMenuItems(): SidebarMenuItemDef[] {
  return SIDEBAR_MENU_ITEMS.map(({ key, label }) => ({ key, label }));
}

function parseSidebarPermissionsLoad(payload: unknown): UserSidebarPermissionsLoad {
  let menuItems: SidebarMenuItemDef[] | null = null;
  let permsRaw: unknown;
  walkObjectGraph(payload, (o) => {
    if (!menuItems) menuItems = parseMenuItems(o.menuItems ?? o.menu_items);
    if (permsRaw === undefined) {
      permsRaw = o.sidebarPermissions ?? o.sidebar_permissions ?? o.permissions;
    }
  });
  const sidebarPermissions = parseSidebarPermissionMap(permsRaw);
  return {
    menuItems: menuItems ?? defaultMenuItems(),
    sidebarPermissions,
  };
}

function parseUpdatedUser(payload: unknown): AppUser | null {
  let user: unknown;
  walkObjectGraph(payload, (o) => {
    if (user) return;
    if (o.user && typeof o.user === 'object') user = o.user;
  });
  if (!user || typeof user !== 'object') return null;
  const u = user as Record<string, unknown>;
  const id = u.id;
  if (id == null) return null;
  return {
    id: typeof id === 'number' ? id : parseInt(String(id), 10),
    username: String(u.username ?? ''),
    role: String(u.role ?? 'user'),
    name: typeof u.name === 'string' ? u.name : undefined,
    sidebarPermissions:
      u.sidebarPermissions && typeof u.sidebarPermissions === 'object'
        ? (u.sidebarPermissions as Record<string, boolean>)
        : undefined,
  };
}

function userUpdateErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Could not update user';
  const o = err as Record<string, unknown>;
  const status = o.status;
  const msg = typeof o.message === 'string' ? o.message : 'Could not update user';
  if (status === 404) return msg || 'User not found';
  if (status === 409) return msg || 'Username cannot be changed';
  if (status === 400) return msg;
  return msg;
}

export const userService = {
  /** GET /api/admin/users */
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

  /** GET /api/admin/users/:id/sidebar-permissions */
  getUserSidebarPermissions: async (userId: number): Promise<UserSidebarPermissionsLoad> => {
    const res = await api.get<unknown>(`/admin/users/${userId}/sidebar-permissions`);
    return parseSidebarPermissionsLoad(res.data);
  },

  /**
   * PUT /api/admin/users/:id
   * Body: { role, password?, sidebarPermissions? } — password omitted when blank; permissions only for role `user`.
   */
  updateUser: async (
    userId: number,
    payload: UpdateUserPayload
  ): Promise<{ user: AppUser | null; message: string }> => {
    const body: Record<string, unknown> = { role: payload.role };
    const pwd = payload.password?.trim();
    if (pwd) body.password = pwd;
    if (payload.role === 'user' && payload.sidebarPermissions) {
      body.sidebarPermissions = payload.sidebarPermissions;
    }
    try {
      const res = await api.put<unknown>(`/admin/users/${userId}`, body);
      const message =
        (typeof res.message === 'string' && res.message.trim()) ||
        extractSuccessMessageFromPut(res.data) ||
        'User updated successfully';
      return { user: parseUpdatedUser(res.data), message };
    } catch (err: unknown) {
      throw new Error(userUpdateErrorMessage(err));
    }
  },

  /** POST /api/admin/create-user */
  createUser: async (payload: CreateUserPayload): Promise<ApiResponse<unknown>> => {
    const body: Record<string, unknown> = {
      username: payload.username.trim(),
      password: payload.password,
      role: payload.role ?? 'user',
    };
    const role = String(payload.role ?? 'user').toLowerCase();
    if (role === 'user' && payload.sidebarPermissions) {
      body.sidebarPermissions = payload.sidebarPermissions;
    }
    return api.post<unknown>('/admin/create-user', body);
  },

  /** DELETE /api/admin/users/:id */
  deleteUser: async (userId: number): Promise<ApiResponse<unknown>> => {
    return api.delete<unknown>(`/admin/users/${userId}`);
  },
};

function extractSuccessMessageFromPut(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  let found: string | undefined;
  walkObjectGraph(body, (o) => {
    if (found) return;
    for (const key of ['message', 'msg']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) found = v.trim();
    }
  });
  return found;
}

/** Compare permission maps (only known sidebar keys). */
export function sidebarPermissionsEqual(
  a: SidebarPermissionMap,
  b: SidebarPermissionMap
): boolean {
  return SIDEBAR_MENU_ITEMS.every(({ key }) => a[key] === b[key]);
}
