import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import TransactionDateField from '@/components/TransactionDateField';
import type { PayablesCategory } from '@/services/payablesService';
import type { ReceivablesCategory } from '@/services/receivablesService';
import type { FxAdcbPaymentType } from '@/lib/fxAdcbPaymentDetails';

const fxAdcbFormSchema = z
  .object({
    date: z
      .string()
      .min(8, 'Date is required')
      .regex(/^\d{2}\/\d{2}\/\d{2,4}$/, 'Date must be in dd/mm/yy format'),
    type: z.enum(['Debit', 'Credit'], {
      required_error: 'Please select a type',
    }),
    categoryId: z.string().min(1, 'Customer name is required'),
    paymentType: z.enum(['cash', 'cheque', 'banktransfer', 'dd'], {
      required_error: 'Please select a payment type',
    }),
    chequeNumber: z.string().optional(),
    amount: z.string().optional(),
    bankCharges: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const amountValue =
      data.amount && data.amount.trim() !== ''
        ? parseFloat(data.amount.replace(/,/g, ''))
        : 0;
    const bankChargesValue =
      data.bankCharges && data.bankCharges.trim() !== ''
        ? parseFloat(data.bankCharges.replace(/,/g, ''))
        : 0;
    const hasAmount = !isNaN(amountValue) && amountValue > 0;
    const hasBankCharges = !isNaN(bankChargesValue) && bankChargesValue > 0;

    if (!hasAmount && !hasBankCharges) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Enter an amount or bank charges greater than 0',
      });
    }

    if (hasAmount && data.paymentType === 'cheque' && !data.chequeNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chequeNumber'],
        message: 'Cheque number is required when payment type is cheque',
      });
    }
  });

export type FxAdcbFormValues = z.infer<typeof fxAdcbFormSchema>;

export const emptyFxAdcbFormValues: FxAdcbFormValues = {
  date: '',
  type: 'Debit',
  categoryId: '',
  paymentType: 'cash',
  chequeNumber: '',
  amount: '',
  bankCharges: '',
};

interface FxAdcbTransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currencyLabel: 'USD' | 'GBP';
  currencySymbol: '$' | '£';
  editing: boolean;
  initialValues: FxAdcbFormValues;
  payablesCategories: PayablesCategory[];
  receivablesCategories: ReceivablesCategory[];
  loadingCategories: boolean;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (values: FxAdcbFormValues) => Promise<void>;
}

export default function FxAdcbTransactionFormDialog({
  open,
  onOpenChange,
  currencyLabel,
  currencySymbol,
  editing,
  initialValues,
  payablesCategories,
  receivablesCategories,
  loadingCategories,
  isSubmitting,
  error,
  onSubmit,
}: FxAdcbTransactionFormDialogProps) {
  const form = useForm<FxAdcbFormValues>({
    resolver: zodResolver(fxAdcbFormSchema),
    defaultValues: emptyFxAdcbFormValues,
  });

  const transactionType = form.watch('type');
  const paymentType = form.watch('paymentType');

  const availableCategories = useMemo(() => {
    return transactionType === 'Debit' ? payablesCategories : receivablesCategories;
  }, [transactionType, payablesCategories, receivablesCategories]);

  useEffect(() => {
    if (!open) return;
    form.reset(initialValues);
  }, [open, initialValues, form]);

  useEffect(() => {
    const currentId = form.getValues('categoryId');
    if (!currentId) return;
    const stillValid = availableCategories.some((c) => String(c.id) === currentId);
    if (!stillValid) {
      form.setValue('categoryId', '');
    }
  }, [availableCategories, form]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      form.reset(emptyFxAdcbFormValues);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">
            {editing ? `Edit ${currencyLabel} Transaction` : `Add New ${currencyLabel} Transaction`}
          </DialogTitle>
        </DialogHeader>
        {error && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-lg text-red-600">{error}</p>
          </div>
        )}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg font-medium text-gray-700">Date</FormLabel>
                  <FormControl>
                    <TransactionDateField value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg font-medium text-gray-700">Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Credit">Credit</SelectItem>
                      <SelectItem value="Debit">Debit</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg font-medium text-gray-700">Customer Name</FormLabel>
                  <FormControl>
                    {loadingCategories ? (
                      <div className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-base">
                        <span className="text-muted-foreground">Loading categories...</span>
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : availableCategories.length === 0 ? (
                      <div className="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-base text-muted-foreground">
                        {transactionType === 'Debit'
                          ? 'No payables categories found. Please add categories in Payables List.'
                          : 'No receivables categories found. Please add categories in Receivables List.'}
                      </div>
                    ) : (
                      <SearchableSelect
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        placeholder="Select category"
                        disabled={loadingCategories}
                        searchPlaceholder="Search category..."
                      >
                        {availableCategories.map((category) => (
                          <SelectItem key={String(category.id)} value={String(category.id)}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SearchableSelect>
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg font-medium text-gray-700">Payment Type</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value as FxAdcbPaymentType);
                      if (value !== 'cheque') {
                        form.setValue('chequeNumber', '');
                      }
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select payment type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="banktransfer">Online</SelectItem>
                      <SelectItem value="dd">DD</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {paymentType === 'cheque' && (
              <FormField
                control={form.control}
                name="chequeNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg font-medium text-gray-700">Cheque Number</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter cheque number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg font-medium text-gray-700">
                    Amount ({currencySymbol})
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      placeholder="0"
                      value={field.value ?? ''}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      onChange={(e) => {
                        const next = e.target.value
                          .replace(/[^0-9.]/g, '')
                          .replace(/(\..*)\./g, '$1');
                        field.onChange(next);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bankCharges"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg font-medium text-gray-700">
                    Bank Charges ({currencySymbol})
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      placeholder="0"
                      value={field.value ?? ''}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      onChange={(e) => {
                        const next = e.target.value
                          .replace(/[^0-9.]/g, '')
                          .replace(/(\..*)\./g, '$1');
                        field.onChange(next);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="sm:col-span-2 w-full bg-[#f7c46d] hover:bg-[#c9a82f] text-black py-3 mt-2 font-semibold"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {editing ? 'Updating...' : 'Saving...'}
                </>
              ) : editing ? (
                'Update Transaction'
              ) : (
                'Save Transaction'
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function resolveFxAdcbCategoryId(
  description: string,
  type: 'Debit' | 'Credit' | '',
  payables: PayablesCategory[],
  receivables: ReceivablesCategory[]
): string {
  const name = description.trim().toLowerCase();
  if (!name) return '';

  const primary = type === 'Credit' ? receivables : payables;
  const fallback = type === 'Credit' ? payables : receivables;

  const inPrimary = primary.find((c) => c.name.trim().toLowerCase() === name);
  if (inPrimary) return String(inPrimary.id);

  const inFallback = fallback.find((c) => c.name.trim().toLowerCase() === name);
  return inFallback ? String(inFallback.id) : '';
}
