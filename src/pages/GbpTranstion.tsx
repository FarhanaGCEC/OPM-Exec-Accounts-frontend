
import { Button } from '@/components/ui/button';
import Layout from '../components/Layout';
import { useState, useEffect, useCallback } from 'react';
import { FileSpreadsheet, Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import type { ApiResponse } from '../lib/api';
import { transactionService, type BankTransaction as BankTransactionType } from '../services/transactionService';
import ExcelJS from 'exceljs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

interface GbpTransaction {
  id?: string | number;
  date: string;
  description: string;
  details: string;
  debit?: number | string | null;
  credit?: number | string | null;
  bankCharges?: number;
  balance?: number | string;
}

export default function GbpTranstion() {
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<GbpTransaction[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<GbpTransaction | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<GbpTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<{
    date: string;
    description: string;
    type: 'Debit' | 'Credit' | '';
    paymentType: 'cheque' | 'online' | 'cash' | 'creditcard' | '';
    chequeNumber: string;
    amount: string;
    bankCharges: string;
  }>({
    date: '',
    description: '',
    type: '',
    paymentType: '',
    chequeNumber: '',
    amount: '',
    bankCharges: '',
  });

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response: ApiResponse<any> = await transactionService.getGbpTransactions();
      
      if (response.success && response.data) {
        // API returns data array directly with camelCase fields
        const mappedTransactions: GbpTransaction[] = response.data.map((txn: any) => ({
          id: txn.id,
          date: txn.date,
          description: txn.description || '',
          details: txn.details || '',
          debit: txn.debit,
          credit: txn.credit,
          bankCharges: txn.bankCharges,
          balance: txn.balance,
        }));
        setTransactions(mappedTransactions);
      } else {
        setError('Failed to fetch transactions');
      }
    } catch (err: any) {
      console.error('Error fetching GBP transactions:', err);
      setError(err?.message || 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Handle Add New
  const handleAddNew = () => {
    setEditingTransaction(null);
    setFormData({
      date: '',
      description: '',
      type: '',
      paymentType: '',
      chequeNumber: '',
      amount: '',
      bankCharges: '',
    });
    setIsModalOpen(true);
  };

  // Handle Edit
  const handleEdit = (transaction: GbpTransaction) => {
    setEditingTransaction(transaction);
    
    // Determine type based on debit/credit
    const type = transaction.debit && parseFloat(String(transaction.debit)) > 0 
      ? 'Debit' 
      : transaction.credit && parseFloat(String(transaction.credit)) > 0 
      ? 'Credit' 
      : '';
    
    // Get amount value
    const amount = transaction.debit && parseFloat(String(transaction.debit)) > 0
      ? String(transaction.debit)
      : transaction.credit && parseFloat(String(transaction.credit)) > 0
      ? String(transaction.credit)
      : '';
    
    // Map details to paymentType (normalize to match dropdown values)
    let paymentType: 'cheque' | 'online' | 'cash' | 'creditcard' | '' = '';
    const detailsLower = (transaction.details || '').toLowerCase();
    if (detailsLower.includes('cheque')) {
      paymentType = 'cheque';
    } else if (detailsLower.includes('online')) {
      paymentType = 'online';
    } else if (detailsLower.includes('cash')) {
      paymentType = 'cash';
    } else if (detailsLower.includes('credit') || detailsLower.includes('card')) {
      paymentType = 'creditcard';
    }
    
    setFormData({
      date: transaction.date || '',
      description: transaction.description || '',
      type: type as 'Debit' | 'Credit' | '',
      paymentType: paymentType,
      chequeNumber: (transaction as any).chequeNumber || '',
      amount: amount,
      bankCharges: transaction.bankCharges ? String(transaction.bankCharges) : '',
    });
    setIsModalOpen(true);
  };

  // Handle Delete
  const handleDeleteClick = (transaction: GbpTransaction) => {
    setTransactionToDelete(transaction);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!transactionToDelete?.id) return;
    
    try {
      setLoading(true);
      const response = await transactionService.deleteGbpTransaction(String(transactionToDelete.id));
      
      if (response.success) {
        await fetchTransactions();
        setIsDeleteDialogOpen(false);
        setTransactionToDelete(null);
      } else {
        setError('Failed to delete transaction');
      }
    } catch (err: any) {
      console.error('Error deleting transaction:', err);
      setError(err?.message || 'Failed to delete transaction');
    } finally {
      setLoading(false);
    }
  };

  // Handle Save (Create or Update)
  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Validation
      if (!formData.type) {
        setError('Please select a type (Debit or Credit)');
        setLoading(false);
        return;
      }
      if (!formData.paymentType) {
        setError('Please select a payment type');
        setLoading(false);
        return;
      }
      if (!formData.amount || formData.amount.trim() === '') {
        setError('Please enter an amount');
        setLoading(false);
        return;
      }
      if (formData.paymentType === 'cheque' && !formData.chequeNumber.trim()) {
        setError('Cheque number is required when payment type is cheque');
        setLoading(false);
        return;
      }
      
      // Convert paymentType to details format
      let details = '';
      if (formData.paymentType === 'cheque') {
        details = formData.chequeNumber; // Use cheque number as details
      } else if (formData.paymentType === 'creditcard') {
        details = 'Credit Card';
      } else {
        details = formData.paymentType.charAt(0).toUpperCase() + formData.paymentType.slice(1);
      }
      
      // Parse and validate amount
      const amountValue = parseFloat(formData.amount.replace(/,/g, ''));
      if (isNaN(amountValue) || amountValue <= 0) {
        setError('Please enter a valid amount greater than 0');
        setLoading(false);
        return;
      }
      
      const payload: any = {
        date: formData.date,
        description: formData.description,
        details: details,
      };
      
      // Set debit or credit based on type - always set both fields
      if (formData.type === 'Debit') {
        payload.debit = amountValue; // Send as number, service will handle conversion
        payload.credit = 0; // Always set credit to 0 for debit transactions
      } else if (formData.type === 'Credit') {
        payload.credit = amountValue; // Send as number, service will handle conversion
        payload.debit = 0; // Always set debit to 0 for credit transactions
      }
      
      // Bank charges - only include if provided and valid
      if (formData.bankCharges && formData.bankCharges.trim() !== '') {
        const bankChargesValue = parseFloat(formData.bankCharges.replace(/,/g, ''));
        if (!isNaN(bankChargesValue) && bankChargesValue >= 0) {
          payload.bankCharges = bankChargesValue;
        }
      }
      
      let response: ApiResponse<BankTransactionType>;
      
      if (editingTransaction?.id) {
        // Update
        response = await transactionService.updateGbpTransaction(String(editingTransaction.id), payload);
      } else {
        // Create
        response = await transactionService.createGbpTransaction(payload);
      }
      
      if (response.success) {
        await fetchTransactions();
        setIsModalOpen(false);
        setEditingTransaction(null);
      } else {
        setError('Failed to save transaction');
      }
    } catch (err: any) {
      console.error('Error saving transaction:', err);
      setError(err?.message || 'Failed to save transaction');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to format date for Excel (dd-mmm-yy format like "31-Dec-25")
  const formatDateForExcel = (date: Date | string | null): string => {
    if (!date) return '';
    
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      if (isNaN(dateObj.getTime())) return '';
      
      const day = String(dateObj.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[dateObj.getMonth()];
      const year = String(dateObj.getFullYear()).slice(-2); // Last 2 digits of year
      
      return `${day}-${month}-${year}`;
    } catch {
      return '';
    }
  };

  const handleDownloadExcel = async () => {
    if (transactions.length === 0) {
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('GBP Transactions');
      let currentRow = 1;

      // Helper function to add a row with optional styling
      const addRow = (values: any[], style?: Partial<ExcelJS.Style>) => {
        const row = worksheet.addRow(values);
        if (style) {
          row.eachCell((cell) => {
            Object.assign(cell, style);
          });
        }
        currentRow++;
        return row;
      };

      // Header rows
      addRow(['ADCB GCEC CLOUD (GBP)'], { font: { bold: true, size: 14 } });
      addRow(['Account No:', '12990685920003']);
      addRow([]);

      // Headers
      const headers = ['Date', 'Description', 'Details', 'Debit', 'Bank Charges', 'Credit', 'Balance'];
      addRow(headers);
      addRow([], { font: { bold: true } });

      // Transaction rows
      transactions.forEach((transaction) => {
        const debitValue = transaction.debit ? parseFloat(String(transaction.debit).replace(/,/g, '')) : 0;
        const bankChargesValue = transaction.bankCharges ? parseFloat(String(transaction.bankCharges).replace(/,/g, '')) : 0;
        const creditValue = transaction.credit ? parseFloat(String(transaction.credit).replace(/,/g, '')) : 0;
        const balanceValue = transaction.balance ? parseFloat(String(transaction.balance).replace(/,/g, '')) : 0;
        
        // Check if this row should have red text and light blue background (if bank charges exist)
        const hasBankCharges = bankChargesValue > 0;
        const hasDebit = debitValue > 0;
        
        const row = addRow([
          formatDateForExcel(transaction.date),
          transaction.description,
          transaction.details,
          debitValue,
          bankChargesValue,
          creditValue,
          balanceValue,
        ]);

        // Format number columns with $ symbol
        row.getCell(4).numFmt = '£#,##0.00'; // Debit
        row.getCell(5).numFmt = '£#,##0.00'; // Bank Charges
        row.getCell(6).numFmt = '£#,##0.00'; // Credit
        row.getCell(7).numFmt = '£#,##0.00'; // Balance

        // Apply light blue background if bank charges exist
    

        // Apply red text based on transaction type
        if (hasBankCharges) {
          // Rows with bank charges: red text in Date, Description, Details, Bank Charges
          row.getCell(1).font = { color: { argb: 'FFFF0000' } }; // Date - red
          row.getCell(2).font = { color: { argb: 'FFFF0000' } }; // Description - red
          row.getCell(3).font = { color: { argb: 'FFFF0000' } }; // Details - red
          row.getCell(5).font = { color: { argb: 'FFFF0000' } }; // Bank Charges - red
        }
        
        if (hasDebit) {
          // Rows with debit: red text in Date, Description, Details, Debit
          row.getCell(1).font = { color: { argb: 'FFFF0000' } }; // Date - red
          row.getCell(2).font = { color: { argb: 'FFFF0000' } }; // Description - red
          row.getCell(3).font = { color: { argb: 'FFFF0000' } }; // Details - red
          row.getCell(4).font = { color: { argb: 'FFFF0000' } }; // Debit - red
        }

        // Make Balance red if negative, otherwise keep default
        if (balanceValue < 0) {
          row.getCell(7).font = { color: { argb: 'FFFF0000' } }; // Balance - red if negative
        }
      });

      // Set column widths
      worksheet.columns = [
        { width: 15 }, // Date
        { width: 25 }, // Description
        { width: 15 }, // Details
        { width: 18 }, // Debit
        { width: 18 }, // Bank Charges
        { width: 18 }, // Credit
        { width: 18 }, // Balance
      ];

      // Generate filename and download
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const fileName = `GBP-Transactions-${dateStr}.xlsx`;

      // Write to buffer and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading Excel:', err);
      setError(err?.message || 'Failed to download Excel file');
    }
  };

  const formatAmount = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined) return '-';
    const numValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
    return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return dateString;
    }
  };

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-4 ml-16">
          <h2 className="text-2xl font-bold text-gray-900">ADCB GCEC CLOUD (GBP)</h2>
        </div>
        <div className="flex items-center gap-3 mr-4">
          <Button
            onClick={handleDownloadExcel}
            variant="outline"
            className="flex items-center space-x-2 border-gray-300 hover:bg-gray-50 text-black"
            disabled={loading || transactions.length === 0}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Download Excel</span>
          </Button>
          <Button
            onClick={handleAddNew}
            className="bg-[#eab308] hover:bg-[#d4a007] text-black flex items-center space-x-2 transition-colors rounded-lg"
            disabled={loading}
          >
            <Plus className="w-4 h-4 text-black" />
            <span>Add New</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-8 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="mx-8">
        {loading && transactions.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-[#eab308]" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No transactions found. Click "Add New" to create one.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eab308] border-0">
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Date</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Description</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Details</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Debit</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Bank Charges</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Credit</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Balance</TableHead>
                    <TableHead className="font-semibold text-black text-sm text-left py-3 px-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={transaction.id} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
                      <TableCell className="text-gray-700 text-sm py-3 px-4">{formatDate(transaction.date)}</TableCell>
                      <TableCell className="text-gray-700 font-medium text-sm py-3 px-4">{transaction.description}</TableCell>
                      <TableCell className="text-gray-600 text-sm py-3 px-4">{transaction.details}</TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        {transaction.debit ? (
                          <span className="text-red-600 font-semibold">£{formatAmount(transaction.debit)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        {transaction.bankCharges ? (
                          <span className="text-red-600 font-semibold">£{formatAmount(transaction.bankCharges)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        {transaction.credit ? (
                          <span className="text-black font-semibold">£{formatAmount(transaction.credit)}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        {(() => {
                          const balanceValue = transaction.balance ? parseFloat(String(transaction.balance).replace(/,/g, '')) : 0;
                          const isNegative = balanceValue < 0;
                          return (
                            <span className={`font-semibold ${isNegative ? 'text-red-600' : 'text-gray-700'}`}>
                              £{formatAmount(transaction.balance)}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(transaction)}
                            disabled={loading}
                            className="h-8 w-8 p-0"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(transaction)}
                            disabled={loading}
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTransaction ? 'Edit GBP Transaction' : 'Add New GBP Transaction'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g., ABC Co."
              />
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value as 'Debit' | 'Credit' | '' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Debit">Debit</SelectItem>
                  <SelectItem value="Credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="paymentType">Payment Type</Label>
              <Select
                value={formData.paymentType}
                onValueChange={(value) => setFormData({ ...formData, paymentType: value as 'cheque' | 'online' | 'cash' | 'creditcard' | '', chequeNumber: '' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Payment Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="creditcard">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.paymentType === 'cheque' && (
              <div>
                <Label htmlFor="chequeNumber">Cheque Number</Label>
                <Input
                  id="chequeNumber"
                  value={formData.chequeNumber}
                  onChange={(e) => setFormData({ ...formData, chequeNumber: e.target.value })}
                  placeholder="Enter cheque number"
                />
              </div>
            )}
            <div>
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="bank_charges">Bank Charges</Label>
              <Input
                id="bank_charges"
                type="number"
                step="0.01"
                value={formData.bankCharges}
                onChange={(e) => setFormData({ ...formData, bankCharges: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingTransaction(null);
                }}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
                className="bg-[#eab308] hover:bg-[#d4a007] text-black"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) {
            setTransactionToDelete(null);
          }
        }}
        onConfirm={handleDeleteConfirm}
        itemName={(() => {
          if (!transactionToDelete) return '';
          const date = formatDate(transactionToDelete.date);
          const description = transactionToDelete.description || 'Unknown';
          const debitValue = transactionToDelete.debit ? parseFloat(String(transactionToDelete.debit).replace(/,/g, '')) : 0;
          const creditValue = transactionToDelete.credit ? parseFloat(String(transactionToDelete.credit).replace(/,/g, '')) : 0;
          const amount = debitValue > 0 ? debitValue : creditValue;
          const amountText = amount > 0 ? `£${formatAmount(amount)}` : '';
          return `GBP transaction dated ${date}${description ? ` for "${description}"` : ''}${amountText ? ` (${amountText})` : ''}`;
        })()}
        isLoading={loading}
      />
    </Layout>
  );
}