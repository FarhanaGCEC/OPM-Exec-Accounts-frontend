import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import Layout from '../components/Layout';
import { transactionService, type AccountSummary } from '../services/transactionService';
import type { ApiResponse } from '../lib/api';
import ViewAllTranstion from './ViewAllTranstion';

const formatAmount = (value: number | string | undefined): string => {
  const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export default function Dashboard() {
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  const fetchAccountSummary = useCallback(async () => {
    try {
      setLoadingSummary(true);
      const response: ApiResponse<AccountSummary> = await transactionService.getAccountSummary();

      if (response.success && response.data) {
        setAccountSummary(response.data);
      } else {
        setAccountSummary(null);
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching account summary:', err);
      setAccountSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    fetchAccountSummary();
  }, [fetchAccountSummary]);

  const totalDebitValue =
    typeof accountSummary?.totalDebit === 'number'
      ? accountSummary.totalDebit
      : parseFloat(String(accountSummary?.totalDebit || 0));
  const totalCreditValue =
    typeof accountSummary?.totalCredit === 'number'
      ? accountSummary.totalCredit
      : parseFloat(String(accountSummary?.totalCredit || 0));
  const currentBalanceValue = totalCreditValue - totalDebitValue;
  const pendingHoldAmount =
    typeof accountSummary?.pendingChecks?.totalAmount === 'number'
      ? accountSummary.pendingChecks.totalAmount
      : parseFloat(String(accountSummary?.pendingChecks?.totalAmount || 0));
  const availableBalanceValue = currentBalanceValue - pendingHoldAmount;

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
          <h2 className="text-2xl font-bold text-gray-900">
            Daily Transactions Summary
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 m-8">
        {loadingSummary ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-white border border-gray-200">
                <CardContent className="p-6">
                  <div className="flex flex-col items-center justify-center text-center h-32">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-24 mb-4" />
                      <div className="h-8 bg-gray-200 rounded w-32" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : accountSummary ? (
          <>
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">Total Debit</p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-2xl font-bold text-gray-900">
                      AED {formatAmount(totalDebitValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">Total Credit</p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-2xl font-bold text-gray-900">
                      AED {formatAmount(totalCreditValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">Current Balance</p>
                  <div className="flex items-baseline space-x-2">
                    <p
                      className={`text-2xl font-bold ${currentBalanceValue < 0 ? 'text-red-600' : 'text-gray-900'}`}
                    >
                      AED {formatAmount(currentBalanceValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">Available Balance</p>
                  <div className="flex items-baseline space-x-2">
                    <p
                      className={`text-2xl font-bold ${availableBalanceValue < 0 ? 'text-red-600' : 'text-gray-900'}`}
                    >
                      AED {formatAmount(availableBalanceValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <div className="col-span-1 md:col-span-2 lg:col-span-4 text-center py-8">
            <p className="text-base text-gray-500">Failed to load account summary</p>
          </div>
        )}
      </div>

      <ViewAllTranstion />
    </Layout>
  );
}
