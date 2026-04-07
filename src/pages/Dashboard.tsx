import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import Layout from '../components/Layout';
import { transactionService, type AccountSummary, type PostDatedCheque } from '../services/transactionService';
import type { ApiResponse } from '../lib/api';
import ViewAllTranstion from './ViewAllTranstion';
import { formatIsoDateDisplay } from '../lib/formatDisplayDate';
import { Loader2 } from 'lucide-react';

const formatAmount = (value: number | string | undefined): string => {
  const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

function pdcAmount(c: PostDatedCheque): string {
  if (typeof c.amount === 'number') return formatAmount(c.amount);
  const n = parseFloat(String(c.amount).replace(/,/g, ''));
  return formatAmount(isNaN(n) ? 0 : n);
}

function DashboardPdcList({
  title,
  items,
  loading,
  viewAllTo,
}: {
  title: string;
  items: PostDatedCheque[];
  loading: boolean;
  viewAllTo: string;
}) {
  return (
    <Card className="bg-white border border-gray-200 flex-1 flex flex-col min-h-0 max-h-[550px] overflow-hidden shadow-sm">
      <div className="bg-[#f7c46d] px-4 py-3 shrink-0 border-b border-[#c9a82f]/30">
        <h3 className="text-lg font-semibold text-black">{title}</h3>
      </div>
      <CardContent className="p-0 flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-600">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10 px-4">No cheques in this category.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((c) => (
              <li key={String(c.id)} className="px-4 py-3 hover:bg-gray-50/80 transition-colors">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {c.chequeNumber}
                      {c.chequeType === 'Security Cheque' && (
                        <span className="ml-2 text-xs font-normal text-red-600">(Security)</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-600 truncate mt-0.5">
                      {c.customerName || '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Due {formatIsoDateDisplay(c.chequeDate)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 shrink-0">AED {pdcAmount(c)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50 shrink-0">
        <Link
          to={viewAllTo}
          className="text-sm font-medium text-[#b08f2c] hover:text-black hover:underline"
        >
          View all →
        </Link>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const userName = localStorage.getItem('userName') || 'Admin';
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [customerPdcs, setCustomerPdcs] = useState<PostDatedCheque[]>([]);
  const [gcecPdcs, setGcecPdcs] = useState<PostDatedCheque[]>([]);
  const [loadingPdc, setLoadingPdc] = useState(true);

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

  const fetchPdcSplit = useCallback(async () => {
    try {
      setLoadingPdc(true);
      const res = await transactionService.getPostDatedCheques();
      if (res.success && res.data) {
        const list = res.data.filter((c) => c.pdcType !== 'Custom PDC');
        setCustomerPdcs(list.filter((c) => c.pdcType === 'Customer PDC'));
        setGcecPdcs(list.filter((c) => c.pdcType === 'GCEC PDC'));
      } else {
        setCustomerPdcs([]);
        setGcecPdcs([]);
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching PDC lists:', err);
      setCustomerPdcs([]);
      setGcecPdcs([]);
    } finally {
      setLoadingPdc(false);
    }
  }, []);

  useEffect(() => {
    fetchAccountSummary();
    fetchPdcSplit();
  }, [fetchAccountSummary, fetchPdcSplit]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4 ml-4">
          <h2 className="text-2xl font-bold text-gray-900 pl-12 py-4">
            Welcome Back, {userName}!
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 m-8">
        {loadingSummary ? (
          <>
            {[1, 2, 3].map((i) => (
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
                    <p className="text-3xl font-bold text-gray-900">
                      {formatAmount(accountSummary.totalDebit)}
                    </p>
                    <span className="text-xl font-semibold text-gray-900">AED</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">Total Credit</p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-3xl font-bold text-gray-900">
                      {formatAmount(accountSummary.totalCredit)}
                    </p>
                    <span className="text-xl font-semibold text-gray-900">AED</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">Current Balance</p>
                  <div className="flex items-baseline space-x-2">
                    {(() => {
                      const balanceValue =
                        typeof accountSummary.totalBalance === 'number'
                          ? accountSummary.totalBalance
                          : parseFloat(String(accountSummary.totalBalance || 0));
                      const isNegative = balanceValue < 0;
                      return (
                        <>
                          <p
                            className={`text-3xl font-bold ${isNegative ? 'text-red-600' : 'text-gray-900'}`}
                          >
                            {formatAmount(accountSummary.totalBalance)}
                          </p>
                          <span
                            className={`text-xl font-semibold ${isNegative ? 'text-red-600' : 'text-gray-900'}`}
                          >
                            AED
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <div className="col-span-1 md:col-span-2 lg:col-span-3 text-center py-8">
            <p className="text-base text-gray-500">Failed to load account summary</p>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 m-8">
        <DashboardPdcList
          title="Customer PDC"
          items={customerPdcs}
          loading={loadingPdc}
          viewAllTo="/customer-pdc"
        />
        <DashboardPdcList
          title="GCEC Issued PDC"
          items={gcecPdcs}
          loading={loadingPdc}
          viewAllTo="/gcec-pdc"
        />
      </div>

      <ViewAllTranstion />
    </Layout>
  );
}
