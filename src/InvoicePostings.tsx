import { useEffect, useState } from 'react';
import type { DocumentPostings, InvoiceInput, State } from '../shared/types';
import { categoryAccounts } from '../shared/inventory';
import { cents, sum } from '../core/money';
import { lineAmount } from '../core/quantity';
import { api } from './api';
import { Modal, money, day } from './components';

export function InvoicePostings({
  state,
  invoiceId,
  onClose,
}: {
  state: State;
  invoiceId: string;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<DocumentPostings | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [view, setView] = useState<'entries' | 'accounts'>('entries');
  useEffect(() => {
    let live = true;
    setDocument(null);
    setError('');
    api
      .call({ op: 'invoice.postings', companyId: state.company.id, id: invoiceId })
      .then((result) => {
        if (live) setDocument(result as DocumentPostings);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [state.company.id, invoiceId]);
  const rows = document?.entries.filter((e) => history || e.version === document.version) ?? [];
  const accounts = [...new Set(rows.map((e) => e.account))].sort();
  const name = (code: string) => state.accounts.find((a) => a.code === code)?.name ?? '';
  const debit = sum(...rows.map((e) => e.debit)),
    credit = sum(...rows.map((e) => e.credit));
  return (
    <Modal
      title={'Dt/Kt · ' + (document?.number ?? 'Qaimə')}
      subtitle="Bazaya yazılmış müxabirləşmələr · AZN"
      wide
      onClose={onClose}
    >
      <div className="form-body postings-body">
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {!document && !error && <p role="status">Müxabirləşmələr yüklənir…</p>}
        {document && (
          <>
            <div className="inventory-toolbar">
              <button
                type="button"
                className={'button ' + (view === 'entries' ? 'primary' : 'secondary')}
                aria-pressed={view === 'entries'}
                onClick={() => setView('entries')}
              >
                Müxabirləşmələr
              </button>
              <button
                type="button"
                className={'button ' + (view === 'accounts' ? 'primary' : 'secondary')}
                aria-pressed={view === 'accounts'}
                onClick={() => setView('accounts')}
              >
                T-hesablar
              </button>
              <label className="postings-history">
                <input
                  type="checkbox"
                  checked={history}
                  onChange={(e) => setHistory(e.target.checked)}
                />{' '}
                Bütün versiyalar
              </label>
            </div>
            <p className="inventory-note">
              {history ? 'Bütün ilkin və əks yazılışlar' : 'Cari versiya: ' + document.version} ·{' '}
              {document.status === 'cancelled'
                ? 'Ləğv edilib — əks yazılışlar daxildir.'
                : 'Uçota alınıb.'}{' '}
              Redaktə formasındakı saxlanmamış dəyişikliklər burada göstərilmir.
            </p>
            {view === 'entries' ? (
              <div className="postings-scroll">
                <table className="postings-table" aria-label="Sənədin müxabirləşmələri">
                  <thead>
                    <tr>
                      <th>Tarix / versiya</th>
                      <th>Hesab</th>
                      <th>Analitika</th>
                      <th>Debet</th>
                      <th>Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {day(e.date)}
                          <small>
                            v{e.version}
                            {e.reversal ? ' · Əks yazılış' : ''}
                          </small>
                        </td>
                        <td>
                          <b>{e.account}</b>
                          <small>{name(e.account)}</small>
                        </td>
                        <td>{[e.partnerName, e.subaccount].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="numeric">{money(e.debit)}</td>
                        <td className="numeric">{money(e.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3}>Cəmi</th>
                      <th>{money(debit)}</th>
                      <th>{money(credit)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="t-accounts">
                {accounts.map((account) => {
                  const entries = rows.filter((e) => e.account === account);
                  const d = sum(...entries.map((e) => e.debit)),
                    c = sum(...entries.map((e) => e.credit));
                  return (
                    <section className="t-account" key={account} aria-label={'T-hesab ' + account}>
                      <h3>
                        {account} · {name(account)}
                      </h3>
                      <div className="t-sides">
                        {(['debit', 'credit'] as const).map((side) => (
                          <div key={side}>
                            <strong>{side === 'debit' ? 'Debet' : 'Kredit'}</strong>
                            {entries
                              .filter((e) => e[side] !== 0)
                              .map((e) => (
                                <div className="t-entry" key={e.id}>
                                  <span>
                                    {e.subaccount || e.partnerName || e.sourceNumber}
                                    <small>
                                      v{e.version}
                                      {e.reversal ? ' · Əks yazılış' : ''}
                                    </small>
                                  </span>
                                  <b>{money(e[side])}</b>
                                </div>
                              ))}
                            <div className="t-total">{money(side === 'debit' ? d : c)}</div>
                          </div>
                        ))}
                      </div>
                      <p className="t-balance">
                        Sənəd üzrə saldo:{' '}
                        {d === c ? '0,00' : (d > c ? 'Dt ' : 'Kt ') + money(Math.abs(d - c))}
                      </p>
                    </section>
                  );
                })}
              </div>
            )}
            {!rows.length && <p>Bu sənəd üzrə müxabirləşmə yoxdur.</p>}
            {debit !== credit && (
              <p role="alert" className="message error">
                Debet və kredit cəmləri uyğun deyil.
              </p>
            )}
          </>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Bağla
        </button>
      </div>
    </Modal>
  );
}

export function PurchasePostingPreview({
  invoice,
  state,
}: {
  invoice: InvoiceInput;
  state: State;
}) {
  if (invoice.direction !== 'purchase') return null;
  let rows: { account: string; analytic: string; amount: number }[];
  try {
    rows =
      invoice.kind === 'goods'
        ? (invoice.items ?? []).map((i) => {
            const product = state.products.find((p) => p.id === i.productId);
            const warehouse = state.warehouses.find((w) => w.id === i.warehouseId);
            if (!product || !warehouse) throw new Error('Incomplete');
            return {
              account: i.account ?? categoryAccounts[i.category],
              analytic: product.code + ' · ' + product.name + ' / ' + warehouse.name,
              amount: lineAmount(i.quantity, i.unitPrice),
            };
          })
        : [{ account: '721', analytic: invoice.subaccount, amount: cents(invoice.net) }];
    if (!rows.length || rows.some((r) => r.amount <= 0)) return null;
    const vat =
      invoice.kind === 'goods'
        ? sum(...(invoice.items ?? []).map((i) => cents(i.vat)))
        : cents(invoice.vat);
    if (vat) rows.push({ account: '241', analytic: 'ƏDV', amount: vat });
    sum(...rows.map((r) => r.amount));
  } catch {
    return (
      <p className="inventory-note">Dt/Kt ilkin baxışı üçün sətirləri və məbləğləri doldurun.</p>
    );
  }
  return (
    <section className="posting-preview" aria-label="Dt/Kt ilkin baxış">
      <strong>Dt/Kt · İlkin baxış</strong>
      <p className="inventory-note">
        Yadda saxlandıqda yaranacaq yazılışlar. Hesablaşma hesabı: 531.
      </p>
      <div className="postings-scroll">
        <table className="postings-table">
          <thead>
            <tr>
              <th>Debet</th>
              <th>Kredit</th>
              <th>Analitika</th>
              <th>Məbləğ · AZN</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.account}</td>
                <td>531</td>
                <td>{r.analytic || '—'}</td>
                <td className="numeric">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>Cəmi</th>
              <th>{money(sum(...rows.map((r) => r.amount)))}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
