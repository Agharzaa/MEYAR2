import { useEffect, useState, type FormEvent } from 'react';
import { Check, Info, Plus } from 'lucide-react';
import { cents, decimal } from '../core/money';
import type {
  Direction,
  Invoice,
  InvoiceInput,
  PaymentDirection,
  PaymentInput,
  State,
} from '../shared/types';
import { Field, money, today } from './components';
export function InvoiceForm({
  state,
  direction,
  existing,
  newPartnerId,
  busy,
  onSave,
  onClose,
  onPartner,
}: {
  state: State;
  direction: Direction;
  existing?: Invoice;
  newPartnerId?: string;
  busy: boolean;
  onSave: (x: InvoiceInput) => Promise<void>;
  onClose: () => void;
  onPartner: () => void;
}) {
  const [vatError, setVatError] = useState('');
  const [v, set] = useState<InvoiceInput>(
    existing ?? {
      number: '',
      date: today(),
      partnerId: '',
      direction,
      kind: 'service',
      net: '',
      vat: '0.00',
      subaccount: '',
      description: '',
    },
  );
  useEffect(() => {
    if (newPartnerId) set((s) => ({ ...s, partnerId: newPartnerId }));
  }, [newPartnerId]);
  const field = <K extends keyof InvoiceInput>(key: K, value: InvoiceInput[K]) =>
    set((s) => ({ ...s, [key]: value }));
  let total = '—';
  try {
    total = money(cents(v.net) + cents(v.vat));
  } catch {
    /* incomplete form */
  }
  function calcVat() {
    try {
      field('vat', decimal(Number((BigInt(cents(v.net)) * 18n + 50n) / 100n)));
      setVatError('');
    } catch {
      setVatError('Əvvəl əsas məbləği düzgün daxil edin.');
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        void onSave(v);
      }}
    >
      <div className="form-body">
        <div className="form-grid">
          <Field label="Qaimə nömrəsi">
            <input
              disabled={busy}
              required
              autoFocus
              maxLength={80}
              value={v.number}
              onChange={(e) => field('number', e.target.value)}
              placeholder="Məsələn, MT2609…"
            />
          </Field>
          <Field label="Tarix">
            <input
              disabled={busy}
              required
              type="date"
              value={v.date}
              onChange={(e) => field('date', e.target.value)}
            />
          </Field>
          <Field label="Kontragent" full>
            <div className="input-action">
              <select
                disabled={busy}
                required
                value={v.partnerId}
                onChange={(e) => field('partnerId', e.target.value)}
              >
                <option value="">Kontragent seçin</option>
                {state.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.taxId}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Kontragent əlavə et"
                aria-label="Kontragent əlavə et"
                className="button secondary"
                disabled={busy}
                onClick={onPartner}
              >
                <Plus size={17} />
              </button>
            </div>
          </Field>
          <Field label="Əməliyyatın növü">
            <select
              disabled={busy}
              value={v.kind}
              onChange={(e) => field('kind', e.target.value as InvoiceInput['kind'])}
            >
              <option value="service">Xidmət</option>
              <option value="goods">Mal</option>
            </select>
          </Field>
          <Field
            label={
              direction === 'purchase' && v.kind === 'service'
                ? 'Subkonto · 721'
                : 'Subkonto / analitika'
            }
            hint={
              direction === 'purchase' && v.kind === 'service'
                ? 'Məsələn: rabitə, nəqliyyat, ofis xərcləri'
                : undefined
            }
          >
            <input
              disabled={busy}
              required={direction === 'purchase' && v.kind === 'service'}
              maxLength={100}
              value={v.subaccount}
              onChange={(e) => field('subaccount', e.target.value)}
              placeholder="Subkonto adı"
            />
          </Field>
          <Field label="Əsas məbləğ · AZN">
            <input
              disabled={busy}
              required
              inputMode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              value={v.net}
              onChange={(e) => field('net', e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="ƏDV məbləği · AZN">
            <div className="input-action">
              <input
                disabled={busy}
                required
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,2})?"
                value={v.vat}
                onChange={(e) => field('vat', e.target.value)}
              />
              <button
                type="button"
                className="button secondary vat-button"
                disabled={busy}
                onClick={calcVat}
                title="Əsas məbləğin 18 faizini hesabla"
              >
                18%
              </button>
            </div>
          </Field>
          <Field label="Təyinat" full>
            <textarea
              disabled={busy}
              maxLength={500}
              rows={2}
              value={v.description}
              onChange={(e) => field('description', e.target.value)}
              placeholder="Mal və ya xidmətin qısa təsviri"
            />
          </Field>
        </div>
        {vatError && <p role="alert">{vatError}</p>}
        <div className="form-total">
          <span>Qaimənin ümumi məbləği</span>
          <strong>
            {total} <small>AZN</small>
          </strong>
        </div>
        <div className="form-note">
          <Info size={16} />
          <span>
            Yadda saxlandıqda müxabirləşmə avtomatik yaranır. ƏDV məbləğini sənədə uyğun daxil edin.
            {v.kind === 'goods'
              ? ' Bu mərhələdə malların yalnız maliyyə uçotu aparılır; anbar miqdarı və maya dəyəri ayrıca hazırlanacaq.'
              : ''}
          </span>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
          Bağla
        </button>
        <button className="button primary" disabled={busy || !state.partners.length}>
          <Check size={16} />
          {busy ? 'Saxlanılır…' : existing ? 'Düzəlişi uçota al' : 'Yadda saxla və uçota al'}
        </button>
      </div>
    </form>
  );
}
export function PaymentForm({
  state,
  direction,
  busy,
  onSave,
  onClose,
}: {
  state: State;
  direction: PaymentDirection;
  busy: boolean;
  onSave: (x: PaymentInput) => Promise<void>;
  onClose: () => void;
}) {
  const [v, set] = useState<PaymentInput>({
    reference: '',
    date: today(),
    partnerId: '',
    direction,
    amount: '',
    bankAccount: '223',
    invoiceId: '',
    description: '',
  });
  const field = <K extends keyof PaymentInput>(key: K, value: PaymentInput[K]) =>
    set((s) => ({ ...s, [key]: value }));
  const invoices = state.invoices.filter(
    (i) =>
      i.partnerId === v.partnerId &&
      i.direction === (direction === 'in' ? 'sale' : 'purchase') &&
      i.status === 'posted' &&
      i.totalCents > i.paidCents,
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        void onSave(v);
      }}
    >
      <div className="form-body">
        <div className="form-grid">
          <Field label="Bank sənədinin nömrəsi">
            <input
              disabled={busy}
              required
              autoFocus
              maxLength={80}
              value={v.reference}
              onChange={(e) => field('reference', e.target.value)}
              placeholder="Ödənişin unikal nömrəsi"
            />
          </Field>
          <Field label="Ödəniş tarixi">
            <input
              disabled={busy}
              required
              type="date"
              value={v.date}
              onChange={(e) => field('date', e.target.value)}
            />
          </Field>
          <Field label="Kontragent" full>
            <select
              disabled={busy}
              required
              value={v.partnerId}
              onChange={(e) => set((s) => ({ ...s, partnerId: e.target.value, invoiceId: '' }))}
            >
              <option value="">Kontragent seçin</option>
              {state.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.taxId}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Bağlı qaimə"
            full
            hint="Boş saxlanıldıqda ödəniş kontragentin ümumi borcuna işlənir."
          >
            <select
              disabled={busy}
              value={v.invoiceId}
              onChange={(e) => field('invoiceId', e.target.value)}
            >
              <option value="">Ümumi borc üzrə ödəniş</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · qalıq: {money(i.totalCents - i.paidCents)} AZN
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bank hesabı">
            <select
              disabled={busy}
              value={v.bankAccount}
              onChange={(e) => field('bankAccount', e.target.value as PaymentInput['bankAccount'])}
            >
              <option value="223">223 · Bank hesabı</option>
              <option value="224.04">224.04 · ƏDV depozit hesabı</option>
            </select>
          </Field>
          <Field label="Məbləğ · AZN">
            <input
              disabled={busy}
              required
              inputMode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              value={v.amount}
              onChange={(e) => field('amount', e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Təyinat" full>
            <textarea
              disabled={busy}
              maxLength={500}
              rows={2}
              value={v.description}
              onChange={(e) => field('description', e.target.value)}
            />
          </Field>
        </div>
        <div className="form-note">
          <Info size={16} />
          <span>
            {direction === 'in' ? `Dt ${v.bankAccount} / Kt 211` : `Dt 531 / Kt ${v.bankAccount}`} —
            borc üzrə hesablaşma. Avanslar ayrıca modulda hazırlanacaq.
          </span>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
          Bağla
        </button>
        <button className="button primary" disabled={busy || !state.partners.length}>
          <Check size={16} />
          {busy ? 'Saxlanılır…' : 'Ödənişi uçota al'}
        </button>
      </div>
    </form>
  );
}
export function IdentityForm({
  company = false,
  busy,
  onSave,
  onClose,
}: {
  company?: boolean;
  busy: boolean;
  onSave: (name: string, tax: string) => Promise<void>;
  onClose?: () => void;
}) {
  const [name, setName] = useState(''),
    [tax, setTax] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        void onSave(name, tax);
      }}
    >
      <div className="form-body form-grid">
        <Field label={company ? 'Şirkətin adı' : 'Kontragentin adı'} full>
          <input
            disabled={busy}
            required
            autoFocus
            maxLength={240}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={company ? 'Şirkət adı MMC' : 'Kontragent adı MMC'}
          />
        </Field>
        <Field label="VÖEN" full hint="10 rəqəm. Başlanğıcdakı sıfırlar saxlanılır.">
          <input
            disabled={busy}
            required
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            placeholder="0000000000"
          />
        </Field>
      </div>
      <div className="modal-actions">
        {onClose && (
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Bağla
          </button>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Saxlanılır…' : company ? 'Şirkəti yarat' : 'Yadda saxla'}
        </button>
      </div>
    </form>
  );
}
