import { Card, CardContent } from './ui/card';
import { ArrowRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';

export interface Transaction {
  date: string;
  description: string;
  type: 'Debit' | 'Credit';
  amount: string;
  status: string;
}

interface RecentTransactionsProps {
  transactions: Transaction[];
  onViewAll?: () => void;
}

// Transaction Type Badge Component
const TransactionTypeBadge = ({ type }: { type: 'Debit' | 'Credit' }) => {
  return (
    <span
      className={`inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium ${
        type === 'Debit'
          ? 'bg-red-100 text-red-700'
          : 'bg-green-100 text-green-700'
      }`}
    >
      {type}
    </span>
  );
};

// Status Badge Component
const StatusBadge = ({ status }: { status: string }) => {
  return (
    <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
      <span className="w-2 h-2 bg-green-600 rounded-full mr-2"></span>
      {status}
    </span>
  );
};

// Transaction Row Component (for mobile view)
const TransactionRowMobile = ({ transaction }: { transaction: Transaction }) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-semibold text-gray-900 text-sm">{transaction.description}</p>
          <p className="text-xs text-gray-500 mt-1">{transaction.date}</p>
        </div>
        <TransactionTypeBadge type={transaction.type} />
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-500">Amount</p>
          <p
            className={`font-semibold text-sm ${
              transaction.type === 'Debit' ? 'text-red-600' : 'text-green-600'
            }`}
          >
            {transaction.amount} AED
          </p>
        </div>
        <StatusBadge status={transaction.status} />
      </div>
    </div>
  );
};

// Transaction Table Row Component (for desktop view)
const TransactionTableRow = ({ transaction }: { transaction: Transaction }) => {
  return (
    <TableRow className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <TableCell className="text-gray-700 text-sm py-4">
        <span className="block sm:inline">{transaction.date}</span>
      </TableCell>
      <TableCell className="text-gray-700 font-medium text-sm py-4">
        {transaction.description}
      </TableCell>
      <TableCell className="py-4">
        <TransactionTypeBadge type={transaction.type} />
      </TableCell>
      <TableCell
        className={`font-semibold text-sm py-4 ${
          transaction.type === 'Debit' ? 'text-red-600' : 'text-green-600'
        }`}
      >
        {transaction.amount} AED
      </TableCell>
      <TableCell className="py-4">
        <StatusBadge status={transaction.status} />
      </TableCell>
    </TableRow>
  );
};

// Header Component
const TransactionsHeader = ({ onViewAll }: { onViewAll?: () => void }) => {
  return (
    <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
        Recent Transactions
      </h3>
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="text-green-600 hover:text-green-700 font-medium text-sm flex items-center transition-colors"
        >
          View All
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      )}
    </div>
  );
};

// Main Component
export default function RecentTransactions({
  transactions,
  onViewAll,
}: RecentTransactionsProps) {
  return (
    <Card className="bg-white border border-gray-200 w-full">
      <CardContent className="p-4 sm:p-6">
        <TransactionsHeader onViewAll={onViewAll} />

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader >
              <TableRow className="border-b border-gray-200">
                <TableHead className="font-semibold text-gray-700 text-sm text-center">
                  DATE
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-sm text-center">
                  DESCRIPTION
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-sm text-center">
                  TYPE
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-sm text-center">
                  AMOUNT
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-sm text-center">
                  STATUS
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction, index) => (
                <TransactionTableRow key={index} transaction={transaction} />
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden space-y-4">
          {transactions.map((transaction, index) => (
            <TransactionRowMobile key={index} transaction={transaction} />
          ))}
        </div>

        {/* Tablet View - Simplified Table */}
        <div className="hidden sm:block md:hidden overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200">
                <TableHead className="font-semibold text-gray-700 text-xs">
                  DATE
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-xs">
                  DESCRIPTION
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-xs">
                  TYPE
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-xs">
                  AMOUNT
                </TableHead>
                <TableHead className="font-semibold text-gray-700 text-xs">
                  STATUS
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction, index) => (
                <TransactionTableRow key={index} transaction={transaction} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

