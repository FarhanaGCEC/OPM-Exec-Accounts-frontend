import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut,
  ListOrdered,
  Home,
  CreditCard,
  FileText,
  CircleUser,
} from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const menuItems: MenuItem[] = [
  { id: 'overview', label: 'Dashboard', icon: Home, path: '/dashboard' },
  { id: 'bank', label: 'Daily Transactions', icon: CreditCard, path: '/bank' },
  { id: 'cheque', label: 'Post-Dated Cheque', icon: FileText, path: '/cheque' },
  {
    id: 'matching',
    label: 'Customer Credit Card Payments',
    icon: CreditCard,
    path: '/matching',
  },
  { id: 'category', label: 'Payables List', icon: ListOrdered, path: '/category' },
  {
    id: 'reciveables',
    label: 'Reciveables List',
    icon: ListOrdered,
    path: '/reciveables',
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [userName, setUserName] = useState<string>('Admin');

  // Get user name from localStorage
  useEffect(() => {
    const name = localStorage.getItem('userName') || 'Admin';
    setUserName(name);

    const handleStorageChange = () => {
      const updatedName = localStorage.getItem('userName') || 'Admin';
      setUserName(updatedName);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userName');
    localStorage.removeItem('rememberMe');
    navigate('/');
  };

  const isActive = (path: string) => location.pathname === path;

  const username = userName.toUpperCase();

  return (
    <aside className="w-64 bg-gray-900 flex-shrink-0 flex flex-col h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-gray-800">
        <img
          src="https://res.cloudinary.com/dstnwi5iq/image/upload/v1767004411/gcec-logo-removebg-preview_dtdfbt.png"
          alt="GCEC Cloud Logo"
          className="h-12"
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const active = isActive(item.path);

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors
                ${
                  active
                    ? 'bg-yellow-500 text-gray-900'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                }
              `}
            >
              <span
                className={`text-sm font-medium whitespace-nowrap flex-1 text-left ${
                  active ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CircleUser className="w-8 h-8 text-gray-400" />
            <span className="text-sm font-medium text-gray-400">
              {username}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
