import './dom-setup.js';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { Store } from '../core/database.js';
import type { Command, DesktopAPI, State } from '../shared/types.js';

afterEach(() => {
  cleanup();
  delete window.meyar;
});

test('DOM + SQLite: onboarding, nested partner draft preservation, postings, payment, DBC and company switching', async () => {
  const store = new Store(':memory:');
  const commands: Command[] = [];
  let delayedCompany = '';
  let releaseRead: (() => void) | undefined;
  const bridge: DesktopAPI = {
    async call(command) {
      commands.push(command);
      if (command.op === 'state' && command.companyId === delayedCompany && delayedCompany) {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      }
      return store.call(command);
    },
    async backup() {
      return null;
    },
    async importFile() {
      return null;
    },
    async template() {
      return null;
    },
    async checkUpdate() {
      return 'Test bridge';
    },
    async version() {
      return '0.1.0-test';
    },
  };
  window.meyar = bridge;
  const user = userEvent.setup();
  const snapshot = (companyId = '') =>
    store.call({
      op: 'state',
      companyId,
      filter: { from: '2000-01-01', to: '2099-12-31', account: '' },
    }) as State;
  try {
    render(<App />);
    await user.type(await screen.findByRole('textbox', { name: 'Şirkətin adı' }), 'Birinci MMC');
    await user.type(screen.getByRole('textbox', { name: /^VÖEN/ }), '1234567890');
    await user.click(screen.getByRole('button', { name: 'Şirkəti yarat' }));
    await screen.findByRole('combobox', { name: 'Aktiv şirkət' });
    const firstCompany = snapshot().company.id;
    assert.ok(firstCompany);
    assert.equal(snapshot().company.name, 'Birinci MMC');

    await user.click(screen.getByRole('button', { name: 'Gedən qaimələr', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Əlavə et', exact: true }));
    let invoiceDialog = await screen.findByRole('dialog', { name: 'Yeni gedən qaimə' });
    await user.type(
      within(invoiceDialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }),
      'UI-SALE-001',
    );
    await user.type(
      within(invoiceDialog).getByRole('textbox', { name: 'Əsas məbləğ · AZN' }),
      '100',
    );
    await user.click(within(invoiceDialog).getByRole('button', { name: '18%' }));
    await user.type(
      within(invoiceDialog).getByRole('textbox', { name: 'Təyinat' }),
      'Draft must survive nested dialog',
    );
    const addPartner = within(invoiceDialog).getByRole('button', { name: 'Kontragent əlavə et' });
    await user.click(addPartner);
    let partnerDialog = await screen.findByRole('dialog', { name: 'Kontragent əlavə et' });
    assert.equal(
      screen.getAllByRole('dialog').length,
      2,
      'Invoice stays mounted under partner dialog',
    );
    await user.type(
      within(partnerDialog).getByRole('textbox', { name: 'Kontragentin adı' }),
      'Alıcı MMC',
    );
    await user.type(within(partnerDialog).getByRole('textbox', { name: /^VÖEN/ }), '0123456789');
    await user.click(
      within(partnerDialog).getByRole('button', { name: 'Yadda saxla', exact: true }),
    );
    await waitFor(() =>
      assert.equal(screen.queryByRole('dialog', { name: 'Kontragent əlavə et' }), null),
    );
    invoiceDialog = screen.getByRole('dialog', { name: 'Yeni gedən qaimə' });
    assert.equal(
      (within(invoiceDialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement)
        .value,
      'UI-SALE-001',
    );
    assert.equal(
      (within(invoiceDialog).getByRole('textbox', { name: 'Təyinat' }) as HTMLTextAreaElement)
        .value,
      'Draft must survive nested dialog',
    );
    assert.equal(
      (
        within(invoiceDialog).getByRole('textbox', {
          name: /^ƏDV məbləği · AZN/,
        }) as HTMLInputElement
      ).value,
      '18.00',
    );
    const partner = snapshot(firstCompany).partners[0];
    assert.equal(partner.taxId, '0123456789');
    await waitFor(() =>
      assert.equal(
        (within(invoiceDialog).getByRole('combobox', { name: /^Kontragent/ }) as HTMLSelectElement)
          .value,
        partner.id,
      ),
    );

    // Closing a second nested partner form also preserves the original invoice.
    await user.click(within(invoiceDialog).getByRole('button', { name: 'Kontragent əlavə et' }));
    partnerDialog = screen.getByRole('dialog', { name: 'Kontragent əlavə et' });
    await user.type(
      within(partnerDialog).getByRole('textbox', { name: 'Kontragentin adı' }),
      'Unsaved partner',
    );
    await user.click(within(partnerDialog).getByRole('button', { name: 'Bağla', exact: true }));
    assert.equal(snapshot(firstCompany).partners.length, 1);
    assert.equal(
      (within(invoiceDialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement)
        .value,
      'UI-SALE-001',
    );
    await user.click(within(invoiceDialog).getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    await screen.findByRole('button', { name: 'UI-SALE-001', exact: true });
    let state = snapshot(firstCompany);
    assert.equal(state.invoices.length, 1);
    assert.equal(state.invoices[0].direction, 'sale');
    assert.equal(state.invoices[0].totalCents, 11800);
    const invoice = state.invoices[0];
    assert.deepEqual(state.ledger.map((row) => [row.account, row.debit, row.credit]).sort(), [
      ['211', 11800, 0],
      ['545', 0, 1800],
      ['601', 0, 10000],
    ]);

    await user.click(screen.getByText('Bank', { selector: 'summary' }));
    await user.click(screen.getByRole('button', { name: 'Daxil olan ödənişlər', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Ödəniş əlavə et' }));
    const paymentDialog = await screen.findByRole('dialog', { name: 'Yeni daxil olan ödəniş' });
    await user.type(
      within(paymentDialog).getByRole('textbox', { name: 'Bank sənədinin nömrəsi' }),
      'UI-PAY-001',
    );
    await user.selectOptions(
      within(paymentDialog).getByRole('combobox', { name: 'Kontragent', exact: true }),
      partner.id,
    );
    await user.selectOptions(
      within(paymentDialog).getByRole('combobox', { name: /^Bağlı qaimə/ }),
      invoice.id,
    );
    await user.type(
      within(paymentDialog).getByRole('textbox', { name: 'Məbləğ · AZN', exact: true }),
      '118',
    );
    await user.click(within(paymentDialog).getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    state = snapshot(firstCompany);
    assert.equal(state.payments.length, 1);
    assert.equal(state.payments[0].amountCents, 11800);
    assert.equal(state.invoices[0].paidCents, 11800);
    assert.equal(state.balances[0].receivable, 0);
    assert.equal(state.trial.find((row) => row.account === '223')?.closingDebit, 11800);

    await user.click(screen.getByRole('button', { name: 'Dövriyyə balansı', exact: true }));
    await screen.findByText('Debet və kredit bərabərdir');
    assert.equal(
      state.trial.reduce((sum, row) => sum + row.debit, 0),
      state.trial.reduce((sum, row) => sum + row.credit, 0),
    );
    assert.ok(screen.getByRole('button', { name: '223', exact: true }));

    await user.click(screen.getByRole('button', { name: 'Şirkət və proqram', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Yeni şirkət', exact: true }));
    const companyDialog = await screen.findByRole('dialog', { name: 'Yeni şirkət' });
    await user.type(
      within(companyDialog).getByRole('textbox', { name: 'Şirkətin adı' }),
      'İkinci MMC',
    );
    await user.type(within(companyDialog).getByRole('textbox', { name: /^VÖEN/ }), '9876543210');
    await user.click(within(companyDialog).getByRole('button', { name: 'Şirkəti yarat' }));
    await waitFor(() =>
      assert.match(
        screen.getByRole('combobox', { name: 'Aktiv şirkət' }).textContent ?? '',
        /İkinci MMC/,
      ),
    );
    const secondCompany = snapshot().companies.find((company) => company.name === 'İkinci MMC')!.id;
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('combobox', { name: 'Aktiv şirkət' }) as HTMLSelectElement).value,
        secondCompany,
      ),
    );
    assert.equal(snapshot(secondCompany).invoices.length, 0);
    assert.equal(snapshot(secondCompany).payments.length, 0);

    delayedCompany = firstCompany;
    await user.selectOptions(screen.getByRole('combobox', { name: 'Aktiv şirkət' }), firstCompany);
    await screen.findByText('Uçot bazası açılır…');
    assert.equal(
      screen.queryByRole('combobox', { name: 'Aktiv şirkət' }),
      null,
      'Old company cannot receive edits while target company loads',
    );
    assert.equal(screen.queryByRole('button', { name: 'Əlavə et', exact: true }), null);
    await waitFor(() => assert.ok(releaseRead));
    delayedCompany = '';
    await act(async () => {
      releaseRead!();
    });
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('combobox', { name: 'Aktiv şirkət' }) as HTMLSelectElement).value,
        firstCompany,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Gedən qaimələr', exact: true }));
    await screen.findByRole('button', { name: 'UI-SALE-001', exact: true });
    assert.equal(commands.filter((command) => command.op === 'invoice.save').length, 1);
    assert.equal(commands.filter((command) => command.op === 'payment.save').length, 1);
  } finally {
    cleanup();
    store.close();
  }
});

test('DOM + SQLite: rejected input preserves draft and in-flight double submit posts only once', async () => {
  const store = new Store(':memory:');
  const created = store.call({
    op: 'company.create',
    name: 'Validation MMC',
    taxId: '1234567890',
  }) as { id: string };
  const partner = store.call({
    op: 'partner.save',
    companyId: created.id,
    name: 'Rabitə MMC',
    taxId: '0123456789',
  }) as { id: string };
  let holdSave = false;
  let releaseSave: (() => void) | undefined;
  let saveCalls = 0;
  window.meyar = {
    async call(command) {
      if (command.op === 'invoice.save') {
        saveCalls++;
        if (holdSave)
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
      }
      return store.call(command);
    },
    async backup() {
      return null;
    },
    async importFile() {
      return null;
    },
    async template() {
      return null;
    },
    async checkUpdate() {
      return 'Test bridge';
    },
    async version() {
      return '0.1.0-test';
    },
  };
  const snapshot = () =>
    store.call({
      op: 'state',
      companyId: created.id,
      filter: { from: '2000-01-01', to: '2099-12-31', account: '' },
    }) as State;
  const user = userEvent.setup();
  try {
    render(<App />);
    await screen.findByRole('combobox', { name: 'Aktiv şirkət' });
    await user.click(screen.getByRole('button', { name: 'Gələn qaimələr', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Əlavə et', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni gələn qaimə' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }),
      'UI-PURCHASE-001',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Kontragent/ }),
      partner.id,
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Əsas məbləğ · AZN' }), '100');
    const subaccount = within(dialog).getByRole('textbox', { name: /^Subkonto · 721/ });
    await user.type(subaccount, ' '); // Native required passes; accounting validation must reject whitespace.
    await user.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }));
    await within(dialog).findByRole('alert');
    assert.match(within(dialog).getByRole('alert').textContent ?? '', /subkonto/i);
    assert.equal(
      (within(dialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'UI-PURCHASE-001',
    );
    assert.equal(snapshot().invoices.length, 0);
    await user.clear(subaccount);
    await user.type(subaccount, 'Rabitə');
    holdSave = true;
    const form = dialog.querySelector('form')!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    assert.equal(
      saveCalls,
      2,
      'One rejected request and only one new request despite double submit',
    );
    assert.equal(
      (within(dialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).disabled,
      true,
    );
    assert.equal(snapshot().invoices.length, 0, 'No document committed before bridge completes');
    assert.ok(releaseSave);
    await act(async () => {
      releaseSave!();
    });
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    const final = snapshot();
    assert.equal(final.invoices.length, 1);
    assert.equal(final.ledger.length, 2);
    assert.equal(final.ledger.find((row) => row.account === '721')?.subaccount, 'Rabitə');
    assert.equal(final.ledger.find((row) => row.account === '721')?.debit, 10000);
    assert.equal(final.ledger.find((row) => row.account === '531')?.credit, 10000);
  } finally {
    cleanup();
    store.close();
  }
});

test('Module windows keep independent filters, searches and pagination; minimize preserves and close resets', async () => {
  const store = new Store(':memory:');
  const { id: companyId } = store.call({
    op: 'company.create',
    name: 'Window Test',
    taxId: '1234567890',
  }) as { id: string };
  const { id: partnerId } = store.call({
    op: 'partner.save',
    companyId,
    name: 'Window Partner',
    taxId: '0123456789',
  }) as { id: string };
  const year = new Date().getFullYear();
  for (let i = 1; i <= 65; i++)
    store.call({
      op: 'invoice.save',
      companyId,
      invoice: {
        number: `WINDOW-${String(i).padStart(3, '0')}`,
        date: `${year}-01-01`,
        partnerId,
        direction: 'purchase',
        kind: 'service',
        net: '100',
        vat: '18',
        subaccount: 'Rabitə',
        description: '',
      },
    });
  window.meyar = {
    call: async (command) => store.call(command),
    backup: async () => null,
    importFile: async () => null,
    template: async () => null,
    checkUpdate: async () => 'Test',
    version: async () => 'test',
  };
  const user = userEvent.setup();
  const ready = () =>
    waitFor(() => assert.equal(screen.getByRole('main').getAttribute('aria-busy'), 'false'));
  const value = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value;
  try {
    render(<App />);
    await screen.findByRole('combobox', { name: 'Aktiv şirkət' });
    await user.click(screen.getByRole('button', { name: 'Gələn qaimələr', exact: true }));
    await ready();
    await user.type(screen.getByLabelText('Cədvəldə axtar'), 'WINDOW');
    await user.selectOptions(screen.getByLabelText('Sətirlər səhifədə'), '50');
    await user.click(screen.getByRole('button', { name: 'Növbəti səhifə' }));
    assert.ok(screen.getByText('2 / 2'));
    fireEvent.change(screen.getByLabelText('Başlanğıc tarix'), {
      target: { value: `${year}-01-02` },
    });
    await user.click(screen.getByRole('button', { name: 'Pəncərəni kiçilt' }));
    assert.ok(screen.getByRole('tabpanel').classList.contains('restored'));
    await user.click(screen.getByRole('button', { name: 'Gedən qaimələr', exact: true }));
    await ready();
    assert.equal(value('Cədvəldə axtar'), '');
    assert.equal(value('Sətirlər səhifədə'), '25');
    assert.equal(value('Başlanğıc tarix'), `${year}-01-01`);
    await user.type(screen.getByLabelText('Cədvəldə axtar'), 'SALE');
    await user.click(screen.getByRole('tab', { name: 'Gələn qaimələr', exact: true }));
    await ready();
    assert.equal(value('Cədvəldə axtar'), 'WINDOW');
    assert.equal(value('Sətirlər səhifədə'), '50');
    assert.equal(value('Başlanğıc tarix'), `${year}-01-02`);
    assert.ok(screen.getByText('2 / 2'));
    assert.ok(screen.getByRole('tabpanel').classList.contains('restored'));
    await user.click(screen.getByRole('button', { name: 'Pəncərəni aşağı yığ' }));
    await ready();
    assert.equal(
      screen.getByRole('tab', { name: 'İş masası' }).getAttribute('aria-selected'),
      'true',
    );
    await user.click(screen.getByRole('tab', { name: 'Gələn qaimələr', exact: true }));
    await ready();
    assert.equal(value('Cədvəldə axtar'), 'WINDOW');
    await user.click(screen.getByRole('button', { name: 'Aktiv bölməni bağla' }));
    await ready();
    assert.equal(screen.queryByRole('tab', { name: 'Gələn qaimələr', exact: true }), null);
    assert.equal(value('Cədvəldə axtar'), 'SALE');
    await user.click(screen.getByRole('button', { name: 'Gələn qaimələr', exact: true }));
    await ready();
    assert.equal(value('Cədvəldə axtar'), '');
    assert.equal(value('Sətirlər səhifədə'), '25');
    assert.equal(value('Başlanğıc tarix'), `${year}-01-01`);
    assert.equal(screen.getByRole('tabpanel').classList.contains('restored'), false);

    // Report drill-down opens the ledger without replacing the trial balance filter.
    await user.click(screen.getByRole('button', { name: 'Dövriyyə balansı', exact: true }));
    await ready();
    await user.click(screen.getByRole('button', { name: '721', exact: true }));
    await ready();
    assert.equal(value('Hesab üzrə filtr'), '721');
    await user.click(screen.getByRole('tab', { name: 'Dövriyyə balans cədvəli', exact: true }));
    await ready();
    assert.equal(value('Hesab üzrə filtr'), '');
  } finally {
    cleanup();
    store.close();
  }
});

test('Internal workspace preserves invoice fields across modules and company switches, posts to the original company, and never opens another native window', async () => {
  const { Workspace } = await import('../src/Workspace');
  const store = new Store(':memory:');
  const first = (
    store.call({ op: 'company.create', name: 'A MMC', taxId: '1111111111' }) as { id: string }
  ).id;
  const second = (
    store.call({ op: 'company.create', name: 'B MMC', taxId: '2222222222' }) as { id: string }
  ).id;
  const partner = (
    store.call({ op: 'partner.save', companyId: first, name: 'Alıcı', taxId: '3333333333' }) as {
      id: string;
    }
  ).id;
  const listeners = new Set<(id: string) => void>();
  let dirty = false,
    confirmations = 0;
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  const host: import('../shared/windows').WindowBridge = {
    context: async () => ({ id: 1, page: 'home', companyId: '' }),
    open: async () => {
      throw new Error('Unexpected native window');
    },
    list: async () => [],
    focus: async () => {},
    close: async () => {},
    minimize: async () => {},
    maximize: async () => {},
    setDirty: async (value) => {
      dirty = value;
    },
    confirmDiscard: async () => {
      confirmations++;
      return false;
    },
    onChanged: () => () => {},
    onDataChanged: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  window.meyar = {
    windows: host,
    call: async (command) => {
      const result = store.call(command);
      if (command.op !== 'state' && command.op !== 'company.create')
        for (const cb of listeners) cb(command.companyId);
      return result;
    },
    backup: async () => null,
    importFile: async () => null,
    template: async () => null,
    checkUpdate: async () => '',
    version: async () => 'test',
  };
  const user = userEvent.setup();
  try {
    render(<Workspace host={host} />);
    await screen.findByRole('combobox', { name: 'Aktiv şirkət' });
    await user.click(screen.getByRole('button', { name: 'Gedən qaimələr', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Əlavə et', exact: true }));
    const number = await screen.findByRole('textbox', { name: 'Qaimə nömrəsi' });
    await user.type(number, 'INTERNAL-DRAFT');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Kontragent/ }), partner);
    await user.type(screen.getByRole('textbox', { name: 'Əsas məbləğ · AZN' }), '100');
    assert.equal(dirty, true);
    await user.click(screen.getByRole('button', { name: 'Bank', exact: true }));
    await screen.findByRole('heading', { name: 'Daxil olan ödənişlər' });
    const footer = within(document.querySelector('.workspace-footer') as HTMLElement);
    await user.click(footer.getByRole('button', { name: /^● Yeni qaimə/ }));
    assert.equal(
      (screen.getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'INTERNAL-DRAFT',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Aktiv şirkət' }), second);
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('combobox', { name: 'Aktiv şirkət' }) as HTMLSelectElement).value,
        second,
      ),
    );
    await user.click(footer.getByRole('button', { name: /^● Yeni qaimə/ }));
    assert.equal(
      (screen.getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'INTERNAL-DRAFT',
    );
    await user.click(screen.getByRole('button', { name: 'Sənədi bağla' }));
    assert.equal(confirmations, 1);
    assert.ok(screen.getByRole('textbox', { name: 'Qaimə nömrəsi' }));
    await user.click(screen.getByRole('button', { name: 'Yadda saxla', exact: true }));
    await waitFor(() =>
      assert.equal(screen.queryByRole('textbox', { name: 'Qaimə nömrəsi' }), null),
    );
    const filter = { from: '2000-01-01', to: '2099-12-31', account: '' };
    assert.equal(store.snapshot(first, filter).invoices.length, 1);
    assert.equal(store.snapshot(second, filter).invoices.length, 0);
    assert.equal(store.snapshot(first, filter).ledger.length, 2);
    assert.equal(dirty, false);
    assert.equal(document.querySelectorAll('.app-header').length, 1);
    assert.equal(document.querySelectorAll('.main-nav').length, 1);
    assert.equal(document.querySelectorAll('.workspace-footer').length, 1);
  } finally {
    cleanup();
    store.close();
  }
});

test('DOM + SQLite: goods invoice creates nomenclature inline, converts packaging and posts mixed inventory categories', async () => {
  const store = new Store(':memory:');
  const result = store.call({
    op: 'company.create',
    name: 'Anbar UI MMC',
    taxId: '5555555555',
  }) as { id: string };
  const companyId = result.id,
    partnerId = (
      store.call({
        op: 'partner.save',
        companyId,
        name: 'Təchizatçı MMC',
        taxId: '6666666666',
      }) as { id: string }
    ).id;
  const assetId = (
    store.call({
      op: 'product.save',
      companyId,
      product: {
        code: 'ASSET-UI',
        name: 'Noutbuk',
        group: 'Avadanlıq',
        barcode: '',
        baseUnitId: 'pcs',
        purchaseUnitId: 'pcs',
        factor: '1',
        category: 'asset',
      },
    }) as { id: string }
  ).id;
  window.meyar = {
    call: async (command) => store.call(command),
    backup: async () => null,
    importFile: async () => null,
    template: async () => null,
    checkUpdate: async () => '',
    version: async () => '0.2.0-test',
  };
  const user = userEvent.setup();
  const state = () =>
    store.snapshot(companyId, { from: '2000-01-01', to: '2099-12-31', account: '' });
  try {
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Gələn qaimələr', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Əlavə et', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni gələn qaimə' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }), {
      target: { value: 'UI-GOODS-1' },
    });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Kontragent' }),
      partnerId,
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Əməliyyatın növü' }),
      'goods',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Yeni nomenklatura 1' }));
    const product = await screen.findByRole('dialog', { name: 'Yeni nomenklatura' });
    fireEvent.change(within(product).getByRole('textbox', { name: 'Nomenklatura adı' }), {
      target: { value: 'Qablaşdırılmış mal' },
    });
    await user.selectOptions(
      within(product).getByRole('combobox', { name: 'Alış / qablaşdırma vahidi' }),
      'box',
    );
    fireEvent.change(
      within(product).getByRole('textbox', { name: /^Bir alış vahidində əsas vahid sayı/ }),
      { target: { value: '12' } },
    );
    await user.click(within(product).getByRole('button', { name: 'Nomenklaturanı saxla' }));
    await waitFor(() =>
      assert.equal(screen.queryByRole('dialog', { name: 'Yeni nomenklatura' }), null),
    );
    assert.equal(
      (within(dialog).getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'UI-GOODS-1',
    );
    assert.equal(
      (within(dialog).getByRole('combobox', { name: 'Vahid 1' }) as HTMLSelectElement).value,
      'box',
    );
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Miqdar 1' }), {
      target: { value: '2' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Vahid qiyməti 1' }), {
      target: { value: '120' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Sətir əlavə et' }));
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Nomenklatura 2' }),
      assetId,
    );
    assert.equal(
      (within(dialog).getByRole('combobox', { name: 'Uçot hesabı 2' }) as HTMLSelectElement).value,
      '113',
    );
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Vahid qiyməti 2' }), {
      target: { value: '500' },
    });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Uçot hesabı 1' }),
      '201',
    );
    assert.match(
      within(dialog).getByRole('region', { name: 'Dt/Kt ilkin baxış' }).textContent!,
      /201531/,
    );
    await user.click(within(dialog).getByRole('button', { name: '18%' }));
    assert.equal(
      (within(dialog).getByRole('textbox', { name: 'Əsas məbləğ · AZN' }) as HTMLInputElement)
        .value,
      '740.00',
    );
    assert.equal(
      (within(dialog).getByRole('textbox', { name: 'ƏDV məbləği · AZN' }) as HTMLInputElement)
        .value,
      '133.20',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Yadda saxla', exact: true }));
    await waitFor(() =>
      assert.equal(screen.queryByRole('dialog', { name: 'Yeni gələn qaimə' }), null),
    );
    const s = state();
    assert.equal(s.invoices.length, 1);
    assert.equal(s.invoices[0].items!.length, 2);
    assert.equal(s.stock.find((r) => r.productName === 'Qablaşdırılmış mal')!.quantity, '24');
    assert.equal(s.assets.length, 1);
    assert.equal(s.assets[0].costCents, 50000);
    assert.equal(s.balances[0].payable, 87320);
    assert.equal(s.invoices[0].items![0].account, '201');
    assert.equal(s.ledger.find((e) => e.account === '201')!.debit, 24000);
    await user.click(screen.getByRole('button', { name: 'Dt/Kt UI-GOODS-1' }));
    const postings = await screen.findByRole('dialog', { name: 'Dt/Kt · UI-GOODS-1' });
    assert.ok(within(postings).getByRole('table', { name: 'Sənədin müxabirləşmələri' }));
    await user.click(within(postings).getByRole('button', { name: 'T-hesablar' }));
    assert.match(
      within(postings).getByRole('region', { name: 'T-hesab 201' }).textContent!,
      /240,00/,
    );
    assert.match(
      within(postings).getByRole('region', { name: 'T-hesab 531' }).textContent!,
      /873,20/,
    );
    await user.click(within(postings).getByRole('button', { name: 'Bağla', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Düzəliş et UI-GOODS-1' }));
    const edit = await screen.findByRole('dialog', { name: 'Qaiməyə düzəliş · UI-GOODS-1' });
    fireEvent.change(within(edit).getByRole('textbox', { name: 'Təyinat' }), {
      target: { value: 'Saxlanmamış qeyd' },
    });
    await user.click(within(edit).getByRole('button', { name: 'Dt/Kt', exact: true }));
    const actual = await screen.findByRole('dialog', { name: 'Dt/Kt · UI-GOODS-1' });
    await user.click(within(actual).getByRole('button', { name: 'Bağla', exact: true }));
    assert.equal(
      (within(edit).getByRole('textbox', { name: 'Təyinat' }) as HTMLTextAreaElement).value,
      'Saxlanmamış qeyd',
    );
    assert.deepEqual(
      state(),
      s,
      'Viewing postings preserves the unsaved form and does not write to SQLite',
    );
    await user.click(within(edit).getByRole('button', { name: 'Bağla', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Anbar', exact: true }));
    await screen.findByRole('heading', { name: 'Anbar uçotu' });
    await screen.findByText('Qablaşdırılmış mal');
    assert.equal(screen.getAllByRole('row').length >= 3, true);
    const selector = screen.getByRole('combobox', { name: 'Aktiv şirkət' }) as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: companyId } });
    await waitFor(() =>
      assert.equal(
        selector.disabled,
        false,
        'Selecting the active company must not leave the workspace loading',
      ),
    );
    assert.ok(screen.getByRole('heading', { name: 'Anbar uçotu' }));
  } finally {
    cleanup();
    store.close();
  }
});
