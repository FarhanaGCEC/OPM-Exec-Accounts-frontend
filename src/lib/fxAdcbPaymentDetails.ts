export type FxAdcbPaymentType = 'cash' | 'cheque' | 'banktransfer' | 'dd';

export function fxAdcbDetailsFromPaymentType(
  paymentType: FxAdcbPaymentType | '',
  chequeNumber: string
): string {
  if (paymentType === 'cheque') return chequeNumber.trim();
  if (paymentType === 'banktransfer') return 'Online';
  if (paymentType === 'dd') return 'DD';
  if (paymentType === 'cash') return 'Cash';
  return '';
}

export function fxAdcbPaymentTypeFromDetails(details: string): {
  paymentType: FxAdcbPaymentType | '';
  chequeNumber: string;
} {
  const trimmed = String(details ?? '').trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'cash') return { paymentType: 'cash', chequeNumber: '' };
  if (lower === 'online') return { paymentType: 'banktransfer', chequeNumber: '' };
  if (lower === 'dd') return { paymentType: 'dd', chequeNumber: '' };

  if (trimmed) return { paymentType: 'cheque', chequeNumber: trimmed };
  return { paymentType: '', chequeNumber: '' };
}

export function fxAdcbDetailsDisplayLabel(details: string): string {
  const trimmed = String(details ?? '').trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'cash') return 'Cash';
  if (lower === 'online') return 'Online';
  if (lower === 'dd') return 'DD';
  return trimmed;
}

export function fxAdcbInferPaymentTab(details: string): 'online' | 'cheque' | 'cash' | 'other' {
  const lower = String(details ?? '').trim().toLowerCase();
  if (lower === 'online') return 'online';
  if (lower === 'cash') return 'cash';
  if (lower === 'dd') return 'other';
  if (!lower) return 'other';
  if (lower === 'cheque') return 'cheque';
  return 'cheque';
}
