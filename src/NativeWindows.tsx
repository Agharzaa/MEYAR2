import { useEffect, useRef, useState } from 'react';
import { X, Minus, Maximize2 } from 'lucide-react';
import type { Command, Invoice, State } from '../shared/types';
import {
  windowTitles,
  type OpenWindow,
  type WindowContext,
  type WindowBridge,
} from '../shared/windows';
import { api } from './api';
import { InvoiceForm, PaymentForm, IdentityForm } from './forms';
import { Modal, today } from './components';
export function NativeWindowBar({
  context,
  windowBridge,
}: {
  context: WindowContext;
  windowBridge?: WindowBridge;
}) {
  const bridge = () => windowBridge ?? window.meyar?.windows;
  const [items, setItems] = useState<OpenWindow[]>([]);
  useEffect(() => {
    const w = bridge();
    if (!w) return;
    let live = true;
    const refresh = () =>
      void w
        .list()
        .then((items) => {
          if (live) setItems(items);
        })
        .catch(() => {});
    const remove = w.onChanged(refresh);
    refresh();
    return () => {
      live = false;
      remove();
    };
  }, []);
  return (
    <footer className="workspace-footer native-window-bar" aria-label="Açıq daxili pəncərələr">
      <div className="workspace-tabs">
        {items.map((item) => (
          <div className={`workspace-tab ${context.id === item.id ? 'active' : ''}`} key={item.id}>
            <button
              title={item.title}
              aria-current={context.id === item.id ? 'page' : undefined}
              onClick={() => void bridge()?.focus(item.id)}
            >
              {item.dirty ? '● ' : ''}
              {item.title.replace(' — Meyar ERP', '')}
            </button>
            {item.page !== 'home' && (
              <button
                className="tab-close"
                aria-label={`${item.title} bağla`}
                onClick={() => void bridge()?.close(item.id)}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </footer>
  );
}
export function NativeDocument({
  context,
  windowBridge,
  hideWindowBar = false,
}: {
  context: WindowContext;
  windowBridge?: WindowBridge;
  hideWindowBar?: boolean;
}) {
  const bridge = () => windowBridge ?? window.meyar?.windows;
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [partner, setPartner] = useState(false),
    [partnerId, setPartnerId] = useState('');
  const original = useRef<Invoice | undefined>(undefined),
    initialized = useRef(false),
    locked = useRef(false),
    sequence = useRef(0);
  async function load() {
    const seq = ++sequence.current;
    try {
      const data = (await api.call({
        op: 'state',
        companyId: context.companyId,
        filter: { from: '2000-01-01', to: today(), account: '' },
      })) as State;
      if (seq !== sequence.current) return;
      if (!initialized.current) {
        if (context.documentId) {
          const invoice = data.invoices.find((i) => i.id === context.documentId);
          if (!invoice || invoice.direction !== context.page || invoice.status !== 'posted')
            throw new Error('Qaimə tapılmadı və ya artıq ləğv edilib.');
          original.current = invoice;
        }
        initialized.current = true;
      }
      setState(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    const remove = bridge()?.onDataChanged((id) => {
      if (id === context.companyId && !locked.current) void load();
    });
    return () => {
      sequence.current++;
      remove?.();
    };
  }, []);
  const markDirty = (dirty: boolean) => {
    void bridge()?.setDirty(dirty);
  };
  const close = () => {
    if (!locked.current) void bridge()?.close();
  };
  async function save(command: Command) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await api.call(command);
      await bridge()?.setDirty(false);
      await bridge()?.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="native-document-shell">
      <header className="native-document-heading">
        <div>
          <h1>
            {context.documentId
              ? 'Qaiməyə düzəliş'
              : context.form === 'invoice'
                ? 'Yeni qaimə'
                : 'Yeni ödəniş'}
          </h1>
          <p>
            {state?.company.name} · {windowTitles[context.page]}
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            title="Aşağı yığ"
            aria-label="Sənədi aşağı yığ"
            onClick={() => void bridge()?.minimize()}
          >
            <Minus size={16} />
          </button>
          <button
            className="icon-button"
            title="Böyüt / əvvəlki ölçü"
            aria-label="Sənədin ölçüsünü dəyiş"
            onClick={() => void bridge()?.maximize()}
          >
            <Maximize2 size={16} />
          </button>
          <button
            className="icon-button"
            title="Bağla"
            aria-label="Sənədi bağla"
            disabled={busy}
            onClick={close}
          >
            <X size={16} />
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void bridge()?.open({
                page: context.page === 'purchase' ? 'bank-out' : 'bank-in',
                companyId: context.companyId,
              })
            }
          >
            Bank
          </button>
          <button
            className="button secondary"
            onClick={() => void bridge()?.open({ page: 'trial', companyId: context.companyId })}
          >
            Dövriyyə balansı
          </button>
        </div>
      </header>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {!state ? (
        <div className="form-body">
          <p>{error ? 'Sənəd açıla bilmədi.' : 'Sənəd açılır…'}</p>
          <button className="button secondary" onClick={close}>
            Bağla
          </button>
        </div>
      ) : (
        <div className="native-document-body">
          {context.form === 'invoice' ? (
            <InvoiceForm
              state={state}
              direction={context.page === 'purchase' ? 'purchase' : 'sale'}
              existing={original.current}
              newPartnerId={partnerId}
              busy={busy}
              onDirtyChange={markDirty}
              onClose={close}
              onPartner={() => setPartner(true)}
              onSave={(invoice) =>
                save({ op: 'invoice.save', companyId: context.companyId, invoice })
              }
            />
          ) : (
            <PaymentForm
              state={state}
              direction={context.page === 'bank-in' ? 'in' : 'out'}
              busy={busy}
              onDirtyChange={markDirty}
              onClose={close}
              onSave={(payment) =>
                save({ op: 'payment.save', companyId: context.companyId, payment })
              }
            />
          )}
        </div>
      )}
      {!hideWindowBar && <NativeWindowBar context={context} windowBridge={windowBridge} />}
      {partner && (
        <Modal
          title="Kontragent əlavə et"
          onClose={() => {
            if (!busy) setPartner(false);
          }}
        >
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <IdentityForm
            busy={busy}
            onClose={() => setPartner(false)}
            onSave={async (name, taxId) => {
              if (locked.current) return;
              locked.current = true;
              setBusy(true);
              try {
                const result = await api.call({
                  op: 'partner.save',
                  companyId: context.companyId,
                  name,
                  taxId,
                });
                await load();
                if ('id' in result && result.id) setPartnerId(result.id);
                setPartner(false);
                markDirty(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                locked.current = false;
                setBusy(false);
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}
