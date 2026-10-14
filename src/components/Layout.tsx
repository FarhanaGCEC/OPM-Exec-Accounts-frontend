import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import { PanelLeft, PanelRight } from 'lucide-react';
import { APP_SIDEBAR_OPEN_EVENT } from '../lib/sidebarControl';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen');
    return saved ? saved === 'true' : true; // Default to open
  });

  useEffect(() => {
    localStorage.setItem('sidebarOpen', String(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    const onSidebarOpenEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      if (typeof detail?.open === 'boolean') {
        setIsSidebarOpen(detail.open);
      }
    };
    window.addEventListener(APP_SIDEBAR_OPEN_EVENT, onSidebarOpenEvent);
    return () => {
      window.removeEventListener(APP_SIDEBAR_OPEN_EVENT, onSidebarOpenEvent);
    };
  }, []);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="h-screen bg-gray-50 flex overflow-hidden">
      {/* Sidebar - Fixed position */}
      <div
        className={`${
          isSidebarOpen ? 'w-60 pointer-events-auto' : 'w-0 pointer-events-none'
        } transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 fixed left-0 top-0 h-screen z-40`}
      >
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-h-0 relative transition-all duration-300 ${
        isSidebarOpen ? 'ml-60' : 'ml-0'
      }`}>
        {/* Toggle Button - Always visible on the left */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSidebar();
          }}
          className={`fixed top-4 z-[60] p-2 bg-black text-[#d90522] rounded-md hover:bg-zinc-900 transition-all duration-200 shadow-md cursor-pointer ${
            isSidebarOpen ? 'left-[252px]' : 'left-4'
          }`}
          aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          title={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          type="button"
        >
          {isSidebarOpen ? (
            <PanelLeft className="w-5 h-5" />
          ) : (
            <PanelRight className="w-5 h-5" />
          )}
        </button>

        <main className="flex-1 min-h-0 overflow-y-auto bg-gray-50 pt-4">
          {children}
        </main>
      </div>
    </div>
  );
}
