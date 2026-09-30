import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { pathToFileURL } from 'node:url';
import type { MutationResult } from '../shared/types.js';
import {
  windowPages,
  windowTitles,
  type WindowContext,
  type WindowRequest,
} from '../shared/windows.js';
import { validateCommand } from './transport.js';
import { date } from '../core/money.js';
import type { Store } from '../core/database.js';
type Entry = { window: BrowserWindow; context: WindowContext; dirty: boolean; key: string };
export class WindowManager {
  readonly entries = new Map<number, Entry>();
  constructor(
    private store: Store,
    private renderer: string,
    private preload: string,
    private dev = false,
  ) {}
  private allowedURL(value: string) {
    try {
      const url = new URL(value);
      return this.dev
        ? url.origin === 'http://127.0.0.1:5173'
        : url.href === pathToFileURL(this.renderer).href;
    } catch {
      return false;
    }
  }
  sender(event: IpcMainEvent | IpcMainInvokeEvent): Entry {
    const entry = [...this.entries.values()].find((e) => e.window.webContents === event.sender);
    if (
      !entry ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !this.allowedURL(event.senderFrame.url)
    )
      throw new Error('Bu pəncərəyə giriş icazəsi verilmir.');
    return entry;
  }
  handle(channel: string, action: (entry: Entry, ...args: any[]) => unknown) {
    ipcMain.handle(channel, (event, ...args) => action(this.sender(event), ...args));
  }
  private request(value: unknown, source?: Entry): WindowRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Pəncərə seçimi düzgün deyil.');
    const r = value as WindowRequest;
    if (!windowPages.includes(r.page) || typeof r.companyId !== 'string')
      throw new Error('Bölmə tapılmadı.');
    if (source?.context.companyId && source.context.companyId !== r.companyId && r.page !== 'home')
      throw new Error('Başqa şirkət üçün iş masasından pəncərə açın.');
    if (r.page === 'home') return { page: 'home', companyId: '' };
    this.store.companyName(r.companyId);
    if (r.form !== undefined && r.form !== 'invoice' && r.form !== 'payment')
      throw new Error('Sənəd növü düzgün deyil.');
    if (
      (r.form === 'invoice' && !['purchase', 'sale'].includes(r.page)) ||
      (r.form === 'payment' && !['bank-in', 'bank-out'].includes(r.page))
    )
      throw new Error('Sənəd bölməyə uyğun deyil.');
    if (
      r.documentId !== undefined &&
      (r.form !== 'invoice' ||
        typeof r.documentId !== 'string' ||
        !r.documentId ||
        r.documentId.length > 80)
    )
      throw new Error('Sənəd seçimi düzgün deyil.');
    const filter = r.filter
      ? {
          from: date(r.filter.from),
          to: date(r.filter.to),
          account: typeof r.filter.account === 'string' ? r.filter.account : '',
        }
      : undefined;
    if (filter && (filter.from > filter.to || filter.account.length > 20))
      throw new Error('Filtr düzgün deyil.');
    return { page: r.page, companyId: r.companyId, form: r.form, documentId: r.documentId, filter };
  }
  command(source: Entry, value: unknown) {
    const command = validateCommand(value);
    if (
      source.context.companyId &&
      (command.op === 'company.create' || command.companyId !== source.context.companyId)
    )
      throw new Error('Əməliyyat pəncərənin şirkətinə uyğun deyil.');
    const result = this.store.call(command);
    if (command.op !== 'state' && command.op !== 'invoice.postings')
      this.broadcast(
        'meyar:data-changed',
        command.op === 'company.create' ? (result as MutationResult).id : command.companyId,
      );
    return result;
  }
  private broadcast(channel: string, value?: unknown) {
    for (const { window } of this.entries.values())
      if (!window.isDestroyed()) window.webContents.send(channel, value);
  }
  notify() {
    this.broadcast('meyar:windows-changed');
  }
  list() {
    return [...this.entries.values()].map((e) => ({
      id: e.window.id,
      title: e.window.getTitle(),
      companyId: e.context.companyId,
      page: e.context.page,
      dirty: e.dirty,
    }));
  }
  focus(id: number) {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.window.isMinimized()) e.window.restore();
    e.window.show();
    e.window.focus();
  }
  async confirmDiscard(entry: Entry) {
    if (!entry.dirty) return true;
    const r = await dialog.showMessageBox(entry.window, {
      type: 'question',
      title: 'Saxlanmamış məlumat',
      message: 'Daxil etdiyiniz dəyişikliklər saxlanmayıb.',
      detail: 'Bağlasanız bu dəyişikliklər itəcək. Mövcud uçot məlumatları dəyişməyəcək.',
      buttons: ['Geri qayıt', 'Dəyişiklikləri at'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return r.response === 1;
  }
  async create(value: WindowRequest, source?: Entry): Promise<BrowserWindow> {
    const r = this.request(value, source);
    if (r.page !== 'home' || r.form) throw new Error('Bölmələr proqram daxilində açılır.');
    // New document requests get a new editor; existing documents focus their own editor.
    const key = JSON.stringify([
      r.page,
      r.companyId,
      r.form ?? '',
      r.documentId ?? '',
      r.filter ?? null,
    ]);
    const existing = [...this.entries.values()].find((e) => e.key === key);
    if (existing && (!r.form || r.documentId)) {
      this.focus(existing.window.id);
      return existing.window;
    }
    const title = `${r.form ? (r.documentId ? 'Qaiməyə düzəliş' : 'Yeni sənəd') + ' · ' : ''}${windowTitles[r.page]}${r.companyId ? ' · ' + this.store.companyName(r.companyId) : ''} — Meyar ERP`;
    const native = new BrowserWindow({
      width: r.form ? 760 : 1440,
      height: r.form ? 830 : 940,
      minWidth: r.form ? 640 : 1050,
      minHeight: r.form ? 680 : 700,
      show: false,
      backgroundColor: '#f8f3df',
      autoHideMenuBar: true,
      title,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: this.dev,
      },
    });
    const windowId = native.id;
    const context = { ...r, id: windowId };
    const entry: Entry = { window: native, context, dirty: false, key };
    this.entries.set(native.id, entry);
    native.on('page-title-updated', (event) => event.preventDefault());
    native.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    native.webContents.on('will-navigate', (event, url) => {
      if (!this.allowedURL(url)) event.preventDefault();
    });
    native.webContents.on('will-redirect', (e) => e.preventDefault());
    native.webContents.on('will-attach-webview', (e) => e.preventDefault());
    let confirming = false;
    native.on('close', (event) => {
      if (!entry.dirty) return;
      event.preventDefault();
      if (confirming) return;
      confirming = true;
      void this.confirmDiscard(entry)
        .then((discard) => {
          confirming = false;
          if (discard && !native.isDestroyed()) {
            entry.dirty = false;
            native.close();
          }
        })
        .catch(() => {
          confirming = false;
        });
    });
    native.on('closed', () => {
      this.entries.delete(windowId);
      this.notify();
    });
    native.once('ready-to-show', () => {
      native.setTitle(title);
      native.show();
      this.notify();
    });
    try {
      if (this.dev) await native.loadURL('http://127.0.0.1:5173');
      else await native.loadFile(this.renderer);
    } catch (error) {
      native.destroy();
      throw error;
    }
    this.notify();
    return native;
  }
  register() {
    this.handle('meyar:command', (e, value) => this.command(e, value));
    this.handle('meyar:window-context', (e) => e.context);
    this.handle('meyar:window-open', async (e, r) => {
      await this.create(r, e);
    });
    this.handle('meyar:window-list', () => this.list());
    this.handle('meyar:window-focus', (_e, id) => {
      if (Number.isSafeInteger(id)) this.focus(id);
    });
    this.handle('meyar:window-close', (e, id) => {
      if (id !== undefined && !Number.isSafeInteger(id)) throw new Error('Pəncərə düzgün deyil.');
      this.entries.get(id ?? e.window.id)?.window.close();
    });
    this.handle('meyar:window-minimize', (e) => e.window.minimize());
    this.handle('meyar:window-maximize', (e) => {
      if (e.window.isMaximized()) e.window.unmaximize();
      else e.window.maximize();
    });
    this.handle('meyar:window-dirty', (e, dirty) => {
      if (typeof dirty !== 'boolean') throw new Error('Pəncərə vəziyyəti düzgün deyil.');
      if (e.dirty === dirty) return;
      e.dirty = dirty;
      this.notify();
    });
    this.handle('meyar:window-discard', (e) => this.confirmDiscard(e));
  }
}
