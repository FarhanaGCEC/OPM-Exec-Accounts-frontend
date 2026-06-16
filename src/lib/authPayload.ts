import type { SidebarPermissionKey } from './sidebarMenuPermissions';

/** localStorage keys — use these when reading the logged-in user or role. */
export const AUTH_STORAGE_KEYS = {
  token: 'authToken',
  userName: 'userName',
  userRole: 'userRole',
  /** JSON: { id?, username?, name?, role, sidebarPermissions? } */
  authUser: 'authUser',
} as const;

export type StoredAuthUser = {
  id?: number | string;
  username?: string;
  name?: string;
  role: string;
  /** Present for role `user`; from login / profile `user.sidebarPermissions`. */
  sidebarPermissions?: Record<string, boolean>;
  /** From login / profile — true only for admins who may create/edit/deactivate cards. */
  canManageCreditCards?: boolean;
};

function parseSidebarPermissions(raw: unknown): Record<string, boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Unwrap common API shapes: { token, user } or { data: { token, user } } */
export function extractLoginData(data: unknown): {
  token?: string;
  user?: {
    username?: string;
    name?: string;
    role?: string;
    id?: number | string;
    sidebarPermissions?: Record<string, boolean>;
    canManageCreditCards?: boolean;
  };
} {
  if (!data || typeof data !== 'object') return {};
  const root = data as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  const token =
    (typeof root.token === 'string' ? root.token : undefined) ??
    (nested && typeof nested.token === 'string' ? nested.token : undefined);
  const userRaw = root.user ?? nested?.user;
  if (!userRaw || typeof userRaw !== 'object' || Array.isArray(userRaw)) {
    return { token, user: undefined };
  }
  const u = userRaw as Record<string, unknown>;
  const sidebarPermissions = parseSidebarPermissions(u.sidebarPermissions);
  const canManageRaw = u.canManageCreditCards ?? u.can_manage_credit_cards;
  const user = {
    username: typeof u.username === 'string' ? u.username : undefined,
    name: typeof u.name === 'string' ? u.name : undefined,
    role: typeof u.role === 'string' ? u.role : undefined,
    id: (typeof u.id === 'number' || typeof u.id === 'string' ? u.id : undefined) as number | string | undefined,
    ...(sidebarPermissions ? { sidebarPermissions } : {}),
    ...(typeof canManageRaw === 'boolean' ? { canManageCreditCards: canManageRaw } : {}),
  };
  return { token, user };
}

export function roleFromJwt(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    let base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    const raw =
      payload.role ??
      payload.userRole ??
      payload.UserRole ??
      (Array.isArray(payload.roles) ? payload.roles[0] : undefined);
    if (typeof raw === 'string') return raw;
    return null;
  } catch {
    return null;
  }
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role?.toLowerCase().trim() === 'admin';
}

/**
 * True only when JWT / stored role is exactly `admin` (not `accountant`, not `user`).
 * Use for approval queue + admin change-request APIs — not the looser `isCurrentUserAdmin()` sidebar helper.
 */
export function isRoleAdmin(): boolean {
  return isAdminRole(syncUserRoleFromSession());
}

export function isAccountantRole(role: string | null | undefined): boolean {
  return role?.toLowerCase().trim() === 'accountant';
}

export function isViewerRole(role: string | null | undefined): boolean {
  const normalized = role?.toLowerCase().trim();
  return normalized === 'viewer' || normalized === 'vierer';
}

/** Viewer is read-only; all other roles can perform mutating actions in UI. */
export function canMutateRecords(): boolean {
  return !isViewerRole(syncUserRoleFromSession());
}

/**
 * POST /credit-card-payments is allowed for viewers (payment_date + amount required).
 * Edit/delete remain gated by {@link canMutateRecords}.
 */
export function canCreateCreditCardPayment(): boolean {
  const role = syncUserRoleFromSession();
  if (!role) return false;
  return canMutateRecords() || isViewerRole(role);
}

