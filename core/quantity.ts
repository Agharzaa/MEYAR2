import { safe, cents, decimal } from './money.js';
export const QUANTITY_SCALE = 1_000_000;
export function scaled(value: unknown, digits = 6, label = 'Miqdar'): number {
  if (typeof value !== 'string') throw new Error(label + ' mətn kimi verilməlidir.');
  const valueText = value.trim().replace(',', '.');
  if (!new RegExp('^\\d{1,9}(\\.\\d{1,' + digits + '})?$').test(valueText))
    throw new Error(label + ': müsbət ədəd və ən çox ' + digits + ' onluq rəqəm yazın.');
  const [whole, fraction = ''] = valueText.split('.');
  return safe(Number(BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'))));
}
export function unscaled(value: number, digits = 6): string {
  safe(value);
  const n = BigInt(value),
    abs = n < 0n ? -n : n,
    scale = 10n ** BigInt(digits);
  const fraction = String(abs % scale)
    .padStart(digits, '0')
    .replace(/0+$/, '');
  return (n < 0n ? '-' : '') + String(abs / scale) + (fraction ? '.' + fraction : '');
}
export function lineAmount(quantity: unknown, unitPrice: unknown): number {
  const q = scaled(quantity),
    p = scaled(unitPrice, 4, 'Vahid qiyməti');
  if (q <= 0 || p <= 0) throw new Error('Miqdar və vahid qiyməti sıfırdan böyük olmalıdır.');
  const amount = safe(Number((BigInt(q) * BigInt(p) + 50_000_000n) / 100_000_000n));
  cents(decimal(amount));
  if (amount <= 0) throw new Error('Sətrin məbləği ən azı 0,01 AZN olmalıdır.');
  return amount;
}
export function converted(quantity: unknown, factor: unknown): number {
  const q = scaled(quantity),
    f = scaled(factor);
  if (q <= 0 || f <= 0) throw new Error('Miqdar və çevirmə əmsalı müsbət olmalıdır.');
  const product = BigInt(q) * BigInt(f);
  if (product % 1_000_000n) throw new Error('Əsas vahiddə miqdar 6 onluq dəqiqliyini aşır.');
  return safe(Number(product / 1_000_000n));
}
