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

/** Remarks that are only a PDC type label (not a user note). */
export function isPdcTypeLabelRemarks(remarks?: string | null): boolean {
  const norm = String(remarks ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  if (!norm) return false;
  return (
    norm === 'customer pdc' ||
    norm === 'gcec pdc' ||
    norm === 'custom pdc' ||
    norm === 'pdc customer' ||
    norm === 'pdc gcec' ||
    norm === 'pdc custom'
  );
}

export type DailyLedgerRemarksDisplayOptions = {
  /** Approved GCEC PDC: do not inject the "GCEC PDC" fallback label in Remarks. */
  omitGcecFallback?: boolean;
  /** When set (incl. `null`), approved GCEC uses this instead of remarks / pdcType. */
  description?: string | null;
};

/**
 * **Daily Transaction** remarks for table/export: show **GCEC PDC** when applicable
 * (including when remarks are empty but `pdcType` is GCEC). For Customer PDC,
 * only real remarks text is shown; no auto "Customer PDC" label is injected.
 */
export function remarksForDailyLedgerDisplay(
  remarks?: string | null,
  pdcType?: string,
  opts?: DailyLedgerRemarksDisplayOptions
): string {
  if (opts?.omitGcecFallback) {
    if (opts.description !== undefined) {
      if (opts.description === null) return '';
      const d = String(opts.description).trim();
      if (!d || isPdcTypeLabelRemarks(d)) return '';
      return d;
    }
    const r = String(remarks ?? '').trim();
    if (r && !isPdcTypeLabelRemarks(r)) return r;
    return '';
  }

  const r = String(remarks ?? '').trim();
  if (r) return r;
  if (rowIsGcecPdcHighlight(remarks, pdcType)) return 'GCEC PDC';
  return '';
}
