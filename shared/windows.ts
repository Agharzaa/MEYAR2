import type { ReportFilter } from './types.js';
export const windowPages = [
  'home',
  'purchase',
  'sale',
  'bank-in',
  'bank-out',
  'trial',
  'ledger',
  'partners',
  'receivables',
  'payables',
  'accounts',
  'audit',
  'settings',
] as const;
export type Page = (typeof windowPages)[number];
export const windowTitles: Record<Page, string> = {
  home: 'İş masası',
  purchase: 'Gələn qaimələr',
  sale: 'Gedən qaimələr',
  'bank-in': 'Daxil olan ödənişlər',
  'bank-out': 'Çıxan ödənişlər',
  trial: 'Dövriyyə balans cədvəli',
  ledger: 'Müxabirləşmə jurnalı',
  partners: 'Kontragentlər',
  receivables: 'Debitorlar · 211',
  payables: 'Kreditorlar · 531',
  accounts: 'Hesab planı',
  audit: 'Əməliyyat tarixçəsi',
  settings: 'Şirkət və proqram',
};
export interface WindowRequest {
  page: Page;
  companyId: string;
  form?: 'invoice' | 'payment';
  documentId?: string;
  filter?: ReportFilter;
}
export interface WindowContext extends WindowRequest {
  id: number;
}
export interface OpenWindow {
  id: number;
  title: string;
  companyId: string;
  page: Page;
  dirty: boolean;
}
export interface WindowBridge {
  context(): Promise<WindowContext>;
  open(request: WindowRequest): Promise<void>;
  list(): Promise<OpenWindow[]>;
  focus(id: number): Promise<void>;
  close(id?: number): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  setDirty(dirty: boolean): Promise<void>;
  confirmDiscard(): Promise<boolean>;
  onChanged(callback: () => void): () => void;
  onDataChanged(callback: (companyId: string) => void): () => void;
}
