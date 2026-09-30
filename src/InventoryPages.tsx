import { useState, type FormEvent } from 'react';
import { Plus, SquarePen, Trash2 } from 'lucide-react';
import { DataTable, Field, Modal, money, day, today } from './components';
import type { Command, State } from '../shared/types';
import {
  categoryAccounts,
  inventoryAccounts,
  type ItemCategory,
  type Product,
  type ProductInput,
  type Asset,
  type StockBalance,
} from '../shared/inventory';
import type { Page } from '../shared/windows';
export const inventoryPages: Page[] = ['products', 'units', 'warehouses', 'stock', 'assets'];
export function ProductForm({
  state,
  existing,
  busy,
  onClose,
  onSave,
  onDirty,
}: {
  state: State;
  existing?: Product;
  busy: boolean;
  onClose: () => void;
  onSave: (p: ProductInput) => Promise<void>;
  onDirty?: () => void;
}) {
  const next =
    Math.max(
      0,
      ...state.products.map((p) => (/^NOM-\d+$/.test(p.code) ? Number(p.code.slice(4)) : 0)),
    ) + 1;
  const [v, set] = useState<ProductInput>(
    existing ?? {
      code: 'NOM-' + String(next).padStart(4, '0'),
      name: '',
      group: '',
      barcode: '',
      baseUnitId: 'pcs',
      purchaseUnitId: 'pcs',
      factor: '1',
      category: 'goods',
    },
  );
  const field = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => {
    onDirty?.();
    set((s) => ({ ...s, [key]: value }));
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) void onSave(v);
      }}
    >
      <div className="form-body">
        <div className="form-grid">
          <Field label="Nomenklatura kodu">
            <input
              required
              disabled={busy}
              maxLength={60}
              value={v.code}
              onChange={(e) => field('code', e.target.value)}
            />
          </Field>
          <Field label="Nomenklatura adı">
            <input
              required
              autoFocus
              disabled={busy}
              maxLength={200}
              value={v.name}
              onChange={(e) => field('name', e.target.value)}
            />
          </Field>
          <Field label="Qrup">
            <input
              disabled={busy}
              maxLength={100}
              value={v.group}
              onChange={(e) => field('group', e.target.value)}
            />
          </Field>
          <Field label="Barkod / artikul">
            <input
              disabled={busy}
              maxLength={80}
              value={v.barcode}
              onChange={(e) => field('barcode', e.target.value)}
            />
          </Field>
          <Field label="Əsas ölçü vahidi">
            <select
              disabled={busy}
              value={v.baseUnitId}
              onChange={(e) => {
                onDirty?.();
                set((s) => ({
                  ...s,
                  baseUnitId: e.target.value,
                  purchaseUnitId: e.target.value,
                  factor: '1',
                }));
              }}
            >
              {state.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Alış / qablaşdırma vahidi">
            <select
              disabled={busy}
              value={v.purchaseUnitId}
              onChange={(e) => {
                onDirty?.();
                set((s) => ({
                  ...s,
                  purchaseUnitId: e.target.value,
                  factor: e.target.value === s.baseUnitId ? '1' : s.factor,
                }));
              }}
            >
              {state.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Bir alış vahidində əsas vahid sayı"
            hint="Məsələn, 1 qutu = 12 ədəd üçün 12 yazın."
          >
            <input
              required
              inputMode="decimal"
              disabled={busy || v.baseUnitId === v.purchaseUnitId}
              value={v.factor}
              onChange={(e) => field('factor', e.target.value)}
            />
          </Field>
          <Field label="İlkin uçot hesabı">
            <select
              disabled={busy}
              value={v.account ?? categoryAccounts[v.category]}
              onChange={(e) => {
                const a = inventoryAccounts.find((a) => a.code === e.target.value)!;
                onDirty?.();
                set((s) => ({ ...s, account: a.code, category: a.category }));
              }}
            >
              {inventoryAccounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="form-note">
          Seçilmiş hesab qaimə sətrinə avtomatik gəlir; sənəddə dəyişmək mümkündür. Əsas vahid üzrə
          anbar qalığı saxlanılır. Hərəkət yarandıqdan sonra vahidlər və çevirmə əmsalı
          dəyişdirilmir.
        </p>
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
          Bağla
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? 'Saxlanılır…' : 'Nomenklaturanı saxla'}
        </button>
      </div>
    </form>
  );
}
type Editor =
  | { kind: 'product'; product?: Product }
  | { kind: 'unit' }
  | { kind: 'warehouse' }
  | { kind: 'issue'; stock: StockBalance }
  | { kind: 'commission'; asset: Asset }
  | { kind: 'cancelIssue' | 'cancelCommission'; id: string };
