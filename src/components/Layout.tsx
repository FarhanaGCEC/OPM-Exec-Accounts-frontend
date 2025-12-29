
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
// import { Search } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  // showHeader?: boolean;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      {/* <div className="flex-1 flex flex-col bg-white">
      
        {showHeader && (
          <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-10">
            <div className="flex items-center space-x-8">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 w-64"
                />
              </div>
            </div>
            <div className="flex items-center space-x-4">
         
              <div className="flex items-center space-x-2 ml-4">
                <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold">A</span>
                </div>
                <span className="text-sm font-medium text-gray-900">Admin</span>
              </div>
            </div>
          </header>
        )}

      </div> */}

      <main className="flex-1 p-6 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}

