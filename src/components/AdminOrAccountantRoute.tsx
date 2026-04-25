import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { canApprovePdcDailyLedger } from '../lib/authPayload';

export default function AdminOrAccountantRoute({ children }: { children: ReactNode }) {
  if (!canApprovePdcDailyLedger()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
