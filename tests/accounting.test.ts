import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../core/database.js';
import { cents, date, decimal, sum } from '../core/money.js';
import type {
  Command,
  ImportRow,
  InvoiceInput,
  MutationResult,
  PaymentInput,
  State,
} from '../shared/types.js';
const filter = { from: '2026-01-01', to: '2026-12-31', account: '' };
function fixture(t: TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const mutate = (command: Command) => store.call(command) as MutationResult;
  const companyId = mutate({ op: 'company.create', name: 'Meyar Test', taxId: '1234567891' }).id!;
  const partnerId = mutate({
    op: 'partner.save',
    companyId,
    name: 'Kontragent',
    taxId: '1234567892',
  }).id!;
  const invoice = (extra: Partial<InvoiceInput> = {}) =>
    mutate({
      op: 'invoice.save',
      companyId,
      invoice: {
        number: 'INV-1',
        date: '2026-01-10',
        partnerId,
        direction: 'sale',
        kind: 'service',
        net: '100',
        vat: '18',
        subaccount: '',
        description: '',
        ...extra,
      },
    });
  const payment = (extra: Partial<PaymentInput> = {}) =>
    mutate({
      op: 'payment.save',
      companyId,
      payment: {
        reference: 'BANK-1',
        date: '2026-01-15',
        partnerId,
        direction: 'in',
        amount: '50',
        bankAccount: '223',
        invoiceId: '',
        description: '',
        ...extra,
      },
    });
  const state = (from = filter.from, to = filter.to) =>
    store.snapshot(companyId, { ...filter, from, to });
  return { store, mutate, companyId, partnerId, invoice, payment, state };
}
function balanced(state: State) {
  for (const [debit, credit] of [
    ['openingDebit', 'openingCredit'],
    ['debit', 'credit'],
    ['closingDebit', 'closingCredit'],
  ] as const) {
    assert.equal(
      state.trial.reduce((a, r) => a + r[debit], 0),
      state.trial.reduce((a, r) => a + r[credit], 0),
    );
  }
}
function importRow(extra: Partial<ImportRow> = {}): ImportRow {
  return {
    number: 'IMP-1',
    date: '2026-01-10',
    taxId: '9876543210',
    partnerName: 'İdxal kontragent',
    direction: 'purchase',
    kind: 'service',
    net: '100',
    vat: '18',
    subaccount: 'Rabitə',
    description: '',
    ...extra,
  };
}

