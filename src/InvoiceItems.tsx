import { Plus, Trash2 } from 'lucide-react';
import { lineAmount } from '../core/quantity';
import { decimal } from '../core/money';
import { categoryAccounts, inventoryAccounts, type InvoiceItemInput } from '../shared/inventory';
import type { State, Direction } from '../shared/types';
export const emptyItem = (state: State): InvoiceItemInput => ({
  productId: '',
  warehouseId: state.warehouses[0]?.id ?? '',
  category: 'goods',
  account: '205',
  unitId: 'pcs',
  quantity: '1',
  unitPrice: '',
  vat: '0.00',
});
export function InvoiceItems({
  state,
  items,
  direction,
  busy,
  onChange,
  onProduct,
}: {
  state: State;
  items: InvoiceItemInput[];
  direction: Direction;
  busy: boolean;
  onChange: (items: InvoiceItemInput[]) => void;
  onProduct: (index: number) => void;
}) {
  const patch = (index: number, change: Partial<InvoiceItemInput>) =>
    onChange(items.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return (
    <section className="invoice-items">
      <div className="inventory-toolbar">
        <strong>Nomenklatura sətirləri</strong>
        <button
          type="button"
          className="button secondary"
          disabled={busy || items.length >= 100}
          onClick={() => onChange([...items, emptyItem(state)])}
        >
          <Plus size={15} />
          Sətir əlavə et
        </button>
      </div>
      <div className="invoice-items-scroll">
        <table>
          <thead>
            <tr>
              {[
                'Nomenklatura',
                'Uçot hesabı',
                'Anbar',
                'Miqdar',
                'Vahid',
                'Vahid qiyməti',
                'Əsas məbləğ',
                'ƏDV',
                '',
              ].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => {
              const product = state.products.find((p) => p.id === row.productId);
              const units = state.units.filter(
                (u) => u.id === product?.baseUnitId || u.id === product?.purchaseUnitId,
              );
              let amount = '—';
              try {
                amount = decimal(lineAmount(row.quantity, row.unitPrice));
              } catch {
                /* incomplete row */
              }
              return (
                <tr key={index}>
                  <td className="item-name">
                    <div className="input-action">
                      <select
                        required
                        aria-label={'Nomenklatura ' + (index + 1)}
                        disabled={busy}
                        value={row.productId}
                        onChange={(e) => {
                          const p = state.products.find((p) => p.id === e.target.value);
                          patch(index, {
                            productId: e.target.value,
                            unitId: p?.purchaseUnitId ?? 'pcs',
                            category:
                              direction === 'sale' && p?.category === 'asset'
                                ? 'goods'
                                : (p?.category ?? 'goods'),
                            account:
                              direction === 'sale' && p?.category === 'asset'
                                ? '205'
                                : (p?.account ?? '205'),
                          });
                        }}
                      >
                        <option value="">Nomenklatura seçin</option>
                        {state.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} · {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={'Yeni nomenklatura ' + (index + 1)}
                        disabled={busy}
                        onClick={() => onProduct(index)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={'Uçot hesabı ' + (index + 1)}
                      disabled={busy}
                      value={row.account ?? categoryAccounts[row.category]}
                      onChange={(e) => {
                        const selected = inventoryAccounts.find((a) => a.code === e.target.value)!;
                        patch(index, { account: selected.code, category: selected.category });
                      }}
                    >
                      {inventoryAccounts
                        .filter((a) => direction === 'purchase' || a.code !== '113')
                        .map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <select
                      required
                      aria-label={'Anbar ' + (index + 1)}
                      disabled={busy}
                      value={row.warehouseId}
                      onChange={(e) => patch(index, { warehouseId: e.target.value })}
                    >
                      {state.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      required
                      aria-label={'Miqdar ' + (index + 1)}
                      disabled={busy}
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) => patch(index, { quantity: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      required
                      aria-label={'Vahid ' + (index + 1)}
                      disabled={busy || !product}
                      value={row.unitId}
                      onChange={(e) => patch(index, { unitId: e.target.value })}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      required
                      aria-label={'Vahid qiyməti ' + (index + 1)}
                      disabled={busy}
                      inputMode="decimal"
                      value={row.unitPrice}
                      onChange={(e) => patch(index, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td className="item-amount">{amount}</td>
                  <td>
                    <input
                      required
                      aria-label={'Sətir ƏDV-si ' + (index + 1)}
                      disabled={busy}
                      inputMode="decimal"
                      value={row.vat}
                      onChange={(e) => patch(index, { vat: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={'Sətri sil ' + (index + 1)}
                      disabled={busy}
                      onClick={() => onChange(items.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="inventory-note">
        Miqdar seçilmiş vahidlə daxil edilir; anbara əsas vahidlə işlənir. Əsas vəsait üçün hər ədəd
        üzrə inventar kartı yaranır.
      </p>
    </section>
  );
}
