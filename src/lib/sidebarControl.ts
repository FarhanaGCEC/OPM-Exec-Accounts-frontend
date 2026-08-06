/** Close/open the app Layout sidebar from any page (see Layout.tsx listener). */
export function setAppSidebarOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('app-sidebar-open', { detail: { open } })
  );
}

export const APP_SIDEBAR_OPEN_EVENT = 'app-sidebar-open';
