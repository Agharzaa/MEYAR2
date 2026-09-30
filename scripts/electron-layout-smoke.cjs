// Real Electron integration: one OS window with persistent internal workspaces.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdir, writeFile } = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
let store, manager, window;
// Keep the test runner alive until it explicitly records success or failure.
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => {
  console.error('Workspace validation timed out');
  app.exit(1);
}, 90000);
const evaluate = (expression) => window.webContents.executeJavaScript(expression);
async function waitFor(check, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Condition not met: ${label}`);
}
const until = (expression) => waitFor(() => evaluate(expression), expression);
async function click(text, scope = 'document', partial = false) {
  assert.ok(
    await evaluate(
      `(()=>{const root=${scope};const b=[...root.querySelectorAll('button')].find(b=>b.getClientRects().length && ( ${partial} ? b.textContent.includes(${JSON.stringify(text)}) : b.textContent.trim()===${JSON.stringify(text)}));if(!b||b.disabled)return false;b.click();return true;})()`,
    ),
    `Missing enabled button ${text}`,
  );
}
async function clickLabel(label) {
  assert.ok(
    await evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)return false;b.click();return true;})()`,
    ),
    label,
  );
}
async function pane(page, form = '') {
  await until(
    `(()=>{const p=document.querySelector('.internal-pane:not([hidden])');return p?.dataset.page===${JSON.stringify(page)}&&p.dataset.form===${JSON.stringify(form)}&&${form ? "!!p.querySelector('form input')" : "p.querySelector('main')?.getAttribute('aria-busy')==='false'"};})()`,
  );
  assert.equal(
    BrowserWindow.getAllWindows().length,
    1,
    'Modules and editors never create OS windows',
  );
}
async function field(label, value) {
  await evaluate(
    `(()=>{const root=document.querySelector('.internal-pane:not([hidden])');const label=[...root.querySelectorAll('label')].find(e=>e.textContent.includes(${JSON.stringify(label)}));const input=label.querySelector('input,select,textarea');const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
  );
}
async function company(id) {
  await until("!document.querySelector('.app-header select').disabled");
  if (
    await evaluate("document.querySelector('.app-header select').value === " + JSON.stringify(id))
  )
    return;
  await evaluate(
    `(()=>{const s=document.querySelector('.app-header select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(id)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await until(
    `document.querySelector('.app-header select')?.value===${JSON.stringify(id)}&&!document.querySelector('.app-header select').disabled`,
  );
}
const active = "document.querySelector('.internal-pane:not([hidden])')";
const tabs = "document.querySelector('.workspace-footer')";
async function layout(name, width, height) {
  window.setContentSize(width, height);
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const dimensions = await evaluate(`(() => {
    const rect = selector => { const r = (document.querySelector('.internal-pane:not([hidden])')?.querySelector(selector) || document.querySelector(selector)).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    return { workspace:rect('.module-workspace'), filter:rect('.filter-bar'), body:rect('.window-body'), table:rect('.data-table'), footer:rect('.workspace-footer'), viewport:{width:innerWidth,height:innerHeight}, scrollWidth:document.documentElement.scrollWidth,
      heading:rect('.page-heading'), headerCount:document.querySelectorAll('.app-header').length, navigationCount:document.querySelectorAll('.main-nav').length, footerCount:document.querySelectorAll('.workspace-footer').length,
      controls:[...document.querySelector('.internal-pane:not([hidden])').querySelectorAll('.filter-bar input, .filter-bar select, .filter-bar button')].map(el=>({label:el.getAttribute('aria-label')||el.textContent, rect:{top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}})) };
  })()`);
  assert.ok(dimensions.table.height > 300, 'Table has adequate usable height');
  assert.ok(
    dimensions.table.bottom <= dimensions.footer.y + 1,
    'Table never overlaps bottom window tabs',
  );
  assert.ok(
    dimensions.scrollWidth <= dimensions.viewport.width,
    'No page-level horizontal overflow',
  );
  const expectedFilter = Math.max(36, dimensions.workspace.height * 0.07);
  assert.ok(
    Math.abs(dimensions.filter.height - expectedFilter) < 1,
    `7% filter: ${dimensions.filter.height} vs ${expectedFilter}`,
  );
  assert.ok(
    Math.abs(dimensions.body.height + dimensions.filter.height - dimensions.workspace.height) < 1,
    'Table area fills the remaining 93%',
  );
  for (const control of dimensions.controls) {
    assert.ok(
      control.rect.top >= dimensions.filter.y - 1 &&
        control.rect.bottom <= dimensions.filter.bottom + 1,
      `Filter control clipped: ${control.label}`,
    );
  }
  assert.equal(dimensions.headerCount, 1, 'One shared application header');
  assert.equal(dimensions.navigationCount, 1, 'One shared module menu');
  assert.equal(dimensions.footerCount, 1, 'One shared internal-window strip');
  assert.ok(
    dimensions.heading.y >= 80 && dimensions.heading.y < 100,
    'Internal module stays below shared navigation',
  );
  await writeFile(
    path.join(root, 'screenshots', `${name}.png`),
    (await window.webContents.capturePage()).toPNG(),
  );
  return dimensions;
}

app
  .whenReady()
  .then(async () => {
    const { Store } = await import(
      pathToFileURL(path.join(root, 'dist/main/core/database.js')).href
    );
    const { WindowManager } = await import(
      pathToFileURL(path.join(root, 'dist/main/electron/windows.js')).href
    );
    store = new Store(':memory:');
    const { id: companyId } = store.call({
      op: 'company.create',
      name: 'Nümunə MMC',
      taxId: '1234567890',
    });
    const { id: otherCompany } = store.call({
      op: 'company.create',
      name: 'Digər MMC',
      taxId: '2222222222',
    });
    const { id: partnerId } = store.call({
      op: 'partner.save',
      companyId,
      name: 'Rabitə xidmətləri MMC',
      taxId: '0123456789',
    });
    const year = new Date().getFullYear(),
      filter = { from: `${year}-01-01`, to: `${year}-12-31`, account: '' };
    const invoice = {
      number: 'MT-00001',
      date: `${year}-01-01`,
      direction: 'purchase',
      kind: 'service',
      partnerId,
      net: '250',
      vat: '45',
      subaccount: 'Rabitə',
      description: 'Rabitə xidməti',
    };
    for (let i = 1; i <= 65; i++)
      store.call({
        op: 'invoice.save',
        companyId,
        invoice: { ...invoice, number: `MT-${String(i).padStart(5, '0')}` },
      });
    manager = new WindowManager(
      store,
      path.join(root, 'dist/renderer/index.html'),
      path.join(root, 'dist/main/electron/preload.cjs'),
    );
    manager.register();
    manager.handle('meyar:version', () => '0.2.0-workspace-test');
    await mkdir(path.join(root, 'screenshots'), { recursive: true });
    window = await manager.create({ page: 'home', companyId: '' });
    await until(
      "!!document.querySelector('.main-nav')&&!document.querySelector('.app-header select').disabled",
    );
    await company(companyId);
    await click('Gələn qaimələr');
    await pane('purchase');
    const results = {};
    results.standard = await layout('purchase-1440', 1440, 940);
    results.minimum = await layout('purchase-1050', 1050, 700);
    results.large = await layout('purchase-1920', 1920, 1080);
    await click('Dövriyyə balansı', "document.querySelector('.main-nav')");
    await pane('trial');
    results.trial = await layout('trial-1440', 1440, 940);
    await click('Gələn qaimələr', "document.querySelector('.main-nav')");
    await pane('purchase');
    await clickLabel('Böyüt / əvvəlki ölçü');
    await until(
      "document.querySelector('.internal-pane:not([hidden])').classList.contains('restored')",
    );
    assert.equal(window.isMaximized(), false, 'Internal restore does not maximize the OS window');
    await clickLabel('Pəncərəni aşağı yığ');
    await until("!document.querySelector('.internal-pane:not([hidden])')");
    await click('Gələn qaimələr', tabs, true);
    await pane('purchase');
    await clickLabel('Böyüt / əvvəlki ölçü');
    await click('Əlavə et', active);
    await pane('purchase', 'invoice');
    await field('Qaimə nömrəsi', 'INTERNAL-66');
    await field('Kontragent', partnerId);
    await field('Subkonto', 'Rabitə');
    await field('Əsas məbləğ', '100');
    await field('ƏDV məbləği', '18');
    await waitFor(
      () => manager.entries.get(window.id).dirty,
      'Host aggregates document dirty state',
    );
    const editorId = await evaluate(
      "document.querySelector('.internal-pane:not([hidden])').dataset.paneId",
    );
    await click('Bank', active);
    await pane('bank-out');
    await click('Yeni qaimə', tabs, true);
    await pane('purchase', 'invoice');
    assert.equal(await evaluate(`${active}.querySelector('form input').value`), 'INTERNAL-66');
    // Company changes must not unmount an open draft or change its original company.
    await company(otherCompany);
    await click('Yeni qaimə', tabs, true);
    await pane('purchase', 'invoice');
    assert.equal(
      await evaluate(`${active}.querySelector('form input').value`),
      'INTERNAL-66',
      'Draft survives company switch',
    );
    let asked = 0;
    manager.confirmDiscard = async () => {
      asked++;
      return false;
    };
    await clickLabel('Sənədi bağla');
    await waitFor(() => asked === 1, 'Internal close asks before discarding');
    assert.equal(await evaluate(`!!document.querySelector('[data-pane-id="${editorId}"]')`), true);
    window.close();
    await waitFor(() => asked === 2, 'Application close protects internal drafts');
    assert.equal(window.isDestroyed(), false);
    await writeFile(
      path.join(root, 'screenshots/internal-invoice.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    await click('Yadda saxla', active);
    await until(`!document.querySelector('[data-pane-id="${editorId}"]')`);
    const state = store.snapshot(companyId, filter);
    assert.equal(state.invoices.length, 66);
    assert.equal(
      store.snapshot(otherCompany, filter).invoices.length,
      0,
      'Save uses original company',
    );
    assert.equal(
      state.ledger.filter((r) => r.sourceNumber === 'INTERNAL-66').length,
      3,
      'Save automatically posts',
    );
    await click('Gələn qaimələr · Nümunə MMC', tabs, true);
    await pane('purchase');
    await until(`${active}.textContent.includes('INTERNAL-66')`);
    // Open a real row editor then change that document through the main-process API.
    await click('INTERNAL-66', active);
    await pane('purchase', 'invoice');
    await field('Əsas məbləğ', '300');
    const saved = state.invoices.find((i) => i.number === 'INTERNAL-66');
    await evaluate(
      `window.meyar.call(${JSON.stringify({ op: 'invoice.save', companyId, invoice: { ...saved, expectedVersion: saved.version, net: '400' } })})`,
    );
    await click('Düzəlişi saxla', active);
    await until(`${active}.querySelector('[role=alert]')?.textContent.includes('başqa pəncərədə')`);
    assert.equal(
      store.snapshot(companyId, filter).invoices.find((i) => i.id === saved.id).netCents,
      40000,
    );
    assert.equal(
      await evaluate(`[...${active}.querySelectorAll('input')].some(i=>i.value==='300')`),
      true,
    );
    manager.confirmDiscard = async () => true;
    await clickLabel('Sənədi bağla');
    await until("!document.querySelector('.internal-pane[data-form=invoice]')");
    await waitFor(
      () => manager.entries.get(window.id)?.dirty === false,
      'Host clears closed document dirty state',
    );
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    await assert.rejects(
      () => manager.create({ page: 'purchase', companyId }),
      /proqram daxilində/,
    );

    // Itemized goods exercise the shipped renderer, IPC, SQLite and internal windows.
    await company(companyId);
    const productCommand = {
      op: 'product.save',
      companyId,
      product: {
        code: 'WINDOWS-BOX',
        name: 'Qutu ilə mal',
        group: 'Test',
        barcode: '',
        baseUnitId: 'pcs',
        purchaseUnitId: 'box',
        factor: '12',
        category: 'goods',
      },
    };
    const productResult = await evaluate(
      'window.meyar.call(' + JSON.stringify(productCommand) + ')',
    );
    await click('Gələn qaimələr', "document.querySelector('.main-nav')");
    await pane('purchase');
    await click('Əlavə et', active);
    await pane('purchase', 'invoice');
    await field('Qaimə nömrəsi', 'WINDOWS-GOODS');
    await field('Kontragent', partnerId);
    await field('Əməliyyatın növü', 'goods');
    await until(active + '.querySelector(\'[aria-label="Nomenklatura 1"]\')?.options.length>1');
    async function itemField(label, value) {
      await evaluate(
        '(()=>{const input=' +
          active +
          '.querySelector(' +
          JSON.stringify('[aria-label="' + label + '"]') +
          ');const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(input,' +
          JSON.stringify(value) +
          ');input.dispatchEvent(new Event(input instanceof HTMLSelectElement?"change":"input",{bubbles:true}));})()',
      );
    }
    await itemField('Nomenklatura 1', productResult.id);
    await itemField('Miqdar 1', '2');
    await itemField('Vahid qiyməti 1', '120');
    await itemField('Sətir ƏDV-si 1', '43.20');
    await until(active + ".querySelector('.form-total').textContent.includes('283')");
    assert.equal(
      await evaluate(active + '.querySelector(\'[aria-label="Vahid 1"]\').value'),
      'box',
    );
    await writeFile(
      path.join(root, 'screenshots/inventory-invoice.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    await click('Yadda saxla', active);
    await until("!document.querySelector('.internal-pane[data-form=invoice]')");
    const inventoryState = store.snapshot(companyId, filter);
    assert.equal(inventoryState.stock[0].quantity, '24');
    assert.equal(inventoryState.stock[0].valueCents, 24000);
    assert.equal(inventoryState.invoices.find((i) => i.number === 'WINDOWS-GOODS').items.length, 1);
    assert.equal(
      inventoryState.invoices.find((i) => i.number === 'WINDOWS-GOODS').items[0].account,
      '205',
    );
    await evaluate('document.querySelector(\'[aria-label="Dt/Kt WINDOWS-GOODS"]\').click()');
    await until("document.querySelector('dialog[open] .postings-table') !== null");
    await click('T-hesablar', "document.querySelector('dialog[open]')");
    await until('document.querySelector(\'[aria-label="T-hesab 205"]\') !== null');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    await writeFile(
      path.join(root, 'screenshots/invoice-postings.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    await click('Bağla', "document.querySelector('dialog[open]')");
    await click('Anbar', "document.querySelector('.main-nav')");
    await pane('stock');
    await until(active + ".textContent.includes('Qutu ilə mal')");
    results.stock = await layout('inventory-stock-1050', 1050, 700);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    results.inventory = {
      accountPostings: true,
      itemizedInvoice: true,
      packagingConversion: true,
      automaticPosting: true,
      oneNativeWindow: true,
    };

    results.internalWindows = {
      oneNativeWindow: true,
      persistentDraft: true,
      companySwitch: true,
      automaticPosting: true,
      refresh: true,
      staleEditGuard: true,
      dirtyCloseGuard: true,
    };
    await writeFile(
      path.join(root, 'screenshots/layout-results.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(
      'Internal workspace passed: one native window, shared menu, persistent drafts, company isolation, posting and close guards.',
    );
    clearTimeout(timeout);
    window.destroy();
    store.close();
    app.exit(0);
  })
  .catch((error) => {
    require('node:fs').writeFileSync(
      path.join(root, 'screenshots/layout-error.txt'),
      error.stack || String(error),
    );
    console.error(error);
    clearTimeout(timeout);
    if (manager) for (const e of [...manager.entries.values()]) e.window.destroy();
    if (store) store.close();
    app.exit(1);
  });
