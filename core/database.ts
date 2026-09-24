import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID as uuid } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { accounts, schema } from './schema.js';
import { cents, decimal, text, optional, date, taxId, safe, sum } from './money.js';
import type {
  Command,
  Company,
  ImportRow,
  Invoice,
  InvoiceInput,
  MutationResult,
  Partner,
  Payment,
  PaymentInput,
  ReportFilter,
  State,
  TrialRow,
} from '../shared/types.js';
type Row = Record<string, string | number | null>;
type Line = {
  account: string;
  partnerId?: string;
  subaccount?: string;
  debit: number;
  credit: number;
};
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;',
      );
      const version = this.one('PRAGMA user_version')?.user_version;
      if (Number(version) > 2) throw new Error('Baza daha yeni proqram versiyası tələb edir.');
      this.tx(() => this.db.exec(schema));
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private one(sql: string, ...p: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...p) as Row | undefined;
  }
  private all(sql: string, ...p: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...p) as Row[];
  }
  private run(sql: string, ...p: SQLInputValue[]) {
    return this.db.prepare(sql).run(...p);
  }
  private tx<T>(fn: () => T, readOnly = false): T {
    this.db.exec(readOnly ? 'BEGIN DEFERRED' : 'BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private audit(companyId: string, action: string, entity: string, description: string) {
    this.run(
      'INSERT INTO audit(company_id,action,entity,description) VALUES(?,?,?,?)',
      companyId,
      action,
      entity,
      description,
    );
  }
  private company(id: string): Row {
    const c = this.one('SELECT * FROM companies WHERE id=?', text(id, 'Şirkət'));
    if (!c) throw new Error('Şirkət tapılmadı.');
    return c;
  }
  private partner(companyId: string, id: string): Row {
    const p = this.one(
      'SELECT * FROM partners WHERE company_id=? AND id=?',
      companyId,
      text(id, 'Kontragent'),
    );
    if (!p) throw new Error('Bu şirkətdə kontragent tapılmadı.');
    return p;
  }
  private open(companyId: string, value: unknown): string {
    const d = date(value);
    if (d <= String(this.company(companyId).closed_through))
      throw new Error('Bu tarix üzrə uçot dövrü bağlanıb.');
    return d;
  }
  private savePartner(companyId: string, nameValue: unknown, taxValue: unknown): string {
    this.company(companyId);
    const name = text(nameValue, 'Kontragent adı');
    const tax = taxId(taxValue);
    const old = this.one('SELECT * FROM partners WHERE company_id=? AND tax_id=?', companyId, tax);
    if (old) {
      if (old.name !== name) {
        this.run('UPDATE partners SET name=? WHERE id=?', name, old.id);
        this.audit(companyId, 'Yeniləndi', 'Kontragent', `${tax}: ${old.name} → ${name}`);
      }
      return String(old.id);
    }
    const id = uuid();
    this.run('INSERT INTO partners VALUES(?,?,?,?)', id, companyId, name, tax);
    this.audit(companyId, 'Yaradıldı', 'Kontragent', `${name} · ${tax}`);
    return id;
  }
  private post(
    companyId: string,
    d: string,
    type: string,
    id: string,
    number: string,
    version: number,
    reversal: number,
    description: string,
    lines: Line[],
  ) {
    const debits = lines.reduce((n, l) => n + BigInt(l.debit), 0n),
      credits = lines.reduce((n, l) => n + BigInt(l.credit), 0n);
    if (debits !== credits || debits <= 0n) throw new Error('Debet və kredit bərabər deyil.');
    const journalId = uuid();
    this.run(
      'INSERT INTO journals VALUES(?,?,?,?,?,?,?,?,?)',
      journalId,
      companyId,
      d,
      type,
      id,
      number,
      version,
      reversal,
      description,
    );
    for (const l of lines) {
      safe(l.debit);
      safe(l.credit);
      if (!accounts.some((a) => a[0] === l.account))
        throw new Error('Hesab planında hesab yoxdur.');
      if (l.partnerId) this.partner(companyId, l.partnerId);
      if (l.debit + l.credit === 0) continue;
      this.run(
        'INSERT INTO entries VALUES(?,?,?,?,?,?,?)',
        uuid(),
        journalId,
        l.account,
        l.partnerId ?? null,
        l.subaccount ?? '',
        l.debit,
        l.credit,
      );
    }
  }
  private reverse(companyId: string, type: string, id: string, version: number, reason: string) {
    const j = this.one(
      'SELECT * FROM journals WHERE company_id=? AND source_type=? AND source_id=? AND version=? AND reversal=0',
      companyId,
      type,
      id,
      version,
    );
    if (!j) throw new Error('İlkin müxabirləşmə tapılmadı.');
    this.open(companyId, j.date);
    const lines = this.all('SELECT * FROM entries WHERE journal_id=?', j.id).map((e) => ({
      account: String(e.account),
      partnerId: e.partner_id ? String(e.partner_id) : undefined,
      subaccount: String(e.subaccount),
      debit: Number(e.credit),
      credit: Number(e.debit),
    }));
    this.post(
      companyId,
      String(j.date),
      type,
      id,
      String(j.source_number),
      version,
      1,
      reason,
      lines,
    );
  }
  private saveInvoice(companyId: string, raw: InvoiceInput): MutationResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Qaimə məlumatları yoxdur.');
    const d = date(raw.date),
      partner = this.partner(companyId, raw.partnerId),
      number = text(raw.number, 'Qaimə nömrəsi', 80).toUpperCase();
    if (!['purchase', 'sale'].includes(raw.direction) || !['goods', 'service'].includes(raw.kind))
      throw new Error('Qaimə istiqaməti və növü seçilməlidir.');
    const net = cents(raw.net, 'Əsas məbləğ'),
      vat = cents(raw.vat, 'ƏDV');
    if (net <= 0) throw new Error('Əsas məbləğ sıfırdan böyük olmalıdır.');
    const input: InvoiceInput = {
      number,
      date: d,
      partnerId: String(partner.id),
      direction: raw.direction,
      kind: raw.kind,
      net: decimal(net),
      vat: decimal(vat),
      subaccount: optional(raw.subaccount, 100),
      description: optional(raw.description),
    };
    if (input.direction === 'purchase' && input.kind === 'service' && !input.subaccount)
      throw new Error('Xidmət alışında 721 üçün subkonto yazın.');
    if (raw.id !== undefined) text(raw.id, 'Qaimə');
    const byKey = this.one(
      'SELECT * FROM invoices WHERE company_id=? AND partner_id=? AND number=? AND direction=?',
      companyId,
      partner.id,
      number,
      input.direction,
    );
    const existing = raw.id
      ? this.one(
          'SELECT * FROM invoices WHERE id=? AND company_id=?',
          text(raw.id, 'Qaimə'),
          companyId,
        )
      : byKey;
    if (raw.id && !existing) throw new Error('Qaimə tapılmadı.');
    if (byKey && existing && byKey.id !== existing.id)
      throw new Error('Bu nömrə, VÖEN və istiqamətlə qaimə artıq mövcuddur.');
    if (existing?.status === 'cancelled')
      throw new Error('Ləğv olunmuş qaimənin nömrəsi təkrar istifadə edilə bilməz.');
    if (existing?.input === JSON.stringify(input)) return { id: String(existing.id), unchanged: 1 };
    this.open(companyId, d);
    const id = existing ? String(existing.id) : uuid(),
      version = existing ? Number(existing.version) + 1 : 1;
    if (existing) {
      this.open(companyId, existing.date);
      if (
        this.one(
          "SELECT id FROM payments WHERE company_id=? AND invoice_id=? AND status='posted'",
          companyId,
          id,
        )
      )
        throw new Error(
          'Ödənişlə bağlanmış qaiməni dəyişmək üçün əvvəl əlaqəli ödənişi ləğv edin.',
        );
      this.reverse(companyId, 'invoice', id, Number(existing.version), 'Qaimə düzəlişi');
      this.run(
        'UPDATE invoices SET partner_id=?,number=?,date=?,direction=?,net=?,vat=?,version=?,input=? WHERE id=?',
        partner.id,
        number,
        d,
        input.direction,
        net,
        vat,
        version,
        JSON.stringify(input),
        id,
      );
    } else
      this.run(
        "INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,'posted',?)",
        id,
        companyId,
        partner.id,
        number,
        d,
        input.direction,
        net,
        vat,
        version,
        JSON.stringify(input),
      );
    const total = sum(net, vat),
      p = String(partner.id);
    const lines: Line[] =
      input.direction === 'sale'
        ? [
            { account: '211', partnerId: p, debit: total, credit: 0 },
            { account: '601', debit: 0, credit: net },
            { account: '545', debit: 0, credit: vat },
          ]
        : [
            {
              account: input.kind === 'goods' ? '205' : '721',
              subaccount: input.subaccount,
              debit: net,
              credit: 0,
            },
            { account: '241', debit: vat, credit: 0 },
            { account: '531', partnerId: p, debit: 0, credit: total },
          ];
    this.post(
      companyId,
      d,
      'invoice',
      id,
      number,
      version,
      0,
      input.description || `${input.direction === 'sale' ? 'Satış' : 'Alış'} · ${partner.name}`,
      lines,
    );
    this.audit(
      companyId,
      existing ? 'Yeniləndi' : 'Uçota alındı',
      'Qaimə',
      `${number} · v${version} · ${decimal(total)} AZN`,
    );
    return { id, ...(existing ? { updated: 1 } : { created: 1 }) };
  }
  private savePayment(companyId: string, raw: PaymentInput): MutationResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Ödəniş məlumatları yoxdur.');
    const d = date(raw.date),
      partner = this.partner(companyId, raw.partnerId),
      reference = text(raw.reference, 'Bank sənədi nömrəsi', 80).toUpperCase(),
      amount = cents(raw.amount);
    if (amount <= 0) throw new Error('Məbləğ sıfırdan böyük olmalıdır.');
    if (!['in', 'out'].includes(raw.direction) || !['223', '224.04'].includes(raw.bankAccount))
      throw new Error('Ödəniş istiqaməti və bank hesabı düzgün deyil.');
    const input: PaymentInput = {
      reference,
      date: d,
      partnerId: String(partner.id),
      direction: raw.direction,
      amount: decimal(amount),
      bankAccount: raw.bankAccount,
      invoiceId: optional(raw.invoiceId, 80),
      description: optional(raw.description),
    };
    const old = this.one(
      'SELECT * FROM payments WHERE company_id=? AND reference=? AND direction=? AND bank_account=?',
      companyId,
      reference,
      input.direction,
      input.bankAccount,
    );
    if (old) {
      if (old.status === 'posted' && old.input === JSON.stringify(input))
        return { id: String(old.id), unchanged: 1 };
      throw new Error('Bu bank sənədi nömrəsi artıq mövcuddur.');
    }
    this.open(companyId, d);
    if (input.invoiceId) {
      const invoice = this.one(
        "SELECT * FROM invoices WHERE company_id=? AND id=? AND status='posted'",
        companyId,
        input.invoiceId,
      );
      if (
        !invoice ||
        invoice.partner_id !== partner.id ||
        invoice.direction !== (input.direction === 'in' ? 'sale' : 'purchase')
      )
        throw new Error('Qaimə kontragent və ödəniş istiqamətinə uyğun deyil.');
      if (d < String(invoice.date))
        throw new Error('Qaiməyə bağlanan ödənişin tarixi qaimədən əvvəl ola bilməz.');
      const paid = Number(
        this.one(
          "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE company_id=? AND invoice_id=? AND status='posted'",
          companyId,
          input.invoiceId,
        )!.total,
      );
      if (sum(paid, amount) > sum(Number(invoice.net), Number(invoice.vat)))
        throw new Error('Ödəniş qaimənin qalıq borcundan çoxdur.');
    }
    const id = uuid();
    this.run(
      "INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,'posted',?)",
      id,
      companyId,
      partner.id,
      input.invoiceId || null,
      reference,
      d,
      input.direction,
      input.bankAccount,
      amount,
      JSON.stringify(input),
    );
    const lines: Line[] =
      input.direction === 'in'
        ? [
            { account: input.bankAccount, debit: amount, credit: 0 },
            { account: '211', partnerId: String(partner.id), debit: 0, credit: amount },
          ]
        : [
            { account: '531', partnerId: String(partner.id), debit: amount, credit: 0 },
            { account: input.bankAccount, debit: 0, credit: amount },
          ];
    this.post(
      companyId,
      d,
      'payment',
      id,
      reference,
      1,
      0,
      input.description ||
        `${input.direction === 'in' ? 'Daxil olan' : 'Çıxan'} ödəniş · ${partner.name}`,
      lines,
    );
    this.audit(companyId, 'Uçota alındı', 'Bank', `${reference} · ${decimal(amount)} AZN`);
    return { id, created: 1 };
  }
  private cancel(companyId: string, type: 'invoice' | 'payment', id: string, reasonValue: string) {
    this.company(companyId);
    const reason = text(reasonValue, 'Ləğv səbəbi');
    const table = type === 'invoice' ? 'invoices' : 'payments';
    const old = this.one(
      `SELECT * FROM ${table} WHERE company_id=? AND id=?`,
      companyId,
      text(id, 'Sənəd'),
    );
    if (!old || old.status !== 'posted') throw new Error('Aktiv sənəd tapılmadı.');
    if (
      type === 'invoice' &&
      this.one(
        "SELECT id FROM payments WHERE company_id=? AND invoice_id=? AND status='posted'",
        companyId,
        id,
      )
    )
      throw new Error('Əvvəl əlaqəli bank ödənişini ləğv edin.');
    this.reverse(
      companyId,
      type,
      id,
      type === 'invoice' ? Number(old.version) : 1,
      `Ləğv: ${reason}`,
    );
    this.run(`UPDATE ${table} SET status='cancelled' WHERE id=?`, id);
    this.audit(
      companyId,
      'Ləğv edildi',
      type === 'invoice' ? 'Qaimə' : 'Bank',
      `${old.number ?? old.reference} · ${reason}`,
    );
    return { id };
  }
  call(command: Command): State | MutationResult {
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      typeof command.op !== 'string'
    )
      throw new Error('Əməliyyat düzgün deyil.');
    if (command.op === 'state') return this.snapshot(command.companyId, command.filter);
    return this.tx(() => {
      switch (command.op) {
        case 'company.create': {
          const name = text(command.name, 'Şirkət adı'),
            tax = taxId(command.taxId);
          if (this.one('SELECT id FROM companies WHERE tax_id=?', tax))
            throw new Error('Bu VÖEN ilə şirkət artıq mövcuddur.');
          const id = uuid();
          this.run('INSERT INTO companies(id,name,tax_id) VALUES(?,?,?)', id, name, tax);
          this.audit(id, 'Yaradıldı', 'Şirkət', name);
          return { id };
        }
        case 'partner.save':
          return { id: this.savePartner(command.companyId, command.name, command.taxId) };
        case 'invoice.save':
          return this.saveInvoice(command.companyId, command.invoice);
        case 'payment.save':
          return this.savePayment(command.companyId, command.payment);
        case 'invoice.cancel':
          return this.cancel(command.companyId, 'invoice', command.id, command.reason);
        case 'payment.cancel':
          return this.cancel(command.companyId, 'payment', command.id, command.reason);
        case 'period.close': {
          const d = this.open(command.companyId, command.date);
          if (d >= new Date().toISOString().slice(0, 10))
            throw new Error('Yalnız keçmiş tarixədək dövr bağlamaq olar.');
          this.run('UPDATE companies SET closed_through=? WHERE id=?', d, command.companyId);
          this.audit(command.companyId, 'Dövr bağlandı', 'Şirkət', d);
          return {};
        }
        case 'invoice.import': {
          this.company(command.companyId);
          if (!Array.isArray(command.rows) || !command.rows.length || command.rows.length > 1000)
            throw new Error('İdxalda 1–1000 sətir olmalıdır.');
          const result = { created: 0, updated: 0, unchanged: 0 };
          const seen = new Set<string>();
          for (const [index, row] of command.rows.entries()) {
            try {
              if (!row || typeof row !== 'object' || Array.isArray(row))
                throw new Error('Qaimə sətri düzgün deyil.');
              const key = [
                taxId(row.taxId),
                text(row.number, 'Qaimə nömrəsi', 80).toUpperCase(),
                row.direction,
              ].join('|');
              if (seen.has(key)) throw new Error('Faylda təkrar qaimə var.');
              seen.add(key);
              const partnerId = this.savePartner(command.companyId, row.partnerName, row.taxId);
              const r = this.saveInvoice(command.companyId, { ...row, partnerId, id: undefined });
              result.created += r.created ?? 0;
              result.updated += r.updated ?? 0;
              result.unchanged += r.unchanged ?? 0;
            } catch (e) {
              throw new Error(`Sətir ${index + 2}: ${(e as Error).message}`);
            }
          }
          return result;
        }
        default:
          throw new Error('Dəstəklənməyən əməliyyat.');
      }
    });
  }
  snapshot(companyId: string, filter: ReportFilter): State {
    return this.tx(() => this.readSnapshot(companyId, filter), true);
  }
  private readSnapshot(companyId: string, filter: ReportFilter): State {
    if (
      typeof companyId !== 'string' ||
      !filter ||
      typeof filter !== 'object' ||
      Array.isArray(filter)
    )
      throw new Error('Hesabat filtri düzgün deyil.');
    const from = date(filter.from),
      to = date(filter.to);
    if (from > to) throw new Error('Başlanğıc tarix son tarixdən böyükdür.');
    const account = optional(filter.account, 20);
    if (account && !accounts.some((a) => a[0] === account)) throw new Error('Hesab tapılmadı.');
    const companies = this.all(
      'SELECT id,name,tax_id AS taxId,closed_through AS closedThrough FROM companies ORDER BY name',
    ) as unknown as Company[];
    if (!companies.length)
      return {
        company: { id: '', name: '', taxId: '', closedThrough: '' },
        companies,
        partners: [],
        invoices: [],
        payments: [],
        trial: [],
        ledger: [],
        balances: [],
        audit: [],
        accounts: accounts.map(([code, name]) => ({ code, name })),
        report: { from, to, account },
      };
    const company =
      companies.find((c) => c.id === companyId) || (companyId === '' ? companies[0] : undefined);
    if (!company) throw new Error('Şirkət tapılmadı.');
    const id = company.id;
    const partners = this.all(
      'SELECT id,name,tax_id AS taxId FROM partners WHERE company_id=? ORDER BY name',
      id,
    ) as unknown as Partner[];
    const invoices = this.all(
      `SELECT i.*,p.name AS partnerName,p.tax_id AS taxId,COALESCE((SELECT SUM(amount) FROM payments pay WHERE pay.invoice_id=i.id AND pay.company_id=i.company_id AND pay.status='posted'),0) AS paid FROM invoices i JOIN partners p ON p.id=i.partner_id WHERE i.company_id=? ORDER BY i.date DESC,i.rowid DESC`,
      id,
    ).map((r) => ({
      ...JSON.parse(String(r.input)),
      id: String(r.id),
      partnerName: String(r.partnerName),
      taxId: String(r.taxId),
      netCents: Number(r.net),
      vatCents: Number(r.vat),
      totalCents: sum(Number(r.net), Number(r.vat)),
      status: r.status,
      paidCents: Number(r.paid),
      version: Number(r.version),
    })) as Invoice[];
    const payments = this.all(
      'SELECT pay.*,p.name AS partnerName FROM payments pay JOIN partners p ON p.id=pay.partner_id WHERE pay.company_id=? ORDER BY pay.date DESC,pay.rowid DESC',
      id,
    ).map((r) => ({
      ...JSON.parse(String(r.input)),
      id: String(r.id),
      partnerName: String(r.partnerName),
      amountCents: Number(r.amount),
      status: r.status,
    })) as Payment[];
    const totals = this.all(
      `SELECT e.account,SUM(CASE WHEN j.date<? THEN e.debit-e.credit ELSE 0 END) AS opening,SUM(CASE WHEN j.date>=? THEN e.debit ELSE 0 END) AS debit,SUM(CASE WHEN j.date>=? THEN e.credit ELSE 0 END) AS credit FROM entries e JOIN journals j ON j.id=e.journal_id WHERE j.company_id=? AND j.date<=? GROUP BY e.account`,
      from,
      from,
      from,
      id,
      to,
    );
    const trial: TrialRow[] = totals
      .filter((r) => !account || r.account === account)
      .map((r) => {
        const opening = safe(Number(r.opening)),
          debit = safe(Number(r.debit)),
          credit = safe(Number(r.credit)),
          closing = sum(opening, debit, -credit);
        return {
          account: String(r.account),
          name: accounts.find((a) => a[0] === r.account)?.[1] ?? '',
          openingDebit: Math.max(opening, 0),
          openingCredit: Math.max(-opening, 0),
          debit,
          credit,
          closingDebit: Math.max(closing, 0),
          closingCredit: Math.max(-closing, 0),
        };
      });
    const ledger = this.all(
      `SELECT e.id,j.date,e.account,COALESCE(p.name,'') AS partnerName,e.subaccount,e.debit,e.credit,j.description,j.source_number AS sourceNumber,j.reversal FROM entries e JOIN journals j ON j.id=e.journal_id LEFT JOIN partners p ON p.id=e.partner_id WHERE j.company_id=? AND j.date>=? AND j.date<=? AND (?='' OR e.account=?) ORDER BY j.date DESC,j.rowid DESC,e.rowid`,
      id,
      from,
      to,
      account,
      account,
    ) as unknown as State['ledger'];
    const balances = this.all(
      `SELECT p.id AS partnerId,p.name,p.tax_id AS taxId,COALESCE(SUM(CASE WHEN e.account='211' THEN e.debit-e.credit ELSE 0 END),0) AS receivable,COALESCE(SUM(CASE WHEN e.account='531' THEN e.credit-e.debit ELSE 0 END),0) AS payable FROM partners p LEFT JOIN entries e ON e.partner_id=p.id AND e.journal_id IN (SELECT id FROM journals WHERE company_id=? AND date<=?) WHERE p.company_id=? GROUP BY p.id ORDER BY p.name`,
      id,
      to,
      id,
    ) as unknown as State['balances'];
    const audit = this.all(
      'SELECT id,created_at AS createdAt,action,entity,description FROM audit WHERE company_id=? ORDER BY id DESC LIMIT 300',
      id,
    ) as unknown as State['audit'];
    return {
      company,
      companies,
      partners,
      invoices,
      payments,
      trial,
      ledger,
      balances,
      audit,
      accounts: accounts.map(([code, name]) => ({ code, name })),
      report: { from, to, account },
    };
  }
  async backup(path: string) {
    await backup(this.db, path);
  }
  close() {
    this.db.close();
  }
}
