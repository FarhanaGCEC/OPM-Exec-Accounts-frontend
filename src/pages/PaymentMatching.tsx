import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Plus, Calendar as CalendarIcon, Loader2, Edit, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import Calendar from '../components/ui/calendar-tailwind';
import { transactionService, type PaymentMatching as PaymentMatchingType } from '../services/transactionService';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import type { ApiResponse } from '../lib/api';

interface PaymentMatching extends PaymentMatchingType {
  date?: string; // Formatted date for display
  amountFormatted?: string; // Formatted amount for display
}

// Zod validation schema
const paymentSchema = z.object({
  paymentDate: z.string()
    .min(10, 'Payment date is required')
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in dd/mm/yyyy format'),
  invoiceNumber: z.string().optional(),
  customerName: z.string()
    .min(1, 'Customer name is required')
    .min(3, 'Customer name must be at least 3 characters'),
  paymentMethod: z.string({
    required_error: 'Please select a payment method',
  }).min(1, 'Payment method is required'),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

// Format date from ISO to DD-MMM-YYYY (e.g., "01-Jan-2026")
const formatDateForDisplay = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = String(date.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateString;
  }
};

// Convert DD-MMM-YYYY or ISO to dd/mm/yyyy for form
const convertDateForForm = (dateString: string): string => {
  try {
    // Try ISO format first
    const isoDate = new Date(dateString);
    if (!isNaN(isoDate.getTime())) {
      const day = String(isoDate.getDate()).padStart(2, '0');
      const month = String(isoDate.getMonth() + 1).padStart(2, '0');
      const year = isoDate.getFullYear();
      return `${day}/${month}/${year}`;
    }
    
    // Try DD-MMM-YYYY format
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = months.findIndex(m => m === parts[1]);
      if (monthIndex !== -1) {
        const month = String(monthIndex + 1).padStart(2, '0');
        const year = parts[2];
        return `${day}/${month}/${year}`;
      }
    }
    
    return dateString;
  } catch {
    return dateString;
  }
};

