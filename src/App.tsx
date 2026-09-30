import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Download,
  FileDown,
  FileInput,
  FileOutput,
  FileSpreadsheet,
  FolderOpen,
  Home,
  Landmark,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  Command,
  ImportRow,
  Invoice,
  InvoiceInput,
  MutationResult,
  Payment,
  PaymentInput,
  ReportFilter,
  State,
} from '../shared/types';
import { api } from './api';
import type { Page, WindowContext, WindowBridge } from '../shared/windows';
import {InventoryPanel,inventoryPages} from './InventoryPages';
import { NativeWindowBar } from './NativeWindows';
import {
  DataTable,
  Empty,
  Field,
  Modal,
  Status,
  day,
  money,
  today,
  type Column,
  type TableView,
} from './components';
import { IdentityForm, InvoiceForm, PaymentForm } from './forms';
const pages: Record<Page, { title: string; icon: typeof Home; subtitle: string }> = {
  products:{title:'Nomenklatura',icon:FolderOpen,subtitle:'Məhsul kartları, vahidlər və qablaşdırma çevirməsi'},
  units:{title:'Ölçü vahidləri',icon:BookOpen,subtitle:'Ədəd, litr, cüt və digər vahidlər'},
  warehouses:{title:'Anbarlar',icon:FolderOpen,subtitle:'Şirkətin anbar kitabçası'},
  stock:{title:'Anbar uçotu',icon:FolderOpen,subtitle:'Nomenklatura üzrə miqdar və maya dəyəri'},
  assets:{title:'Əsas vəsaitlər',icon:Building2,subtitle:'İnventar kartları və istismara vermə'},
  home: {
    title: 'İş masası',
    icon: Home,
    subtitle: 'Gündəlik işlərin və son əməliyyatların icmalı',
  },
  purchase: {
    title: 'Gələn qaimələr',
    icon: FileInput,
    subtitle: 'Alış sənədləri və kreditor hesablaşmaları',
  },
  sale: {
    title: 'Gedən qaimələr',
    icon: FileOutput,
    subtitle: 'Satış sənədləri və debitor hesablaşmaları',
  },
  'bank-in': {
    title: 'Daxil olan ödənişlər',
    icon: ArrowDownLeft,
    subtitle: 'Alıcılardan daxilolmalar · bank və ƏDV depoziti',
  },
  'bank-out': {
    title: 'Çıxan ödənişlər',
    icon: ArrowUpRight,
    subtitle: 'Malsatanlara ödənişlər · bank və ƏDV depoziti',
  },
  trial: {
    title: 'Dövriyyə balans cədvəli',
    icon: BookOpen,
    subtitle: 'Hesablar üzrə açılış qalığı, dövriyyə və son qalıq',
  },
  ledger: {
    title: 'Müxabirləşmə jurnalı',
    icon: ClipboardList,
    subtitle: 'Sənədlərdən yaranan bütün debet və kredit yazılışları',
  },
  partners: {
    title: 'Kontragentlər',
    icon: Users,
    subtitle: 'VÖEN üzrə vahid kontragent kitabçası',
  },
  receivables: {
    title: 'Debitorlar · 211',
    icon: Users,
    subtitle: 'Seçilmiş dövrün sonuna alıcılar üzrə xalis qalıq',
  },
  payables: {
    title: 'Kreditorlar · 531',
    icon: Users,
    subtitle: 'Seçilmiş dövrün sonuna malsatanlar üzrə xalis qalıq',
  },
  accounts: { title: 'Hesab planı', icon: BookOpen, subtitle: 'Uçotda istifadə edilən hesablar' },
  audit: {
    title: 'Əməliyyat tarixçəsi',
    icon: ShieldCheck,
    subtitle: 'Sənədlərin və parametrlərin son 300 dəyişiklik qeydi',
  },
  settings: {
    title: 'Şirkət və proqram',
    icon: Settings2,
    subtitle: 'Uçot dövrü, ehtiyat nüsxə və proqram haqqında',
  },
};
type ModalState =
  | { kind: 'invoice'; existing?: Invoice }
  | { kind: 'payment' }
  | { kind: 'partner' }
  | { kind: 'company' }
  | { kind: 'cancel'; type: 'invoice' | 'payment'; id: string; number: string }
  | { kind: 'import'; rows: ImportRow[]; direction: 'purchase' | 'sale' }
  | { kind: 'period' }
  | null;
