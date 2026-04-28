import { normalizePdcTypeFromApi } from '../services/transactionService';

function isGcecPdcRemarks(remarks?: string | null): boolean {
  const remarksNorm = String(remarks || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return (
    remarksNorm.includes('gcec pdc') ||
    remarksNorm.includes('pdc gcec') ||
    (remarksNorm.includes('gcec') && remarksNorm.includes('pdc'))
  );
}

export function rowIsGcecPdcHighlight(remarks?: string | null, pdcType?: string): boolean {
  if (isGcecPdcRemarks(remarks)) return true;
  if (pdcType && normalizePdcTypeFromApi(pdcType) === 'GCEC PDC') return true;
  return false;
}

/**
 * Daily ledger row highlight (full-row blue in UI / Excel): bounced or returned cheque,
 * or remarks that include **Reversed Transaction** (e.g. multi-line with “Bounced cheque”).
 */
export function isBouncedChequeRemarks(remarks?: string | null): boolean {
  const remarksLower = String(remarks || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return (
    remarksLower === 'bounced cheque' ||
    remarksLower === 'bouncedcheque' ||
    remarksLower === 'bouncedchecq' ||
    remarksLower === 'returned cheque' ||
    remarksLower === 'returnedcheque' ||
    remarksLower.includes('reversed transaction') ||
    (remarksLower.includes('bounced') && remarksLower.includes('cheque')) ||
    (remarksLower.includes('returned') && remarksLower.includes('cheque'))
  );
}

export function isCustomerPdcRemarksLabel(remarks?: string | null): boolean {
  const norm = String(remarks || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return (
    norm === 'customer pdc' ||
    norm === 'pdc customer' ||
    norm === 'customerpdc'
  );
}

/**
 * **Daily Transaction** remarks for table/export: show **GCEC PDC** when applicable
 * (including when remarks are empty but `pdcType` is GCEC). Hide **Customer PDC**
 * label-only / empty Customer PDC rows; keep other remark text.
 */
export function remarksForDailyLedgerDisplay(
  remarks?: string | null,
  pdcType?: string
): string {
  const r = String(remarks ?? '').trim();
  if (r) return r;
  if (pdcType && normalizePdcTypeFromApi(pdcType) === 'Customer PDC') return 'Customer PDC';
  if (rowIsGcecPdcHighlight(remarks, pdcType)) return 'GCEC PDC';
  return '';
}
