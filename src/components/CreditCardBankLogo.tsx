import { resolveCreditCardBankLogo } from '../lib/creditCardBankLogo';

type CreditCardBankLogoProps = {
  issuingBank: string | undefined | null;
  /** Pixel size of the square logo box. */
  size?: number;
  className?: string;
  /** Show bank name next to the logo. */
  showName?: boolean;
  /** Override name text (defaults to issuingBank). */
  name?: string;
};

/**
 * Issuing-bank logo for credit card / statement tables.
 * Falls back to name-only when no asset matches.
 */
export default function CreditCardBankLogo({
  issuingBank,
  size = 28,
  className = '',
  showName = false,
  name,
}: CreditCardBankLogoProps) {
  const logo = resolveCreditCardBankLogo(issuingBank);
  const label = (name ?? String(issuingBank ?? '').trim()) || '—';

  if (!logo && !showName) {
    return <span className={className}>{label}</span>;
  }

  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      {logo ? (
        <span
          className="inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-transparent"
          style={{ width: size, height: size }}
          title={logo.alt}
        >
          <img
            src={logo.src}
            alt={logo.alt}
            className="h-full w-full object-contain p-0.5"
            loading="lazy"
            decoding="async"
          />
        </span>
      ) : null}
      {showName || !logo ? (
        <span className="min-w-0 truncate font-medium text-gray-700">{label}</span>
      ) : null}
    </span>
  );
}
