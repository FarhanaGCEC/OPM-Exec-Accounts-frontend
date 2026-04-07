import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut,
  ListOrdered,
  Home,
  CreditCard,
  FileText,
  CircleUser,
  ChevronDown,
  ChevronRight,
  Users,
  ClipboardList,
  Inbox,
} from 'lucide-react';
import {
  clearAuthStorage,
  isCurrentUserAdmin,
  isRoleAdmin,
  showMyChangeRequestsInNav,
} from '../lib/authPayload';
import { useAdminChangeRequestStreamOptional } from '../context/AdminChangeRequestStreamContext';

interface SubMenuItem {
  id: string;
  label: string;
  path: string;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path?: string;
  subMenus?: SubMenuItem[];
  adminOnly?: boolean;
  /** If set, only JWT/stored role `admin` (not accountant). */
  roleAdminOnly?: boolean;
  /** If set, only standard users (approval flow); hide for admin / accountant. */
  standardUserOnly?: boolean;
}

const menuItems: MenuItem[] = [
  { id: 'overview', label: 'Dashboard', icon: Home, path: '/dashboard' },

  { id: 'bank', label: 'Daily Transactions', icon: CreditCard, path: '/bank' },
 
  { id: 'cheque', label: 'Post-Dated Cheques', icon: FileText, path: '/cheque' },
  {
    id: 'receivable',
    label: 'Creditors List',
    icon: ListOrdered,
    path: '/reciveables',
  },
  { id: 'category', label: 'Debtors List', icon: ListOrdered, path: '/category' },

  {
    id: 'credit-card',
    label: 'Credit Cards ',
    icon: CreditCard,
    subMenus: [
     
      {
        id: 'credit-card-statements',
        label: 'Credit Cards Statements',
        path: '/credit-card-statements',
      },
     
      {
        id: 'credit-card-payments',
        label: 'Credit Cards Payments',
        path: '/credit-card-statements/payments',
      },
      {
        id: 'credit-card-details',
        label: 'Credit Cards Details',
        path: '/credit-card-statements/details',
      },
    ],
  },
  {
    id: 'matching',
    label: 'Customer Credit Card Payments',
    icon: CreditCard,
    path: '/matching',
  },

  { id: 'gbp-transactions', label: 'GBP Transactions', icon: CreditCard, path: '/gbp-transactions' },
  { id: 'usd-transactions', label: 'USD Transactions', icon: CreditCard, path: '/usd-transactions' },
  { id: 'fks-transactions', label: 'FK EMIRATES NBD', icon: CreditCard, path: '/fks-transactions' },
  {
    id: 'user-management',
    label: 'User Accounts Management',
    icon: Users,
    path: '/admin/users',
    adminOnly: true,
  },
  {
    id: 'my-change-requests',
    label: 'My change requests',
    icon: ClipboardList,
    path: '/my-change-requests',
    standardUserOnly: true,
  },
  {
    id: 'approval-queue',
    label: 'Approval Queue',
    icon: Inbox,
    path: '/approval-queue',
    roleAdminOnly: true,
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const adminStream = useAdminChangeRequestStreamOptional();
  const [userName, setUserName] = useState<string>('Admin');
  const [isAdmin, setIsAdmin] = useState(() => isCurrentUserAdmin());
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());
  const approvalPending = adminStream?.pendingCount ?? 0;

  const visibleMenuItems = menuItems.filter((item) => {
    if (item.standardUserOnly && !showMyChangeRequestsInNav()) return false;
    if (item.roleAdminOnly && !isRoleAdmin()) return false;
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  // Get user name from localStorage
  useEffect(() => {
    const name = localStorage.getItem('userName') || 'Admin';
    setUserName(name);
    setIsAdmin(isCurrentUserAdmin());

    const handleStorageChange = () => {
      const updatedName = localStorage.getItem('userName') || 'Admin';
      setUserName(updatedName);
      setIsAdmin(isCurrentUserAdmin());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [location.pathname]);

  // Auto-expand menu if current path matches sub-menu
  useEffect(() => {
    menuItems.forEach((item) => {
      if (item.subMenus) {
        const hasActiveSubMenu = item.subMenus.some(
          (subMenu) => location.pathname === subMenu.path
        );
        if (hasActiveSubMenu) {
          setExpandedMenus((prev) => new Set(prev).add(item.id));
        }
      }
    });
  }, [location.pathname]);

  const handleLogout = () => {
    clearAuthStorage();
    localStorage.removeItem('rememberMe');
    navigate('/');
  };

  const isActive = (path?: string) => {
    if (!path) return false;
    return location.pathname === path;
  };

  const isSubMenuActive = (subMenus?: SubMenuItem[]) => {
    if (!subMenus) return false;
    return subMenus.some((subMenu) => location.pathname === subMenu.path);
  };

  const toggleMenu = (menuId: string) => {
    setExpandedMenus((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(menuId)) {
        newSet.delete(menuId);
      } else {
        newSet.add(menuId);
      }
      return newSet;
    });
  };

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
        {visibleMenuItems.map((item) => {
          const active = item.path ? isActive(item.path) : isSubMenuActive(item.subMenus);
          const isExpanded = item.subMenus && expandedMenus.has(item.id);
          const hasSubMenus = item.subMenus && item.subMenus.length > 0;

          return (
            <div key={item.id} className="space-y-1">
              <button
                onClick={() => {
                  if (hasSubMenus) {
                    toggleMenu(item.id);
                  } else if (item.path) {
                    navigate(item.path);
                  }
                }}
                className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors
                  ${
                    active
                      ? 'bg-[#f7c46d] text-gray-900'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                  }
                `}
              >
                <span
                  className={`text-sm font-medium whitespace-nowrap flex-1 text-left inline-flex items-center ${
                    active ? 'text-gray-900' : 'text-gray-400'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.id === 'approval-queue' && approvalPending > 0 && (
                    <span
                      className={`ml-2 flex-shrink-0 inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                        active ? 'bg-gray-900 text-[#f7c46d]' : 'bg-red-600 text-white'
                      }`}
                      title={`${approvalPending} pending change request(s)`}
                    >
                      {approvalPending > 99 ? '99+' : approvalPending}
                    </span>
                  )}
                </span>
                {hasSubMenus && (
                  <span className="ml-2">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </span>
                )}
              </button>
              
              {/* Sub-menu items */}
              {hasSubMenus && isExpanded && (
                <div className="ml-4 space-y-1">
                  {item.subMenus!.map((subMenu) => {
                    const subActive = isActive(subMenu.path);
                    return (
                      <button
                        key={subMenu.id}
                        onClick={() => navigate(subMenu.path)}
                        className={`w-full flex items-center px-4 py-2 rounded-lg transition-colors text-sm
                          ${
                            subActive
                              ? 'bg-[#edd06a] text-gray-900 font-medium'
                              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                          }
                        `}
                      >
                        <span className="flex-1 text-left">{subMenu.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