const initialFilter: ReportFilter = {
  from: `${today().slice(0, 4)}-01-01`,
  to: today(),
  account: '',
};
type WindowState = {
  filter: ReportFilter;
  draft: ReportFilter;
  search: string;
  table: TableView;
  restored: boolean;
};
const initialWindow: WindowState = {
  filter: initialFilter,
  draft: initialFilter,
  search: '',
  table: { page: 0, size: 25 },
  restored: false,
};
function Message({
  children,
  type = 'error',
  onClose,
}: {
  children: ReactNode;
  type?: 'error' | 'success';
  onClose?: () => void;
}) {
  return (
    <div role={type === 'error' ? 'alert' : 'status'} className={`message ${type}`}>
      <span>{children}</span>
      {onClose && (
        <button aria-label="Bildirişi bağla" onClick={onClose}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export default function App({
  nativeContext,
  windowBridge,
  hideWindowBar = false,
  workspace,
  workspaceActive = false,
  activeWindowId,
  navigationPage,
  workspaceCompanyId,
}: {
  nativeContext?: WindowContext;
  windowBridge?: WindowBridge;
  hideWindowBar?: boolean;
  workspace?: ReactNode;
  workspaceActive?: boolean;
  activeWindowId?: number;
  navigationPage?: Page;
  workspaceCompanyId?: string;
} = {}) {
  const desktop = windowBridge ?? window.meyar?.windows;
  const [state, setState] = useState<State | null>(null),
    [companyId, setCompanyId] = useState(nativeContext?.companyId ?? ''),
    [page, setPage] = useState<Page>(nativeContext?.page ?? 'home'),
    [tabs, setTabs] = useState<Page[]>(['home']),
    [windows, setWindows] = useState<Partial<Record<Page, WindowState>>>(
      nativeContext?.filter
        ? {
            [nativeContext.page]: {
              ...initialWindow,
              filter: nativeContext.filter,
              draft: nativeContext.filter,
            },
          }
        : {},
    ),
    [modal, setModal] = useState<ModalState>(null),
    [partnerOverInvoice, setPartnerOverInvoice] = useState(false),
    [newPartnerId, setNewPartnerId] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [version, setVersion] = useState('0.2.0'),
    [reason, setReason] = useState(''),
    [closeDate, setCloseDate] = useState('');
  const activeWindow = windows[page] ?? initialWindow;
  const { filter, draft, search } = activeWindow;
  function updateWindow(p: Page, update: Partial<WindowState>) {
    setWindows((current) => ({ ...current, [p]: { ...(current[p] ?? initialWindow), ...update } }));
  }
  function setDraft(value: ReportFilter | ((previous: ReportFilter) => ReportFilter)) {
    setWindows((current) => {
      const window = current[page] ?? initialWindow;
      return {
        ...current,
        [page]: { ...window, draft: typeof value === 'function' ? value(window.draft) : value },
      };
    });
  }
  function setFilter(value: ReportFilter) {
    updateWindow(page, { filter: value, table: { ...activeWindow.table, page: 0 } });
  }
  function setSearch(value: string) {
    updateWindow(page, { search: value, table: { ...activeWindow.table, page: 0 } });
  }
  const tableViewProps = {
    view: activeWindow.table,
    onViewChange: (table: TableView) => updateWindow(page, { table }),
  };
  const request = useRef(0),
    locked = useRef(false);
  async function load(id = companyId, f = filter) {
    const r = ++request.current;
    setLoading(true);
    try {
      const s = (await api.call({ op: 'state', companyId: id, filter: f })) as State;
      if (r === request.current) {
        setState(s);
        return true;
      }
      return false;
    } catch (e) {
      if (r === request.current) setError((e as Error).message);
      return false;
    } finally {
      if (r === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (workspaceCompanyId) setCompanyId(workspaceCompanyId);
  }, [workspaceCompanyId]);
  useEffect(() => {
    void load(companyId, filter);
  }, [companyId, filter, page]);
  useEffect(() => {
    void api
      .version()
      .then(setVersion)
      .catch(() => {});
  }, []);
  function open(p: Page, reportFilter?: ReportFilter) {
    if (locked.current || modal) return;
    if (desktop && nativeContext) {
      void desktop
        .open({
          page: p,
          companyId: workspaceCompanyId ?? state?.company.id ?? companyId,
          filter: reportFilter,
        })
        .catch((e) => setError(e.message));
      return;
    }
    if (reportFilter)
      updateWindow(p, { filter: reportFilter, draft: reportFilter, table: { page: 0, size: 25 } });
    if (p !== page || reportFilter) {
      request.current++;
      setLoading(true);
    }
    setPage(p);
    setError('');
    setSuccess('');
    setTabs((t) => (t.includes(p) ? t : [...t, p]));
  }
  function openInvoice(existing?: Invoice) {
    if (desktop && nativeContext)
      void desktop
        .open({
          page: existing?.direction ?? (page === 'purchase' ? 'purchase' : 'sale'),
          companyId: state!.company.id,
          form: 'invoice',
          documentId: existing?.id,
        })
        .catch((e) => setError(e.message));
    else setModal({ kind: 'invoice', existing });
  }
  function openPayment() {
    if (desktop && nativeContext)
      void desktop
        .open({
          page: page === 'bank-in' ? 'bank-in' : 'bank-out',
          companyId: state!.company.id,
          form: 'payment',
        })
        .catch((e) => setError(e.message));
    else setModal({ kind: 'payment' });
  }
  useEffect(
    () =>
      desktop?.onDataChanged((id) => {
        if (!locked.current && (id === (state?.company.id ?? companyId) || page === 'home'))
          void load();
      }),
    [desktop, companyId, filter, page, state?.company.id],
  );
  function closeTab(p: Page) {
    if (locked.current || modal || p === 'home') return;
    const next = tabs.filter((t) => t !== p);
    setTabs(next);
    if (page === p) {
      open(next[next.length - 1] || 'home');
    }
    setWindows((current) => {
      const nextWindows = { ...current };
      delete nextWindows[p];
      return nextWindows;
    });
  }
  function closeModal() {
    if (!locked.current) {
      setModal(null);
      setPartnerOverInvoice(false);
      setReason('');
      setError('');
      setNewPartnerId('');
    }
  }
  function closePartner() {
    if (!locked.current) {
      setPartnerOverInvoice(false);
      setError('');
    }
  }
  function switchCompany(id: string) {
    if (locked.current) return;
    if (workspace) void desktop?.focus(0);
    request.current++;
    if (!workspace) setState(null);
    setLoading(true);
    setCompanyId(id);
    setModal(null);
    setPartnerOverInvoice(false);
    setNewPartnerId('');
    setTabs(['home']);
    setPage('home');
    setWindows({});
    setError('');
    setSuccess('');
  }
  async function mutate(command: Command, message: string, keepModal = false) {
    if (locked.current || loading) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const r = (await api.call(command)) as MutationResult;
      const savedMessage =
        command.op === 'invoice.import'
          ? `${r.created ?? 0} yeni, ${r.updated ?? 0} yenilənmiş, ${r.unchanged ?? 0} dəyişməyən qaimə.`
          : message;
      if (!keepModal) {
        setModal(null);
        setNewPartnerId('');
      }
      setSuccess(savedMessage);
      if (command.op === 'company.create' && r.id) {
        setPage('home');
        setWindows({});
        setTabs(['home']);
        if (!workspace) setState(null);
        request.current++;
        setLoading(true);
        setCompanyId(r.id);
      } else {
        const refreshed = await load();
        if (!refreshed)
          setError(
            'Əməliyyat saxlanıldı, lakin cədvəl yenilənmədi. Əməliyyatı təkrarlamayın; məlumatları yeniləyin.',
          );
        if (keepModal && command.op === 'partner.save' && r.id && refreshed) setNewPartnerId(r.id);
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function action(fn: () => Promise<string | null>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const message = await fn();
      if (message) setSuccess(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function beginImport() {
    if (locked.current || loading || !(page === 'purchase' || page === 'sale')) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    const direction = page;
    try {
      const rows = await api.importFile(direction);
      if (rows) setModal({ kind: 'import', rows, direction });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const company = state?.company.id ?? '';
  const info = pages[page];
  const Icon = info.icon;
  const invoicePage = page === 'purchase' || page === 'sale';
  const bankPage = page === 'bank-in' || page === 'bank-out';
  const reportPage = page === 'trial' || page === 'ledger';
  const partnerPage = ['partners', 'receivables', 'payables'].includes(page);
  const inventoryPage=inventoryPages.includes(page);
  const showFilters = invoicePage || bankPage || reportPage || partnerPage || page==='stock';
  const matches = (s: string) =>
    s.toLocaleLowerCase('az').includes(search.toLocaleLowerCase('az').trim());
  const inPeriod = (d: string) =>
    d >= (state?.report.from ?? filter.from) && d <= (state?.report.to ?? filter.to);
  if (!state)
    return (
      <div className="startup">
        <div className="brand-mark">M</div>
        <h1>Meyar ERP</h1>
        {error ? (
          <>
            <Message>{error}</Message>
            <button className="button primary" onClick={() => void load()}>
              Yenidən yoxla
            </button>
          </>
        ) : (
          <p>Uçot bazası açılır…</p>
        )}
      </div>
    );
  if (!state.companies.length)
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <div className="brand-lockup">
            <div className="brand-mark">M</div>
            <div>
              <b>
                meyar<span>ERP</span>
              </b>
              <small>MÜHASİBAT İŞ MƏKANI</small>
            </div>
          </div>
          <div className="onboarding-intro">
            <span className="eyebrow">İLK ADDIM</span>
            <h1>
              Şirkətini əlavə et.
              <br />
              Uçota buradan başla.
            </h1>
            <p>Qaimələr, bank ödənişləri və dövriyyə balansı vahid iş məkanında.</p>
          </div>
          {error && <Message>{error}</Message>}
          <IdentityForm
            company
            busy={busy || loading}
            onSave={(name, taxId) =>
              mutate({ op: 'company.create', name, taxId }, 'Şirkət yaradıldı.').then(() => {})
            }
          />
          <p className="onboarding-foot">
            <ShieldCheck size={15} />
            Məlumatlar bu cihazın yerli bazasında saxlanılır.
          </p>
        </div>
        <div className="onboarding-decoration">
          <div className="onboarding-wordmark">meyar.</div>
          <h2>
            Hər sənədin
            <br />
            öz yeri var.
          </h2>
          <div className="onboarding-steps">
            <span>
              01 <b>Qaimə və bank sənədləri</b>
            </span>
            <span>
              02 <b>Avtomatik ikili yazılış</b>
            </span>
            <span>
              03 <b>Aydın hesabatlar</b>
            </span>
          </div>
        </div>
      </div>
    );
  const invoiceRows = state.invoices.filter(
    (i) =>
      i.direction === page &&
      inPeriod(i.date) &&
      matches(`${i.number} ${i.partnerName} ${i.taxId} ${i.description}`),
  );
  const paymentRows = state.payments.filter(
    (p) =>
      p.direction === (page === 'bank-in' ? 'in' : 'out') &&
      inPeriod(p.date) &&
      matches(`${p.reference} ${p.partnerName} ${p.description}`),
  );
  const invoiceColumns: Column<Invoice>[] = [
    {
      key: 'number',
      label: 'Qaimə №',
      render: (i) => (
        <button
          className="text-link mono"
          onClick={() => openInvoice(i)}
          disabled={busy || loading || i.status === 'cancelled'}
        >
          {i.number}
        </button>
      ),
    },
    { key: 'date', label: 'Tarix', render: (i) => day(i.date) },
    {
      key: 'partner',
      label: 'Kontragent',
      className: 'wide-cell',
      render: (i) => (
        <div className="cell-two">
          <strong title={i.partnerName}>{i.partnerName}</strong>
          <small>VÖEN {i.taxId}</small>
        </div>
      ),
    },
    {
      key: 'kind',
      label: 'Növ',
      render: (i) => <span className="type-label">{i.kind === 'service' ? 'Xidmət' : 'Mal'}</span>,
    },
    { key: 'net', label: 'Əsas məbləğ', numeric: true, render: (i) => money(i.netCents) },
    { key: 'vat', label: 'ƏDV', numeric: true, render: (i) => money(i.vatCents) },
    {
      key: 'total',
      label: 'Cəmi · AZN',
      numeric: true,
      render: (i) => <b>{money(i.totalCents)}</b>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (i) => <Status cancelled={i.status === 'cancelled'} />,
    },
    {
      key: 'actions',
      label: '',
      render: (i) =>
        i.status === 'posted' && (
          <div className="row-actions">
            <button
              className="icon-button"
              disabled={busy || loading}
              title="Düzəliş et"
              aria-label={`Düzəliş et ${i.number}`}
              onClick={() => openInvoice(i)}
            >
              <SquarePen size={15} />
            </button>
            <button
              className="icon-button danger"
              disabled={busy || loading}
              title="Ləğv et"
              aria-label={`Ləğv et ${i.number}`}
              onClick={() => {
                setReason('');
                setModal({ kind: 'cancel', type: 'invoice', id: i.id, number: i.number });
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
    },
  ];
  const paymentColumns: Column<Payment>[] = [
    {
      key: 'reference',
      label: 'Bank sənədi №',
      render: (p) => <span className="mono">{p.reference}</span>,
    },
    { key: 'date', label: 'Tarix', render: (p) => day(p.date) },
    {
      key: 'partner',
      label: 'Kontragent',
      className: 'wide-cell',
      render: (p) => (
        <div className="cell-two">
          <strong>{p.partnerName}</strong>
          <small>{p.description || 'Borc üzrə hesablaşma'}</small>
        </div>
      ),
    },
    {
      key: 'account',
      label: 'Hesab',
      render: (p) => <span className="account-code">{p.bankAccount}</span>,
    },
    {
      key: 'invoice',
      label: 'Bağlı qaimə',
      render: (p) => state.invoices.find((i) => i.id === p.invoiceId)?.number || 'Ümumi borc',
    },
    {
      key: 'amount',
      label: 'Məbləğ · AZN',
      numeric: true,
      render: (p) => <b>{money(p.amountCents)}</b>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (p) => <Status cancelled={p.status === 'cancelled'} />,
    },
    {
      key: 'actions',
      label: '',
      render: (p) =>
        p.status === 'posted' && (
          <button
            className="icon-button danger"
            disabled={busy || loading}
            title="Ləğv et"
            aria-label={`Ləğv et ${p.reference}`}
            onClick={() => {
              setReason('');
              setModal({ kind: 'cancel', type: 'payment', id: p.id, number: p.reference });
            }}
          >
            <Trash2 size={15} />
          </button>
        ),
    },
  ];
  const totals = state.trial.reduce(
    (r, t) => ({
      openingDebit: r.openingDebit + t.openingDebit,
      openingCredit: r.openingCredit + t.openingCredit,
      debit: r.debit + t.debit,
      credit: r.credit + t.credit,
      closingDebit: r.closingDebit + t.closingDebit,
      closingCredit: r.closingCredit + t.closingCredit,
    }),
    { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 },
  );
  function navigation(p: Page, label?: string) {
    const N = pages[p].icon;
    return (
      <button
        className={`nav-item ${(navigationPage ?? page) === p ? 'active' : ''}`}
        onClick={() => open(p)}
      >
        <N size={17} />
        {label || pages[p].title}
      </button>
    );
  }
  return (
    <div className={`app-shell ${nativeContext ? 'native-app' : ''}`}>
      {(!nativeContext || page === 'home') && (
        <>
          <header className="app-header">
            <button
              className="brand-lockup"
              aria-label="Meyar iş masası"
              onClick={() => open('home')}
            >
              <div className="brand-mark">M</div>
              <b>
                meyar<span>ERP</span>
              </b>
              <span className="version-badge">2</span>
            </button>
            <div className="header-divider" />
            <div className="company-control">
              <Building2 size={17} />
              <select
                aria-label="Aktiv şirkət"
                value={state.company.id}
                disabled={busy || loading || !!nativeContext?.companyId}
                onChange={(e) => switchCompany(e.target.value)}
              >
                {state.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="company-tax">VÖEN {state.company.taxId}</span>
              {nativeContext && !nativeContext.companyId && (
                <button
                  className="icon-button"
                  title="Yeni şirkət"
                  aria-label="Yeni şirkət"
                  disabled={busy || loading}
                  onClick={() => setModal({ kind: 'company' })}
                >
                  <Plus size={17} />
                </button>
              )}
            </div>
            <div className="header-right">
              <span className="local-state">
                <i />
                {window.meyar ? 'Yerli baza' : 'Sınaq baxışı'}
              </span>
              <button
                className="icon-button"
                aria-label="Əməliyyat tarixçəsi"
                title="Əməliyyat tarixçəsi"
                onClick={() => open('audit')}
              >
                <Bell size={19} />
              </button>
              <button
                className={`icon-button ${page === 'settings' ? 'selected' : ''}`}
                aria-label="Şirkət və proqram"
                title="Şirkət və proqram"
                onClick={() => open('settings')}
              >
                <Settings2 size={19} />
              </button>
              <div className="avatar" title={state.company.name}>
                {state.company.name.slice(0, 2).toLocaleUpperCase('az')}
              </div>
            </div>
          </header>
          <nav className="main-nav" aria-label="Əsas modullar">
            {navigation('home')}
            {navigation('purchase')}
            {navigation('sale')}
            <details className="nav-dropdown">
              <summary
                className={`nav-item ${['bank-in', 'bank-out'].includes(navigationPage ?? page) ? 'active' : ''}`}
              >
                <Landmark size={17} />
                Bank
                <ChevronDown size={13} />
              </summary>
              <div
                className="dropdown-menu"
                onClick={(e) =>
                  (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')
                }
              >
                {navigation('bank-in')}
                {navigation('bank-out')}
              </div>
            </details>
            {navigation('trial', 'Dövriyyə balansı')}
            {navigation('stock','Anbar')}
            <details className="nav-dropdown">
              <summary
                className={`nav-item ${['partners', 'receivables', 'payables', 'accounts',...inventoryPages].includes(navigationPage ?? page) ? 'active' : ''}`}
              >
                <FolderOpen size={17} />
                Kitabçalar
                <ChevronDown size={13} />
              </summary>
              <div
                className="dropdown-menu"
                onClick={(e) =>
                  (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')
                }
              >
                {navigation('products')}
                {navigation('units')}
                {navigation('warehouses')}
                {navigation('assets')}
                {navigation('partners')}
                {navigation('receivables')}
                {navigation('payables')}
                {navigation('accounts')}
              </div>
            </details>
            <button
              className={`nav-item journal-nav ${(navigationPage ?? page) === 'ledger' ? 'active' : ''}`}
              onClick={() => open('ledger')}
            >
              <ClipboardList size={17} />
              Jurnal
            </button>
          </nav>
        </>
      )}
      {workspace}
      <main
        hidden={workspaceActive}
        className={`main-content ${page === 'home' ? 'home-workspace' : 'window-workspace'}`}
        aria-busy={loading || busy}
      >
        <section
          key={page}
          id={`window-${page}`}
          role="tabpanel"
          aria-labelledby={nativeContext ? undefined : `tab-${page}`}
          aria-label={nativeContext ? info.title : undefined}
          className={`module-window ${page === 'home' ? 'home-window' : ''} ${activeWindow.restored ? 'restored' : ''}`}
        >
          <div className="page-heading">
            <div className="page-title">
              <span className="page-icon">
                <Icon size={21} />
              </span>
              <div>
                <div className="title-line">
                  <h1>{info.title}</h1>
                  {invoicePage && <span className="count-badge">{invoiceRows.length}</span>}
                  {bankPage && <span className="count-badge">{paymentRows.length}</span>}
                </div>
                <p>{info.subtitle}</p>
              </div>
            </div>
            <div className="heading-actions">
              {page === 'home' && (
                <span className="today-label">
                  {new Intl.DateTimeFormat('az-AZ', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(new Date())}
                </span>
              )}
              {invoicePage && (
                <>
                  <button
                    className="button secondary"
                    disabled={busy || loading}
                    onClick={() =>
                      void action(async () => {
                        await api.template();
                        return null;
                      })
                    }
                  >
                    <FileDown size={16} />
                    Excel şablonu
                  </button>
                  <details className="action-dropdown">
                    <summary className="button secondary">
                      <FileSpreadsheet size={16} />
                      İdxal
                      <ChevronDown size={13} />
                    </summary>
                    <div
                      className="dropdown-menu"
                      onClick={(e) =>
                        (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute(
                          'open',
                        )
                      }
                    >
                      <button disabled={busy || loading} onClick={() => void beginImport()}>
                        Excel-dən yüklə
                      </button>
                      <span className="menu-note">DVX canlı bağlantısı hazırlanacaq</span>
                    </div>
                  </details>
                  <button
                    className="button primary"
                    disabled={busy || loading}
                    onClick={() => openInvoice()}
                  >
                    <Plus size={17} />
                    Əlavə et
                  </button>
                </>
              )}
              {bankPage && (
                <button
                  className="button primary"
                  disabled={busy || loading}
                  onClick={() => openPayment()}
                >
                  <Plus size={17} />
                  Ödəniş əlavə et
                </button>
              )}
              {partnerPage && (
                <button
                  className="button primary"
                  disabled={busy || loading}
                  onClick={() => setModal({ kind: 'partner' })}
                >
                  <Plus size={17} />
                  Kontragent əlavə et
                </button>
              )}
              {page !== 'home' && (
                <button
                  className={`icon-button refresh ${loading ? 'spinning' : ''}`}
                  aria-label="Məlumatları yenilə"
                  title="Yenilə"
                  onClick={() => void load()}
                  disabled={loading || busy}
                >
                  <RefreshCw size={17} />
                </button>
              )}
            </div>
            {page !== 'home' && (
              <div className="window-controls">
                <button
                  className="icon-button"
                  aria-label="Pəncərəni aşağı yığ"
                  title="Aşağı yığ"
                  onClick={() => (nativeContext ? void desktop?.minimize() : open('home'))}
                >
                  <Minus size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={
                    nativeContext
                      ? 'Böyüt / əvvəlki ölçü'
                      : activeWindow.restored
                        ? 'Pəncərəni böyüt'
                        : 'Pəncərəni kiçilt'
                  }
                  title={
                    nativeContext
                      ? 'Böyüt / əvvəlki ölçü'
                      : activeWindow.restored
                        ? 'Böyüt'
                        : 'Kiçilt'
                  }
                  onClick={() =>
                    nativeContext
                      ? void desktop?.maximize()
                      : updateWindow(page, { restored: !activeWindow.restored })
                  }
                >
                  {activeWindow.restored ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
                </button>
                <button
                  className="icon-button window-close"
                  aria-label="Aktiv bölməni bağla"
                  title="Bağla"
                  onClick={() => (nativeContext ? void desktop?.close() : closeTab(page))}
                >
                  <X size={17} />
                </button>
              </div>
            )}
          </div>
          <div className="window-notices">
            {!modal && error && <Message onClose={() => setError('')}>{error}</Message>}
            {success && (
              <Message type="success" onClose={() => setSuccess('')}>
                {success}
              </Message>
            )}
          </div>
          <div className={`module-workspace ${showFilters ? 'with-filters' : ''}`}>
            {showFilters && (
              <form
                className="filter-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (loading || locked.current) return;
                  if (draft.from > draft.to) {
                    setError('Başlanğıc tarix son tarixdən böyükdür.');
                    return;
                  }
                  setError('');
                  setFilter({ ...draft });
                }}
              >
                <div className="filter-label">
                  <SlidersHorizontal size={15} />
                  Filtr
                </div>
                <label className="date-filter">
                  <span>Tarix</span>
                  <input
                    aria-label="Başlanğıc tarix"
                    required
                    type="date"
                    value={draft.from}
                    onChange={(e) => setDraft((s) => ({ ...s, from: e.target.value }))}
                  />
                  <span className="date-separator">—</span>
                  <input
                    aria-label="Son tarix"
                    required
                    type="date"
                    value={draft.to}
                    onChange={(e) => setDraft((s) => ({ ...s, to: e.target.value }))}
                  />
                </label>
                {reportPage && (
                  <select
                    aria-label="Hesab üzrə filtr"
                    value={draft.account}
                    onChange={(e) => setDraft((s) => ({ ...s, account: e.target.value }))}
                  >
                    <option value="">Bütün hesablar</option>
                    {state.accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                )}
                <button type="submit" className="button filter-apply" disabled={loading}>
                  Tətbiq et
                </button>
                {!reportPage && (
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Cədvəldə axtar"
                      placeholder="Nömrə, kontragent və ya VÖEN…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        type="button"
                        aria-label="Axtarışı təmizlə"
                        onClick={() => setSearch('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                )}
                <span className="currency-tag">AZN</span>
              </form>
            )}
            <div
              className={`window-body ${page === 'home' || page === 'settings' ? 'scrollable' : ''}`}
            >
              {page === 'home' && <Dashboard state={state} open={open} />}
              {invoicePage && (
                <DataTable
                  {...tableViewProps}
                  rows={invoiceRows}
                  columns={invoiceColumns}
                  onOpen={(i) => {
                    if (!busy && !loading && i.status === 'posted') openInvoice(i);
                  }}
                  empty={
                    <Empty
                      title={page === 'purchase' ? 'Gələn qaimə yoxdur' : 'Gedən qaimə yoxdur'}
                      description="Tarix aralığını yoxlayın və ya ilk qaiməni əlavə edin."
                      action={
                        <button
                          className="button primary"
                          disabled={busy || loading}
                          onClick={() => openInvoice()}
                        >
                          <Plus size={16} />
                          Qaimə əlavə et
                        </button>
                      }
                    />
                  }
                  footer={
                    <tr>
                      <td colSpan={4}>Uçota alınmış sənədlər üzrə cəmi</td>
                      <td className="numeric">
                        {money(
                          invoiceRows
                            .filter((i) => i.status === 'posted')
                            .reduce((n, i) => n + i.netCents, 0),
                        )}
                      </td>
                      <td className="numeric">
                        {money(
                          invoiceRows
                            .filter((i) => i.status === 'posted')
                            .reduce((n, i) => n + i.vatCents, 0),
                        )}
                      </td>
                      <td className="numeric">
                        {money(
                          invoiceRows
                            .filter((i) => i.status === 'posted')
                            .reduce((n, i) => n + i.totalCents, 0),
                        )}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  }
                />
              )}
              {bankPage && (
                <DataTable
                  {...tableViewProps}
                  rows={paymentRows}
                  columns={paymentColumns}
                  footer={
                    <tr>
                      <td colSpan={5}>Uçota alınmış ödənişlər üzrə cəmi</td>
                      <td className="numeric">
                        {money(
                          paymentRows
                            .filter((p) => p.status === 'posted')
                            .reduce((n, p) => n + p.amountCents, 0),
                        )}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  }
                />
              )}
              {page === 'trial' && (
                <>
                  <div className="report-caption">
                    <span>
                      {day(state.report.from)} — {day(state.report.to)}
                    </span>
                    <span className="report-check">
                      {state.report.account ? (
                        <>
                          <BookOpen size={15} />
                          {state.report.account} hesabının dövriyyəsi
                        </>
                      ) : totals.debit === totals.credit ? (
                        <>
                          <CheckCheck size={16} />
                          Debet və kredit bərabərdir
                        </>
                      ) : (
                        <>Debet–kredit fərqi: {money(totals.debit - totals.credit)}</>
                      )}
                    </span>
                  </div>
                  <DataTable
                    {...tableViewProps}
                    rows={state.trial.map((t) => ({ ...t, id: t.account }))}
                    columns={[
                      {
                        key: 'account',
                        label: 'Hesab',
                        render: (t) => (
                          <button
                            className="account-link"
                            onClick={() => {
                              open('ledger', { ...filter, account: t.account });
                            }}
                          >
                            {t.account}
                          </button>
                        ),
                      },
                      {
                        key: 'name',
                        label: 'Hesabın adı',
                        className: 'wide-cell',
                        render: (t) => t.name,
                      },
                      ...(
                        [
                          'openingDebit',
                          'openingCredit',
                          'debit',
                          'credit',
                          'closingDebit',
                          'closingCredit',
                        ] as const
                      ).map((key, i) => ({
                        key,
                        label: [
                          'İlk qalıq · Dt',
                          'İlk qalıq · Kt',
                          'Dövriyyə · Dt',
                          'Dövriyyə · Kt',
                          'Son qalıq · Dt',
                          'Son qalıq · Kt',
                        ][i],
                        numeric: true,
                        render: (t: State['trial'][number]) => (
                          <span className={t[key] === 0 ? 'zero-value' : ''}>{money(t[key])}</span>
                        ),
                      })),
                    ]}
                    footer={
                      <tr>
                        <td colSpan={2}>YEKUN</td>
                        {(
                          [
                            'openingDebit',
                            'openingCredit',
                            'debit',
                            'credit',
                            'closingDebit',
                            'closingCredit',
                          ] as const
                        ).map((k) => (
                          <td className="numeric" key={k}>
                            {money(totals[k])}
                          </td>
                        ))}
                      </tr>
                    }
                    empty={
                      <Empty
                        title="Bu dövr üzrə uçot yazılışı yoxdur"
                        description="Qaimə və bank sənədlərini əlavə etdikdə dövriyyə balansı avtomatik formalaşacaq."
                      />
                    }
                  />
                </>
              )}
              {page === 'ledger' && (
                <DataTable
                  {...tableViewProps}
                  rows={state.ledger}
                  columns={[
                    { key: 'date', label: 'Tarix', render: (r) => day(r.date) },
                    {
                      key: 'doc',
                      label: 'Sənəd №',
                      render: (r) => <span className="mono">{r.sourceNumber}</span>,
                    },
                    {
                      key: 'account',
                      label: 'Hesab',
                      render: (r) => <span className="account-code">{r.account}</span>,
                    },
                    {
                      key: 'partner',
                      label: 'Analitika',
                      className: 'wide-cell',
                      render: (r) => (
                        <div className="cell-two">
                          <strong>{r.partnerName || r.subaccount || '—'}</strong>
                          <small>{r.description}</small>
                        </div>
                      ),
                    },
                    {
                      key: 'debit',
                      label: 'Debet · AZN',
                      numeric: true,
                      render: (r) => money(r.debit),
                    },
                    {
                      key: 'credit',
                      label: 'Kredit · AZN',
                      numeric: true,
                      render: (r) => money(r.credit),
                    },
                    {
                      key: 'reversal',
                      label: 'Yazılış',
                      render: (r) => (
                        <span className={`type-label ${r.reversal ? 'reversal' : ''}`}>
                          {r.reversal ? 'Əks yazılış' : 'İlkin yazılış'}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
              {partnerPage && (
                <DataTable
                  {...tableViewProps}
                  rows={state.balances
                    .filter((b) => matches(`${b.name} ${b.taxId}`))
                    .filter((b) =>
                      page === 'receivables'
                        ? b.receivable !== 0
                        : page === 'payables'
                          ? b.payable !== 0
                          : true,
                    )
                    .map((b) => ({ ...b, id: b.partnerId }))}
                  columns={[
                    {
                      key: 'name',
                      label: 'Kontragentin adı',
                      className: 'wide-cell',
                      render: (b) => <strong>{b.name}</strong>,
                    },
                    {
                      key: 'tax',
                      label: 'VÖEN',
                      render: (b) => <span className="mono">{b.taxId}</span>,
                    },
                    ...(page !== 'payables'
                      ? [
                          {
                            key: 'receivable',
                            label: '211 üzrə qalıq · AZN',
                            numeric: true,
                            render: (b: State['balances'][number]) => (
                              <b className={b.receivable < 0 ? 'negative' : ''}>
                                {money(b.receivable)}
                              </b>
                            ),
                          },
                        ]
                      : []),
                    ...(page !== 'receivables'
                      ? [
                          {
                            key: 'payable',
                            label: '531 üzrə qalıq · AZN',
                            numeric: true,
                            render: (b: State['balances'][number]) => (
                              <b className={b.payable < 0 ? 'negative' : ''}>{money(b.payable)}</b>
                            ),
                          },
                        ]
                      : []),
                  ]}
                  empty={
                    <Empty
                      title="Uyğun kontragent tapılmadı"
                      description="Kontragent əlavə edin və ya filtr şərtlərini dəyişin."
                    />
                  }
                />
              )}
              {inventoryPage&&<InventoryPanel state={state} page={page} busy={busy||loading} search={search} operationError={error} onSave={command=>mutate(command,'Əməliyyat saxlanıldı.')}/>}
              {page === 'accounts' && (
                <DataTable
                  {...tableViewProps}
                  rows={state.accounts.map((a) => ({ ...a, id: a.code }))}
                  columns={[
                    {
                      key: 'code',
                      label: 'Hesab',
                      render: (a) => <span className="account-code">{a.code}</span>,
                    },
                    {
                      key: 'name',
                      label: 'Hesabın adı',
                      className: 'wide-cell',
                      render: (a) => a.name,
                    },
                  ]}
                />
              )}
              {page === 'audit' && (
                <DataTable
                  {...tableViewProps}
                  rows={state.audit.map((a) => ({ ...a, id: String(a.id) }))}
                  columns={[
                    {
                      key: 'time',
                      label: 'Tarix və saat',
                      render: (a) => new Date(a.createdAt).toLocaleString('az-AZ'),
                    },
                    { key: 'entity', label: 'Bölmə', render: (a) => a.entity },
                    {
                      key: 'action',
                      label: 'Əməliyyat',
                      render: (a) => <span className="type-label">{a.action}</span>,
                    },
                    {
                      key: 'description',
                      label: 'Təfərrüat',
                      className: 'wide-cell',
                      render: (a) => a.description,
                    },
                  ]}
                />
              )}
              {page === 'settings' && (
                <div className="settings-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        <Building2 size={18} />
                        Şirkət
                      </h2>
                    </div>
                    <div className="settings-body">
                      <h3>{state.company.name}</h3>
                      <p>VÖEN {state.company.taxId}</p>
                      <p>
                        Uçot valyutası: <b>AZN</b>
                      </p>
                      <button
                        className="button secondary"
                        disabled={busy || loading}
                        onClick={() =>
                          nativeContext?.companyId ? open('home') : setModal({ kind: 'company' })
                        }
                      >
                        <Plus size={16} />
                        {nativeContext?.companyId
                          ? 'Şirkətləri iş masasında idarə et'
                          : 'Yeni şirkət'}
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        <LockKeyhole size={18} />
                        Uçot dövrü
                      </h2>
                    </div>
                    <div className="settings-body">
                      <h3>
                        {state.company.closedThrough
                          ? `${day(state.company.closedThrough)} tarixinədək bağlıdır`
                          : 'Dövr açıqdır'}
                      </h3>
                      <p>Bağlı tarixlərə aid sənədlərə əlavə, düzəliş və ləğv tətbiq edilmir.</p>
                      <button
                        className="button secondary"
                        disabled={busy || loading}
                        onClick={() => {
                          setCloseDate('');
                          setModal({ kind: 'period' });
                        }}
                      >
                        Dövrü bağla
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        <ShieldCheck size={18} />
                        Ehtiyat nüsxə
                      </h2>
                    </div>
                    <div className="settings-body">
                      <p>Uçot bazasının ayrıca nüsxəsini seçdiyiniz qovluqda saxlayın.</p>
                      <button
                        className="button primary"
                        disabled={busy || loading}
                        onClick={() =>
                          void action(async () => {
                            const path = await api.backup();
                            return path ? 'Ehtiyat nüsxə saxlanıldı.' : null;
                          })
                        }
                      >
                        <Download size={16} />
                        Nüsxə yarat
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        <RefreshCw size={18} />
                        Meyar ERP 2
                      </h2>
                      <span className="version-label">v{version}</span>
                    </div>
                    <div className="settings-body">
                      <p>
                        Qaimələr, nomenklatura, anbar uçotu, əsas vəsait kartları, bank hesablaşmaları, DBC və
                        əməliyyat tarixçəsi.
                      </p>
                      <p className="muted">
                        DVX canlı inteqrasiyası, amortizasiya hesablanması, valyuta uçotu,
                        avanslar və vergi bəyannamələri növbəti mərhələlərdir.
                      </p>
                      <button
                        className="button secondary"
                        disabled={busy || loading}
                        onClick={() => void action(() => api.checkUpdate())}
                      >
                        Yeniləməni yoxla
                      </button>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      {hideWindowBar ? null : nativeContext ? (
        <NativeWindowBar
          context={{ ...nativeContext, id: activeWindowId ?? nativeContext.id }}
          windowBridge={desktop}
        />
      ) : (
        <footer className="workspace-footer">
          <div className="workspace-tabs" role="tablist" aria-label="Açıq pəncərələr">
            {tabs.map((t) => {
              const T = pages[t].icon;
              return (
                <div className={`workspace-tab ${page === t ? 'active' : ''}`} key={t}>
                  <button
                    id={`tab-${t}`}
                    role="tab"
                    aria-controls={page === t ? `window-${t}` : undefined}
                    aria-selected={page === t}
                    onClick={() => open(t)}
                  >
                    <T size={14} />
                    {pages[t].title}
                  </button>
                  {t !== 'home' && (
                    <button
                      aria-label={`${pages[t].title} pəncərəsini bağla`}
                      className="tab-close"
                      onClick={() => closeTab(t)}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <span className="footer-status">
            <span className={loading ? 'working-dot' : 'saved-dot'} />
            {loading ? 'Yüklənir…' : 'Meyar ERP 2'}
            <span className="footer-version">v{version}</span>
          </span>
        </footer>
      )}
      {modal && (
        <Modal
          title={
            modal.kind === 'invoice'
              ? modal.existing
                ? `Qaiməyə düzəliş · ${modal.existing.number}`
                : page === 'purchase'
                  ? 'Yeni gələn qaimə'
                  : 'Yeni gedən qaimə'
              : modal.kind === 'payment'
                ? page === 'bank-in'
                  ? 'Yeni daxil olan ödəniş'
                  : 'Yeni çıxan ödəniş'
                : modal.kind === 'partner'
                  ? 'Kontragent əlavə et'
                  : modal.kind === 'company'
                    ? 'Yeni şirkət'
                    : modal.kind === 'import'
                      ? 'Excel idxalına baxış'
                      : modal.kind === 'period'
                        ? 'Uçot dövrünü bağla'
                        : `Sənədi ləğv et · ${modal.number}`
          }
          subtitle={
            modal.kind === 'import'
              ? `${modal.rows.length} qaimə · ${modal.direction === 'purchase' ? 'Gələn' : 'Gedən'} istiqaməti`
              : undefined
          }
          onClose={closeModal}
          wide={modal.kind === 'import'}
        >
          {error && (
            <div className="modal-error">
              <Message>{error}</Message>
            </div>
          )}
          {modal.kind === 'invoice' && (
            <InvoiceForm
              state={state}
              direction={modal.existing?.direction ?? (page === 'purchase' ? 'purchase' : 'sale')}
              existing={modal.existing}
              newPartnerId={newPartnerId}
              busy={busy || loading}
              onClose={closeModal}
              onSave={(invoice: InvoiceInput) =>
                mutate(
                  { op: 'invoice.save', companyId: company, invoice },
                  'Qaimə uçota alındı.',
                ).then(() => {})
              }
              onPartner={() => {
                setError('');
                setPartnerOverInvoice(true);
              }}
            />
          )}
          {modal.kind === 'payment' && (
            <PaymentForm
              state={state}
              direction={page === 'bank-in' ? 'in' : 'out'}
              busy={busy || loading}
              onClose={closeModal}
              onSave={(payment: PaymentInput) =>
                mutate(
                  { op: 'payment.save', companyId: company, payment },
                  'Ödəniş uçota alındı.',
                ).then(() => {})
              }
            />
          )}
          {modal.kind === 'partner' && (
            <IdentityForm
              busy={busy || loading}
              onClose={closeModal}
              onSave={(name, taxId) =>
                mutate(
                  { op: 'partner.save', companyId: company, name, taxId },
                  'Kontragent saxlanıldı.',
                ).then(() => {})
              }
            />
          )}
          {modal.kind === 'company' && (
            <IdentityForm
              company
              busy={busy || loading}
              onClose={closeModal}
              onSave={(name, taxId) =>
                mutate({ op: 'company.create', name, taxId }, 'Şirkət yaradıldı.').then(() => {})
              }
            />
          )}
          {modal.kind === 'cancel' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  {
                    op: modal.type === 'invoice' ? 'invoice.cancel' : 'payment.cancel',
                    companyId: company,
                    id: modal.id,
                    reason,
                  },
                  'Sənəd ləğv edildi.',
                );
              }}
            >
              <div className="form-body">
                <p className="confirmation-copy">
                  Sənədin əks müxabirləşməsi yaradılacaq. İlkin yazılış və ləğv səbəbi tarixçədə
                  saxlanılacaq.
                </p>
                <Field label="Ləğv səbəbi">
                  <textarea
                    disabled={busy || loading}
                    autoFocus
                    required
                    maxLength={240}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={closeModal}
                  disabled={busy || loading}
                >
                  Geri
                </button>
                <button className="button destructive" disabled={busy || loading}>
                  Sənədi ləğv et
                </button>
              </div>
            </form>
          )}
          {modal.kind === 'period' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  { op: 'period.close', companyId: company, date: closeDate },
                  'Uçot dövrü bağlandı.',
                );
              }}
            >
              <div className="form-body">
                <p className="confirmation-copy">
                  Seçilmiş tarix daxil olmaqla sənədlər dəyişdirilə bilməyəcək. Bu versiyada bağlı
                  dövrün yenidən açılması yoxdur. Əvvəl hesabatları yoxlayın və ehtiyat nüsxə
                  yaradın.
                </p>
                <Field label="Bu tarix daxil olmaqla bağla">
                  <input
                    disabled={busy || loading}
                    autoFocus
                    required
                    type="date"
                    value={closeDate}
                    onChange={(e) => setCloseDate(e.target.value)}
                  />
                </Field>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={closeModal}
                  disabled={busy || loading}
                >
                  Geri
                </button>
                <button className="button primary" disabled={busy || loading}>
                  Dövrü bağla
                </button>
              </div>
            </form>
          )}
          {modal.kind === 'import' && (
            <>
              <div className="import-note">
                Eyni nömrə + VÖEN + istiqamət ilə mövcud qaimə yenilənəcək. Səhv sətir olarsa bütün
                idxal dayandırılacaq.
              </div>
              <div className="import-table">
                <DataTable
                  rows={modal.rows.map((r, i) => ({ ...r, id: String(i) }))}
                  columns={[
                    { key: 'number', label: 'Qaimə №', render: (r) => r.number },
                    { key: 'date', label: 'Tarix', render: (r) => day(r.date) },
                    { key: 'partner', label: 'Kontragent', render: (r) => r.partnerName },
                    { key: 'tax', label: 'VÖEN', render: (r) => r.taxId },
                    { key: 'net', label: 'Əsas məbləğ', numeric: true, render: (r) => r.net },
                    { key: 'vat', label: 'ƏDV', numeric: true, render: (r) => r.vat },
                  ]}
                />
              </div>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  onClick={closeModal}
                  disabled={busy || loading}
                >
                  Geri
                </button>
                <button
                  className="button primary"
                  disabled={busy || loading}
                  onClick={() =>
                    void mutate(
                      { op: 'invoice.import', companyId: company, rows: modal.rows },
                      'İdxal tamamlandı.',
                    )
                  }
                >
                  <Check size={16} />
                  {busy ? 'İdxal edilir…' : `${modal.rows.length} qaiməni idxal et`}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {partnerOverInvoice && (
        <Modal title="Kontragent əlavə et" onClose={closePartner}>
          {error && (
            <div className="modal-error">
              <Message>{error}</Message>
            </div>
          )}
          <IdentityForm
            busy={busy || loading}
            onClose={closePartner}
            onSave={async (name, taxId) => {
              if (
                await mutate(
                  { op: 'partner.save', companyId: company, name, taxId },
                  'Kontragent əlavə edildi.',
                  true,
                )
              )
                setPartnerOverInvoice(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
function Dashboard({ state, open }: { state: State; open: (p: Page) => void }) {
  const payments = state.payments.filter((p) => p.status === 'posted').slice(0, 5);
  const active = state.invoices.filter((i) => i.status === 'posted');
  const positive = (field: 'receivable' | 'payable') =>
    state.balances.reduce((s, b) => s + Math.max(b[field], 0), 0);
  const unmatched = state.payments.filter((p) => p.status === 'posted' && !p.invoiceId).length;
  return (
    <div className="dashboard">
      <div className="summary-strip">
        <div className="summary-item">
          <span className="summary-label">
            <FileInput size={15} />
            Gələn qaimələr
          </span>
          <strong>
            {active.filter((i) => i.direction === 'purchase').length}
            <small>sənəd</small>
          </strong>
          <button onClick={() => open('purchase')}>
            Reyestrə keç <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="summary-item">
          <span className="summary-label">
            <FileOutput size={15} />
            Gedən qaimələr
          </span>
          <strong>
            {active.filter((i) => i.direction === 'sale').length}
            <small>sənəd</small>
          </strong>
          <button onClick={() => open('sale')}>
            Reyestrə keç <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="summary-item">
          <span className="summary-label">
            <ArrowDownLeft size={15} />
            Debitor borcu
          </span>
          <strong>
            {money(positive('receivable'))}
            <small>AZN</small>
          </strong>
          <button onClick={() => open('receivables')}>
            {day(state.report.to)} tarixinə <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="summary-item">
          <span className="summary-label">
            <ArrowUpRight size={15} />
            Kreditor borcu
          </span>
          <strong>
            {money(positive('payable'))}
            <small>AZN</small>
          </strong>
          <button onClick={() => open('payables')}>
            {day(state.report.to)} tarixinə <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="panel bank-panel">
          <div className="panel-heading">
            <h2>
              <Landmark size={18} />
              Son bank ödənişləri
            </h2>
            <span className="muted small">Son 5 əməliyyat</span>
          </div>
          {payments.length ? (
            <div className="dashboard-table">
              <table>
                <thead>
                  <tr>
                    <th>Kontragent / sənəd</th>
                    <th>Tarix</th>
                    <th>İstiqamət</th>
                    <th className="numeric">Məbləğ · AZN</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-two">
                          <strong>{p.partnerName}</strong>
                          <small>
                            {p.reference} · {p.bankAccount}
                          </small>
                        </div>
                      </td>
                      <td>{day(p.date)}</td>
                      <td>
                        <span className={`payment-direction ${p.direction}`}>
                          {p.direction === 'in' ? (
                            <ArrowDownLeft size={14} />
                          ) : (
                            <ArrowUpRight size={14} />
                          )}{' '}
                          {p.direction === 'in' ? 'Daxil olan' : 'Çıxan'}
                        </span>
                      </td>
                      <td className="numeric">
                        <b>{money(p.amountCents)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Bank əməliyyatı yoxdur"
              description="İlk ödənişi əlavə etdikdə son əməliyyatlar burada görünəcək."
              action={
                <button className="button secondary" onClick={() => open('bank-in')}>
                  Bank bölməsinə keç <ArrowUpRight size={15} />
                </button>
              }
            />
          )}
          <div className="panel-footer">
            <button className="text-link" onClick={() => open('bank-in')}>
              Daxil olanlar <ArrowUpRight size={13} />
            </button>
            <button className="text-link" onClick={() => open('bank-out')}>
              Çıxanlar <ArrowUpRight size={13} />
            </button>
          </div>
        </section>
        <section className="panel notifications-panel">
          <div className="panel-heading">
            <h2>
              <Bell size={18} />
              Bildirişlər
            </h2>
            <span className="count-badge">{unmatched ? 3 : 2}</span>
          </div>
          <div className="notification">
            <span className="notification-icon green">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3>Uçot dövrü {state.company.closedThrough ? 'qorunur' : 'açıqdır'}</h3>
              <p>
                {state.company.closedThrough
                  ? `${day(state.company.closedThrough)} tarixinədək sənədlər bağlıdır.`
                  : 'Dövrü bağlamazdan əvvəl DBC-ni yoxlayın.'}
              </p>
              <button className="text-link" onClick={() => open('trial')}>
                Dövriyyə balansına bax
              </button>
            </div>
          </div>
          {unmatched > 0 && (
            <div className="notification">
              <span className="notification-icon amber">
                <ClipboardList size={18} />
              </span>
              <div>
                <h3>{unmatched} ödəniş ümumi borca işlənib</h3>
                <p>Bu ödənişlər konkret qaiməyə bağlanmayıb.</p>
                <button className="text-link" onClick={() => open('ledger')}>
                  Yazılışlara bax
                </button>
              </div>
            </div>
          )}
          <div className="notification">
            <span className="notification-icon">
              <CircleHelp size={18} />
            </span>
            <div>
              <h3>İlk versiyanın əhatəsi</h3>
              <p>
                Qaimələr, bank hesablaşmaları və DBC. DVX, anbar və valyuta uçotu ayrıca hazırlanır.
              </p>
              <button className="text-link" onClick={() => open('settings')}>
                Proqram haqqında
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="work-note">
        <CheckCheck size={17} />
        <span>Qaimə və ödənişlər yadda saxlandıqda uçot yazılışları avtomatik formalaşır.</span>
        <button onClick={() => open('ledger')}>
          Jurnalı aç <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
}