/**
 * Credit card master (bank, holder, number, expiry, limit) — admin only.
 * Uses `canManageCreditCards` from login/profile; falls back to JWT role `admin` until profile loads.
 */
export function canManageCreditCards(): boolean {
  if (isRoleAdmin()) return true;
  const stored = readStoredAuthUser();
  if (stored?.canManageCreditCards === true) return true;
  if (stored?.canManageCreditCards === false) return false;
  return false;
}

/** Map 403 ADMIN_ONLY (or equivalent message) to a short UI toast string. */
export function creditCardAdminOnlyMessage(err: unknown): string | null {
  const code =
    typeof (err as { code?: unknown })?.code === 'string'
      ? (err as { code: string }).code
      : undefined;
  if (code === 'ADMIN_ONLY') return 'Only admin can edit cards';
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  if (
    msg.includes('only administrators can create or edit credit cards') ||
    msg.includes('only admin') ||
    msg.includes('admin_only')
  ) {
    return 'Only admin can edit cards';
  }
  return null;
}

/** Viewers may open/view/download statements but must never upload or replace them. */
export function canUploadStatements(): boolean {
  return canMutateRecords();
}

/** Daily-ledger PDC approval PATCH is allowed for admin and accountant (matches backend). */
export function canApprovePdcDailyLedger(): boolean {
  const r = syncUserRoleFromSession();
  return isAdminRole(r) || isAccountantRole(r);
}

/**
 * Show "My change requests" only for standard users (approval flow).
 * Admin and accountant edit directly; hide this nav for them.
 */
export function showMyChangeRequestsInNav(): boolean {
  const role = syncUserRoleFromSession();
  if (isAdminRole(role)) return false;
  if (isAccountantRole(role)) return false;
  if (isViewerRole(role)) return false;
  if (isCurrentUserAdmin()) return false;
  return true;
}

/**
 * Admin, accountant, and standard `user`: save on ✓ via PATCH or upload.
 * Viewer is read-only ({@link canMutateRecords}).
 */
export function canSaveStatementsDirectly(): boolean {
  return canMutateRecords();
}

/**
 * Standard `user` role — removing a statement PDF goes through POST /user/change-requests.
 * Admin and accountant delete directly.
 */
export function usesStatementDeleteApprovalFlow(): boolean {
  if (!canMutateRecords()) return false;
  if (isRoleAdmin() || isCurrentUserAdmin()) return false;
  return !isAccountantRole(syncUserRoleFromSession());
}

/** @deprecated Prefer {@link usesStatementDeleteApprovalFlow} for card-statement deletes. */
export function usesChangeRequestApprovalFlow(): boolean {
  return usesStatementDeleteApprovalFlow();
}

/**
 * Whether a canonical sidebar key is allowed for the current session.
 * Admin / accountant: always true. Role `user`: from `authUser.sidebarPermissions` in localStorage (login).
 */
export function hasSidebarPermission(key: SidebarPermissionKey): boolean {
  const role = syncUserRoleFromSession();
  if (isAdminRole(role) || isAccountantRole(role)) return true;
  if (isViewerRole(role)) return true;
  const perms = readStoredAuthUser()?.sidebarPermissions;
  if (!perms) return false;
  return perms[key] === true;
}