export function InventoryPanel({
  state,
  page,
  busy,
  search,
  onSave,
  operationError,
}: {
  state: State;
  page: Page;
  busy: boolean;
  search: string;
  operationError?: string;
  onSave: (command: Command) => Promise<boolean>;
}) {
  const [editor, setEditor] = useState<Editor | null>(null),
    [query, setQuery] = useState(''),
    [movements, setMovements] = useState(false),
    [warehouse, setWarehouse] = useState('');
  const [error, setError] = useState(''),
    [code, setCode] = useState(''),
    [name, setName] = useState(''),
    [reference, setReference] = useState(''),
    [date, setDate] = useState(today()),
    [quantity, setQuantity] = useState(''),
    [subaccount, setSubaccount] = useState(''),
    [location, setLocation] = useState(''),
    [responsible, setResponsible] = useState(''),
    [months, setMonths] = useState(''),
    [reason, setReason] = useState('');
  const match = (value: string) =>
    value
      .toLocaleLowerCase('az')
      .includes((page === 'stock' ? search : query).trim().toLocaleLowerCase('az'));
  function edit(e: Editor) {
    setError('');
    setCode('');
    setName('');
    setQuantity('');
    setSubaccount('');
    setDate(today());
    setLocation('');
    setResponsible('');
    setMonths('');
    setReason('');
    setReference(
      e.kind === 'commission'
        ? e.asset.inventoryNumber
        : 'IST-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
    );
    setEditor(e);
  }
  async function save(command: Command) {
    try {
      if (await onSave(command)) {
        setEditor(null);
        setError('');
      } else setError('Əməliyyat saxlanmadı. Bölmədə göstərilən xəta səbəbini yoxlayın.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !editor) return;
    if (editor.kind === 'warehouse')
      await save({ op: 'warehouse.save', companyId: state.company.id, name });
    if (editor.kind === 'unit')
      await save({ op: 'unit.save', companyId: state.company.id, code, name });
    if (editor.kind === 'issue')
      await save({
        op: 'stock.issue',
        companyId: state.company.id,
        issue: {
          reference,
          date,
          productId: editor.stock.productId,
          warehouseId: editor.stock.warehouseId,
          quantity,
          subaccount,
        },
      });
    if (editor.kind === 'commission')
      await save({
        op: 'asset.commission',
        companyId: state.company.id,
        asset: {
          id: editor.asset.id,
          date,
          inventoryNumber: reference,
          location,
          responsible,
          usefulLifeMonths: Number(months),
        },
      });
    if (editor.kind === 'cancelIssue' || editor.kind === 'cancelCommission')
      await save({
        op: editor.kind === 'cancelIssue' ? 'stock.issue.cancel' : 'asset.commission.cancel',
        companyId: state.company.id,
        id: editor.id,
        reason,
      });
  }
  return (
    <div className="inventory-panel">
      <div className="inventory-toolbar">
        {page === 'products' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => edit({ kind: 'product' })}
          >
            <Plus size={15} />
            Yeni nomenklatura
          </button>
        )}
        {page === 'warehouses' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => edit({ kind: 'warehouse' })}
          >
            Anbar əlavə et
          </button>
        )}
        {page === 'units' && (
          <button className="button primary" disabled={busy} onClick={() => edit({ kind: 'unit' })}>
            Ölçü vahidi əlavə et
          </button>
        )}
        {page === 'stock' && (
          <>
            <button
              className={'button ' + (!movements ? 'primary' : 'secondary')}
              onClick={() => setMovements(false)}
            >
              Qalıqlar
            </button>
            <button
              className={'button ' + (movements ? 'primary' : 'secondary')}
              onClick={() => setMovements(true)}
            >
              Hərəkətlər
            </button>
            <select
              aria-label="Anbar seçimi"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              <option value="">Bütün anbarlar</option>
              {state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <span className="muted small">{day(state.report.to)} tarixinə · əsas vahidlə</span>
          </>
        )}
        {page !== 'stock' && (
          <input
            className="inventory-search"
            aria-label="Kitabçada axtar"
            placeholder="Ad, kod və ya nömrə ilə axtar…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      {page === 'products' && (
        <DataTable
          rows={state.products.filter((p) =>
            match(p.code + ' ' + p.name + ' ' + p.group + ' ' + p.barcode),
          )}
          columns={[
            { key: 'code', label: 'Kod', render: (p) => p.code },
            {
              key: 'name',
              label: 'Nomenklatura',
              render: (p) => (
                <button className="text-link" onClick={() => edit({ kind: 'product', product: p })}>
                  {p.name}
                </button>
              ),
            },
            { key: 'group', label: 'Qrup', render: (p) => p.group },
            { key: 'unit', label: 'Əsas vahid', render: (p) => p.baseUnitName },
            {
              key: 'pack',
              label: 'Alış vahidi / çevirmə',
              render: (p) => p.purchaseUnitName + ' = ' + p.factor + ' ' + p.baseUnitName,
            },
            {
              key: 'category',
              label: 'Uçot hesabı',
              render: (p) =>
                p.account + ' · ' + inventoryAccounts.find((a) => a.code === p.account)?.name,
            },
            { key: 'barcode', label: 'Barkod / artikul', render: (p) => p.barcode },
          ]}
        />
      )}
      {page === 'warehouses' && (
        <DataTable
          rows={state.warehouses.filter((w) => match(w.name))}
          columns={[{ key: 'name', label: 'Anbarın adı', render: (w) => w.name }]}
        />
      )}
      {page === 'units' && (
        <DataTable
          rows={state.units.filter((u) => match(u.id + ' ' + u.name))}
          columns={[
            { key: 'code', label: 'Kod', render: (u) => u.id },
            { key: 'name', label: 'Ölçü vahidi', render: (u) => u.name },
          ]}
        />
      )}
      {page === 'stock' && !movements && (
        <DataTable
          rows={state.stock.filter(
            (s) =>
              (!warehouse || s.warehouseId === warehouse) &&
              match(s.productCode + ' ' + s.productName),
          )}
          columns={[
            { key: 'code', label: 'Kod', render: (s) => s.productCode },
            { key: 'name', label: 'Nomenklatura', render: (s) => s.productName },
            { key: 'warehouse', label: 'Anbar', render: (s) => s.warehouseName },
            {
              key: 'category',
              label: 'Uçot hesabı',
              render: (s) =>
                categoryAccounts[s.category] +
                ' · ' +
                inventoryAccounts.find((a) => a.category === s.category)?.name,
            },
            { key: 'quantity', label: 'Miqdar', numeric: true, render: (s) => s.quantity },
            { key: 'unit', label: 'Vahid', render: (s) => s.unitName },
            {
              key: 'value',
              label: 'Dəyər · AZN',
              numeric: true,
              render: (s) => money(s.valueCents),
            },
            {
              key: 'action',
              label: '',
              render: (s) =>
                s.category === 'material' && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => edit({ kind: 'issue', stock: s })}
                  >
                    İstifadəyə ver
                  </button>
                ),
            },
          ]}
        />
      )}
      {page === 'stock' && movements && (
        <>
          <div className="inventory-note">
            Seçilmiş dövrün son 1000 hərəkəti. Çıxışlar orta çəkili maya dəyəri ilə hesablanır.
          </div>
          <DataTable
            rows={state.stockMovements.filter(
              (m) =>
                (!warehouse ||
                  m.warehouseName === state.warehouses.find((w) => w.id === warehouse)?.name) &&
                match(m.productName + ' ' + m.sourceNumber),
            )}
            columns={[
              { key: 'date', label: 'Tarix', render: (m) => day(m.date) },
              {
                key: 'doc',
                label: 'Sənəd',
                render: (m) => m.sourceNumber + (m.reversal ? ' · ləğv' : ''),
              },
              { key: 'product', label: 'Nomenklatura', render: (m) => m.productName },
              { key: 'warehouse', label: 'Anbar', render: (m) => m.warehouseName },
              {
                key: 'quantity',
                label: 'Miqdar',
                numeric: true,
                render: (m) => m.quantity + ' ' + m.unitName,
              },
              {
                key: 'value',
                label: 'Dəyər · AZN',
                numeric: true,
                render: (m) => money(m.valueCents),
              },
              {
                key: 'action',
                label: '',
                render: (m) =>
                  m.sourceType === 'issue' &&
                  !m.reversal &&
                  !state.stockMovements.some(
                    (r) => r.sourceType === 'issue' && r.sourceId === m.sourceId && r.reversal,
                  ) && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => edit({ kind: 'cancelIssue', id: m.sourceId })}
                    >
                      Ləğv et
                    </button>
                  ),
              },
            ]}
          />
        </>
      )}
      {page === 'assets' && (
        <>
          <div className="inventory-note">
            Alışda inventar kartı yaranır. İstismara vermə ayrıca uçota alınır. Amortizasiya
            hesablanması bu mərhələyə daxil deyil.
          </div>
          <DataTable
            rows={state.assets.filter((a) =>
              match(a.inventoryNumber + ' ' + a.productName + ' ' + a.invoiceNumber),
            )}
            columns={[
              { key: 'number', label: 'İnventar №', render: (a) => a.inventoryNumber },
              { key: 'name', label: 'Əsas vəsait', render: (a) => a.productName },
              { key: 'doc', label: 'Alış qaiməsi', render: (a) => a.invoiceNumber },
              {
                key: 'value',
                label: 'İlkin dəyər · AZN',
                numeric: true,
                render: (a) => money(a.costCents),
              },
              {
                key: 'status',
                label: 'Vəziyyət',
                render: (a) =>
                  a.status === 'pending'
                    ? 'İstismara verilməyib'
                    : a.status === 'active'
                      ? 'İstismardadır'
                      : 'Ləğv edilib',
              },
              {
                key: 'location',
                label: 'Yer / məsul şəxs',
                render: (a) => [a.location, a.responsible].filter(Boolean).join(' · '),
              },
              {
                key: 'date',
                label: 'İstismar / müddət',
                render: (a) =>
                  a.commissionedDate
                    ? day(a.commissionedDate) + ' · ' + a.usefulLifeMonths + ' ay'
                    : '—',
              },
              {
                key: 'action',
                label: '',
                render: (a) =>
                  a.status !== 'cancelled' && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        edit(
                          a.status === 'pending'
                            ? { kind: 'commission', asset: a }
                            : { kind: 'cancelCommission', id: a.id },
                        )
                      }
                    >
                      {a.status === 'pending' ? 'İstismara ver' : 'İstismarı ləğv et'}
                    </button>
                  ),
              },
            ]}
          />
        </>
      )}
      {editor && (
        <Modal
          title={
            editor.kind === 'product'
              ? 'Nomenklatura kartı'
              : editor.kind === 'warehouse'
                ? 'Yeni anbar'
                : editor.kind === 'unit'
                  ? 'Yeni ölçü vahidi'
                  : editor.kind === 'issue'
                    ? 'Materialın istifadəyə verilməsi'
                    : editor.kind === 'commission'
                      ? 'Əsas vəsaitin istismara verilməsi'
                      : 'Əməliyyatı ləğv et'
          }
          onClose={() => {
            if (!busy) setEditor(null);
          }}
        >
          {error && (
            <p className="message error" role="alert">
              {operationError || error}
            </p>
          )}
          {editor.kind === 'product' ? (
            <ProductForm
              state={state}
              existing={editor.product}
              busy={busy}
              onClose={() => setEditor(null)}
              onSave={(product) =>
                save({ op: 'product.save', companyId: state.company.id, product })
              }
            />
          ) : (
            <form onSubmit={submit}>
              <div className="form-body">
                <div className="form-grid">
                  {(editor.kind === 'unit' || editor.kind === 'warehouse') && (
                    <>
                      {editor.kind === 'unit' && (
                        <Field label="Vahid kodu">
                          <input
                            required
                            disabled={busy}
                            maxLength={20}
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                          />
                        </Field>
                      )}
                      <Field label={editor.kind === 'unit' ? 'Vahid adı' : 'Anbar adı'}>
                        <input
                          required
                          disabled={busy}
                          maxLength={editor.kind === 'unit' ? 30 : 100}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  {(editor.kind === 'issue' || editor.kind === 'commission') && (
                    <>
                      <Field
                        label={
                          editor.kind === 'issue' ? 'İstifadə sənədi nömrəsi' : 'İnventar nömrəsi'
                        }
                      >
                        <input
                          required
                          disabled={busy}
                          maxLength={80}
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </Field>
                      <Field label="Əməliyyat tarixi">
                        <input
                          required
                          disabled={busy}
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  {editor.kind === 'issue' && (
                    <>
                      <Field
                        label={'Miqdar · ' + editor.stock.unitName}
                        hint={'Anbar: ' + editor.stock.warehouseName}
                      >
                        <input
                          required
                          disabled={busy}
                          inputMode="decimal"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                        />
                      </Field>
                      <Field label="Xərc subkontosu · 721">
                        <input
                          required
                          disabled={busy}
                          maxLength={100}
                          value={subaccount}
                          onChange={(e) => setSubaccount(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  {editor.kind === 'commission' && (
                    <>
                      <Field label="Yerləşdiyi yer">
                        <input
                          required
                          disabled={busy}
                          maxLength={150}
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                        />
                      </Field>
                      <Field label="Məsul şəxs">
                        <input
                          required
                          disabled={busy}
                          maxLength={150}
                          value={responsible}
                          onChange={(e) => setResponsible(e.target.value)}
                        />
                      </Field>
                      <Field label="Faydalı istifadə müddəti · ay">
                        <input
                          required
                          disabled={busy}
                          type="number"
                          min="1"
                          max="1200"
                          step="1"
                          value={months}
                          onChange={(e) => setMonths(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  {(editor.kind === 'cancelIssue' || editor.kind === 'cancelCommission') && (
                    <Field label="Ləğv səbəbi" full>
                      <textarea
                        required
                        disabled={busy}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={240}
                      />
                    </Field>
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  Bağla
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? 'Saxlanılır…' : 'Yadda saxla'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
