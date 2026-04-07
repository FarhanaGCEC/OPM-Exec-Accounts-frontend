import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { showMyChangeRequestsInNav } from '../lib/authPayload';

export default function MyChangeRequestsRoute({ children }: { children: ReactNode }) {
  if (!showMyChangeRequestsInNav()) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
