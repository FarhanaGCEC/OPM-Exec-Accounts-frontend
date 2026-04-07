import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isRoleAdmin } from '../lib/authPayload';

/**
 * Approval queue and admin change-requests API are for role `admin` only — not accountants.
 */
export default function ApprovalQueueAdminRoute({ children }: { children: ReactNode }) {
  if (!isRoleAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
