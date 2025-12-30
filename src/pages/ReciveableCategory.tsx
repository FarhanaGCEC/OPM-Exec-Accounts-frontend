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
import { receivablesService, type ReceivablesCategory } from '../services/receivablesService';
import type { ApiResponse } from '../lib/api';

const categorySchema = z.object({
    name: z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name must not exceed 100 characters')
        .trim(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

export default function ReciveableCategory() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<ReceivablesCategory | null>(null);
    const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
    const [categories, setCategories] = useState<ReceivablesCategory[]>([]);
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
            console.log('[ReceivableCategory] Fetching categories...');
            const response: ApiResponse<ReceivablesCategory[]> = await receivablesService.getReceivables();
            console.log('[ReceivableCategory] API Response:', response);
            
            if (response.success && response.data && Array.isArray(response.data)) {
                // Convert id to string if it's a number (for consistency)
                const categoriesData: ReceivablesCategory[] = response.data.map(cat => ({
                    ...cat,
                    id: String(cat.id), // Convert id to string
                }));
                console.log('[ReceivableCategory] Setting categories:', categoriesData);
                setCategories(categoriesData);
            } else {
                const errorMsg = response?.message || 'Failed to fetch categories';
                console.error('[ReceivableCategory] API returned unsuccessful response:', errorMsg, response);
                setError(errorMsg);
                setCategories([]); // Set empty array on error
            }
        } catch (err: any) {
            // Handle both Error instances and ApiError objects
            const errorMessage = err?.message || err?.error || 'Failed to fetch categories';
            console.error('[ReceivableCategory] Error fetching categories:', err);
            setError(errorMessage);
            setCategories([]); // Set empty array on error
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch categories on component mount
    useEffect(() => {
        console.log('ReceivableCategory component mounted, fetching categories...');
        fetchCategories();
    }, [fetchCategories]);

    const onSubmit = useCallback(async (data: CategoryFormData) => {
        try {
            setIsSubmitting(true);
            setError(null);

            let response: ApiResponse<ReceivablesCategory>;

            if (editingCategory) {
                // Update existing category
                console.log('[ReceivableCategory] Updating category:', editingCategory.id, data);
                response = await receivablesService.updateReceivable(String(editingCategory.id), { name: data.name });
                console.log('[ReceivableCategory] Update response:', response);
                
                if (response.success && response.data) {
                    const updatedCategory = {
                        ...response.data,
                        id: String(response.data.id), // Ensure id is string
                    };
                    console.log('[ReceivableCategory] Updating state with:', updatedCategory);
                    setCategories(prevCategories => {
                        const updated = prevCategories.map(cat =>
                            cat.id === editingCategory.id ? updatedCategory : cat
                        );
                        console.log('[ReceivableCategory] Updated categories:', updated);
                        return updated;
                    });
                    setEditingCategory(null);
                    setIsModalOpen(false);
                    form.reset();
                    setError(null); // Clear any previous errors
                    // Refetch in background to ensure we have the latest data
                    fetchCategories().catch(err => console.error('Error refetching after update:', err));
                } else {
                    const errorMsg = response.message || 'Failed to update category';
                    console.error('[ReceivableCategory] Update failed:', errorMsg);
                    setError(errorMsg);
                }
            } else {
                // Create new category
                console.log('[ReceivableCategory] Creating category:', data);
                response = await receivablesService.createReceivable({ name: data.name });
                console.log('[ReceivableCategory] Create response:', response);
                
                if (response.success && response.data) {
                    const newCategory = {
                        ...response.data,
                        id: String(response.data.id), // Ensure id is string
                    };
                    console.log('[ReceivableCategory] Adding to state:', newCategory);
                    setCategories(prevCategories => {
                        const updated = [newCategory, ...prevCategories];
                        console.log('[ReceivableCategory] Updated categories:', updated);
                        return updated;
                    });
                    setIsModalOpen(false);
                    form.reset();
                    setError(null); // Clear any previous errors
                    // Refetch in background to ensure we have the latest data
                    fetchCategories().catch(err => console.error('Error refetching after create:', err));
                } else {
                    const errorMsg = response.message || 'Failed to create category';
                    console.error('[ReceivableCategory] Create failed:', errorMsg);
                    setError(errorMsg);
                }
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to save category';
            console.error('[ReceivableCategory] Error saving category:', err);
            setError(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    }, [editingCategory, form, fetchCategories]);

    const handleEdit = useCallback((category: ReceivablesCategory) => {
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
            const response: ApiResponse<void> = await receivablesService.deleteReceivable(deletingCategoryId);
            
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
            form.reset();
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
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">Receivables Category</h2>
                <Button
                    onClick={handleAddNew}
                    className="bg-[#eab308] hover:bg-[#d4a007] text-white flex items-center space-x-2 transition-colors"
                    disabled={loading}
                >
                    <Plus className="w-4 h-4" />
                    <span>Add New Category</span>
                </Button>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}

            <Card className="bg-white border border-gray-200 shadow-sm">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-[#eab308] border-0 hover:bg-[#d4a007]">
                                    <TableHead className="font-semibold text-white text-sm text-left py-4">
                                        Name
                                    </TableHead>
                                    <TableHead className="font-semibold text-white text-sm text-left py-4">
                                        Actions
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                            <p className="text-sm text-gray-500">Loading categories...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : !Array.isArray(categories) || categories.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8">
                                            <p className="text-sm text-gray-500 mb-1">No categories found.</p>
                                            <p className="text-xs text-gray-400">Click "Add New Category" to create your first category.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    categories.map((category) => (
                                        <TableRow
                                            key={category.id}
                                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                        >
                                            <TableCell className="text-gray-700 font-medium text-sm py-4 text-left">
                                                {category.name}
                                            </TableCell>
                                            <TableCell className="text-sm py-4 text-left">
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
                            {editingCategory ? 'Edit Receivables Category' : 'Add Receivables Category'}
                        </DialogTitle>
                    </DialogHeader>
                    {error && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                            <p className="text-sm text-red-600">{error}</p>
                        </div>
                    )}
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-medium text-gray-700">
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
                                    className="bg-[#eab308] hover:bg-[#d4a007] text-white px-6"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        editingCategory ? 'Update Category' : 'Create Category'
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