/** After login: token, display name, `userRole`, full `authUser` JSON, and `sidebarPermissions` for role `user`. */
export function persistLoginSession(args: {
  token: string;
  user?: {
    id?: number | string;
    username?: string;
    name?: string;
    role?: string;
    sidebarPermissions?: Record<string, boolean>;
    canManageCreditCards?: boolean;
  };
  /** Used when API omits username on `user` */
  formUsername?: string;
}): StoredAuthUser {
  const { token, user, formUsername } = args;
  const role = user?.role ?? roleFromJwt(token) ?? 'user';

  localStorage.setItem(AUTH_STORAGE_KEYS.token, token);

  const displayName = user?.name ?? user?.username ?? formUsername ?? '';
  if (displayName) {
    localStorage.setItem(AUTH_STORAGE_KEYS.userName, displayName);
  }

  localStorage.setItem(AUTH_STORAGE_KEYS.userRole, role);

  const roleLower = role.toLowerCase().trim();
  const snapshot: StoredAuthUser = {
    id: user?.id,
    username: user?.username ?? formUsername,
    name: user?.name,
    role,
  };
  if (roleLower === 'user' && user?.sidebarPermissions && typeof user.sidebarPermissions === 'object') {
    snapshot.sidebarPermissions = user.sidebarPermissions;
  }
  if (typeof user?.canManageCreditCards === 'boolean') {
    snapshot.canManageCreditCards = user.canManageCreditCards;
  }

  localStorage.setItem(AUTH_STORAGE_KEYS.authUser, JSON.stringify(snapshot));

  return snapshot;
}

export function readStoredAuthUser(): StoredAuthUser | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEYS.authUser);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredAuthUser;
    if (parsed && typeof parsed.role === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Picks role from JWT, stored role, or auth snapshot. If the JWT says admin but
 * localStorage still has "user" from an old login, upgrades to admin.
 */
export function syncUserRoleFromSession(): string | null {
  const t = localStorage.getItem(AUTH_STORAGE_KEYS.token);
  const jwtRole = t ? roleFromJwt(t) : null;
  const stored = localStorage.getItem(AUTH_STORAGE_KEYS.userRole);
  const snapshotRole = readStoredAuthUser()?.role ?? null;

  let role: string | null = null;
  if (jwtRole && isAdminRole(jwtRole)) {
    role = jwtRole;
  } else if (stored) {
    role = stored;
  } else if (snapshotRole) {
    role = snapshotRole;
  } else {
    role = jwtRole;
  }

  if (role) {
    localStorage.setItem(AUTH_STORAGE_KEYS.userRole, role);
  }
  return role;
}

/** Sidebar / route guard: role, snapshot, JWT, or bootstrap "admin" username. */
export function isCurrentUserAdmin(): boolean {
  if (isAdminRole(syncUserRoleFromSession())) return true;
  const u = readStoredAuthUser();
  if (u?.username?.toLowerCase() === 'admin') return true;
  const label = localStorage.getItem(AUTH_STORAGE_KEYS.userName);
  if (label?.toLowerCase() === 'admin') return true;
  return false;
}

export function clearAuthStorage(): void {
  localStorage.removeItem(AUTH_STORAGE_KEYS.token);
  localStorage.removeItem(AUTH_STORAGE_KEYS.userName);
  localStorage.removeItem(AUTH_STORAGE_KEYS.userRole);
  localStorage.removeItem(AUTH_STORAGE_KEYS.authUser);
}

/** Merge GET /user/profile into localStorage without clearing the token. */
export function applyProfileToSession(profile: StoredAuthUser): void {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.token);
  if (!token) return;

  const role = profile.role ?? syncUserRoleFromSession() ?? 'user';
  localStorage.setItem(AUTH_STORAGE_KEYS.userRole, role);

  const displayName = profile.name ?? profile.username ?? '';
  if (displayName) {
    localStorage.setItem(AUTH_STORAGE_KEYS.userName, displayName);
  }

  const existing = readStoredAuthUser();
  const snapshot: StoredAuthUser = {
    id: profile.id ?? existing?.id,
    username: profile.username ?? existing?.username,
    name: profile.name ?? existing?.name,
    role,
  };
  if (role.toLowerCase().trim() === 'user' && profile.sidebarPermissions) {
    snapshot.sidebarPermissions = profile.sidebarPermissions;
  }
  if (typeof profile.canManageCreditCards === 'boolean') {
    snapshot.canManageCreditCards = profile.canManageCreditCards;
  } else if (typeof existing?.canManageCreditCards === 'boolean') {
    snapshot.canManageCreditCards = existing.canManageCreditCards;
  }

  localStorage.setItem(AUTH_STORAGE_KEYS.authUser, JSON.stringify(snapshot));
}
