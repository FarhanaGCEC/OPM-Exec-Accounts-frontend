import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarIcon, Loader2, Pencil, ChevronUp, Check, X, Download } from 'lucide-react';
import { creditCardService, type CreditCardStatement } from '../services/creditCardService.ts';
import * as XLSX from 'xlsx';

// Group statements by month
interface GroupedStatements {
    [monthKey: string]: CreditCardStatement[];
}

export default function CreditCardStatements() {
    const [creditCards, setCreditCards] = useState<CreditCardStatement[]>([]);
    const [groupedStatements, setGroupedStatements] = useState<GroupedStatements>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Period selection state
    const currentDate = new Date();
    const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
    const [selectedMonths, setSelectedMonths] = useState<number[]>([currentDate.getMonth()]);
    const [isPeriodSelectorOpen, setIsPeriodSelectorOpen] = useState(false);
    
    // Edit state - only one card can be edited at a time
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<{
        totalPaymentDue: number;
        paid: number;
        epp: number;
    } | null>(null);
    const [saving, setSaving] = useState(false);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const years = [currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1];

    const formatSelectedPeriod = () => {
        if (selectedMonths.length === 0) return 'Select Period';
        if (selectedMonths.length === 1) {
            return `${months[selectedMonths[0]]} ${selectedYear}`;
        }
        return `${selectedMonths.length} months selected`;
    };

    const toggleMonth = (monthIndex: number) => {
        setSelectedMonths(prev => {
            if (prev.includes(monthIndex)) {
                return prev.filter(m => m !== monthIndex);
            } else {
                return [...prev, monthIndex].sort((a, b) => a - b);
            }
        });
    };

    // Helper function to get month from statement
    const getStatementMonth = (statement: CreditCardStatement): number | null => {
        // Try to get month from statement_date
        if (statement.statement_date) {
            const parts = statement.statement_date.split('-');
            if (parts.length === 3) {
                const monthNum = parseInt(parts[1], 10) - 1; // Convert to 0-11 index
                if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
                    return monthNum;
                }
            }
            // Fallback: try parsing as Date object
            const statementDate = new Date(statement.statement_date);
            if (!isNaN(statementDate.getTime())) {
                return statementDate.getMonth(); // 0-11
            }
        }
        
        // Try to get month from due_month
        if (statement.due_month) {
            // If it's a number (1-12), convert to index (0-11)
            const monthNum = typeof statement.due_month === 'string' 
                ? parseInt(statement.due_month, 10) 
                : statement.due_month;
            if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
                return monthNum - 1;
            }
            // If it's a month name, parse it
            const statementMonth = String(statement.due_month).toLowerCase().substring(0, 3);
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const statementMonthIndex = monthNames.findIndex((m) => statementMonth.includes(m));
            if (statementMonthIndex !== -1) {
                return statementMonthIndex;
            }
        }
        
        return null;
    };

    const fetchCreditCards = useCallback(async (year: number, months: number[]) => {
        try {
            setLoading(true);
            setError(null);
            
            let allStatements: CreditCardStatement[] = [];
            
            if (months.length === 0) {
                // No months selected, use current month/year (no params)
                const response = await creditCardService.getCreditCardStatements();
                if (response.success && response.data) {
                    allStatements = response.data;
                }
            } else if (months.length === 1) {
                // Single month selected: fetch specific month
                const response = await creditCardService.getCreditCardStatements({
                    year: year,
                    month: months[0], // month index (0-11)
                });
                if (response.success && response.data) {
                    allStatements = response.data;
                }
            } else {
                // Multiple months selected: use months query parameter
                const response = await creditCardService.getCreditCardStatements({
                    year: year,
                    months: months, // Array of month indices (0-11)
                });
                if (response.success && response.data) {
                    allStatements = response.data;
                }
            }
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:fetchCreditCards:SET_STATE',message:'Setting creditCards state',data:{count:allStatements.length,cardIds:allStatements.map(c=>c.id),cardIdTypes:allStatements.map(c=>typeof c.id),hasNullIds:allStatements.some(c=>!c.id),hasEmptyIds:allStatements.some(c=>c.id==='')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            
            // Group statements by month if multiple months are selected
            if (months.length > 1) {
                const grouped: GroupedStatements = {};
                allStatements.forEach((statement) => {
                    const statementMonth = getStatementMonth(statement);
                    if (statementMonth !== null && months.includes(statementMonth)) {
                        const monthKey = `${year}-${String(statementMonth + 1).padStart(2, '0')}`;
                        if (!grouped[monthKey]) {
                            grouped[monthKey] = [];
                        }
                        grouped[monthKey].push(statement);
                    }
                });
                setGroupedStatements(grouped);
            } else {
                setGroupedStatements({});
            }
            
            setCreditCards(allStatements);
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to fetch credit card statements';
            console.error('Error fetching credit card statements:', err);
            setError(errorMessage);
            setCreditCards([]);
            setGroupedStatements({});
        } finally {
            setLoading(false);
        }
    }, []);

    const handleApplyPeriod = () => {
        setIsPeriodSelectorOpen(false);
        fetchCreditCards(selectedYear, selectedMonths);
    };

    useEffect(() => {
        // Initial load with default period (current month/year)
        fetchCreditCards(selectedYear, selectedMonths);
      
    }, []);

    const formatCurrency = (value: number) => {
        return `AED ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return '-';
       
        const parts = dateString.split('-');
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const monthNum = parseInt(parts[1], 10);
            const year = parts[2];
            
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthName = monthNames[monthNum - 1] || parts[1];
            
            return `${day}-${monthName}-${year}`;
        }
        return dateString;
    };

    const formatMonth = (monthValue: string | number) => {
        if (!monthValue) return '-';
        // Convert month number to month name
        // Example: 12 -> Dec, "12" -> Dec
        const monthNum = typeof monthValue === 'string' ? parseInt(monthValue, 10) : monthValue;
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return String(monthValue);
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[monthNum - 1];
    };

    const handleEdit = useCallback((card: CreditCardStatement) => {
       
        if (!card.id) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleEdit:ERROR',message:'Card ID missing',data:{card},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            console.error('Card ID is missing:', card);
            return;
        }
        const cardId = String(card.id);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleEdit:BEFORE_SET',message:'Before setEditingId',data:{cardId,cardIdLength:cardId.length,currentEditingId:editingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        setEditingId(cardId);
        setEditValues({
            totalPaymentDue: card.totalPaymentDue,
            paid: card.paid,
            epp: card.epp,
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleEdit:AFTER_SET',message:'After setEditingId',data:{cardId,editValues:{totalPaymentDue:card.totalPaymentDue,paid:card.paid,epp:card.epp}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
    }, [creditCards, editingId]);

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditValues(null);
    };

    const handleSave = async (cardId: string) => {
        if (!editValues) return;
        const validCardId = String(cardId);
        if (!validCardId || validCardId === 'null' || validCardId === 'undefined' || validCardId === '') {
            setError('Invalid card ID');
            return;
        }
        
        try {
            setSaving(true);
            setError(null);
            
            // Format month as YYYY-MM for API (use first selected month)
            const monthIndex = selectedMonths.length > 0 ? selectedMonths[0] : currentDate.getMonth();
            const monthStr = String(monthIndex + 1).padStart(2, '0'); // Convert 0-11 to 1-12, then pad
            const monthParam = `${selectedYear}-${monthStr}`; // Format: YYYY-MM
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleSave:BEFORE_API',message:'Before API call',data:{validCardId,monthParam,editValues,selectedYear,selectedMonths},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE'})}).catch(()=>{});
            // #endregion
            
            // amountPending is auto-calculated by backend, so we don't send it
            const response = await creditCardService.updateCreditCardStatement(validCardId, {
                totalPaymentDue: editValues.totalPaymentDue,
                paid: editValues.paid,
                epp: editValues.epp,
            }, monthParam);
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleSave:AFTER_API',message:'After API call',data:{success:response.success,responseData:response.data,responseDataKeys:response.data?Object.keys(response.data):null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE'})}).catch(()=>{});
            // #endregion
            
            if (response.success && response.data) {
                // #region agent log
                const currentCard = creditCards.find(c => String(c.id) === validCardId);
                fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleSave:BEFORE_UPDATE',message:'Before state update',data:{currentCard,responseData:response.data},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE'})}).catch(()=>{});
                // #endregion
                
                // Update only the specific card in the list, preserve all other fields
                let updatedCard: CreditCardStatement | null = null;
                setCreditCards(prev => {
                    const updated = prev.map(card => {
                        if (String(card.id) === validCardId) {
                            // Create a new object to ensure React detects the change
                            updatedCard = {
                                ...card, // Keep existing fields (including id, issuingBank, cardHolder, etc.)
                                // Override only the updated financial values from response
                                totalPaymentDue: response.data.totalPaymentDue !== undefined && response.data.totalPaymentDue !== null
                                  ? Number(response.data.totalPaymentDue)
                                  : card.totalPaymentDue,
                                paid: response.data.paid !== undefined && response.data.paid !== null
                                  ? Number(response.data.paid)
                                  : card.paid,
                                epp: response.data.epp !== undefined && response.data.epp !== null
                                  ? Number(response.data.epp)
                                  : card.epp,
                                amountPending: response.data.amountPending !== undefined && response.data.amountPending !== null
                                  ? Number(response.data.amountPending)
                                  : card.amountPending,
                                // Update dates if provided
                                statement_date: response.data.statement_date || card.statement_date,
                                due_date: response.data.due_date || card.due_date,
                                due_month: response.data.due_month || card.due_month,
                            };
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleSave:UPDATED_CARD',message:'Updated card object',data:{originalCard:card,updatedCard,responseData:response.data},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE'})}).catch(()=>{});
                            // #endregion
                            return updatedCard;
                        }
                        // Keep all other cards unchanged
                        return card;
                    });
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleSave:AFTER_UPDATE',message:'After state update',data:{updatedCard:updated.find(c=>String(c.id)===validCardId),allCardIds:updated.map(c=>c.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE'})}).catch(()=>{});
                    // #endregion
                    return updated;
                });
                
                // Also update grouped statements if multiple months are selected
                if (updatedCard && selectedMonths.length > 1) {
                    const statementMonth = getStatementMonth(updatedCard);
                    if (statementMonth !== null && selectedMonths.includes(statementMonth)) {
                        const monthKey = `${selectedYear}-${String(statementMonth + 1).padStart(2, '0')}`;
                        setGroupedStatements(prevGrouped => {
                            const updatedGrouped = { ...prevGrouped };
                            if (updatedGrouped[monthKey]) {
                                updatedGrouped[monthKey] = updatedGrouped[monthKey].map(c => 
                                    String(c.id) === validCardId ? updatedCard! : c
                                );
                            }
                            return updatedGrouped;
                        });
                    }
                }
                
                // Close edit mode after state update
                setEditingId(null);
                setEditValues(null);
            } else {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:handleSave:ERROR',message:'API call failed',data:{success:response.success,error:response.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE'})}).catch(()=>{});
                // #endregion
                setError('Failed to update statement');
            }
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to update statement';
            console.error('Error updating statement:', err);
            setError(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const handleEditValueChange = (field: 'totalPaymentDue' | 'paid' | 'epp', value: string) => {
        if (!editValues) return;
        const numValue = parseFloat(value) || 0;
        setEditValues({
            ...editValues,
            [field]: numValue,
        });
    };

    const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const handleDownloadExcel = useCallback(() => {
        if (creditCards.length === 0) {
            setError('No data to export');
            return;
        }

        // Create workbook
        const workbook = XLSX.utils.book_new();

        // If multiple months selected, create separate sheets for each month
        if (selectedMonths.length > 1 && Object.keys(groupedStatements).length > 0) {
            // Multiple months: create separate sheets
            Object.keys(groupedStatements)
                .sort()
                .forEach((monthKey) => {
                    const [year, monthNum] = monthKey.split('-');
                    const monthIndex = parseInt(monthNum, 10) - 1;
                    const monthName = fullMonthNames[monthIndex];
                    const statements = groupedStatements[monthKey];

                    // Prepare data for Excel
                    const excelData: any[] = [];

                    // Add header
                    excelData.push([`Credit Card Statements - ${monthName} ${year}`]);
                    excelData.push([]);

                    // Add table headers
                    excelData.push([
                        'Issuing Bank',
                        'Card Holder',
                        'Card No',
                        'Statement Date',
                        'Due Date',
                        'Due Month',
                        'Total Payment Due',
                        'Paid',
                        'EPP',
                        'Amount Pending'
                    ]);

                    // Add statement rows
                    statements.forEach((card) => {
                        excelData.push([
                            card.issuingBank || '',
                            card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || ''),
                            card.card_number || '',
                            formatDate(card.statement_date || ''),
                            formatDate(card.due_date || ''),
                            formatMonth(card.due_month || ''),
                            card.totalPaymentDue || 0,
                            card.paid || 0,
                            card.epp || 0,
                            card.amountPending || 0
                        ]);
                    });

                    // Create worksheet
                    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

                    // Set column widths
                    worksheet['!cols'] = [
                        { wch: 20 }, // Issuing Bank
                        { wch: 15 }, // Card Holder
                        { wch: 20 }, // Card No
                        { wch: 15 }, // Statement Date
                        { wch: 15 }, // Due Date
                        { wch: 12 }, // Due Month
                        { wch: 18 }, // Total Payment Due
                        { wch: 15 }, // Paid
                        { wch: 15 }, // EPP
                        { wch: 18 }, // Amount Pending
                    ];

                    // Format header row (row 2, 0-indexed)
                    const headerRow = 2;
                    for (let col = 0; col <= 9; col++) {
                        const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
                        if (worksheet[headerCellRef]) {
                            if (!worksheet[headerCellRef].s) {
                                worksheet[headerCellRef].s = {};
                            }
                            worksheet[headerCellRef].s.font = { bold: true };
                            worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
                        }
                    }

                    // Format number columns (Total Payment Due, Paid, EPP, Amount Pending)
                    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                    for (let row = 3; row <= range.e.r; row++) {
                        // Column G (Total Payment Due) - index 6
                        const totalDueCellRef = XLSX.utils.encode_cell({ r: row, c: 6 });
                        if (worksheet[totalDueCellRef] && typeof worksheet[totalDueCellRef].v === 'number') {
                            worksheet[totalDueCellRef].t = 'n';
                            worksheet[totalDueCellRef].z = '#,##0.00';
                        }
                        // Column H (Paid) - index 7
                        const paidCellRef = XLSX.utils.encode_cell({ r: row, c: 7 });
                        if (worksheet[paidCellRef] && typeof worksheet[paidCellRef].v === 'number') {
                            worksheet[paidCellRef].t = 'n';
                            worksheet[paidCellRef].z = '#,##0.00';
                        }
                        // Column I (EPP) - index 8
                        const eppCellRef = XLSX.utils.encode_cell({ r: row, c: 8 });
                        if (worksheet[eppCellRef] && typeof worksheet[eppCellRef].v === 'number') {
                            worksheet[eppCellRef].t = 'n';
                            worksheet[eppCellRef].z = '#,##0.00';
                        }
                        // Column J (Amount Pending) - index 9
                        const pendingCellRef = XLSX.utils.encode_cell({ r: row, c: 9 });
                        if (worksheet[pendingCellRef] && typeof worksheet[pendingCellRef].v === 'number') {
                            worksheet[pendingCellRef].t = 'n';
                            worksheet[pendingCellRef].z = '#,##0.00';
                        }
                    }

                    // Add worksheet to workbook
                    XLSX.utils.book_append_sheet(workbook, worksheet, monthName.substring(0, 10)); // Sheet name max 31 chars
                });
        } else {
            // Single month: create single sheet
            const excelData: any[] = [];

            // Add header
            const periodText = selectedMonths.length === 1 
                ? `${months[selectedMonths[0]]} ${selectedYear}`
                : formatSelectedPeriod();
            excelData.push([`Credit Card Statements - ${periodText}`]);
            excelData.push([]);

            // Add table headers
            excelData.push([
                'Issuing Bank',
                'Card Holder',
                'Card No',
                'Statement Date',
                'Due Date',
                'Due Month',
                'Total Payment Due',
                'Paid',
                'EPP',
                'Amount Pending'
            ]);

            // Add statement rows
            creditCards.forEach((card) => {
                excelData.push([
                    card.issuingBank || '',
                    card.cardHolder === 'Suleman' ? 'MST' : (card.cardHolder || ''),
                    card.card_number || '',
                    formatDate(card.statement_date || ''),
                    formatDate(card.due_date || ''),
                    formatMonth(card.due_month || ''),
                    card.totalPaymentDue || 0,
                    card.paid || 0,
                    card.epp || 0,
                    card.amountPending || 0
                ]);
            });

            // Create worksheet
            const worksheet = XLSX.utils.aoa_to_sheet(excelData);

            // Set column widths
            worksheet['!cols'] = [
                { wch: 20 }, // Issuing Bank
                { wch: 15 }, // Card Holder
                { wch: 20 }, // Card No
                { wch: 15 }, // Statement Date
                { wch: 15 }, // Due Date
                { wch: 12 }, // Due Month
                { wch: 18 }, // Total Payment Due
                { wch: 15 }, // Paid
                { wch: 15 }, // EPP
                { wch: 18 }, // Amount Pending
            ];

            // Format header row (row 2, 0-indexed)
            const headerRow = 2;
            for (let col = 0; col <= 9; col++) {
                const headerCellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
                if (worksheet[headerCellRef]) {
                    if (!worksheet[headerCellRef].s) {
                        worksheet[headerCellRef].s = {};
                    }
                    worksheet[headerCellRef].s.font = { bold: true };
                    worksheet[headerCellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
                }
            }

            // Format number columns
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            for (let row = 3; row <= range.e.r; row++) {
                // Column G (Total Payment Due) - index 6
                const totalDueCellRef = XLSX.utils.encode_cell({ r: row, c: 6 });
                if (worksheet[totalDueCellRef] && typeof worksheet[totalDueCellRef].v === 'number') {
                    worksheet[totalDueCellRef].t = 'n';
                    worksheet[totalDueCellRef].z = '#,##0.00';
                }
                // Column H (Paid) - index 7
                const paidCellRef = XLSX.utils.encode_cell({ r: row, c: 7 });
                if (worksheet[paidCellRef] && typeof worksheet[paidCellRef].v === 'number') {
                    worksheet[paidCellRef].t = 'n';
                    worksheet[paidCellRef].z = '#,##0.00';
                }
                // Column I (EPP) - index 8
                const eppCellRef = XLSX.utils.encode_cell({ r: row, c: 8 });
                if (worksheet[eppCellRef] && typeof worksheet[eppCellRef].v === 'number') {
                    worksheet[eppCellRef].t = 'n';
                    worksheet[eppCellRef].z = '#,##0.00';
                }
                // Column J (Amount Pending) - index 9
                const pendingCellRef = XLSX.utils.encode_cell({ r: row, c: 9 });
                if (worksheet[pendingCellRef] && typeof worksheet[pendingCellRef].v === 'number') {
                    worksheet[pendingCellRef].t = 'n';
                    worksheet[pendingCellRef].z = '#,##0.00';
                }
            }

            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Statements');
        }

        // Generate Excel file and download
        const periodText = selectedMonths.length === 1 
            ? `${months[selectedMonths[0]]}-${selectedYear}`
            : `${selectedMonths.length}-months-${selectedYear}`;
        const fileName = `Credit-Card-Statements-${periodText}.xlsx`;
        XLSX.writeFile(workbook, fileName);
    }, [creditCards, selectedMonths, selectedYear, groupedStatements, months, fullMonthNames]);

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
                <div className="flex items-center gap-4 ml-16">
                    <h2 className="text-2xl font-bold text-gray-900">Credit Card Statements</h2>
                </div>
                <div className="flex items-center gap-2 mr-4">
                    <Button
                        variant="outline"
                        onClick={handleDownloadExcel}
                        disabled={loading || creditCards.length === 0}
                        className="bg-white hover:bg-[#eab308] text-black border-0 flex items-center gap-2"
                    >
                        <Download className="w-4 h-4" />
                        <span>Download Excel</span>
                    </Button>
                   
                    <Popover open={isPeriodSelectorOpen} onOpenChange={setIsPeriodSelectorOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center space-x-2 transition-colors rounded-lg mr-4 min-w-[200px] justify-between"
                            disabled={loading}
                        >
                            <div className="flex items-center space-x-2">
                                <CalendarIcon className="w-4 h-4 text-gray-600" />
                                <span className="font-medium">{formatSelectedPeriod()}</span>
                            </div>
                            <ChevronUp className="w-4 h-4 text-gray-600" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <div className="p-4 space-y-4">
                            {/* Selected Period Display */}
                            <div className="border border-gray-300 rounded-lg p-3 bg-[#eab308]">
                                <div className="text-xs font-medium text-gray-600 mb-1">Selected Period</div>
                                <div className="flex items-center space-x-2">
                                    <CalendarIcon className="w-4 h-4 text-gray-600" />
                                    <span className="font-semibold text-black">{formatSelectedPeriod()}</span>
                                </div>
                            </div>

                            {/* Year Selection */}
                            <div>
                                <div className="text-sm font-semibold text-gray-700 mb-2">Select Year</div>
                                <div className="flex gap-2">
                                    {years.map((year) => (
                                        <button
                                            key={year}
                                            onClick={() => setSelectedYear(year)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                selectedYear === year
                                                    ? 'bg-[#eab308] text-black'
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
                                    {months.map((month, index) => (
                                        <button
                                            key={index}
                                            onClick={() => toggleMonth(index)}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                selectedMonths.includes(index)
                                                    ? 'bg-[#eab308] text-black'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            {month}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2 pt-2 border-t">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsPeriodSelectorOpen(false)}
                                    className="flex-1"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleApplyPeriod}
                                    className="flex-1 bg-[#eab308] hover:bg-[#d4a007] text-black"
                                    disabled={selectedMonths.length === 0}
                                >
                                    Apply
                                </Button>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md animate-in fade-in-50">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}

            {/* Render separate tables for each month when multiple months are selected */}
            {selectedMonths.length > 1 && Object.keys(groupedStatements).length > 0 ? (
                // Multiple months: show separate tables
                Object.keys(groupedStatements)
                    .sort()
                    .map((monthKey) => {
                        const [year, monthNum] = monthKey.split('-');
                        const monthIndex = parseInt(monthNum, 10) - 1;
                        const monthName = fullMonthNames[monthIndex];
                        const statements = groupedStatements[monthKey];
                        
                        return (
                            <Card key={monthKey} className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                                <CardContent className="p-0">
                                    <div className="bg-[#eab308] px-6 py-3 border-b border-gray-200">
                                        <h3 className="text-lg font-bold text-black">
                                            {monthName} {year}
                                        </h3>
                                    </div>
                                    <div className="overflow-x-auto rounded-lg">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-[#eab308] border-0 hover:bg-[#d4a007]">
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Issuing Bank
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Card Holder
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Card No
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Statement Date
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Due Date
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Due Month
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Total Payment Due
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Paid
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        EPP
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Amount Pending
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-black text-sm text-left py-2">
                                                        Actions
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {statements.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={11} className="text-center py-8">
                                                            <p className="text-sm text-gray-500">No statements found for {monthName} {year}.</p>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    statements.map((card) => {
                                                        return (
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
                                                                    {card.card_number || ''}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                    {formatDate(card.statement_date || '')}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                    {formatDate(card.due_date || '')}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                    {formatMonth(card.due_month || '')}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 font-semibold text-sm py-2 text-left">
                                                                    {editingId && String(editingId) === String(card.id) && editValues ? (
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={editValues.totalPaymentDue}
                                                                            onChange={(e) => handleEditValueChange('totalPaymentDue', e.target.value)}
                                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                        />
                                                                    ) : (
                                                                        formatCurrency(card.totalPaymentDue)
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                    {editingId && String(editingId) === String(card.id) && editValues ? (
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={editValues.paid}
                                                                            onChange={(e) => handleEditValueChange('paid', e.target.value)}
                                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                        />
                                                                    ) : (
                                                                        formatCurrency(card.paid)
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                    {editingId && String(editingId) === String(card.id) && editValues ? (
                                                                        <input
                                                                            type="number"
                                                                            step="0.01"
                                                                            value={editValues.epp}
                                                                            onChange={(e) => handleEditValueChange('epp', e.target.value)}
                                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                        />
                                                                    ) : (
                                                                        formatCurrency(card.epp)
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className={`text-sm py-2 text-left font-semibold ${
                                                                    card.amountPending > 0 ? 'text-red-600' : 'text-green-600'
                                                                }`}>
                                                                    {formatCurrency(card.amountPending)}
                                                                </TableCell>
                                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                                    {editingId && String(editingId) === String(card.id) ? (
                                                                        <div className="flex gap-2">
                                                                            <Button
                                                                                variant="outline"
                                                                                size="sm"
                                                                                onClick={() => {
                                                                                    if (card.id) {
                                                                                        handleSave(String(card.id));
                                                                                    }
                                                                                }}
                                                                                disabled={saving || !card.id}
                                                                                className="bg-green-500 hover:bg-green-600 text-white border-0"
                                                                            >
                                                                                <Check className="w-4 h-4" />
                                                                            </Button>
                                                                            <Button
                                                                                variant="outline"
                                                                                size="sm"
                                                                                onClick={handleCancelEdit}
                                                                                disabled={saving}
                                                                                className="bg-red-500 hover:bg-red-600 text-white border-0"
                                                                            >
                                                                                <X className="w-4 h-4" />
                                                                            </Button>
                                                                        </div>
                                                                    ) : (
                                                                        <Button
                                                                            variant="outline"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (card.id) {
                                                                                    handleEdit(card);
                                                                                }
                                                                            }}
                                                                            disabled={!card.id}
                                                                            className="bg-[#eab308] hover:bg-[#d4a007] text-black"
                                                                        >
                                                                            <Pencil className="w-4 h-4 text-black" />
                                                                            Edit
                                                                        </Button>
                                                                    )}
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })
            ) : (
                // Single month: show single table
                <Card className="bg-white border border-gray-200 shadow-sm m-8 rounded-lg overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto rounded-lg">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-[#eab308] border-0 hover:bg-[#d4a007]">
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Issuing Bank
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Card Holder
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Card No
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Statement Date
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Due Date
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Due Month
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Total Payment Due
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Paid
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            EPP
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Amount Pending
                                        </TableHead>
                                        <TableHead className="font-semibold text-black text-sm text-left py-2">
                                            Actions
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={11} className="text-center py-8">
                                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                                                <p className="text-sm text-gray-500">Loading credit card statements...</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : !Array.isArray(creditCards) || creditCards.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={11} className="text-center py-8">
                                                <p className="text-sm text-gray-500 mb-1">No credit card statements found for selected period.</p>
                                                <p className="text-sm text-gray-400">Select a different month/year to view statements.</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        creditCards.map((card, index) => {
                                            // #region agent log
                                            const comparisonResult = editingId && String(editingId) === String(card.id);
                                            fetch('http://127.0.0.1:7242/ingest/8b8f95b1-a1bf-4166-908a-00cc530c965f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CreditCardStatments.tsx:render:ROW',message:'Rendering card row',data:{index,cardId:card.id,cardIdType:typeof card.id,cardIdString:String(card.id),editingId,editingIdType:typeof editingId,editingIdString:String(editingId),comparisonResult,hasEditValues:!!editValues},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
                                            // #endregion
                                            return (
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
                                                    {card.card_number || ''}
                                                </TableCell>
                                             
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    {formatDate(card.statement_date || '')}
                                                </TableCell>
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    {formatDate(card.due_date || '')}
                                                </TableCell>
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    {formatMonth(card.due_month || '')}
                                                </TableCell>
                                                <TableCell className="text-gray-700 font-semibold text-sm py-2 text-left">
                                                    {editingId && String(editingId) === String(card.id) && editValues ? (
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={editValues.totalPaymentDue}
                                                            onChange={(e) => handleEditValueChange('totalPaymentDue', e.target.value)}
                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        />
                                                    ) : (
                                                        formatCurrency(card.totalPaymentDue)
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    {editingId && String(editingId) === String(card.id) && editValues ? (
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={editValues.paid}
                                                            onChange={(e) => handleEditValueChange('paid', e.target.value)}
                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        />
                                                    ) : (
                                                        formatCurrency(card.paid)
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    {editingId && String(editingId) === String(card.id) && editValues ? (
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={editValues.epp}
                                                            onChange={(e) => handleEditValueChange('epp', e.target.value)}
                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        />
                                                    ) : (
                                                        formatCurrency(card.epp)
                                                    )}
                                                </TableCell>
                                               
                                                <TableCell className={`text-sm py-2 text-left font-semibold ${
                                                    card.amountPending > 0 ? 'text-red-600' : 'text-green-600'
                                                }`}>
                                                    {/* amountPending is auto-calculated, so it's read-only */}
                                                    {formatCurrency(card.amountPending)}
                                                </TableCell>
                                                <TableCell className="text-gray-700 text-sm py-2 text-left">
                                                    {editingId && String(editingId) === String(card.id) ? (
                                                        <div className="flex gap-2">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    if (card.id) {
                                                                        handleSave(String(card.id));
                                                                    }
                                                                }}
                                                                disabled={saving || !card.id}
                                                                className="bg-green-500 hover:bg-green-600 text-white border-0"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </Button>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={handleCancelEdit}
                                                                disabled={saving}
                                                                className="bg-red-500 hover:bg-red-600 text-white border-0"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            onClick={(e) => {
                                                               
                                                                e.stopPropagation();
                                                                if (card.id) {
                                                                    handleEdit(card);
                                                                }
                                                            }}
                                                            disabled={!card.id}
                                                            className="bg-[#eab308] hover:bg-[#d4a007] text-black"
                                                        >
                                                            <Pencil className="w-4 h-4 text-black" />
                                                            Edit
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </Layout>
    );
}
