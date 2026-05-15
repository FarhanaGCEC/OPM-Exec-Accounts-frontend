import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { applyProfileToSession } from '../lib/authPayload';
import { authService } from '../services/authService';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const token = localStorage.getItem('authToken');
  const profileFetched = useRef(false);

  useEffect(() => {
    if (!token || profileFetched.current) return;
    profileFetched.current = true;
    void authService.getProfile().then((profile) => {
      if (profile) applyProfileToSession(profile);
    });
  }, [token]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
