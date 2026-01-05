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

interface Beneficiary {
    id: string;
    name: string;
    bankName: string;
}

const beneficiarySchema = z.object({
    name: z.string()
        .min(1, 'Beneficiary Name is required')
        .min(2, 'Name must be at least 2 characters'),
    bankName: z.string()
        .min(1, 'Bank Name is required')
        .min(2, 'Bank Name must be at least 2 characters'),
});

type BeneficiaryFormData = z.infer<typeof beneficiarySchema>;

export default function GCECBeneficiary() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([
        { id: '1', name: 'John Doe Services', bankName: 'Emirates NBD' },
        { id: '2', name: 'Global Logistics', bankName: 'Mashreq Bank' },
    ]);

    const form = useForm<BeneficiaryFormData>({
        resolver: zodResolver(beneficiarySchema),
        defaultValues: {
            name: '',
            bankName: '',
        },
    });

    const onSubmit = (data: BeneficiaryFormData) => {
        const newBeneficiary: Beneficiary = {
            id: Date.now().toString(),
            name: data.name,
            bankName: data.bankName,
        };
        setBeneficiaries([newBeneficiary, ...beneficiaries]);
        form.reset();
        setIsModalOpen(false);
    };

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">GCEC Beneficiary</h2>
                <Button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-[#eab308] text-white flex items-center space-x-2"
                >
                    <Plus className="w-4 h-4" />
                    <span>Add New Beneficiary</span>
                </Button>
            </div>

            <Card className="bg-white border border-gray-200">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-[#eab308] border-0">
                                    <TableHead className="font-semibold text-black text-base text-center py-4">
                                        Beneficiary Name
                                    </TableHead>
                                    <TableHead className="font-semibold text-black text-base text-center py-4">
                                        Bank Name
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {beneficiaries.map((ben) => (
                                    <TableRow key={ben.id} className="border-b border-gray-100 hover:bg-gray-50">
                                        <TableCell className="text-gray-700 font-medium text-base py-4 text-center">
                                            {ben.name}
                                        </TableCell>
                                        <TableCell className="text-gray-600 text-base py-4 text-center">
                                            {ben.bankName}
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
                            Add GCEC Beneficiary
                        </DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">Beneficiary Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Enter beneficiary name" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="bankName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base font-medium text-gray-700">Bank Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Enter bank name" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button
                                type="submit"
                                className="w-full bg-[#eab308] text-white py-3 mt-6"
                            >
                                Save Beneficiary
                            </Button>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </Layout>
    );
}