test('money retains decimal precision and rejects coercion, negatives and excess precision', () => {
  assert.equal(cents('0.29'), 29);
  assert.equal(cents('100,01'), 10001);
  assert.equal(decimal(29), '0.29');
  for (const value of [
    NaN,
    Infinity,
    1,
    null,
    {},
    '1e3',
    '-1',
    '1.001',
    '9,999.99',
    '9000000000.01',
  ])
    assert.throws(() => cents(value));
  assert.equal(sum(Number.MAX_SAFE_INTEGER, 2, -2), Number.MAX_SAFE_INTEGER);
  assert.throws(() => sum(Number.MAX_SAFE_INTEGER, 1));
});
test('date rejects invalid days/months and accepts leap day', () => {
  assert.equal(date('2024-02-29'), '2024-02-29');
  for (const value of [
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2100-01-01',
    '2026-1-01',
    null,
  ])
    assert.throws(() => date(value));
});
test('sales post balanced receivables, revenue and VAT with exact cents', (t) => {
  const f = fixture(t);
  f.invoice({ net: '100.01', vat: '18.00' });
  const s = f.state();
  balanced(s);
  assert.equal(s.balances[0].receivable, 11801);
  assert.deepEqual(
    s.ledger.map((r) => [r.account, r.debit, r.credit]),
    [
      ['211', 11801, 0],
      ['601', 0, 10001],
      ['545', 0, 1800],
    ],
  );
});
test('service purchases use 721 subkonto; goods use 205; no zero entries are emitted', (t) => {
  const f = fixture(t);
  assert.throws(() => f.invoice({ direction: 'purchase', kind: 'service' }), /subkonto/);
  f.invoice({ direction: 'purchase', kind: 'service', subaccount: 'Rabitə' });
  f.invoice({ number: 'GOODS-1', direction: 'purchase', kind: 'goods', net: '200', vat: '0' });
  const s = f.state();
  balanced(s);
  assert.equal(s.balances[0].payable, 31800);
  assert.ok(
    s.ledger.some((r) => r.account === '721' && r.subaccount === 'Rabitə' && r.debit === 10000),
  );
  assert.ok(s.ledger.some((r) => r.account === '205' && r.debit === 20000));
  assert.ok(s.ledger.every((r) => r.debit > 0 !== r.credit > 0));
});
test('identical invoice retries are no-ops; edits reverse previous posting once', (t) => {
  const f = fixture(t);
  const first = f.invoice();
  const before = f.state();
  assert.deepEqual(f.invoice(), { id: first.id, unchanged: 1 });
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.invoice({ net: '200', vat: '36' }), { id: first.id, updated: 1 });
  const s = f.state();
  balanced(s);
  assert.equal(s.invoices.length, 1);
  assert.equal(s.invoices[0].version, 2);
  assert.equal(s.balances[0].receivable, 23600);
  assert.equal(s.ledger.filter((r) => r.reversal).length, 3);
});
test('invoice edits can move date while maintaining accurate opening and period turnover', (t) => {
  const f = fixture(t);
  const { id } = f.invoice();
  f.invoice({ id, date: '2026-02-10', net: '200', vat: '36' });
  const january = f.state('2026-01-01', '2026-01-31');
  balanced(january);
  assert.equal(january.balances[0].receivable, 0);
  const february = f.state('2026-02-01', '2026-02-28');
  balanced(february);
  const receivable = february.trial.find((r) => r.account === '211')!;
  assert.equal(receivable.openingDebit, 0);
  assert.equal(receivable.debit, 23600);
  assert.equal(receivable.closingDebit, 23600);
});
test('linked payments enforce partner, direction, date and remaining balance', (t) => {
  const f = fixture(t);
  const invoiceId = f.invoice().id!;
  assert.throws(() => f.payment({ invoiceId, direction: 'out' }), /uyğun/);
  assert.throws(() => f.payment({ invoiceId, date: '2026-01-09' }), /əvvəl/);
  assert.throws(() => f.payment({ invoiceId, amount: '118.01' }), /çoxdur/);
  f.payment({ invoiceId });
  assert.deepEqual(f.payment({ invoiceId }), { id: f.state().payments[0].id, unchanged: 1 });
  assert.throws(() => f.payment({ invoiceId, reference: 'BANK-2', amount: '68.01' }), /çoxdur/);
  f.payment({ invoiceId, reference: 'BANK-2', amount: '68' });
  const s = f.state();
  balanced(s);
  assert.equal(s.invoices[0].paidCents, 11800);
  assert.equal(s.balances[0].receivable, 0);
  assert.throws(() => f.invoice({ net: '200' }), /əlaqəli/);
  assert.throws(
    () => f.mutate({ op: 'invoice.cancel', companyId: f.companyId, id: invoiceId, reason: 'Səhv' }),
    /əlaqəli/,
  );
});
test('payment cancellation restores outstanding invoice then invoice cancellation clears ledger balance', (t) => {
  const f = fixture(t);
  const id = f.invoice().id!;
  const payment = f.payment({ invoiceId: id }).id!;
  f.mutate({ op: 'payment.cancel', companyId: f.companyId, id: payment, reason: 'Düzəliş' });
  assert.equal(f.state().invoices[0].paidCents, 0);
  assert.equal(f.state().balances[0].receivable, 11800);
  f.mutate({ op: 'invoice.cancel', companyId: f.companyId, id, reason: 'Səhv sənəd' });
  const s = f.state();
  balanced(s);
  assert.equal(s.balances[0].receivable, 0);
  assert.equal(s.invoices[0].status, 'cancelled');
  assert.throws(() => f.invoice(), /Ləğv/);
  assert.throws(
    () => f.mutate({ op: 'invoice.cancel', companyId: f.companyId, id, reason: 'Təkrar' }),
    /Aktiv/,
  );
});
test('failed import rolls back new partners, invoices, reversals and audit records', (t) => {
  const f = fixture(t);
  f.mutate({ op: 'invoice.import', companyId: f.companyId, rows: [importRow()] });
  const before = f.state();
  assert.throws(
    () =>
      f.mutate({
        op: 'invoice.import',
        companyId: f.companyId,
        rows: [
          importRow({ net: '200' }),
          importRow({
            number: 'IMP-2',
            taxId: '9999999999',
            partnerName: 'Rollback',
            net: '1.001',
          }),
        ],
      }),
    /Sətir 3/,
  );
  assert.deepEqual(f.state(), before);
});
test('reimport updates source-key matches, preserves direction and rejects duplicates atomically', (t) => {
  const f = fixture(t);
  const rows = [importRow(), importRow({ direction: 'sale' })];
  assert.deepEqual(f.mutate({ op: 'invoice.import', companyId: f.companyId, rows }), {
    created: 2,
    updated: 0,
    unchanged: 0,
  });
  assert.deepEqual(f.mutate({ op: 'invoice.import', companyId: f.companyId, rows }), {
    created: 0,
    updated: 0,
    unchanged: 2,
  });
  const before = f.state();
  assert.throws(
    () => f.mutate({ op: 'invoice.import', companyId: f.companyId, rows: [rows[0], rows[0]] }),
    /təkrar/,
  );
  assert.deepEqual(f.state(), before);
  assert.deepEqual(
    f.mutate({ op: 'invoice.import', companyId: f.companyId, rows: [importRow({ net: '250' })] }),
    { created: 0, updated: 1, unchanged: 0 },
  );
  balanced(f.state());
});
test('company separation rejects foreign partners, invoices and document mutations', (t) => {
  const f = fixture(t);
  const id = f.invoice().id!;
  const other = f.mutate({ op: 'company.create', name: 'Digər', taxId: '2222222222' }).id!;
  const otherPartner = f.mutate({
    op: 'partner.save',
    companyId: other,
    name: 'Digər kontragent',
    taxId: '1234567892',
  }).id!;
  assert.throws(() => f.invoice({ partnerId: otherPartner }), /şirkətdə/);
  assert.throws(() => f.payment({ partnerId: otherPartner }), /şirkətdə/);
  assert.throws(
    () => f.mutate({ op: 'invoice.cancel', companyId: other, id, reason: 'Səhv' }),
    /tapılmadı/,
  );
  assert.throws(
    () =>
      f.mutate({
        op: 'payment.save',
        companyId: other,
        payment: {
          reference: 'OTHER',
          date: '2026-01-15',
          partnerId: otherPartner,
          direction: 'in',
          amount: '10',
          bankAccount: '223',
          invoiceId: id,
          description: '',
        },
      }),
    /uyğun/,
  );
  const s = f.store.snapshot(other, filter);
  assert.equal(s.invoices.length, 0);
  assert.equal(s.ledger.length, 0);
  assert.equal(s.balances[0].receivable, 0);
});
test('period close blocks historical insert/edit/cancel and allows exact no-op retry', (t) => {
  const f = fixture(t);
  const id = f.invoice().id!;
  const pay = f.payment().id!;
  f.mutate({ op: 'period.close', companyId: f.companyId, date: '2026-01-31' });
  const before = f.state();
  assert.deepEqual(f.invoice(), { id, unchanged: 1 });
  assert.deepEqual(f.payment(), { id: pay, unchanged: 1 });
  assert.throws(() => f.invoice({ net: '200' }), /bağlanıb/);
  assert.throws(() => f.invoice({ id, date: '2026-02-01' }), /bağlanıb/);
  assert.throws(() => f.invoice({ number: 'NEW' }), /bağlanıb/);
  assert.throws(
    () => f.mutate({ op: 'invoice.cancel', companyId: f.companyId, id, reason: 'Səhv' }),
    /bağlanıb/,
  );
  assert.throws(
    () => f.mutate({ op: 'payment.cancel', companyId: f.companyId, id: pay, reason: 'Səhv' }),
    /bağlanıb/,
  );
  assert.throws(
    () => f.mutate({ op: 'period.close', companyId: f.companyId, date: '2026-01-01' }),
    /bağlanıb/,
  );
  assert.deepEqual(f.state(), before);
  f.invoice({ number: 'NEXT', date: '2026-02-01' });
  balanced(f.state());
});
test('period reports distinguish opening, turnover and closing balances', (t) => {
  const f = fixture(t);
  const invoiceId = f.invoice().id!;
  f.payment({ invoiceId, date: '2026-02-10', amount: '18' });
  const s = f.state('2026-02-01', '2026-02-28');
  balanced(s);
  const r = s.trial.find((r) => r.account === '211')!;
  assert.deepEqual([r.openingDebit, r.debit, r.credit, r.closingDebit], [11800, 0, 1800, 10000]);
  assert.equal(s.balances[0].receivable, 10000);
  assert.equal(s.ledger.length, 2);
  assert.equal(f.state('2026-01-01', '2026-01-31').balances[0].receivable, 11800);
  assert.throws(() => f.state('2026-02-01', '2026-01-01'), /Başlanğıc/);
});
test('untrusted IPC values fail without coercion or writes', (t) => {
  const f = fixture(t);
  const before = f.state();
  for (const invoice of [
    { net: 100 },
    { id: 0 },
    { description: null },
    { subaccount: {} },
    { date: '2026-13-01' },
  ])
    assert.throws(() => f.invoice(invoice as unknown as Partial<InvoiceInput>));
  assert.throws(() => f.store.call(null as unknown as Command));
  assert.throws(() => f.store.snapshot(f.companyId, null as unknown as typeof filter));
  assert.deepEqual(f.state(), before);
});
test('SQLite constraints protect tenant references, immutable journal and closed periods', (t) => {
  const f = fixture(t);
  const invoiceId = f.invoice().id!;
  const other = f.mutate({ op: 'company.create', name: 'Other', taxId: '1111111111' }).id!;
  assert.throws(
    () => f.store.db.prepare('UPDATE invoices SET company_id=? WHERE id=?').run(other, invoiceId),
    /uyğun/,
  );
  assert.throws(() => f.store.db.exec("UPDATE journals SET description='changed'"), /dəyişdirilə/);
  assert.throws(() => f.store.db.exec('DELETE FROM entries'), /silinə/);
  assert.throws(() => f.store.db.exec('UPDATE invoices SET net=1.5'), /Məbləğ/);
  f.mutate({ op: 'period.close', companyId: f.companyId, date: '2026-01-31' });
  assert.throws(() => f.store.db.exec('UPDATE invoices SET net=15000'), /bağlanıb/);
  assert.throws(
    () => f.store.db.prepare("UPDATE companies SET closed_through='' WHERE id=?").run(f.companyId),
    /açıla/,
  );
});
test('consistent backup reopens with identical balances and immutable audit', async (t) => {
  const f = fixture(t);
  f.invoice();
  f.payment();
  const directory = mkdtempSync(join(tmpdir(), 'meyar-backup-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'backup.sqlite');
  await f.store.backup(path);
  const reopened = new Store(path);
  try {
    assert.deepEqual(reopened.snapshot(f.companyId, filter), f.state());
    assert.throws(() => reopened.db.exec('DELETE FROM audit'), /silinə/);
  } finally {
    reopened.close();
  }
});
