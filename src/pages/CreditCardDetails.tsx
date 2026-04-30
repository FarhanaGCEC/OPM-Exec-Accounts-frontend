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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { Plus, Loader2, Calendar as CalendarIcon, Power, Filter, CircleMinus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../components/ui/select';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import { 
    creditCardService, 
    mapApiResponseToCreditCardDetail,
    type CreditCardDetail 
} from '../services/creditCardService';
import { canMutateRecords, isViewerRole, syncUserRoleFromSession } from '../lib/authPayload';

const creditCardSchema = z.object({
    issuingBank: z.string().min(1, 'Issuing Bank is required').trim(),
    cardHolder: z.string().min(1, 'MST is required').trim(),
    cardNumber: z.string().min(13, 'Card Number must be at least 13 digits').trim(),
    expiry_date: z.string().min(1, 'Expiry is required').trim(),
    
    amountLimit: z.union([
        z.number(),
        z.string().transform((val) => {
            if (val === '' || val === null || val === undefined) return null;
            const num = parseFloat(val);
            return isNaN(num) ? null : num;
        }),
    ]).optional().nullable(),
});

type CreditCardFormData = z.infer<typeof creditCardSchema>;

export default function CreditCardDetails() {
    const canMutate = canMutateRecords() || isViewerRole(syncUserRoleFromSession());
    const [creditCards, setCreditCards] = useState<CreditCardDetail[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCard, setEditingCard] = useState<CreditCardDetail | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isActivateModalOpen, setIsActivateModalOpen] = useState(false);
    const [activatingCardId, setActivatingCardId] = useState<string | null>(null);
    const [isActivating, setIsActivating] = useState(false);
    const [isExpiryPopoverOpen, setIsExpiryPopoverOpen] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'deactive'>('all');

    const form = useForm<CreditCardFormData>({
        resolver: zodResolver(creditCardSchema),
        defaultValues: {
            issuingBank: '',
            cardHolder: '',
            cardNumber: '',
            expiry_date: '',
           
            amountLimit: null,
        },
    });

    const fetchCreditCards = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await creditCardService.getCreditCards();
            
            if (response.success && response.data) {
                // Map API response (snake_case) to component interface (camelCase)
                const mappedCards = response.data.map(mapApiResponseToCreditCardDetail);
                setCreditCards(mappedCards);
            } else {
                setError('Failed to fetch credit card details');
                setCreditCards([]);
            }
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to fetch credit card details';
            console.error('Error fetching credit card details:', err);
            setError(errorMessage);
            setCreditCards([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCreditCards();
    }, [fetchCreditCards]);

    // Parse expiry date when modal opens or form value changes
    useEffect(() => {
        if (isModalOpen) {
            const expiryValue = form.watch('expiry_date');
            if (expiryValue) {
                const { month, year } = parseExpiryDate(expiryValue);
                setSelectedMonth(month);
                setSelectedYear(year);
            }
        }
    }, [isModalOpen, form]);

    const formatCardNumber = (cardNo: string) => {
        if (!cardNo) return '';
        // Return full card number as is (with spaces if present)
        return cardNo;
    };

 

    // Helper functions for expiry date
    const parseExpiryDate = (expiryDate: string): { month: number | null; year: number | null } => {
        if (!expiryDate) return { month: null, year: null };
        
        // Parse formats like "Feb-28", "Feb-2028", "02-28", "02-2028"
        const parts = expiryDate.split('-');
        if (parts.length !== 2) return { month: null, year: null };
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthPart = parts[0].trim();
        const yearPart = parts[1].trim();
        
        // Try to parse month
        let month: number | null = null;
        const monthIndex = monthNames.findIndex(m => m.toLowerCase() === monthPart.toLowerCase());
        if (monthIndex !== -1) {
            month = monthIndex;
        } else {
            const monthNum = parseInt(monthPart);
            if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
                month = monthNum - 1; // Convert to 0-based index
            }
        }
        
        // Parse year (handle 2-digit and 4-digit)
        let year: number | null = null;
        const yearNum = parseInt(yearPart);
        if (!isNaN(yearNum)) {
            if (yearNum < 100) {
                // 2-digit year, assume 2000s
                year = 2000 + yearNum;
            } else {
                year = yearNum;
            }
        }
        
        return { month, year };
    };

    const formatExpiryDate = (month: number | null, year: number | null): string => {
        if (month === null || year === null) return '';
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const lastTwoDigits = year % 100;
        return `${monthNames[month]}-${lastTwoDigits}`;
    };

    const handleExpiryDateSelect = (month: number, year: number) => {
        const formatted = formatExpiryDate(month, year);
        form.setValue('expiry_date', formatted);
        setSelectedMonth(month);
        setSelectedYear(year);
        setIsExpiryPopoverOpen(false);
    };

   

    const handleDeleteConfirm = useCallback(async () => {
        if (!deletingCardId) return;

        try {
            setIsDeleting(true);
            setError(null);
            
            // Log the ID being sent for debugging
            console.log('[CreditCardDetails] Deactivating card with ID:', deletingCardId);
            console.log('[CreditCardDetails] ID type:', typeof deletingCardId);
            
            const response = await creditCardService.deleteCreditCard(deletingCardId);
            
            if (response.success) {
                // Update the card's isActive status instead of removing it
                setCreditCards(prevCards =>
                    prevCards.map(card => 
                        card.id === deletingCardId 
                            ? { ...card, isActive: false }
                            : card
                    )
                );
                setDeletingCardId(null);
                setIsDeleteModalOpen(false);
            } else {
                setError(response.message || 'Failed to deactivate credit card');
            }
        } catch (err: any) {
            const errorMessage = err?.message || err?.error || 'Failed to deactivate credit card';
            setError(errorMessage);
            console.error('[CreditCardDetails] Error deactivating credit card:', err);
            console.error('[CreditCardDetails] Error details:', {
                message: err?.message,
                status: err?.status,
                response: err?.response
            });
        } finally {
            setIsDeleting(false);
        }
    }, [deletingCardId]);

    const handleActivate = useCallback((cardId: string) => {
        setActivatingCardId(cardId);
        setIsActivateModalOpen(true);
    }, []);

    const handleActivateConfirm = useCallback(async () => {
        if (!activatingCardId) return;

        try {
            setIsActivating(true);
            setError(null);
            const response = await creditCardService.activateCreditCard(activatingCardId);
            
            if (response.success) {
                // Update the card's isActive status
                setCreditCards(prevCards =>
                    prevCards.map(card => 
                        card.id === activatingCardId 
                            ? { ...card, isActive: true }
                            : card
                    )
                );
                setActivatingCardId(null);
                setIsActivateModalOpen(false);
            } else {
                setError(response.message || 'Failed to activate credit card');
            }
        } catch (err: any) {
            const errorMessage = err?.message || err?.error || 'Failed to activate credit card';
            setError(errorMessage);
            console.error('[CreditCardDetails] Error activating credit card:', err);
        } finally {
            setIsActivating(false);
        }
    }, [activatingCardId]);

    // Get the card name for the delete confirmation dialog
    const deletingCardName = deletingCardId 
        ? (() => {
            const card = creditCards.find(c => c.id === deletingCardId);
            return card ? `${card.issuingBank} - ${formatCardNumber(card.cardNo)}` : '';
        })()
        : '';

    // Get the card name for the activate confirmation dialog
    const activatingCardName = activatingCardId 
        ? (() => {
            const card = creditCards.find(c => c.id === activatingCardId);
            return card ? `${card.issuingBank} - ${formatCardNumber(card.cardNo)}` : '';
        })()
        : '';

    const handleModalClose = useCallback(() => {
        setIsModalOpen(false);
        setEditingCard(null);
        setError(null);
        setSelectedMonth(null);
        setSelectedYear(null);
        setIsExpiryPopoverOpen(false);
        form.reset({
            issuingBank: '',
            cardHolder: '',
            cardNumber: '',
            expiry_date: '',
            amountLimit: null,
        });
    }, [form]);

    const handleAddClick = useCallback(() => {
        setEditingCard(null);
        setError(null);
        setSelectedMonth(null);
        setSelectedYear(null);
        setIsExpiryPopoverOpen(false);
        form.reset({
            issuingBank: '',
            cardHolder: '',
            cardNumber: '',
            expiry_date: '',
            amountLimit: null,
        });
        setIsModalOpen(true);
    }, [form]);

  

    const onSubmit = useCallback(async (data: CreditCardFormData) => {
        try {
            setIsSubmitting(true);
            setError(null);

            const payload = {
                issuingBank: data.issuingBank,
                cardHolder: data.cardHolder,
                cardNumber: data.cardNumber,
                expiry_date: data.expiry_date,
                ...(data.amountLimit !== null && data.amountLimit !== undefined && { amountLimit: Number(data.amountLimit) }),
            };

            let response;
            if (editingCard) {
                // Update existing card
                response = await creditCardService.updateCreditCard(editingCard.id, payload);
            } else {
                // Create new card
                response = await creditCardService.createCreditCard(payload);
            }

            if (response.success) {
                // Refresh the list
                await fetchCreditCards();
                handleModalClose();
            } else {
                setError(response.message || 'Failed to save credit card');
            }
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to save credit card';
            setError(errorMessage);
            console.error('Error saving credit card:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [editingCard, fetchCreditCards, handleModalClose]);

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
                <div className="flex items-center gap-4 ml-16">
                    <h2 className="text-2xl font-bold text-gray-900">Credit Card Details</h2>
                </div>
                {canMutate && (
                    <Button
                        onClick={handleAddClick}
                        className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black flex items-center space-x-2 transition-colors rounded-lg mr-4"
                        disabled={loading}
                    >
                        <Plus className="w-4 h-4 text-black" />
                        <span>Add New</span>
                    </Button>
                )}
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}

            {/* Filter Section */}
            <div className="mb-4 mx-8 flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <Filter className="w-5 h-5 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">Filter by Status:</span>
                </div>
                <Select value={statusFilter} onValueChange={(value: 'all' | 'active' | 'deactive') => setStatusFilter(value)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Cards</SelectItem>
                        <SelectItem value="active">Active Only</SelectItem>
                        <SelectItem value="deactive">Deactive Only</SelectItem>
                    </SelectContent>
                </Select>
                <span className="text-sm text-gray-500">
                    {(() => {
                        const filtered = creditCards.filter(card => {
                            if (statusFilter === 'all') return true;
                            if (statusFilter === 'active') return card.isActive;
                            return !card.isActive;
                        });
                        return `Showing ${filtered.length} of ${creditCards.length} cards`;
                    })()}
                </span>
            </div>

            <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                <CardContent className="p-0">
                    <div className="overflow-x-auto rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-[#f7c46d] border-0 hover:bg-[#c9a82f]">
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Issuing Bank
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Card Holder
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Card no
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Expiry
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                        Status
                                    </TableHead>
                                    {canMutate && (
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Actions
                                        </TableHead>
                                    )}
                                  
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-4">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                            <p className="text-sm text-gray-500">Loading credit card details...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : !Array.isArray(creditCards) || creditCards.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-4">
                                            <p className="text-sm text-gray-500 mb-1">No credit card details found.</p>
                                            <p className="text-sm text-gray-400">Click "Add New" to add your first credit card.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (() => {
                                    // Filter cards based on status
                                    const filteredCards = creditCards.filter(card => {
                                        if (statusFilter === 'all') return true;
                                        if (statusFilter === 'active') return card.isActive;
                                        return !card.isActive;
                                    });

                                    if (filteredCards.length === 0) {
                                        return (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-4">
                                                    <p className="text-sm text-gray-500 mb-1">
                                                        No {statusFilter === 'active' ? 'active' : 'deactive'} credit cards found.
                                                    </p>
                                                    {statusFilter !== 'all' && (
                                                        <p className="text-sm text-gray-400">Try selecting a different filter.</p>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    }

                                    return filteredCards.map((card) => (
                                        <TableRow
                                            key={card.id}
                                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                        >
                                            <TableCell className="text-gray-700 font-medium text-sm py-2 text-left">
                                                {card.issuingBank}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                            {card.cardHolder === 'Suleman' ? 'MST' : card.cardHolder}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                {formatCardNumber(card.cardNo)}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                {card.expiry_date && card.expiry_date.trim() ? card.expiry_date : '-'}
                                            </TableCell>
                                            <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                    card.isActive 
                                                        ? 'bg-green-100 text-green-800' 
                                                        : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {card.isActive ? 'Active' : 'Deactive'}
                                                </span>
                                            </TableCell>
                                            {canMutate && (
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    <div className="flex items-center gap-2">
                                                        {card.isActive ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setDeletingCardId(card.id);
                                                                    setIsDeleteModalOpen(true);
                                                                }}
                                                                className="text-red-600 hover:text-red-700 "
                                                                disabled={isDeleting}
                                                            >
                                                                <CircleMinus className="w-4 h-4 mr-1" />
                                                              
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="outline" 
                                                                size="sm"
                                                                onClick={() => handleActivate(card.id)}
                                                                className="text-green-600 hover:text-green-700 "
                                                                disabled={isActivating}
                                                            >
                                                                <Power className="w-4 h-4 mr-1" />
                                                               
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ));
                                })()}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
                <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-gray-900">
                            {editingCard ? 'Edit Credit Card' : 'Add Credit Card'}
                        </DialogTitle>
                    </DialogHeader>
                    {error && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                            <p className="text-base text-red-600">{error}</p>
                        </div>
                    )}
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                            <FormField
                                control={form.control}
                                name="issuingBank"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Issuing Bank
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter Issuing Bank"
                                                {...field}
                                                disabled={isSubmitting}
                                                autoFocus
                                                className="focus-visible:ring-2 focus-visible:ring-[#f7c46d]"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="cardHolder"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Card Holder
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter Card Holder Name"
                                                {...field}
                                                disabled={isSubmitting}
                                                className="focus-visible:ring-2 focus-visible:ring-[#f7c46d]"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="cardNumber"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Card Number
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter Card Number"
                                                {...field}
                                                disabled={isSubmitting}
                                                className="focus-visible:ring-2 focus-visible:ring-[#f7c46d]"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="expiry_date"
                                render={({ field }) => {
                                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                    const currentYear = new Date().getFullYear();
                                    const years = Array.from({ length: 20 }, (_, i) => currentYear + i);
                                    
                                    return (
                                        <FormItem>
                                            <FormLabel className="text-base font-medium text-gray-700">
                                                Expiry
                                            </FormLabel>
                                            <FormControl>
                                                <Popover open={isExpiryPopoverOpen} onOpenChange={setIsExpiryPopoverOpen}>
                                                    <div className="relative">
                                                        <Input
                                                            placeholder="e.g., Feb-28"
                                                            value={field.value}
                                                            onChange={(e) => {
                                                                field.onChange(e.target.value);
                                                                const { month, year } = parseExpiryDate(e.target.value);
                                                                setSelectedMonth(month);
                                                                setSelectedYear(year);
                                                            }}
                                                            disabled={isSubmitting}
                                                            className="focus-visible:ring-2 focus-visible:ring-[#f7c46d] pr-10"
                                                        />
                                                        <PopoverTrigger asChild>
                                                            <button
                                                                type="button"
                                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer z-10"
                                                                disabled={isSubmitting}
                                                            >
                                                                <CalendarIcon className="w-5 h-5 text-gray-600" />
                                                            </button>
                                                        </PopoverTrigger>
                                                    </div>
                                                    <PopoverContent className="w-auto p-4" align="start">
                                                        <div className="space-y-4">
                                                            {/* Year Selection */}
                                                            <div>
                                                                <div className="text-sm font-semibold text-gray-700 mb-2">Select Year</div>
                                                                <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                                                                    {years.map((year) => (
                                                                        <button
                                                                            key={year}
                                                                            onClick={() => {
                                                                                setSelectedYear(year);
                                                                                if (selectedMonth !== null) {
                                                                                    handleExpiryDateSelect(selectedMonth, year);
                                                                                }
                                                                            }}
                                                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                                                selectedYear === year
                                                                                    ? 'bg-[#f7c46d] text-black'
                                                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                                            }`}
                                                                        >
                                                                            {year}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Month Selection */}
                                                            <div>
                                                                <div className="text-sm font-semibold text-gray-700 mb-2">Select Month</div>
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    {monthNames.map((month, index) => (
                                                                        <button
                                                                            key={index}
                                                                            onClick={() => {
                                                                                setSelectedMonth(index);
                                                                                if (selectedYear !== null) {
                                                                                    handleExpiryDateSelect(index, selectedYear);
                                                                                }
                                                                            }}
                                                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                                                selectedMonth === index
                                                                                    ? 'bg-[#f7c46d] text-black'
                                                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                                            }`}
                                                                        >
                                                                            {month}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Selected Display */}
                                                            {selectedMonth !== null && selectedYear !== null && (
                                                                <div className="pt-2 border-t">
                                                                    <div className="text-xs text-gray-600 mb-1">Selected:</div>
                                                                    <div className="font-semibold text-gray-900">
                                                                        {formatExpiryDate(selectedMonth, selectedYear)}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    );
                                }}
                            />
                         
                            <FormField
                                control={form.control}
                                name="amountLimit"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Amount Limit (Optional)
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                pattern="[0-9]*[.]?[0-9]*"
                                                placeholder="Enter Amount Limit"
                                                disabled={isSubmitting}
                                                value={field.value !== null && field.value !== undefined ? String(field.value) : ''}
                                                onChange={(e) => {
                                                    const value = e.target.value
                                                      .replace(/[^0-9.]/g, '')
                                                      .replace(/(\..*)\./g, '$1');
                                                    if (value === '' || value === null || value === undefined) {
                                                        field.onChange(null);
                                                    } else {
                                                        const numValue = parseFloat(value);
                                                        field.onChange(isNaN(numValue) ? null : numValue);
                                                    }
                                                }}
                                                onBlur={field.onBlur}
                                                className="focus-visible:ring-2 focus-visible:ring-[#f7c46d]"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="flex justify-end space-x-3 pt-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleModalClose}
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {editingCard ? 'Updating...' : 'Adding...'}
                                        </>
                                    ) : (
                                        editingCard ? 'Update' : 'Add'
                                    )}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <DeleteConfirmationDialog
                open={isDeleteModalOpen}
                onOpenChange={setIsDeleteModalOpen}
                onConfirm={handleDeleteConfirm}
                title="Deactivate Credit Card"
                description={deletingCardName 
                    ? `Are you sure you want to deactivate the credit card "${deletingCardName}"? This card will be marked as deactive, but you can activate it again later if needed.`
                    : 'Are you sure you want to deactivate this credit card? This card will be marked as deactive, but you can activate it again later if needed.'}
                itemName={deletingCardName}
                isLoading={isDeleting}
                confirmButtonText="Deactivate"
                loadingButtonText="Deactivating..."
            />

            <DeleteConfirmationDialog
                open={isActivateModalOpen}
                onOpenChange={setIsActivateModalOpen}
                onConfirm={handleActivateConfirm}
                title="Activate Credit Card"
                description={activatingCardName 
                    ? `Are you sure you want to activate the credit card "${activatingCardName}"? This card will be marked as active and will be available for use.`
                    : 'Are you sure you want to activate this credit card? This card will be marked as active and will be available for use.'}
                itemName={activatingCardName}
                isLoading={isActivating}
                confirmButtonText="Activate"
                loadingButtonText="Activating..."
                variant="activate"
            />
        </Layout>
    );
}
