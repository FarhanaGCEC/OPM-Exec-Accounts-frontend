import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isCurrentUserAdmin } from '../lib/authPayload';

export default function AdminRoute({ children }: { children: ReactNode }) {
  if (!isCurrentUserAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
