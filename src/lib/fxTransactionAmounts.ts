import { moneyFromApi, roundMoney } from './money';

export type FxTransactionType = 'Debit' | 'Credit' | '';

/**
 * USD/GBP amount rules:
 * - Debit: main amount stays in `debit`; only `bank_charges` reduce running balance.
 * - Credit: bank charges are rolled into `credit` (not sent separately).
 * - Bank-charges-only: `bank_charges` alone (debits balance).
 */
export function buildFxDebitCreditBankChargesPayload(
  type: FxTransactionType,
  amountValue: number,
  bankChargesValue: number,
  hasAmount: boolean,
  hasBankCharges: boolean
): { debit: number; credit: number; bankCharges?: number } {
  if (hasAmount && type === 'Debit') {
    return {
      debit: roundMoney(amountValue),
      credit: 0,
      ...(hasBankCharges ? { bankCharges: roundMoney(bankChargesValue) } : {}),
    };
  }

  if (hasAmount && type === 'Credit') {
    const totalCredit = roundMoney(
      amountValue + (hasBankCharges ? bankChargesValue : 0)
    );
    return { debit: 0, credit: totalCredit };
  }

  if (!hasAmount && hasBankCharges) {
    return { debit: 0, credit: 0, bankCharges: roundMoney(bankChargesValue) };
  }

  return { debit: 0, credit: 0 };
}

/** Split stored debit/credit/bank_charges back into edit-form fields. */
export function fxEditFormAmountAndBankCharges(
  debit: unknown,
  credit: unknown,
  bankCharges: unknown
): { type: FxTransactionType; amount: string; bankCharges: string } {
  const debitVal = moneyFromApi(debit);
  const creditVal = moneyFromApi(credit);
  const chargesVal = moneyFromApi(bankCharges);

  if (debitVal > 0) {
    return {
      type: 'Debit',
      amount: String(debitVal),
      bankCharges: chargesVal > 0 ? String(chargesVal) : '',
    };
  }

  if (creditVal > 0) {
    const amount =
      chargesVal > 0 && creditVal >= chargesVal
        ? roundMoney(creditVal - chargesVal)
        : creditVal;
    return {
      type: 'Credit',
      amount: String(amount),
      bankCharges: chargesVal > 0 ? String(chargesVal) : '',
    };
  }

  return {
    type: '',
    amount: '',
    bankCharges: chargesVal > 0 ? String(chargesVal) : '',
  };
}
