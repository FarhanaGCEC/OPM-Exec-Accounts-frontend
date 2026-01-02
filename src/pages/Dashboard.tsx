// import { Card, CardContent } from '../components/ui/card';
// import RecentTransactions from '../components/RecentTransactions';
// import type { Transaction } from '../components/RecentTransactions';
import Layout from '../components/Layout';
// import {
//   Wallet,
//   ArrowUp,
//   ArrowDown,
//   FileText,
// } from 'lucide-react';

export default function Dashboard() {
  const userName = localStorage.getItem('userName') || 'Admin';
  // const summaryCards = [
  //   {
  //     title: 'Current Balance',
  //     value: '58,850',
  //     currency: 'AED',
  //     icon: Wallet,
  //     cardBg: 'bg-blue-100',
  //     textColor: 'text-blue-900',
  //     iconBg: 'bg-blue-200',
  //   },
  //   {
  //     title: 'Total Debits',
  //     value: '28,150',
  //     currency: 'AED',
  //     icon: ArrowUp,
  //     cardBg: 'bg-yellow-100',
  //     textColor: 'text-yellow-900',
  //     iconBg: 'bg-yellow-200',
  //   },
  //   {
  //     title: 'Total Credits',
  //     value: '87,000',
  //     currency: 'AED',
  //     icon: ArrowDown,
  //     cardBg: 'bg-green-100',
  //     textColor: 'text-green-900',
  //     iconBg: 'bg-green-200',
  //   },
  //   {
  //     title: 'Pending Cheques',
  //     value: '12',
  //     currency: '',
  //     icon: FileText,
  //     cardBg: 'bg-purple-100',
  //     textColor: 'text-purple-900',
  //     iconBg: 'bg-purple-200',
  //   },
  // ];

  // const transactions: Transaction[] = [
  //   {
  //     date: '2024-01-25',
  //     description: 'Utility Bills Payment',
  //     type: 'Debit',
  //     amount: '2,500',
  //     status: 'Completed',
  //   },
  //   {
  //     date: '2024-01-22',
  //     description: 'Returned Cheque - Star Company',
  //     type: 'Debit',
  //     amount: '5,000',
  //     status: 'Completed',
  //   },
  //   {
  //     date: '2024-01-18',
  //     description: 'Customer Payment - Falcon Industries',
  //     type: 'Credit',
  //     amount: '22,000',
  //     status: 'Completed',
  //   },
  //   {
  //     date: '2024-01-15',
  //     description: 'Bank Charges',
  //     type: 'Debit',
  //     amount: '150',
  //     status: 'Completed',
  //   },
  //   {
  //     date: '2024-01-12',
  //     description: 'Supplier Payment - Tech Solutions',
  //     type: 'Debit',
  //     amount: '12,000',
  //     status: 'Completed',
  //   },
  // ];

  // const handleViewAllTransactions = () => {
  //   // Navigate to full transactions page or open modal
  //   console.log('View all transactions');
  // };

  return (
    <Layout>
      {/* Welcome Section */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            Welcome Back, {userName}!
          </h2>
        </div>
        {/* <div className="flex items-center space-x-3">
          <select className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200">
            <option>Previous Year</option>
            <option>Current Year</option>
          </select>
          <button className="px-4 py-2 bg-[#eab308] text-white rounded-lg text-sm transition-colors">
            View All Time
          </button>
        </div> */}
      </div>

      {/* Summary Cards */}
      {/* <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {summaryCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className={`${card.cardBg} hover:shadow-xl transition-all duration-300 border-0 rounded-2xl overflow-hidden border-gray-200 border-2 `}>
              <CardContent className="p-6 relative h-48 flex flex-col justify-between">
        
                <div className="absolute right-4 top-4">
                  <div className={`${card.iconBg} p-4 rounded-xl`}>
                    <Icon className={`w-12 h-12 ${card.textColor}`} />
                  </div>
                </div>

           
                <div className="absolute right-0 top-0 w-32 h-32 opacity-10">
                  <div className={`${card.iconBg} rounded-full w-full h-full`}></div>
                </div>

                
                <div className="relative z-10 mt-auto">
                  <p className={`text-sm font-medium ${card.textColor} opacity-80 mb-2`}>
                    {card.title}
                  </p>
                  <div className="flex items-baseline space-x-1">
                    <p className={`text-4xl font-bold ${card.textColor}`}>
                      {card.value}
                    </p>
                    {card.currency && (
                      <span className={`text-xl font-semibold ${card.textColor} opacity-80`}>
                        {card.currency}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div> */}

      {/* Recent Transactions */}
      {/* <RecentTransactions
        transactions={transactions}
        onViewAll={handleViewAllTransactions}
      /> */}
    </Layout>
  );
}
