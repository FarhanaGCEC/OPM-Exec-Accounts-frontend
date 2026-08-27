import adcbLogo from '../assets/banks/adcb.png';
import cbdLogo from '../assets/banks/cbd.png';
import deemLogo from '../assets/banks/deem.png';
import emiratesIslamicLogo from '../assets/banks/emirates-islamic.png';
import emiratesNbdLogo from '../assets/banks/emirates-nbd.png';
import fabLogo from '../assets/banks/fab.png';
import mashreqLogo from '../assets/banks/mashreq.png';
import scbLogo from '../assets/banks/scb.png';

export type CreditCardBankLogoSrc = string;

type BankLogoRule = {
  /** Test against normalized bank name (lowercase, collapsed spaces). */
  match: (normalized: string) => boolean;
  src: CreditCardBankLogoSrc;
  alt: string;
};

const BANK_LOGO_RULES: BankLogoRule[] = [
  {
    match: (n) => n.includes('deem'),
    src: deemLogo,
    alt: 'Deem',
  },
  {
    match: (n) =>
      n.includes('emirates nbd') ||
      n.includes('enbd') ||
      /\bsunil enbd\b/.test(n) ||
      n.includes('etihad'),
    src: emiratesNbdLogo,
    alt: 'Emirates NBD',
  },
  {
    match: (n) =>
      n.includes('emirates islamic') ||
      n.includes('eib ') ||
      n.startsWith('eib') ||
      n.includes('skywards') ||
      n.includes('eib-black') ||
      n.includes('eib-rta') ||
      n.includes('eib black') ||
      n.includes('eib rta'),
    src: emiratesIslamicLogo,
    alt: 'Emirates Islamic',
  },
  {
    match: (n) => n.includes('mashreq') || n.includes('mash '),
    src: mashreqLogo,
    alt: 'Mashreq',
  },
  {
    match: (n) => n.includes('cbd') || n.includes('smiles'),
    src: cbdLogo,
    alt: 'CBD',
  },
  {
    match: (n) => n.includes('adcb') || n.includes('lulu'),
    src: adcbLogo,
    alt: 'ADCB',
  },
  {
    match: (n) => n.includes('fab') || n.includes('first abu dhabi'),
    src: fabLogo,
    alt: 'FAB',
  },
  {
    match: (n) =>
      n.includes('scb') ||
      n.includes('standard chartered') ||
      n.includes('manhattan') ||
      n.includes('journey'),
    src: scbLogo,
    alt: 'Standard Chartered',
  },
];

function normalizeBankName(bank: string): string {
  return bank
    .toLowerCase()
    .replace(/[_/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve issuing-bank label to a logo asset (or null if unknown). */
export function resolveCreditCardBankLogo(
  issuingBank: string | undefined | null
): { src: CreditCardBankLogoSrc; alt: string } | null {
  const raw = String(issuingBank ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeBankName(raw);
  for (const rule of BANK_LOGO_RULES) {
    if (rule.match(normalized)) {
      return { src: rule.src, alt: rule.alt };
    }
  }
  return null;
}
