import { useState, useEffect, useCallback } from 'react';
import { Calendar, AlertCircle, Clock,  DollarSign, User, CalendarDays } from 'lucide-react';
import { transactionService } from '../services/transactionService';
import type { Reminder } from '../services/transactionService';
import type { ApiResponse } from '../lib/api';


interface DisplayCheque {
  id: string | number;
  chequeNo: string;
  amount: number;
  dueDate: string;
  daysLeft: number;
  recipient: string;
  pdcType: string;
  status: 'urgent' | 'upcoming';
}

export default function Reminder() {
  const [showReminders, setShowReminders] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upcomingCheques, setUpcomingCheques] = useState<DisplayCheque[]>([]);

  // Format date from ISO string to DD-MMM-YYYY (e.g., 13-jan-2026)
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return dateString;
      }
      
      const day = date.getDate();
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear();
      
      return `${day}-${month}-${year}`;
    } catch {
      return dateString;
    }
  };

  // Fetch reminders from API
  const fetchReminders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response: ApiResponse<Reminder[]> = await transactionService.getReminders(30);

      if (response.success && response.data) {
        // Map API response to display format
        const mappedCheques: DisplayCheque[] = response.data.map((reminder) => {
          const amount = typeof reminder.amount === 'string' 
            ? parseFloat(reminder.amount) 
            : reminder.amount;
          
          const daysLeft = reminder.daysRemaining;
          const status: 'urgent' | 'upcoming' = daysLeft <= 3 ? 'urgent' : 'upcoming';

          return {
            id: reminder.id,
            chequeNo: reminder.chequeNumber,
            amount: amount,
            dueDate: formatDate(reminder.chequeDate),
            daysLeft: daysLeft,
            recipient: reminder.customerName,
            pdcType: reminder.pdcType,
            status: status,
          };
        });

        setUpcomingCheques(mappedCheques);
      } else {
        const errorMsg = (response as any)?.error || (response as any)?.message || 'Failed to fetch reminders';
        setError(errorMsg);
        setUpcomingCheques([]);
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.error || 'Failed to fetch reminders';
      console.error('[Reminder] Error fetching reminders:', err);
      setError(errorMessage);
      setUpcomingCheques([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReminders();
  }, [fetchReminders]);

  // Calculate totals for alert banner
  const urgentCount = upcomingCheques.filter(c => c.status === 'urgent').length;
  const totalAmount = upcomingCheques.reduce((sum, cheque) => sum + cheque.amount, 0);

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-lg shadow-sm" style={{ maxHeight: '550px' }}>
      <div className="p-5 flex-1 overflow-y-auto min-h-0 custom-scrollbar">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
                <div className="text-gray-600 text-sm">Loading reminders...</div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-gradient-to-r from-red-50 to-red-100 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-red-800 mb-1">Error Loading Reminders</h3>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && showReminders && urgentCount > 0 && (
            <div className="bg-gradient-to-r from-red-50 via-red-50 to-orange-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg shadow-md hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-red-900 mb-1.5 text-base">
                      ⚠️ Urgent: {urgentCount} {urgentCount === 1 ? 'Cheque' : 'Cheques'} Due This Week
                    </h3>
                    <p className="text-sm text-red-800 leading-relaxed">
                      You have cheques totaling <span className="font-semibold">AED {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} </span> due within the next 30 days. Review them below to avoid missed payments.
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowReminders(false)} 
                  className="flex-shrink-0 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-full p-1.5 transition-colors"
                  aria-label="Dismiss alert"
                >
                  <span className="text-xl leading-none">×</span>
                </button>
              </div>
            </div>
          )}

          {/* Upcoming Cheques Section */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 overflow-hidden">
            <div className="bg-gradient-to-r from-yellow-50 to-orange-50 px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Upcoming Post-Dated Cheques</h2>
                  <p className="text-xs text-gray-600 mt-0.5">Cheques requiring attention in the next 30 days</p>
                </div>
              </div>
            </div>
            
            <div className="p-5">
              {upcomingCheques.length === 0 && !loading && !error && (
                <div className="text-center py-16">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Calendar className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium">No upcoming cheques</p>
                  <p className="text-sm text-gray-400 mt-1">All clear for the next 30 days</p>
                </div>
              )}
              <div className="space-y-3">
                {upcomingCheques.map((cheque) => (
                  <div
                    key={cheque.id}
                    className={`group relative border-l-4 ${
                      cheque.status === 'urgent' 
                        ? 'border-red-500 bg-gradient-to-r from-red-50 to-red-100/50' 
                        : 'border-[#f7c46d] bg-gradient-to-r from-[#fdf8e8] to-orange-50/50'
                    } rounded-r-xl p-4 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-3">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold tracking-wide ${
                            cheque.status === 'urgent' 
                              ? 'bg-red-200 text-red-800 shadow-sm' 
                              : 'bg-yellow-200 text-yellow-800 shadow-sm'
                          }`}>
                            {cheque.status === 'urgent' ? '🔴 URGENT' : '⏰ UPCOMING'}
                          </span>
                          <span className="text-xs font-mono text-gray-600 bg-white px-2 py-1 rounded border border-gray-200">
                            {cheque.chequeNo}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-gray-400" />
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Recipient</p>
                            </div>
                            <p className="font-semibold text-gray-900 text-sm leading-tight">{cheque.recipient}</p>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-gray-400" />
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</p>
                            </div>
                            <p className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
                              {cheque.dueDate}
                            </p>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Days Left</p>
                            </div>
                            <p className={`font-bold text-base ${
                              cheque.daysLeft <= 3 ? 'text-red-600' : 'text-yellow-600'
                            }`}>
                         
                         {cheque.daysLeft === 0
  ? 'Today'
  : cheque.daysLeft > 0
  ? `${cheque.daysLeft} days`
  : 'Overdue'}

                            </p>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</p>
                            </div>
                            <p className="font-bold text-base text-gray-900">
                            <span className="text-xs text-gray-600">AED</span>    {cheque.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                            </p>
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
                        {cheque.pdcType.startsWith('GCEC') ? (
                          <>
                            <span className="text-[#C29438]">GCEC PDC</span>
                           
                          </>
                        ) : (
                          cheque.pdcType
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}