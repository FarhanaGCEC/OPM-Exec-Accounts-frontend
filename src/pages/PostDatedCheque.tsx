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

interface PostDatedCheque {
  id: string;
  chequeDate: string;
  chequeNumber: string;
  customerName: string;
  amount: string;
  chequeType: string;
}

// Zod validation schema
const chequeSchema = z.object({
  chequeDate: z.string()
    .min(10, 'Cheque date is required')
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be in dd/mm/yyyy format'),
  chequeNumber: z.string()
    .min(1, 'Cheque number is required')
    .min(3, 'Cheque number must be at least 3 characters'),
  customerName: z.string()
    .min(1, 'Customer name is required')
    .min(3, 'Customer name must be at least 3 characters'),
  amount: z.string()
    .min(1, 'Amount is required')
    .refine((val) => {
      const num = parseFloat(val.replace(/,/g, ''));
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than 0'),
  chequeType: z.string({
    required_error: 'Please select a cheque type',
  }).min(1, 'Cheque type is required'),
});

type ChequeFormData = z.infer<typeof chequeSchema>;

export default function PostDatedCheque() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const form = useForm<ChequeFormData>({
    resolver: zodResolver(chequeSchema),
    defaultValues: {
      chequeDate: '',
      chequeNumber: '',
      customerName: '',
      amount: '',
      chequeType: 'Payment Cheque',
    },
  });

  const [cheques, setCheques] = useState<PostDatedCheque[]>([
    {
      id: '1',
      chequeDate: '15-Mar-2024',
      chequeNumber: 'CHQ-2401',
      customerName: 'Emirates Trading Co.',
      amount: '25,000',
      chequeType: 'Payment Cheque',
    },
    {
      id: '2',
      chequeDate: '20-Mar-2024',
      chequeNumber: 'CHQ-2402',
      customerName: 'Ahmed Trading LLC',
      amount: '15,500',
      chequeType: 'Security Cheque',
    },
  ]);

  const onSubmit = (data: ChequeFormData) => {
    // Format amount with commas
    const formattedAmount = parseFloat(data.amount.replace(/,/g, '')).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    // Add new cheque
    const newCheque: PostDatedCheque = {
      id: Date.now().toString(),
      chequeDate: data.chequeDate,
      chequeNumber: data.chequeNumber,
      customerName: data.customerName,
      amount: formattedAmount,
      chequeType: data.chequeType,
    };
    setCheques([newCheque, ...cheques]);

    // Reset form and close modal
    form.reset();
    setIsModalOpen(false);
  };

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Post-Dated Cheque</h2>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#eab308] hover:bg-[#eab308] text-white flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add New</span>
        </Button>
      </div>

      {/* Cheques Table */}
      <Card className="bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eab308] border-0">
                  <TableHead className="font-semibold text-white text-sm text-center py-4">
                    Cheque Date
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-center py-4">
                    Customer Name
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-center py-4">
                    Cheque Number
                  </TableHead>

                  <TableHead className="font-semibold text-white text-sm text-center py-4">
                    Amount (AED)
                  </TableHead>
                  <TableHead className="font-semibold text-white text-sm text-center py-4">
                    Remarks
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cheques.map((cheque) => {
                  const isSecurityCheque = cheque.chequeType === 'Security Cheque';
                  return (
                    <TableRow
                      key={cheque.id}
                      className={`border-b ${isSecurityCheque
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'border-gray-100 hover:bg-gray-50'
                        }`}
                    >
                      <TableCell className={`text-sm py-4 text-center ${isSecurityCheque ? 'text-white' : 'text-gray-700'
                        }`}>
                        {cheque.chequeDate}
                      </TableCell>
                      <TableCell className={`text-sm py-4 text-center ${isSecurityCheque ? 'text-white' : 'text-gray-700'
                        }`}>
                        {cheque.customerName}
                      </TableCell>
                      <TableCell className={`font-medium text-sm py-4 text-center ${isSecurityCheque ? 'text-white' : 'text-gray-700'
                        }`}>
                        {cheque.chequeNumber}
                      </TableCell>

                      <TableCell className={`font-semibold text-sm py-4 text-center ${isSecurityCheque ? 'text-white' : 'text-gray-700'
                        }`}>
                        {cheque.amount} AED
                      </TableCell>
                      <TableCell className={`text-sm py-4 text-center ${isSecurityCheque ? 'text-white' : 'text-gray-600'
                        }`}>
                        {cheque.chequeType === 'Security Cheque' ? 'Security Cheque' : ''}
                        { }
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Post-Dated Cheque Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          form.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Add Post-Dated Cheque
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              {/* Cheque Date Field */}
              <FormField
                control={form.control}
                name="chequeDate"
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
                    // Create date in local timezone to avoid timezone issues
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
                        Cheque Date
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

              {/* Cheque Number Field */}
              <FormField
                control={form.control}
                name="chequeNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Cheque Number
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="CHQ-2401"
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
                        placeholder="e.g., Emirates Trading Co."
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

              {/* Cheque Type Field */}
              <FormField
                control={form.control}
                name="chequeType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                      Cheque Type
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select cheque type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Payment Cheque">Payment Cheque</SelectItem>
                        <SelectItem value="Security Cheque">Security Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full bg-[#eab308]  text-white py-3 mt-6"
              >
                Save Cheque
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

