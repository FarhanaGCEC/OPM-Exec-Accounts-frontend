import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import { PanelLeft, PanelRight } from 'lucide-react';

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

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar - Fixed position */}
      <div
        className={`${
          isSidebarOpen ? 'w-64 pointer-events-auto' : 'w-0 pointer-events-none'
        } transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 fixed left-0 top-0 h-screen z-40`}
      >
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col relative transition-all duration-300 ${
        isSidebarOpen ? 'ml-64' : 'ml-0'
      }`}>
        {/* Toggle Button - Always visible on the left */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSidebar();
          }}
          className={`fixed top-4 z-[60] p-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-all duration-200 shadow-md cursor-pointer ${
            isSidebarOpen ? 'left-[268px]' : 'left-4'
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

        <main className="flex-1 pt-4 overflow-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}

