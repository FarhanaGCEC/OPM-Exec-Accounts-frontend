import { useState } from 'react';
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
import { Plus } from 'lucide-react';

interface PayablesCategory {
    id: string;
    name: string;
    description: string;
}

const categorySchema = z.object({
    name: z.string()
        .min(1, 'Name is required')
        .min(2, 'Name must be at least 2 characters'),
    description: z.string()
        .min(1, 'Description is required')
        .min(2, 'Description must be at least 2 characters'),
});

type CategoryFormData = z.infer<typeof categorySchema>;

export default function PayablesCategory() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [categories, setCategories] = useState<PayablesCategory[]>([
        { id: '1', name: 'Vendor A', description: 'Monthly payment for vendor services' },
        { id: '2', name: 'Supplier B', description: 'Payment for raw materials' },
        { id: '3', name: 'Consultant C', description: 'Monthly consulting fee' },
    ]);

    const form = useForm<CategoryFormData>({
        resolver: zodResolver(categorySchema),
        defaultValues: {
            name: '',
            description: '',
        },
    });

    const onSubmit = (data: CategoryFormData) => {
        const newCategory: PayablesCategory = {
            id: Date.now().toString(),
            name: data.name,
            description: data.description,
        };
        setCategories([newCategory, ...categories]);
        form.reset();
        setIsModalOpen(false);
    };

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">Payables Category</h2>
                <Button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-[#eab308] text-white flex items-center space-x-2"
                >
                    <Plus className="w-4 h-4" />
                    <span>Add New Category</span>
                </Button>
            </div>

            <Card className="bg-white border border-gray-200">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-[#eab308] border-0">
                                    <TableHead className="font-semibold text-white text-sm text-center py-4">
                                        Name
                                    </TableHead>
                                    <TableHead className="font-semibold text-white text-sm text-center py-4">
                                        Description
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {categories.map((category) => (
                                    <TableRow key={category.id} className="border-b border-gray-100 hover:bg-gray-50">
                                        <TableCell className="text-gray-700 font-medium text-sm py-4 text-center">
                                            {category.name}
                                        </TableCell>
                                        <TableCell className="text-gray-600 text-sm py-4 text-center">
                                            {category.description}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isModalOpen} onOpenChange={(open) => {
                setIsModalOpen(open);
                if (!open) form.reset();
            }}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-gray-900">
                            Add Payables Category
                        </DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-medium text-gray-700">Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Enter name" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-medium text-gray-700">Description</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Enter description" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button
                                type="submit"
                                className="w-full bg-[#eab308] text-white py-3 mt-6"
                            >
                                Save Category
                            </Button>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </Layout>
    );
}
