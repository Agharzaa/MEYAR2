import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../core/database.js';
import { schema } from '../core/schema.js';
import { scaled, unscaled, converted, lineAmount } from '../core/quantity.js';
import { decimal, sum } from '../core/money.js';
import type { Command, MutationResult, InvoiceInput, State } from '../shared/types.js';
import type { InvoiceItemInput, ProductInput } from '../shared/inventory.js';
const report = { from: '2026-01-01', to: '2026-12-31', account: '' };
function fixture(t: TestContext, path = ':memory:') {
  const store = new Store(path);
  t.after(() => store.close());
  const call = (command: Command) => store.call(command) as MutationResult;
  const companyId = call({ op: 'company.create', name: 'Anbar MMC', taxId: '1111111111' }).id!;
  const partnerId = call({
    op: 'partner.save',
    companyId,
    name: 'Təchizatçı',
    taxId: '2222222222',
  }).id!;
  const state = () => store.snapshot(companyId, report);
  const warehouseId = state().warehouses[0].id;
  function product(extra: Partial<ProductInput> = {}) {
    return call({
      op: 'product.save',
      companyId,
      product: {
        code: 'P-' + (state().products.length + 1),
        name: 'Məhsul ' + (state().products.length + 1),
        group: 'Sınaq',
        barcode: '',
        baseUnitId: 'pcs',
        purchaseUnitId: 'pcs',
        factor: '1',
        category: 'goods',
        ...extra,
      },
    }).id!;
  }
  function item(productId: string, extra: Partial<InvoiceItemInput> = {}): InvoiceItemInput {
    return {
      productId,
      warehouseId,
      category: 'goods',
      unitId: 'pcs',
      quantity: '1',
      unitPrice: '10',
      vat: '0',
      ...extra,
    };
  }
  function invoice(items: InvoiceItemInput[], extra: Partial<InvoiceInput> = {}) {
    return call({
      op: 'invoice.save',
      companyId,
      invoice: {
        number: 'Q-' + (state().invoices.length + 1),
        date: '2026-01-10',
        direction: 'purchase',
        kind: 'goods',
        partnerId,
        subaccount: '',
        description: '',
        net: decimal(sum(...items.map((i) => lineAmount(i.quantity, i.unitPrice)))),
        vat: decimal(sum(...items.map((i) => Math.round(Number(i.vat) * 100)))),
        items,
        ...extra,
      },
    });
  }
  function cancel(id: string) {
    return call({ op: 'invoice.cancel', companyId, id, reason: 'Sınaq ləğvi' });
  }
  return { store, call, companyId, partnerId, warehouseId, state, product, item, invoice, cancel };
}
function balanced(s: State) {
  for (const [d, c] of [
    ['openingDebit', 'openingCredit'],
    ['debit', 'credit'],
    ['closingDebit', 'closingCredit'],
  ] as const)
    assert.equal(sum(...s.trial.map((r) => r[d])), sum(...s.trial.map((r) => r[c])));
}
test('quantity conversion and four-decimal prices use exact integer arithmetic', () => {
  assert.equal(scaled('0,000001'), 1);
  assert.equal(unscaled(-1234500), '-1.2345');
  assert.equal(converted('2', '12'), 24000000);
  assert.equal(lineAmount('1.5', '1.2345'), 185);
  assert.equal(lineAmount('0.5', '0.01'), 1);
  for (const value of ['-1', '1e2', '1.0000001', '', NaN]) assert.throws(() => scaled(value));
  assert.throws(() => converted('0.000001', '0.5'));
  assert.throws(() => lineAmount('0', '10'));
  assert.throws(() => lineAmount('1', '0'));
});
test('mixed purchase posts goods, materials and fixed assets with packaging and indivisible inventory cards', (t) => {
  const f = fixture(t),
    p = f.product({ purchaseUnitId: 'box', factor: '12' }),
    m = f.product({ baseUnitId: 'l', purchaseUnitId: 'l', category: 'material' }),
    a = f.product({ category: 'asset' });
  const rows = [
    f.item(p, { unitId: 'box', quantity: '2', unitPrice: '120', vat: '43.20' }),
    f.item(m, {
      unitId: 'l',
      category: 'material',
      quantity: '1.5',
      unitPrice: '1.2345',
      vat: '0.33',
    }),
    f.item(a, { category: 'asset', quantity: '3', unitPrice: '3.3333', vat: '1.8' }),
  ];
  const saved = f.invoice(rows, { number: 'MIX-1' });
  const s = f.state();
  balanced(s);
  assert.equal(s.stock.find((r) => r.productId === p)!.quantity, '24');
  assert.equal(s.stock.find((r) => r.productId === m)!.quantity, '1.5');
  assert.deepEqual(s.assets.map((a) => a.costCents).sort(), [333, 333, 334]);
  assert.equal(s.ledger.find((r) => r.account === '205')!.debit, 24000);
  assert.equal(s.ledger.find((r) => r.account === '201')!.debit, 185);
  assert.equal(s.ledger.find((r) => r.account === '113')!.debit, 1000);
  assert.equal(s.ledger.find((r) => r.account === '531')!.credit, 29718);
  assert.deepEqual(f.invoice(rows, { number: 'MIX-1' }), { id: saved.id, unchanged: 1 });
  assert.deepEqual(f.state(), s);
  assert.throws(() => f.invoice(rows, { net: '1' }), /cəmi/);
  assert.deepEqual(f.state(), s);
});
test('sales consume weighted average cost; insufficient stock rolls back every invoice line and ledger entry', (t) => {
  const f = fixture(t),
    p = f.product();
  const first = f.invoice([f.item(p, { quantity: '10', unitPrice: '10' })]);
  f.invoice([f.item(p, { quantity: '10', unitPrice: '20' })], { date: '2026-01-11' });
  const sale = f.invoice([f.item(p, { quantity: '4', unitPrice: '30' })], {
    date: '2026-01-12',
    direction: 'sale',
  });
  let s = f.state();
  balanced(s);
  assert.equal(s.stock[0].quantity, '16');
  assert.equal(s.stock[0].valueCents, 24000);
  assert.ok(s.ledger.some((r) => r.account === '701' && r.debit === 6000));
  const before = s;
  assert.throws(
    () =>
      f.invoice([f.item(p, { quantity: '1' }), f.item(p, { quantity: '20' })], {
        date: '2026-01-13',
        direction: 'sale',
      }),
    /qalıq/,
  );
  assert.deepEqual(f.state(), before);
  assert.throws(() => f.cancel(first.id!), /sonrakı/);
  f.cancel(sale.id!);
  s = f.state();
  assert.equal(s.stock[0].quantity, '20');
  assert.equal(s.stock[0].valueCents, 30000);
  balanced(s);
  f.cancel(first.id!);
  assert.equal(f.state().stock[0].quantity, '10');
  assert.equal(f.state().stock[0].valueCents, 20000);
});
test('invoice edits reverse stock and accounting exactly once and reject stale editors', (t) => {
  const f = fixture(t),
    p = f.product(),
    saved = f.invoice([f.item(p, { quantity: '2' })]);
  f.invoice([f.item(p, { quantity: '3', unitPrice: '20' })], {
    number: 'Q-1',
    id: saved.id,
    expectedVersion: 1,
    date: '2026-01-09',
  });
  const s = f.state();
  assert.equal(s.stock[0].quantity, '3');
  assert.equal(s.stock[0].valueCents, 6000);
  assert.equal(s.stockMovements.length, 3);
  balanced(s);
  assert.throws(
    () => f.invoice([f.item(p)], { number: 'Q-1', id: saved.id, expectedVersion: 1 }),
    /başqa pəncərədə/,
  );
  assert.deepEqual(f.state(), s);
  f.cancel(saved.id!);
  assert.equal(f.state().stock.length, 0);
  balanced(f.state());
});
test('material consumption posts 721/201 and supports idempotent save and audited reversal', (t) => {
  const f = fixture(t),
    p = f.product({ category: 'material' });
  f.invoice([f.item(p, { category: 'material', quantity: '10', unitPrice: '2' })]);
  const command: Command = {
    op: 'stock.issue',
    companyId: f.companyId,
    issue: {
      reference: 'IST-1',
      date: '2026-01-11',
      productId: p,
      warehouseId: f.warehouseId,
      quantity: '3',
      subaccount: 'Ofis',
    },
  };
  const saved = f.call(command);
  assert.deepEqual(f.call(command), { id: saved.id, unchanged: 1 });
  let s = f.state();
  assert.equal(s.stock[0].quantity, '7');
  assert.equal(s.stock[0].valueCents, 1400);
  assert.ok(
    s.ledger.some((r) => r.account === '721' && r.subaccount === 'Ofis' && r.debit === 600),
  );
  balanced(s);
  f.call({ op: 'stock.issue.cancel', companyId: f.companyId, id: saved.id!, reason: 'Qaytarıldı' });
  s = f.state();
  assert.equal(s.stock[0].quantity, '10');
  assert.equal(s.stock[0].valueCents, 2000);
  balanced(s);
});
test('asset commissioning posts 111/113 separately, protects source purchase, and can be reversed and recommissioned', (t) => {
  const f = fixture(t),
    p = f.product({ category: 'asset' }),
    receipt = f.invoice([f.item(p, { category: 'asset', quantity: '2', unitPrice: '500' })]);
  const card = f.state().assets[0];
  const command: Command = {
    op: 'asset.commission',
    companyId: f.companyId,
    asset: {
      id: card.id,
      date: '2026-01-12',
      inventoryNumber: 'EV-001',
      location: 'Ofis',
      responsible: 'Məsul şəxs',
      usefulLifeMonths: 60,
    },
  };
  f.call(command);
  assert.deepEqual(f.call(command), { id: card.id, unchanged: 1 });
  let s = f.state();
  balanced(s);
  assert.equal(s.stock[0].quantity, '1');
  assert.equal(s.assets.find((a) => a.id === card.id)!.status, 'active');
  assert.ok(s.ledger.some((r) => r.account === '111' && r.debit === 50000));
  assert.throws(() => f.cancel(receipt.id!), /istismara/);
  assert.deepEqual(f.state(), s);
  f.call({
    op: 'asset.commission.cancel',
    companyId: f.companyId,
    id: card.id,
    reason: 'Tarix düzəlişi',
  });
  assert.equal(f.state().stock[0].quantity, '2');
  f.call({ ...command, asset: { ...command.asset, date: '2026-01-11' } });
  f.call({
    op: 'asset.commission.cancel',
    companyId: f.companyId,
    id: card.id,
    reason: 'Alış ləğvi',
  });
  f.cancel(receipt.id!);
  s = f.state();
  assert.equal(s.stock.length, 0);
  assert.ok(s.assets.every((a) => a.status === 'cancelled'));
  balanced(s);
});
test('tenant boundaries, closed periods, used base units and immutable stock are enforced', (t) => {
  const f = fixture(t),
    p = f.product(),
    receipt = f.invoice([f.item(p)]);
  const other = f.call({ op: 'company.create', name: 'Başqa MMC', taxId: '3333333333' }).id!;
  const otherWarehouse = f.store.snapshot(other, report).warehouses[0].id;
  const before = f.state();
  assert.throws(() => f.invoice([f.item(p, { warehouseId: otherWarehouse })]), /şirkətdə/);
  assert.throws(
    () =>
      f.call({
        op: 'product.save',
        companyId: other,
        product: { ...before.products[0], name: 'Başqa' },
      }),
    /şirkətdə/,
  );
  assert.throws(
    () =>
      f.call({
        op: 'product.save',
        companyId: f.companyId,
        product: { ...before.products[0], baseUnitId: 'l', purchaseUnitId: 'l' },
      }),
    /vahidi/,
  );
  assert.throws(
    () =>
      f.call({
        op: 'product.save',
        companyId: f.companyId,
        product: { ...before.products[0], purchaseUnitId: 'box', factor: '12' },
      }),
    /çevirmə əmsalı/,
  );
  assert.throws(() => f.store.db.exec('UPDATE stock_movements SET quantity=1'), /dəyişdirilə/);
  assert.throws(() => f.store.db.exec('DELETE FROM stock_movements'), /silinə/);
  assert.deepEqual(f.state(), before);
  f.call({ op: 'period.close', companyId: f.companyId, date: '2026-01-31' });
  assert.throws(() => f.cancel(receipt.id!), /bağlanıb/);
  assert.throws(() => f.invoice([f.item(p)], { number: 'CLOSED' }), /bağlanıb/);
});
test('legacy aggregate goods import is preserved and cannot overwrite itemized documents', (t) => {
  const f = fixture(t),
    p = f.product();
  const row = {
    number: 'OLD-1',
    date: '2026-01-10',
    taxId: '2222222222',
    partnerName: 'Təchizatçı',
    direction: 'purchase' as const,
    kind: 'goods' as const,
    net: '100',
    vat: '18',
    subaccount: '',
    description: '',
  };
  f.call({ op: 'invoice.import', companyId: f.companyId, rows: [row] });
  assert.equal(f.state().stock.length, 0);
  assert.equal(f.state().ledger.find((r) => r.account === '205')!.debit, 10000);
  const old = f.state().invoices[0];
  f.invoice([f.item(p, { quantity: '10' })], {
    id: old.id,
    expectedVersion: old.version,
    number: old.number,
  });
  const before = f.state();
  assert.equal(before.stock[0].quantity, '10');
  assert.throws(
    () => f.call({ op: 'invoice.import', companyId: f.companyId, rows: [row] }),
    /cəmlərlə/,
  );
  assert.deepEqual(f.state(), before);
});
test('version two migration supplies warehouses and units without rewriting historical journal; backup retains inventory', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-inventory-'));
  const path = join(dir, 'legacy.sqlite'),
    old = new DatabaseSync(path);
  old.exec(schema);
  old
    .prepare('INSERT INTO companies(id,name,tax_id) VALUES(?,?,?)')
    .run('legacy', 'Köhnə MMC', '9999999999');
  old.close();
  const f = fixture(t, path);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const legacy = f.store.snapshot('legacy', report);
  assert.equal(legacy.warehouses.length, 1);
  assert.equal(legacy.units.length, 10);
  assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version, 3);
  const p = f.product({ category: 'asset' });
  f.invoice([f.item(p, { category: 'asset' })]);
  const backup = join(dir, 'backup.sqlite');
  await f.store.backup(backup);
  const restored = new Store(backup);
  try {
    assert.deepEqual(restored.snapshot(f.companyId, report), f.state());
  } finally {
    restored.close();
  }
});
