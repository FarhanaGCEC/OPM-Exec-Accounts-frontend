import type { SidebarPermissionKey } from './sidebarMenuPermissions';
import {
  canApprovePdcDailyLedger,
  hasSidebarPermission,
  isCurrentUserAdmin,
  isRoleAdmin,
  showMyChangeRequestsInNav,
  syncUserRoleFromSession,
} from './authPayload';

/**
 * Post-login landing order must match `menuItems` in `Sidebar.tsx` so users land
 * on the first screen they are allowed to see (not hard-coded `/dashboard`).
 */
type LandingNavItem = {
  path?: string;
  /** Parent-only entries (e.g. Credit Cards) — first path is the default landing. */
  subPaths?: string[];
  sidebarKey?: SidebarPermissionKey;
  standardUserOnly?: boolean;
  adminOnly?: boolean;
  roleAdminOnly?: boolean;
  adminOrAccountantOnly?: boolean;
};

const POST_LOGIN_NAV_ORDER: LandingNavItem[] = [
  { path: '/dashboard', sidebarKey: 'dashboard' },
  { path: '/bank', sidebarKey: 'daily_transactions' },
  { path: '/gbp-transactions', sidebarKey: 'gbp_transactions' },
  { path: '/usd-transactions', sidebarKey: 'usd_transactions' },
  { path: '/matching', sidebarKey: 'customer_credit_card_payments' },
  { path: '/cheque', sidebarKey: 'post_dated_cheques' },
  { path: '/fks-transactions', sidebarKey: 'fk_emirates_nbd' },
  {
    sidebarKey: 'credit_cards',
    subPaths: [
      '/credit-card-statements',
      '/credit-card-statements/payments',
      '/credit-card-statements/details',
    ],
  },
  { path: '/reciveables', sidebarKey: 'creditors_list' },
  { path: '/category', sidebarKey: 'debtors_list' },
  { path: '/my-change-requests', standardUserOnly: true },
  { path: '/approval-queue', sidebarKey: 'approval_queue', roleAdminOnly: true },
  {
    path: '/monthly-bank-statements',
    sidebarKey: 'monthly_bank_statements',
  },
  { path: '/admin/users', sidebarKey: 'user_accounts_management', adminOnly: true },
];

function isLandingItemVisible(item: LandingNavItem): boolean {
  if (item.standardUserOnly && !showMyChangeRequestsInNav()) return false;
  if (item.roleAdminOnly && !isRoleAdmin()) return false;
  if (item.adminOrAccountantOnly && !canApprovePdcDailyLedger()) return false;
  if (item.adminOnly && !isCurrentUserAdmin()) return false;
  if (item.sidebarKey && !hasSidebarPermission(item.sidebarKey)) return false;
  return true;
}

function resolveLandingPath(item: LandingNavItem): string | null {
  if (item.path) return item.path;
  const first = item.subPaths?.[0];
  return first ?? null;
}

/** First sidebar-visible route in app nav order; falls back to `/dashboard`. */
export function getPostLoginRedirectPath(): string {
  syncUserRoleFromSession();
  for (const item of POST_LOGIN_NAV_ORDER) {
    if (!isLandingItemVisible(item)) continue;
    const path = resolveLandingPath(item);
    if (path) return path;
  }
  return '/dashboard';
}
