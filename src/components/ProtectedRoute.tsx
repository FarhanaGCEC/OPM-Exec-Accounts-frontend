import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  // Check if user has an authentication token
  const token = localStorage.getItem('authToken');

  // If no token, redirect to login page
  if (!token) {
    return <Navigate to="/" replace />;
  }

  // If token exists, render the protected component
  return <>{children}</>;
}
