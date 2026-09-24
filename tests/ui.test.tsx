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
    await user.click(
      within(invoiceDialog).getByRole('button', { name: 'Yadda saxla və uçota al' }),
    );
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
    await user.click(within(paymentDialog).getByRole('button', { name: 'Ödənişi uçota al' }));
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
    await user.click(within(dialog).getByRole('button', { name: 'Yadda saxla və uçota al' }));
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
