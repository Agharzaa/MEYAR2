export type Direction = 'purchase' | 'sale';
export type PaymentDirection = 'in' | 'out';
export interface Company {
  id: string;
  name: string;
  taxId: string;
  closedThrough: string;
}
export interface Partner {
  id: string;
  name: string;
  taxId: string;
}
export interface InvoiceInput {
  id?: string;
  number: string;
  date: string;
  partnerId: string;
  direction: Direction;
  kind: 'goods' | 'service';
  net: string;
  vat: string;
  subaccount: string;
  description: string;
}
export interface Invoice extends InvoiceInput {
  id: string;
  partnerName: string;
  taxId: string;
  netCents: number;
  vatCents: number;
  totalCents: number;
  status: 'posted' | 'cancelled';
  paidCents: number;
  version: number;
}
export interface PaymentInput {
  reference: string;
  date: string;
  partnerId: string;
  direction: PaymentDirection;
  amount: string;
  bankAccount: '223' | '224.04';
  invoiceId: string;
  description: string;
}
export interface Payment extends PaymentInput {
  id: string;
  partnerName: string;
  amountCents: number;
  status: 'posted' | 'cancelled';
}
export interface TrialRow {
  account: string;
  name: string;
  openingDebit: number;
  openingCredit: number;
  debit: number;
  credit: number;
  closingDebit: number;
  closingCredit: number;
}
export interface LedgerRow {
  id: string;
  date: string;
  account: string;
  partnerName: string;
  subaccount: string;
  debit: number;
  credit: number;
  description: string;
  sourceNumber: string;
  reversal: number;
}
export interface Balance {
  partnerId: string;
  name: string;
  taxId: string;
  receivable: number;
  payable: number;
}
export interface AuditRow {
  id: number;
  createdAt: string;
  action: string;
  entity: string;
  description: string;
}
export interface ReportFilter {
  from: string;
  to: string;
  account: string;
}
export interface State {
  company: Company;
  companies: Company[];
  partners: Partner[];
  invoices: Invoice[];
  payments: Payment[];
  trial: TrialRow[];
  ledger: LedgerRow[];
  balances: Balance[];
  audit: AuditRow[];
  accounts: { code: string; name: string }[];
  report: ReportFilter;
}
export type Command =
  | { op: 'state'; companyId: string; filter: ReportFilter }
  | { op: 'company.create'; name: string; taxId: string }
  | { op: 'partner.save'; companyId: string; name: string; taxId: string }
  | { op: 'invoice.save'; companyId: string; invoice: InvoiceInput }
  | { op: 'invoice.cancel'; companyId: string; id: string; reason: string }
  | { op: 'payment.save'; companyId: string; payment: PaymentInput }
  | { op: 'payment.cancel'; companyId: string; id: string; reason: string }
  | { op: 'period.close'; companyId: string; date: string }
  | { op: 'invoice.import'; companyId: string; rows: ImportRow[] };
export interface ImportRow {
  number: string;
  date: string;
  taxId: string;
  partnerName: string;
  direction: Direction;
  kind: 'goods' | 'service';
  net: string;
  vat: string;
  subaccount: string;
  description: string;
}
export interface MutationResult {
  id?: string;
  created?: number;
  updated?: number;
  unchanged?: number;
}
export interface DesktopAPI {
  call(command: Command): Promise<State | MutationResult>;
  backup(): Promise<string | null>;
  importFile(direction: Direction): Promise<ImportRow[] | null>;
  template(): Promise<string | null>;
  checkUpdate(): Promise<string>;
  version(): Promise<string>;
}
declare global {
  interface Window {
    meyar?: DesktopAPI;
  }
}
