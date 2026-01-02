import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut,
  ListOrdered,
  Home,
  CreditCard,
  FileText,
  
} from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const menuItems: MenuItem[] = [
  { id: 'overview', label: 'Dashboard', icon: Home, path: '/dashboard' },
  { id: 'bank', label: ' DailyTransactions', icon: CreditCard, path: '/bank' },
  { id: 'cheque', label: 'Post-Dated Cheque', icon: FileText, path: '/cheque' },
  { id: 'matching', label: 'Customer Credit Cards Payments', icon: CreditCard, path: '/matching' },
  { id: 'category', label: 'Payables List', icon: ListOrdered , path: '/category' },
  { id: 'reciveables', label: 'Reciveables List', icon: ListOrdered, path: '/reciveables' },

];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [userName, setUserName] = useState<string>('Admin');

  // Get user name from localStorage
  useEffect(() => {
    const name = localStorage.getItem('userName') || 'Admin';
    setUserName(name);
    
    // Listen for storage changes (in case name is updated elsewhere)
    const handleStorageChange = () => {
      const updatedName = localStorage.getItem('userName') || 'Admin';
      setUserName(updatedName);
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleLogout = () => {
    // Clear auth data
    localStorage.removeItem('authToken');
    localStorage.removeItem('userName');
    localStorage.removeItem('rememberMe');
    navigate('/');
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  // Get first letter of name for avatar
  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <aside className="w-68 bg-gray-900 flex-shrink-0 flex flex-col">
      {/* Logo Section */}
      <div className="p-6 border-gray-800">
        <div className="flex items-center space-x-3 mb-2">
          <img
            src="https://res.cloudinary.com/dstnwi5iq/image/upload/v1767004411/gcec-logo-removebg-preview_dtdfbt.png"
            alt="GCEC Cloud Logo"
            className="h-16"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        <div className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${active
                    ? 'bg-yellow-500 text-gray-900'
                    : 'text-gray-400 hover:text-gray-300'
                  }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'text-gray-900' : 'text-gray-400'}`} />
                <span className={`text-sm font-medium ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* User & Logout Section */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center justify-between">
          {/* User Profile (Left) */}
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-semibold">
                {getInitial(userName)}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-400">
              {userName}
            </span>
          </div>

          {/* Logout Button (Right) */}
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

