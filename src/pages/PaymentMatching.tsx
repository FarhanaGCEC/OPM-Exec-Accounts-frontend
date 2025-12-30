import { useState, useEffect } from 'react';
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
import { Plus, Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import Calendar from '../components/ui/calendar-tailwind';

interface PaymentMatching {
  id: string;
  paymentDate: string;
  invoiceNumber: string;
  customerName: string;
  paymentMethod: string;
  amount: string;
}

// Zod validation schema
const paymentSchema = z.object({
  paymentDate: z.string()
    .min(10, 'Payment date is required')
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in dd/mm/yyyy format'),
  invoiceNumber: z.string()
    .min(1, 'Invoice number is required')
    .min(3, 'Invoice number must be at least 3 characters'),
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

export default function PaymentMatching() {
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const [payments, setPayments] = useState<PaymentMatching[]>([
    {
      id: '1',
      paymentDate: '10-Jan-2024',
      invoiceNumber: 'INV-001',
      customerName: 'Ahmed Trading LLC',
      paymentMethod: 'Credit Card',
      amount: '12,500',
    },
    {
      id: '2',
      paymentDate: '15-Jan-2024',
      invoiceNumber: 'INV-002',
      customerName: 'Emirates Trading Co.',
      paymentMethod: 'Bank Transfer',
      amount: '8,750',
    },
  ]);

  const onSubmit = (data: PaymentFormData) => {
    // Format amount with commas
    const formattedAmount = parseFloat(data.amount.replace(/,/g, '')).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    // Add new payment
    const newPayment: PaymentMatching = {
      id: Date.now().toString(),
      paymentDate: data.paymentDate,
      invoiceNumber: data.invoiceNumber,
      customerName: data.customerName,
      paymentMethod: data.paymentMethod,
      amount: formattedAmount,
    };
    setPayments([newPayment, ...payments]);

    // Reset form and close modal
    form.reset();
    setIsModalOpen(false);
  };

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Payment Matching</h2>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#eab308] text-white flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add New</span>
        </Button>
      </div>

      {/* Payments Table */}
      <Card className="bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eab308] border-0">
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Payment Date
                  </TableHead>

                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Customer Name
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Payment Method
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Amount (AED)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <TableCell className="text-gray-700 text-sm py-4 text-left">
                      {payment.paymentDate}
                    </TableCell>

                    <TableCell className="text-gray-700 text-sm py-4 text-left">
                      {payment.customerName}
                    </TableCell>
                    <TableCell className="text-gray-600 text-sm py-4 text-left">
                      Credit Card
                    </TableCell>
                    <TableCell className="text-gray-700 font-semibold text-sm py-4 text-left">
                      {payment.amount} AED
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Payment Matching Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          form.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Add Payment Matching
            </DialogTitle>
          </DialogHeader>
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
                      <FormLabel className="text-sm font-medium text-gray-700">
                        Payment Date
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
                                // Update selectedDate when user types a complete date
                                if (value.length === 10) {
                                  const date = parseDate(value);
                                  if (date) {
                                    setSelectedDate(date);
                                  }
                                }
                              }}
                              maxLength={10}
                              className="w-full pr-10"
                            />
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer z-10"
                              >
                                <CalendarIcon className="w-5 h-5" />
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
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Invoice Number
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="INV-001"
                        {...field}
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
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Customer Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Ahmed Trading LLC"
                        {...field}
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
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Payment Method
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
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Amount (AED)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full bg-[#eab308] text-white py-3 mt-6"
              >
                Save Payment
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

