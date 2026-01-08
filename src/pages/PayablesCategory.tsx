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
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import { payablesService, type PayablesCategory } from '../services/payablesService';
import type { ApiResponse } from '../lib/api';

const categorySchema = z.object({
    name: z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name must not exceed 100 characters')
        .trim(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

export default function PayablesCategory() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<PayablesCategory | null>(null);
    const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
    const [categories, setCategories] = useState<PayablesCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const form = useForm<CategoryFormData>({
        resolver: zodResolver(categorySchema),
        defaultValues: {
            name: '',
        },
    });

    const fetchCategories = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            console.log('[PayablesCategory] Fetching categories...');
            const response: ApiResponse<PayablesCategory[]> = await payablesService.getPayables();
            console.log('[PayablesCategory] Full API Response:', JSON.stringify(response, null, 2));
            
            // Handle response structure
            console.log('[PayablesCategory] Response success:', response.success);
            console.log('[PayablesCategory] Response data type:', typeof response.data);
            console.log('[PayablesCategory] Response data is array:', Array.isArray(response.data));
            
            if (response.success && response.data) {
                let categoriesData: PayablesCategory[] = [];
                
                // Handle if response.data is directly an array
                if (Array.isArray(response.data)) {
                    categoriesData = response.data.map((cat: PayablesCategory) => ({
                        ...cat,
                        id: String(cat.id),
                    }));
                } else if (typeof response.data === 'object') {
                    // Handle nested structure
                    const dataObj = response.data as any;
                    const dataArray = dataObj.data || dataObj.categories || [];
                    if (Array.isArray(dataArray)) {
                        categoriesData = dataArray.map((cat: PayablesCategory) => ({
                            ...cat,
                            id: String(cat.id),
                        }));
                    }
                }
                
                console.log('[PayablesCategory] Processed categories count:', categoriesData.length);
                console.log('[PayablesCategory] Categories:', categoriesData);
                setCategories(categoriesData);
            } else {
                const errorMsg = response?.message || 'Failed to fetch categories';
                console.error('[PayablesCategory] API error:', errorMsg);
                console.error('[PayablesCategory] Full response:', response);
                setError(errorMsg);
                setCategories([]);
            }
        } catch (err: any) {
            const errorMessage = err?.message || err?.error || 'Failed to fetch categories';
            console.error('[PayablesCategory] Error fetching categories:', err);
            setError(errorMessage);
            setCategories([]);
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch categories on component mount
    useEffect(() => {
        console.log('PayablesCategory component mounted, fetching categories...');
        fetchCategories();
    }, [fetchCategories]);

    const onSubmit = useCallback(async (data: CategoryFormData) => {
        try {
            setIsSubmitting(true);
            setError(null);

            let response: ApiResponse<PayablesCategory>;

            if (editingCategory) {
                // Update existing category
                console.log('[PayablesCategory] Updating category:', editingCategory.id, data);
                response = await payablesService.updatePayable(String(editingCategory.id), { name: data.name });
                console.log('[PayablesCategory] Update response:', response);
                
                if (response.success && response.data) {
                    const updatedCategory = {
                        ...response.data,
                        id: String(response.data.id), // Ensure id is string
                    };
                    console.log('[PayablesCategory] Updating state with:', updatedCategory);
                    setCategories(prevCategories => {
                        const updated = prevCategories.map(cat =>
                            cat.id === editingCategory.id ? updatedCategory : cat
                        );
                        console.log('[PayablesCategory] Updated categories:', updated);
                        return updated;
                    });
                    // Reset form with default values before closing
                    form.reset({
                        name: '',
                    });
                    setEditingCategory(null);
                    setError(null); // Clear any previous errors
                    setIsModalOpen(false);
                    // Refetch in background to ensure we have the latest data
                    fetchCategories().catch(err => console.error('Error refetching after update:', err));
                } else {
                    const errorMsg = response.message || 'Failed to update category';
                    console.error('[PayablesCategory] Update failed:', errorMsg);
                    setError(errorMsg);
                }
            } else {
                // Create new category
                console.log('[PayablesCategory] Creating category:', data);
                response = await payablesService.createPayable({ name: data.name });
                console.log('[PayablesCategory] Create response:', response);
                
                if (response.success && response.data) {
                    const newCategory = {
                        ...response.data,
                        id: String(response.data.id), // Ensure id is string
                    };
                    console.log('[PayablesCategory] Adding to state:', newCategory);
                    setCategories(prevCategories => {
                        const updated = [newCategory, ...prevCategories];
                        console.log('[PayablesCategory] Updated categories:', updated);
                        return updated;
                    });
                    // Reset form with default values before closing
                    form.reset({
                        name: '',
                    });
                    setEditingCategory(null);
                    setError(null); // Clear any previous errors
                    setIsModalOpen(false);
                    // Refetch in background to ensure we have the latest data
                    fetchCategories().catch(err => console.error('Error refetching after create:', err));
                } else {
                    const errorMsg = response.message || 'Failed to create category';
                    console.error('[PayablesCategory] Create failed:', errorMsg);
                    setError(errorMsg);
                }
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to save category';
            console.error('[PayablesCategory] Error saving category:', err);
            setError(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    }, [editingCategory, form, fetchCategories]);

    const handleEdit = useCallback((category: PayablesCategory) => {
        setEditingCategory(category);
        form.reset({ name: category.name });
        setError(null);
        setIsModalOpen(true);
    }, [form]);

    const handleAddNew = useCallback(() => {
        setEditingCategory(null);
        form.reset({ name: '' });
        setError(null);
        setIsModalOpen(true);
    }, [form]);

    const handleDeleteClick = useCallback((id: string) => {
        setDeletingCategoryId(id);
        setError(null);
        setIsDeleteModalOpen(true);
    }, []);

    const handleDeleteConfirm = useCallback(async () => {
        if (!deletingCategoryId) return;

        try {
            setIsDeleting(true);
            setError(null);
            const response: ApiResponse<void> = await payablesService.deletePayable(deletingCategoryId);
            
            if (response.success) {
                setCategories(prevCategories =>
                    prevCategories.filter(cat => cat.id !== deletingCategoryId)
                );
                setDeletingCategoryId(null);
                setIsDeleteModalOpen(false);
            } else {
                setError(response.message || 'Failed to delete category');
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to delete category';
            setError(errorMessage);
            console.error('Error deleting category:', err);
        } finally {
            setIsDeleting(false);
        }
    }, [deletingCategoryId]);

    const handleModalClose = useCallback((open: boolean) => {
        setIsModalOpen(open);
        if (!open) {
            // Reset form with default values when closing
            form.reset({
                name: '',
            });
            setEditingCategory(null);
            setError(null);
        }
    }, [form]);

    const getCategoryName = useCallback(() => {
        if (!deletingCategoryId) return '';
        const category = categories.find(cat => cat.id === deletingCategoryId);
        return category?.name || '';
    }, [deletingCategoryId, categories]);

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
      
          <h2 className="text-2xl font-bold text-gray-900">Payables Category</h2>
       </div>
            <Button
            onClick={handleAddNew}
            className="bg-[#eab308] hover:bg-[#d4a007] text-black flex items-center space-x-2 transition-colors rounded-lg mr-4"
            disabled={loading}
            >
            <Plus className="w-4 h-4 text-black" />
            <span>Add New</span>
            </Button>
        </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
                    <p className="text-md text-red-600">{error}</p>
                </div>
            )}

            <Card className="bg-white border border-gray-200 shadow-sm m-8">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-[#eab308] border-0 hover:bg-[#d4a007]">
                                    <TableHead className="font-semibold text-black text-md text-left py-4">
                                        Name
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-md text-left py-4">
                                        Actions
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                            <p className="text-md text-gray-500">Loading categories...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : !Array.isArray(categories) || categories.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8">
                                            <p className="text-md text-gray-500 mb-1">No categories found.</p>
                                            <p className="text-md text-gray-400">Click "Add New Category" to create your first category.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    categories.map((category) => (
                                        <TableRow
                                            key={category.id}
                                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                        >
                                            <TableCell className="text-gray-700 font-medium text-md py-4 text-left">
                                                {category.name}
                                            </TableCell>
                                            <TableCell className="text-md py-4 text-left">
                                                <div className="flex items-center space-x-2">
                                                    <button
                                                        onClick={() => handleEdit(category)}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                                        title="Edit category"
                                                        aria-label={`Edit ${category.name}`}
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteClick(String(category.id))}
                                                        className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                                                        title="Delete category"
                                                        aria-label={`Delete ${category.name}`}
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

            <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-gray-900">
                            {editingCategory ? 'Edit Payables Category' : 'Add Payables Category'}
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
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">
                                            Category Name
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Enter category name"
                                                {...field}
                                                disabled={isSubmitting}
                                                autoFocus
                                                className="focus-visible:ring-2 focus-visible:ring-[#eab308]"
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
                                    onClick={() => handleModalClose(false)}
                                    disabled={isSubmitting}
                                    className="px-6"
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
                                            Saving...
                                        </>
                                    ) : (
                                        editingCategory ? 'Update Payables Category' : 'Add Payables Category'
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
                itemName={getCategoryName()}
                isLoading={isDeleting}
            />
        </Layout>
    );
}
