const MAX_CENTS = 900_000_000_000;
export function cents(value: unknown, label = 'Məbləğ'): number {
  if (typeof value !== 'string') throw new Error(`${label} mətn kimi verilməlidir.`);
  const s = value.trim().replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s))
    throw new Error(`${label}: müsbət ədəd və ən çox 2 qəpik rəqəmi yazın.`);
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (n > BigInt(MAX_CENTS)) throw new Error(`${label} icazə verilən həddi keçir.`);
  return Number(n);
}
export function decimal(n: number): string {
  if (!Number.isSafeInteger(n)) throw new Error('Məbləğin dəqiqlik həddi aşılıb.');
  return `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;
}
export function safe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error('Hesabatın dəqiqlik həddi aşılıb.');
  return n;
}
/** Sum in integer space: an overflowing intermediate must never round silently. */
export function sum(...values: number[]): number {
  return safe(Number(values.reduce((total, value) => total + BigInt(safe(value)), 0n)));
}
export function text(value: unknown, label: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error(`${label} düzgün doldurulmayıb.`);
  return value.trim();
}
export function optional(value: unknown, max = 500): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Mətn sahəsi düzgün deyil.');
  return value.trim();
}
export function date(value: unknown): string {
  const s = text(value, 'Tarix', 10);
  const parsed = new Date(s + 'T00:00:00Z');
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== s
  )
    throw new Error('Tarix düzgün deyil (2000–2099).');
  return s;
}
export function taxId(value: unknown): string {
  const s = text(value, 'VÖEN', 10);
  if (!/^\d{10}$/.test(s)) throw new Error('VÖEN 10 rəqəmdən ibarət olmalıdır.');
  return s;
}
