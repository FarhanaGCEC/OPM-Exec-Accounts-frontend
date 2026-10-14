import { useState } from 'react';
import { Card, CardContent} from '../components/ui/card';
import Layout from '../components/Layout';
import {
  
  Wallet,
  ArrowUp,
  ArrowDown,
  FileText,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export default function ViewAllRecords() {
  const [activeTab, setActiveTab] = useState('online');
 

  const summaryCards = [
    {
      title: 'Current Balance',
      value: '41,850',
      currency: 'GBP',
      icon: Wallet,
      cardBg: 'bg-green-100',
      textColor: 'text-green-900',
      iconBg: 'bg-green-200',
    },
    {
      title: 'Total Debits',
      value: '63,150',
      currency: 'GBP',
      icon: ArrowUp,
      cardBg: 'bg-red-100',
      textColor: 'text-red-900',
      iconBg: 'bg-red-200',
    },
    {
      title: 'Total Credits',
      value: '105,000',
      currency: 'GBP',
      icon: ArrowDown,
      cardBg: 'bg-green-100',
      textColor: 'text-green-900',
      iconBg: 'bg-green-200',
    },
    {
      title: 'Pending Cheques',
      value: '183,000',
      currency: 'GBP',
      icon: FileText,
      cardBg: 'bg-orange-100',
      textColor: 'text-orange-900',
      iconBg: 'bg-orange-200',
    },

  ];

  const transactions = [
    {
      date: '2024-01-01',
      description: 'Opening Balance',
      details: 'Initial',
      debit: null,
      credit: '50,000',
      balance: '50,000',
      type: 'online',
    },
    {
      date: '2024-01-05',
      description: 'Rent Payment - Al Khaleej Properties',
      details: 'Cheque #1234',
      debit: '8,500',
      credit: null,
      balance: '41,500',
      type: 'cheque',
    },
    {
      date: '2024-01-08',
      description: 'Customer Payment - Ahmed Trading LLC',
      details: 'Online Transfer',
      debit: null,
      credit: '15,000',
      balance: '56,500',
      type: 'online',
    },
    {
      date: '2024-01-12',
      description: 'Supplier Payment - Tech Solutions',
      details: 'Cheque #1235',
      debit: '12,000',
      credit: null,
      balance: '44,500',
      type: 'cheque',
    },
    {
      date: '2024-01-15',
      description: 'Bank Charges',
      details: 'Monthly Fee',
      debit: '150',
      credit: null,
      balance: '44,350',
      type: 'online',
    },
    {
      date: '2024-01-18',
      description: 'Customer Payment - Falcon Industries',
      details: 'Cash Deposit',
      debit: null,
      credit: '22,000',
      balance: '66,350',
      type: 'online',
    },
    {
      date: '2024-01-22',
      description: 'Returned Cheque - Star Company',
      details: 'Cheque #1230',
      debit: '5,000',
      credit: null,
      balance: '61,350',
      type: 'cheque',
    },
    {
      date: '2024-01-25',
      description: 'Utility Bills Payment',
      details: 'Online',
      debit: '2,500',
      credit: null,
      balance: '58,850',
      type: 'online',
    },
    {
      date: '2024-01-28',
      description: 'Customer Payment - Dubai Mall Stores',
      details: 'Bank Transfer',
      debit: null,
      credit: '18,000',
      balance: '76,850',
      type: 'online',
    },
    {
      date: '2024-02-01',
      description: 'Salary Payments',
      details: 'Multiple Transfers',
      debit: '35,000',
      credit: null,
      balance: '41,850',
      type: 'online',
    },
  ];


  const filteredTransactions = transactions.filter((transaction) => {
    // Filter by type (online/cheque)
    if (activeTab !== 'all' && transaction.type !== activeTab) {
      return false;
    }

 

    return true;
  });

  return (
    <Layout>

<div className="mb-6 flex flex-col gap-2 items-start justify-start">
  <h2 className="text-2xl font-bold text-gray-900">Account Summary</h2>

</div>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
     
        {summaryCards.map((card, index) => {
          const Icon = card.icon;
          return (
           
            <Card key={index} className={`${card.cardBg} hover:shadow-xl transition-all duration-300 border-0 rounded-2xl overflow-hidden border-gray-200 border-2`}>
           
              <CardContent className="p-4 relative h-40 flex flex-col justify-between">
                {/* Illustration/Icon Area */}
                <div className="absolute right-3 top-3">
                  <div className={`${card.iconBg} p-3 rounded-xl`}>
                    <Icon className={`w-8 h-8 ${card.textColor}`} />
                  </div>
                </div>

                {/* Decorative Elements */}
                <div className="absolute right-0 top-0 w-24 h-24 opacity-10">
                  <div className={`${card.iconBg} rounded-full w-full h-full`}></div>
                </div>

                {/* Content */}
                <div className="relative z-10 mt-auto">
                  <p className={`text-sm font-medium ${card.textColor} opacity-80 mb-1`}>
                    {card.title}
                  </p>
                  <div className="flex items-baseline space-x-1">
                    <p className={`text-xl font-bold ${card.textColor}`}>
                      {card.currency ? `${card.currency} ${card.value}` : card.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
        
          );
        })}
      </div>

      {/* Search Bar and Tabs */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Detail Statement</h2>
        {/* <div className="relative flex-1 w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by description, customer, or reference..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-gray-200 bg-white"
          />
        </div> */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'all'
              ? 'bg-[#a8061d] text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
          >
            All
          </button>
          <button
            onClick={() => setActiveTab('online')}
            className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'online'
              ? 'bg-[#a8061d] text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
          >
            Online
          </button>
          <button
            onClick={() => setActiveTab('cheque')}
            className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'cheque'
              ? 'bg-[#a8061d] text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
          >
            Cheque
          </button>
          <button
            onClick={() => setActiveTab('cash')}
            className={`px-4 py-2 rounded-lg text-lg font-medium transition-colors ${activeTab === 'cash'
              ? 'bg-[#a8061d] text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
          >
            Cash
          </button>
        </div>
      </div>

      {/* Transaction Table */}
      <Card className="bg-white border border-gray-200 overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#a8061d] border-0">
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Date
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Description
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Details
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Debit
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Credit
                  </TableHead>
                  <TableHead className="font-semibold text-black text-sm text-left py-2">
                    Balance
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.map((transaction, index) => (
                  <TableRow key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <TableCell className="text-gray-700 text-sm py-2 text-left">
                      {transaction.date}
                    </TableCell>
                    <TableCell className="text-gray-700 font-medium text-sm py-2 text-left">
                      {transaction.description}
                    </TableCell>
                    <TableCell className="text-gray-600 text-sm py-2 text-left">
                      {transaction.details}
                    </TableCell>
                    <TableCell className="text-sm py-2 text-left">
                      {transaction.debit ? (
                        <span className="text-red-600 font-semibold">
                          GBP {transaction.debit}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm py-2 text-left">
                      {transaction.credit ? (
                        <span className="text-green-600 font-semibold">
                          GBP {transaction.credit}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-700 font-semibold text-sm py-2 text-left">
                      GBP {transaction.balance}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}

