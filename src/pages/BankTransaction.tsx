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

interface BankTransaction {
  id: string;
  date: string;
  type: 'Debit' | 'Credit';
  description: string;
  details: string;
  amount: string;
  balance: string;
}

// Zod validation schema
const transactionSchema = z.object({
  date: z.string()
    .min(10, 'Date is required')
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in dd/mm/yyyy format'),
  type: z.enum(['Debit', 'Credit'], {
    required_error: 'Please select a type',
  }),
  description: z.string()
    .min(1, 'Description is required')
    .min(3, 'Description must be at least 3 characters'),
  details: z.string()
    .min(1, 'Details/Reference is required')
    .min(3, 'Details must be at least 3 characters'),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

export default function BankTransaction() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const form = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      date: '',
      type: 'Debit',
      description: '',
      details: '',
      amount: '',
    },
  });

  const [transactions, setTransactions] = useState<BankTransaction[]>([
    {
      id: '1',
      date: '2024-01-05',
      type: 'Debit',
      description: 'Rent Payment - Al Khaleej Properties',
      details: 'Cheque #1234',
      amount: '8,500',
      balance: '41,500',
    },
    {
      id: '2',
      date: '2024-01-08',
      type: 'Credit',
      description: 'Customer Payment - Ahmed Trading LLC',
      details: 'Online Transfer',
      amount: '15,000',
      balance: '56,500',
    },
    {
      id: '3',
      date: '2024-01-12',
      type: 'Debit',
      description: 'Supplier Payment - Tech Solutions',
      details: 'Cheque #1235',
      amount: '12,000',
      balance: '44,500',
    },
  ]);

  const onSubmit = (data: TransactionFormData) => {
    // Format amount with commas
    const formattedAmount = parseFloat(data.amount.replace(/,/g, '')).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    // Add new transaction
    const newTransaction: BankTransaction = {
      id: Date.now().toString(),
      date: data.date,
      type: data.type,
      description: data.description,
      details: data.details,
      amount: formattedAmount,
      balance: '0', // Calculate based on previous balance
    };
    setTransactions([newTransaction, ...transactions]);

    // Reset form and close modal
    form.reset();
    setIsModalOpen(false);
  };

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Bank Transactions</h2>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#eab308] hover:bg-[#eab308] text-white flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add New</span>
        </Button>
      </div>

      {/* Transactions Table */}
      <Card className="bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eab308] border-0">
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Date
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Description
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Details
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Debit
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Credit
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-left py-4">
                    Balance
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((transaction) => (
                  <TableRow key={transaction.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <TableCell className="text-gray-700 text-sm py-4 text-left">
                      {transaction.date}
                    </TableCell>
                    <TableCell className="text-gray-700 font-medium text-sm py-4 text-left">
                      {transaction.description}
                    </TableCell>
                    <TableCell className="text-gray-600 text-sm py-4 text-left">
                      {transaction.details}
                    </TableCell>
                    <TableCell className="text-sm py-4 text-left">
                      {transaction.type === 'Debit' ? (
                        <span className="text-red-600 font-semibold">
                          {transaction.amount} AED
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm py-4 text-left">
                      {transaction.type === 'Credit' ? (
                        <span className="text-green-600 font-semibold">
                          {transaction.amount} AED
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-700 font-semibold text-sm py-4 text-left">
                      {transaction.balance} AED
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Bank Transaction Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          form.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Add Bank Transaction
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              {/* Date Field */}
              <FormField
                control={form.control}
                name="date"
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
                        Date
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

              {/* Type Field */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Type
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Debit">Debit (Money Out)</SelectItem>
                        <SelectItem value="Credit">Credit (Money In)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description Field */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Description
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Rent Payment, Customer Payment"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Details/Reference Field */}
              <FormField
                control={form.control}
                name="details"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Details / Reference
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Cheque #1234, Online Transfer"
                        {...field}
                      />
                    </FormControl>
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
                Save Transaction
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

