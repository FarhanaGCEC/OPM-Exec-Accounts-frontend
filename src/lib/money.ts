/** Round to 2 decimal places; normalizes -0 and near-zero to 0. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const cents = Math.round(value * 100);
  const rounded = cents / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Parse API / form values to a 2-decimal money amount. */
export function moneyFromApi(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace(/,/g, '').trim());
  return roundMoney(Number.isFinite(n) ? n : 0);
}

/** Parse edit-form money strings (commas, decimals) before PATCH. */
export function parseMoneyInput(value: unknown): number {
  return moneyFromApi(value);
}

/** Sum money using integer cents so totals match displayed row values. */
export function sumMoney(values: number[]): number {
  const totalCents = values.reduce((sum, v) => sum + Math.round(roundMoney(v) * 100), 0);
  return roundMoney(totalCents / 100);
}
