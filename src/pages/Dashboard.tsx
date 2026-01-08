import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import Layout from '../components/Layout';
import { transactionService, type AnalyticsResponseData, type AccountSummary } from '../services/transactionService';
import type { ApiResponse } from '../lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export default function Dashboard() {
  const userName = localStorage.getItem('userName') || 'Admin';
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<any[]>([]);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
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

  // Fetch analytics data
  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const response: ApiResponse<AnalyticsResponseData> = await transactionService.getTransactionAnalytics('monthly');
 
      
      if (response.success && response.data) {
        // The API returns: { success: true, period: "monthly", data: {...}, summary: {...} }
        // api.get returns it as-is because it has success and data properties
        // So response.data is the entire API response: { success, period, data, summary }
        const apiResponse = response.data as any;
        
        // The actual data is in apiResponse.data
        // apiResponse = { success: true, period: "monthly", data: { labels, datasets }, summary: {...} }
        const analyticsData = apiResponse?.data || apiResponse;
        
        // Extract labels and datasets
        const labels = analyticsData?.labels || [];
        const datasets = analyticsData?.datasets || [];
        
        console.log('[Dashboard] labels:', labels);
        console.log('[Dashboard] datasets:', datasets);
        
        if (!labels.length || !datasets.length) {
          console.warn('[Dashboard] No data available. labels:', labels.length, 'datasets:', datasets.length);
          setChartData([]);
          return;
        }
        
 
        
        // Map API response to chart format
        const debitDataset = datasets.find((d: { label: string }) => d.label === 'Debit');
        const creditDataset = datasets.find((d: { label: string }) => d.label === 'Credit');

        
        if (!debitDataset || !creditDataset) {
          console.warn('[Dashboard] Debit or Credit dataset not found. Available labels:', datasets.map((d: any) => d.label));
          setChartData([]);
          return;
        }
        
        // Format labels (convert "2025-12" to "Dec")
        const formattedLabels = labels.map((label: string) => {
          // Format: "2025-12" -> "Dec"
          const [, month] = label.split('-');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthIndex = parseInt(month, 10) - 1;
          return monthNames[monthIndex] || label;
        });
        
        // Create chart data array
        const chartDataArray = formattedLabels.map((label: string, index: number) => ({
          month: label,
          Debit: debitDataset.data[index] || 0,
          Credit: creditDataset.data[index] || 0,
        }));
        
        console.log('[Dashboard] Final chartDataArray:', chartDataArray);
        setChartData(chartDataArray);
      } else {
        console.warn('[Dashboard] Response not successful or no data');
        setChartData([]);
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching analytics:', err);
      setChartData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch account summary
  const fetchAccountSummary = useCallback(async () => {
    try {
      setLoadingSummary(true);
      const response: ApiResponse<AccountSummary> = await transactionService.getAccountSummary();
      
      console.log('[Dashboard] Account Summary Response:', JSON.stringify(response, null, 2));
      
      if (response.success && response.data) {
        console.log('[Dashboard] Setting account summary:', response.data);
        setAccountSummary(response.data);
      } else {
        console.warn('[Dashboard] Account summary response not successful:', response);
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
    fetchAnalytics();
    fetchAccountSummary();
  }, [fetchAnalytics, fetchAccountSummary]);

  return (
    <Layout>
      {/* Welcome Section */}
      <div className="mb-6 flex items-center justify-between shadow-md">
       <div className="flex items-center gap-4 ml-4">
          <h2 className="text-2xl font-bold text-gray-900 pl-12 py-4">
            Welcome Back, {userName}!
          </h2>
        </div> 
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 m-8">
        {loadingSummary ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-white border border-gray-200">
                <CardContent className="p-6">
                  <div className="flex flex-col items-center justify-center text-center h-32">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-24 mb-4"></div>
                      <div className="h-8 bg-gray-200 rounded w-32"></div>
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
                  <p className="text-base font-medium text-gray-600 mb-3">
                    Current Balance
                  </p>
                  <div className="flex items-baseline space-x-2">
                    <p className={`text-3xl font-bold ${accountSummary.totalBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {accountSummary.totalBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </p>
                    <span className={`text-xl font-semibold ${accountSummary.totalBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      AED
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">
                    Total Debits
                  </p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-3xl font-bold text-gray-900">
                      {accountSummary.totalDebit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </p>
                    <span className="text-xl font-semibold text-gray-900">
                      AED
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">
                    Total Credits
                  </p>
                  <div className="flex items-baseline space-x-2">
                    <p className="text-3xl font-bold text-gray-900">
                      {accountSummary.totalCredit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </p>
                    <span className="text-xl font-semibold text-gray-900">
                      AED
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white hover:shadow-lg transition-all duration-300 border border-gray-200 rounded-lg overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center justify-center text-center">
                  <p className="text-base font-medium text-gray-600 mb-3">
                    Pending Cheques
                  </p>
                  <div className="flex flex-col items-center space-y-1">
                    <div className="flex items-baseline space-x-2">
                      <p className="text-3xl font-bold text-gray-900">
                        {accountSummary.pendingChecks.count}
                      </p>
                    </div>
                    <p className="text-sm text-gray-500">
                      {accountSummary.pendingChecks.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} AED
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <div className="col-span-4 text-center py-8">
            <p className="text-base text-gray-500">Failed to load account summary</p>
          </div>
        )}
      </div>

      {/* Debit/Credit Chart */}
      <Card className="bg-white border border-gray-200 m-8">
        <CardContent className="p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-6">Debit & Credit Overview</h3>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-base text-gray-500">Loading chart data...</p>
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <p className="text-base text-gray-500">No transaction data available</p>
           
            </div>
          ) : (
            <div style={{ width: '100%', height: '400px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{
                    top: 20,
                    right: 30,
                    left: 20,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="month" 
                    stroke="#6b7280"
                    style={{ fontSize: '14px' }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    style={{ fontSize: '14px' }}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number | undefined) => {
                      if (value === undefined) return '';
                      return `AED ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="rect"
                  />
                  <Bar 
                    dataKey="Debit" 
                    fill="rgba(239, 68, 68, 0.8)" 
                    stroke="rgba(239, 68, 68, 1)"
                    name="Debit"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar 
                    dataKey="Credit" 
                    fill="rgba(34, 197, 94, 0.8)" 
                    stroke="rgba(34, 197, 94, 1)"
                    name="Credit"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