export default function PaymentMatching() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentMatching | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentMatching[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      paymentDate: '',
      invoiceNumber: '',
      customerName: '',
      paymentMethod: 'Credit Card',
      amount: '',
    },
  });

  // Fetch payments from API
  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[PaymentMatching] Fetching payments...');
      const response: ApiResponse<PaymentMatchingType[]> = await transactionService.getPaymentMatchings();
      console.log('[PaymentMatching] API Response:', response);
      
      if (response.success && response.data && Array.isArray(response.data)) {
        const paymentsData: PaymentMatching[] = response.data.map(payment => {
          // Format date as DD-MMM-YYYY (e.g., "01-Jan-2026")
          const formattedDate = formatDateForDisplay(payment.paymentDate);
          
          // Format amount
          let formattedAmount: string;
          if (typeof payment.amount === 'number') {
            formattedAmount = payment.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          } else if (typeof payment.amount === 'string') {
            const numAmount = parseFloat(payment.amount);
            formattedAmount = isNaN(numAmount) ? payment.amount : numAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
          } else {
            formattedAmount = String(payment.amount);
          }
          
          return {
            ...payment,
            id: String(payment.id),
            date: formattedDate,
            amountFormatted: formattedAmount,
          };
        });
        console.log('[PaymentMatching] Processed payments:', paymentsData);
        setPayments(paymentsData);
      } else {
        const errorMsg = response?.message || 'Failed to fetch payments';
        console.error('[PaymentMatching] API error:', errorMsg);
        setError(errorMsg);
        setPayments([]);
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.error || 'Failed to fetch payments';
      console.error('[PaymentMatching] Error fetching payments:', err);
      setError(errorMessage);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const onSubmit = useCallback(async (data: PaymentFormData) => {
    try {
      setIsSubmitting(true);
      setError(null);

      // Prepare payload - all required fields must be included
      // Keep date in dd/mm/yyyy format as API expects
      const payload: any = {
        paymentDate: data.paymentDate, // Keep as dd/mm/yyyy format
        customerName: data.customerName,
        paymentMethod: data.paymentMethod,
        amount: parseFloat(data.amount.replace(/,/g, '')),
      };

      // Add invoiceNumber if provided
      if (data.invoiceNumber && data.invoiceNumber.trim()) {
        payload.invoiceNumber = data.invoiceNumber.trim();
      }

      console.log('[PaymentMatching] Payload being sent:', JSON.stringify(payload, null, 2));

      let response: ApiResponse<PaymentMatchingType>;
      
      if (editingPayment) {
        console.log('[PaymentMatching] Updating payment:', editingPayment.id, payload);
        response = await transactionService.updatePaymentMatching(String(editingPayment.id), payload);
      } else {
        console.log('[PaymentMatching] Creating payment:', payload);
        response = await transactionService.createPaymentMatching(payload);
      }

      if (response.success && response.data) {
        const updatedPayment: PaymentMatching = {
          ...response.data,
          id: String(response.data.id),
          date: formatDateForDisplay(response.data.paymentDate),
          amountFormatted: typeof response.data.amount === 'number'
            ? response.data.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : typeof response.data.amount === 'string'
            ? parseFloat(response.data.amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
            : String(response.data.amount),
        };

        if (editingPayment) {
          setPayments(prevPayments =>
            prevPayments.map(payment =>
              payment.id === editingPayment.id ? updatedPayment : payment
            )
          );
        } else {
          setPayments(prevPayments => [updatedPayment, ...prevPayments]);
        }

        setIsModalOpen(false);
        form.reset();
        setEditingPayment(null);
        setError(null);
        
        // Refetch to ensure consistency
        fetchPayments().catch(err => console.error('Error refetching after save:', err));
      } else {
        const errorMsg = response.message || 'Failed to save payment';
        setError(errorMsg);
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.error || 'Failed to save payment';
      console.error('[PaymentMatching] Error saving payment:', err);
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [editingPayment, form, fetchPayments]);

  const handleEdit = useCallback((payment: PaymentMatching) => {
    setEditingPayment(payment);
    const formDate = convertDateForForm(payment.paymentDate);
    form.reset({
      paymentDate: formDate,
      invoiceNumber: payment.invoiceNumber || '',
      customerName: payment.customerName,
      paymentMethod: payment.paymentMethod,
      amount: typeof payment.amount === 'number' 
        ? payment.amount.toString() 
        : typeof payment.amount === 'string'
        ? payment.amount.replace(/,/g, '')
        : '',
    });
    setError(null);
    setIsModalOpen(true);
  }, [form]);

  const handleAddNew = useCallback(() => {
    setEditingPayment(null);
    form.reset({
      paymentDate: '',
      invoiceNumber: '',
      customerName: '',
      paymentMethod: 'Credit Card',
      amount: '',
    });
    setError(null);
    setIsModalOpen(true);
  }, [form]);

  const handleDeleteClick = useCallback((id: string) => {
    setDeletingPaymentId(id);
    setError(null);
    setIsDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingPaymentId) return;

    try {
      setIsDeleting(true);
      setError(null);
      const response: ApiResponse<void> = await transactionService.deletePaymentMatching(deletingPaymentId);
      
      if (response.success) {
        setPayments(prevPayments =>
          prevPayments.filter(payment => payment.id !== deletingPaymentId)
        );
        setDeletingPaymentId(null);
        setIsDeleteModalOpen(false);
      } else {
        setError(response.message || 'Failed to delete payment');
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.error || 'Failed to delete payment';
      setError(errorMessage);
      console.error('Error deleting payment:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [deletingPaymentId]);

  const handleModalClose = useCallback((open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      form.reset();
      setEditingPayment(null);
      setError(null);
    }
  }, [form]);

  const getPaymentDescription = useCallback(() => {
    if (!deletingPaymentId) return '';
    const payment = payments.find(p => p.id === deletingPaymentId);
    return payment ? `${payment.customerName} - ${payment.date || payment.paymentDate}` : '';
  }, [deletingPaymentId, payments]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 pl-8">Sales Invoice amount paid against GCEC Purchase Bills</h2>
        <Button
          onClick={handleAddNew}
          className="bg-[#eab308] hover:bg-[#d4a007] text-white flex items-center space-x-2 transition-colors"
          disabled={loading}
        >
          <Plus className="w-4 h-4 text-black" />
          <span className="text-black">Add New</span>
        </Button>
      </div>

      {error && !isModalOpen && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
          <p className="text-base text-red-600">{error}</p>
        </div>
      )}

      {/* Payments Table */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eab308] border-0 hover:bg-[#d4a007]">
                  <TableHead className="font-semibold text-black text-base text-left py-4">
                    Payment Date
                  </TableHead>
                  <TableHead className="font-semibold text-black text-base text-left py-4">
                    Customer Name
                  </TableHead>
                  <TableHead className="font-semibold text-black text-base text-left py-4">
                    Payment Method
                  </TableHead>
                  <TableHead className="font-semibold text-black text-base text-left py-4">
                    Amount (AED)
                  </TableHead>
                  <TableHead className="font-semibold text-black text-base text-left py-4">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                      <p className="text-base text-gray-500">Loading payments...</p>
                    </TableCell>
                  </TableRow>
                ) : !Array.isArray(payments) || payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <p className="text-base text-gray-500 mb-1">No payments found.</p>
                      <p className="text-sm text-gray-400">Click "Add New" to create your first payment.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((payment) => (
                    <TableRow
                      key={payment.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <TableCell className="text-base py-4 text-left text-gray-700">
                        {payment.date || formatDateForDisplay(payment.paymentDate)}
                      </TableCell>
                      <TableCell className="text-base py-4 text-left text-gray-700">
                        {payment.customerName}
                      </TableCell>
                      <TableCell className="text-gray-600 text-base py-4 text-left">
                        {payment.paymentMethod}
                      </TableCell>
                      <TableCell className="text-gray-700 font-semibold text-base py-4 text-left">
                        {payment.amountFormatted || (typeof payment.amount === 'number' 
                          ? payment.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                          : payment.amount)} AED
                      </TableCell>
                      <TableCell className="text-base py-4 text-left">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleEdit(payment)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                            title="Edit payment"
                            aria-label={`Edit ${payment.customerName}`}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(String(payment.id))}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                            title="Delete payment"
                            aria-label={`Delete ${payment.customerName}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Payment Matching Modal */}
      <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              {editingPayment ? 'Update Credit Card Payment' : 'Add Credit Card Payment'}
            </DialogTitle>
          </DialogHeader>
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-base text-red-600">{error}</p>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              {/* Payment Date Field */}
              <FormField
                control={form.control}
                name="paymentDate"
                render={({ field }) => {
                  // Convert dd/mm/yyyy string to Date object
                  const parseDate = (dateString: string): Date | null => {
                    if (!dateString || dateString.length !== 10) return null;
                    const parts = dateString.split('/');
                    if (parts.length !== 3) return null;
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10);
                    const year = parseInt(parts[2], 10);
                    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
                    return new Date(year, month - 1, day);
                  };

                  // Convert Date object to dd/mm/yyyy string
                  const formatDate = (date: Date | null): string => {
                    if (!date || isNaN(date.getTime())) return '';
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    return `${day}/${month}/${year}`;
                  };

                  const [selectedDate, setSelectedDate] = useState<Date | null>(() =>
                    parseDate(field.value)
                  );
                  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

                  // Sync selectedDate with field.value when field changes externally
                  useEffect(() => {
                    const parsed = parseDate(field.value);
                    if (parsed) {
                      const currentTime = selectedDate?.getTime();
                      const parsedTime = parsed.getTime();
                      if (!currentTime || currentTime !== parsedTime) {
                        setSelectedDate(parsed);
                      }
                    } else if (field.value === '' && selectedDate !== null) {
                      setSelectedDate(null);
                    }
                    // eslint-disable-next-line react-hooks/exhaustive-deps
                  }, [field.value]);

                  const handleDateSelect = (date: Date | null) => {
                    if (date && !isNaN(date.getTime())) {
                      setSelectedDate(date);
                      const formatted = formatDate(date);
                      field.onChange(formatted);
                      setIsPopoverOpen(false);
                    }
                  };

                  return (
                    <FormItem>
                      <FormLabel className="text-base font-medium text-gray-700">
                        Payment Date <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                          <div className="relative">
                            <Input
                              placeholder="dd/mm/yyyy"
                              value={field.value}
                              onChange={(e) => {
                                let value = e.target.value.replace(/\D/g, '');
                                if (value.length >= 2) value = value.slice(0, 2) + '/' + value.slice(2);
                                if (value.length >= 5) value = value.slice(0, 5) + '/' + value.slice(5, 9);
                                field.onChange(value);
                                if (value.length === 10) {
                                  const date = parseDate(value);
                                  if (date) {
                                    setSelectedDate(date);
                                  }
                                }
                              }}
                              maxLength={10}
                              className="w-full pr-10"
                              disabled={isSubmitting}
                            />
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer z-10"
                              >
                                <CalendarIcon className="w-5 h-5 text-black" />
                              </button>
                            </PopoverTrigger>
                          </div>
                          <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                              date={selectedDate}
                              onSelect={handleDateSelect}
                            />
                          </PopoverContent>
                        </Popover>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Invoice Number Field */}
              <FormField
                control={form.control}
                name="invoiceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Invoice Number
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="INV-001"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Customer Name Field */}
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Customer Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Ahmed Trading LLC"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payment Method Field */}
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Payment Method <span className="text-red-500">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select payment method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Credit Card">Credit Card</SelectItem>
                        <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Cheque">Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount Field */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium text-gray-700">
                      Amount (AED) <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <div className="flex justify-end space-x-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleModalClose(false)}
                  disabled={isSubmitting}
                  className="px-6 text-black"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#eab308] hover:bg-[#d4a007] text-black px-6"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {editingPayment ? 'Updating...' : 'Saving...'}
                    </>
                  ) : (
                    editingPayment ? 'Update Credit Card Payment' : 'Add Credit Card Payment'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        onConfirm={handleDeleteConfirm}
        itemName={getPaymentDescription()}
        isLoading={isDeleting}
      />
    </Layout>
  );
}
