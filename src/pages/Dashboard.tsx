import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import Layout from '../components/Layout';
import { transactionService } from '../services/transactionService';
import ViewAllTranstion from './ViewAllTranstion';

const formatAmount = (value: number | string | undefined): string => {
  const numValue =
    typeof value === 'number'
      ? value
      : parseFloat(String(value ?? 0).replace(/,/g, '').trim());
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

type DashboardSummary = {
  totalDebit: number;
  totalCredit: number;
  currentBalance: number;
};

type AvailableBalanceFromTable = {
  balance: number;
  remark: string;
};

type SummarySource = Record<string, unknown>;

const toAmount = (value: number | string | null | undefined): number => {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isNaN(parsed) ? 0 : parsed;
};

const pickAmountValue = (
  source: SummarySource,
  keys: string[]
): number | string | null | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      if (value !== undefined) return value;
    }
  }
  return undefined;
};

export default function Dashboard() {
  const [accountSummary, setAccountSummary] = useState<DashboardSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [availableFromTable, setAvailableFromTable] = useState<AvailableBalanceFromTable | null>(null);

  const handleAvailableBalanceChange = useCallback((value: AvailableBalanceFromTable | null) => {
    setAvailableFromTable((prev) => {
      if (prev === null && value === null) return prev;
      if (
        prev &&
        value &&
        prev.balance === value.balance &&
        prev.remark === value.remark
      ) {
        return prev;
      }
      return value;
    });
  }, []);

  const fetchAccountSummary = useCallback(async () => {
    try {
      setLoadingSummary(true);
      const response = await transactionService.getAccountSummary();
      if (!response.success || !response.data) {
        setAccountSummary(null);
        return;
      }
      const topLevel = response.data as unknown as SummarySource;
      const nested =
        topLevel.data && typeof topLevel.data === 'object' && !Array.isArray(topLevel.data)
          ? (topLevel.data as SummarySource)
          : null;
      const source = nested ?? topLevel;

      const statementTotals =
        source.statementTotals && typeof source.statementTotals === 'object' && !Array.isArray(source.statementTotals)
          ? (source.statementTotals as SummarySource)
          : null;

      setAccountSummary({
        totalDebit: toAmount(pickAmountValue(source, ['totalDebit', 'total_debit', 'debitTotal'])),
        totalCredit: toAmount(pickAmountValue(source, ['totalCredit', 'total_credit', 'creditTotal'])),
        currentBalance: toAmount(
          pickAmountValue(source, ['currentBalance', 'current_balance']) ??
            (statementTotals
              ? pickAmountValue(statementTotals, ['currentBalance', 'current_balance', 'ledgerBalance'])
              : undefined)
        ),
      });
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

  const totalDebitValue = accountSummary?.totalDebit ?? 0;
  const totalCreditValue = accountSummary?.totalCredit ?? 0;
  const currentBalanceValue = accountSummary?.currentBalance ?? 0;
  const availableBalanceValue = availableFromTable?.balance ?? 0;
  const shouldHighlightAvailableBalanceCell =
    (availableFromTable?.remark ?? '').trim().toLowerCase().replace(/\s+/g, ' ') ===
    'available balance';

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
          <h2 className="text-2xl font-bold text-gray-900">
            Daily Transactions Summary
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 m-6">
        {loadingSummary ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-white border border-gray-200">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center justify-center text-center h-24">
                    <div className="animate-pulse">
                      <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
                      <div className="h-6 bg-gray-200 rounded w-28" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        ) : accountSummary ? (
          <>
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-4">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-sm font-medium text-gray-600 mb-2">Total Debit</p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-xl font-bold text-gray-900">
                      AED {formatAmount(totalDebitValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-4">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-sm font-medium text-gray-600 mb-2">Total Credit</p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-xl font-bold text-gray-900">
                      AED {formatAmount(totalCreditValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-4">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-sm font-medium text-gray-600 mb-2">Current Balance</p>
                  <div className="flex items-baseline space-x-2">
                    <p
                      className={`text-xl font-bold ${currentBalanceValue < 0 ? 'text-red-600' : 'text-gray-900'}`}
                    >
                      AED {formatAmount(currentBalanceValue)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className={"hover:shadow-lg transition-all duration-300 border rounded-lg overflow-hidden:bg-[#91d34d]"}

            
            >
              <CardContent className="p-4">
                <div className="flex flex-col items-center justify-center text-center">
                  <p
                    className={`text-sm font-medium mb-2 ${
                      shouldHighlightAvailableBalanceCell ? 'text-gray-900' : 'text-gray-600'
                    }`}
                  >
                    Available Balance
                  </p>
                  <div className="flex items-baseline space-x-2">
                    <p
                      className={`text-xl font-bold px-1.5 rounded ${availableBalanceValue < 0 ? 'text-red-600' : 'text-gray-900'}`}
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

      <ViewAllTranstion onAvailableBalanceChange={handleAvailableBalanceChange} />
    </Layout>
  );
}
