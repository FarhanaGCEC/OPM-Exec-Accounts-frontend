/**
 * Canonical sidebar keys (API / DB) aligned with app navigation.
 * Must stay in sync with backend `sidebarPermissions` / admin PUT payloads.
 */
export const SIDEBAR_MENU_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'daily_transactions', label: 'Daily Transactions Details' },
  { key: 'post_dated_cheques', label: 'Post-Dated Cheques' },
  { key: 'creditors_list', label: 'Creditors List' },
  { key: 'debtors_list', label: 'Debtors List' },
  { key: 'credit_cards', label: 'Credit Cards' },
  { key: 'customer_credit_card_payments', label: 'Customer Credit Card Payments' },
  { key: 'gbp_transactions', label: 'GBP Transactions' },
  { key: 'usd_transactions', label: 'USD Transactions' },
  { key: 'fk_emirates_nbd', label: 'FK EMIRATES NBD' },
  { key: 'user_accounts_management', label: 'User Accounts Management' },
  { key: 'approval_queue', label: 'Approval Queue' },
] as const;

export type SidebarPermissionKey = (typeof SIDEBAR_MENU_ITEMS)[number]['key'];

export type SidebarPermissionMap = Record<SidebarPermissionKey, boolean>;

export function emptySidebarPermissions(): SidebarPermissionMap {
  return Object.fromEntries(SIDEBAR_MENU_ITEMS.map(({ key }) => [key, false])) as SidebarPermissionMap;
}
