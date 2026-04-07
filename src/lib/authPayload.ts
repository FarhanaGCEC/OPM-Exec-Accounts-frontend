/** localStorage keys — use these when reading the logged-in user or role. */
export const AUTH_STORAGE_KEYS = {
  token: 'authToken',
  userName: 'userName',
  userRole: 'userRole',
  /** JSON: { id?, username?, name?, role } */
  authUser: 'authUser',
} as const;

export type StoredAuthUser = {
  id?: number | string;
  username?: string;
  name?: string;
  role: string;
};

/** Unwrap common API shapes: { token, user } or { data: { token, user } } */
export function extractLoginData(data: unknown): {
  token?: string;
  user?: { username?: string; name?: string; role?: string; id?: number | string };
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
  const user =
    userRaw && typeof userRaw === 'object' && !Array.isArray(userRaw)
      ? (userRaw as { username?: string; name?: string; role?: string; id?: number | string })
      : undefined;
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
  if (isCurrentUserAdmin()) return false;
  return true;
}

/** After login: token, display name, `userRole`, and full `authUser` JSON. */
export function persistLoginSession(args: {
  token: string;
  user?: { id?: number | string; username?: string; name?: string; role?: string };
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

  const snapshot: StoredAuthUser = {
    id: user?.id,
    username: user?.username ?? formUsername,
    name: user?.name,
    role,
  };
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
