// Real native-window integration test. All data is synthetic and in memory.
const { app } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdir, writeFile } = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
let store, manager, window;
const timeout = setTimeout(() => {
  console.error('Native validation timed out');
  app.exit(1);
}, 90000);
const evaluate = (expression) => window.webContents.executeJavaScript(expression);
async function waitFor(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition not met: ${label}`);
}
const until = (expression) => waitFor(() => evaluate(expression), expression);
async function click(text) {
  assert.ok(
    await evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
    ),
    `Missing enabled button ${text}`,
  );
}
async function selectWindow(page, form) {
  let entry;
  await waitFor(() => {
    entry = [...manager.entries.values()].find(
      (e) => e.context.page === page && e.context.form === form,
    );
    return !!entry;
  }, `window ${page}/${form}`);
  window = entry.window;
  await until(
    form
      ? "!!document.querySelector('form input')"
      : "!!document.querySelector('.main-nav') && document.querySelector('main')?.getAttribute('aria-busy') === 'false'",
  );
  return window;
}
async function field(label, value) {
  await evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(el => el.textContent.includes(${JSON.stringify(label)}));
    const input = label?.querySelector('input,select,textarea') || document.getElementById(label?.htmlFor);
    if (!input) throw new Error('Missing field');
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', {bubbles:true}));
  })()`);
}
async function layout(name, width, height) {
  window.setContentSize(width, height);
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const dimensions = await evaluate(`(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    return { workspace:rect('.module-workspace'), filter:rect('.filter-bar'), body:rect('.window-body'), table:rect('.data-table'), footer:rect('.workspace-footer'), viewport:{width:innerWidth,height:innerHeight}, scrollWidth:document.documentElement.scrollWidth,
      headerColor:getComputedStyle(document.querySelector('.app-header')).backgroundColor,
      controls:[...document.querySelectorAll('.filter-bar input, .filter-bar select, .filter-bar button')].map(el=>({label:el.getAttribute('aria-label')||el.textContent, rect:{top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}})) };
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
  assert.equal(dimensions.headerColor, 'rgb(255, 229, 119)', 'Classic yellow header');
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
    const year = new Date().getFullYear();
    const filter = { from: `${year}-01-01`, to: `${year}-12-31`, account: '' };
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
    manager.handle('meyar:version', () => '0.1.2-native-test');
    await mkdir(path.join(root, 'screenshots'), { recursive: true });
    const home = await manager.create({ page: 'home', companyId: '' });
    window = home;
    await until(
      "!!document.querySelector('.main-nav') && document.querySelector('main')?.getAttribute('aria-busy') === 'false'",
    );
    // Select a known company; root state defaults to alphabetical first company.
    await evaluate(
      `(() => {const el=document.querySelector('.company-select select') || document.querySelector('.app-header select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(companyId)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await until(
      `document.querySelector('.app-header select')?.value === ${JSON.stringify(companyId)} && document.querySelector('main')?.getAttribute('aria-busy') === 'false'`,
    );
    await click('Gələn qaimələr');
    const purchase = await selectWindow('purchase');
    assert.notEqual(purchase.id, home.id);
    assert.equal(purchase.getParentWindow(), null, 'Modules are independent OS windows');
    const results = {};
    results.standard = await layout('purchase-1440', 1440, 940);
    results.minimum = await layout('purchase-1050', 1050, 700);
    results.large = await layout('purchase-1920', 1920, 1080);
    // Reopening a module focuses its existing window and preserves local filters.
    const same = await manager.create({ page: 'purchase', companyId });
    assert.equal(same.id, purchase.id);
    await click('Dövriyyə balansı');
    const trial = await selectWindow('trial');
    results.trial = await layout('trial-1440', 1440, 940);
    window = purchase;
    await click('Əlavə et');
    const editor = await selectWindow('purchase', 'invoice');
    assert.equal(editor.getParentWindow(), null, 'Editor is not a modal child window');
    await field('Qaimə nömrəsi', 'NATIVE-66');
    await field('Kontragent', partnerId);
    await field('Subkonto', 'Rabitə');
    await field('Əsas məbləğ', '100');
    await field('ƏDV məbləği', '18');
    await waitFor(
      () => manager.entries.get(editor.id)?.dirty,
      'Unsaved editor tracked in main process',
    );
    await click('Bank');
    const bank = await selectWindow('bank-out');
    assert.equal(bank.getParentWindow(), null);
    const bankBounds = bank.getBounds();
    purchase.setBounds({ x: 40, y: 40, width: 1200, height: 800 });
    assert.deepEqual(bank.getBounds(), bankBounds, 'Windows move independently');
    window = editor;
    assert.equal(
      await evaluate("document.querySelector('form input').value"),
      'NATIVE-66',
      'Switching preserves entered fields',
    );
    // A cancelled close must preserve the native window and its draft.
    let asked = 0;
    manager.confirmDiscard = async () => {
      asked++;
      return false;
    };
    editor.close();
    await waitFor(() => asked === 1, 'Native close confirmation');
    assert.equal(editor.isDestroyed(), false);
    await click('Yadda saxla');
    await waitFor(() => editor.isDestroyed(), 'Successful save closes editor');
    const state = store.snapshot(companyId, filter);
    assert.equal(state.invoices.length, 66);
    assert.equal(state.invoices.find((i) => i.number === 'NATIVE-66').status, 'posted');
    assert.equal(
      state.ledger.filter((r) => r.sourceNumber === 'NATIVE-66').length,
      3,
      'Save automatically posts balanced journal',
    );
    window = purchase;
    await until("document.body.textContent.includes('NATIVE-66')");
    window = trial;
    await until("document.querySelector('main')?.getAttribute('aria-busy') === 'false'");
    assert.equal(
      await evaluate(
        `window.meyar.call({op:'state',companyId:${JSON.stringify(otherCompany)},filter:${JSON.stringify(filter)}}).then(()=>false,()=>true)`,
      ),
      true,
      'IPC rejects foreign company access',
    );
    // Open an existing editor, update the document elsewhere and reject its stale save.
    const first = state.invoices.find((i) => i.number === 'MT-00001');
    window = await manager.create({
      page: 'purchase',
      companyId,
      form: 'invoice',
      documentId: first.id,
    });
    await until("!!document.querySelector('form input')");
    await field('Əsas məbləğ', '300');
    await home.webContents.executeJavaScript(
      `window.meyar.call(${JSON.stringify({ op: 'invoice.save', companyId, invoice: { ...invoice, id: first.id, expectedVersion: 1, net: '400' } })})`,
    );
    await click('Düzəlişi saxla');
    await until("document.querySelector('[role=alert]')?.textContent.includes('başqa pəncərədə')");
    assert.equal(
      store.snapshot(companyId, filter).invoices.find((i) => i.id === first.id).netCents,
      40000,
    );
    assert.equal(
      await evaluate("[...document.querySelectorAll('input')].some(i=>i.value==='300')"),
      true,
      'Conflict preserves unsaved input',
    );
    manager.confirmDiscard = async () => true;
    const conflicted = window;
    conflicted.close();
    await waitFor(() => conflicted.isDestroyed(), 'Confirmed draft discard');
    results.nativeWindows = {
      independent: true,
      savePosts: true,
      synchronized: true,
      tenantGuard: true,
      staleEditGuard: true,
      dirtyCloseGuard: true,
    };
    await writeFile(
      path.join(root, 'screenshots/layout-results.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(
      'Native Electron integration passed: independent OS windows, draft preservation, automatic posting, refresh, tenant and stale-edit guards, 7:93 layout.',
    );
    clearTimeout(timeout);
    for (const e of [...manager.entries.values()]) e.window.destroy();
    store.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    if (manager) for (const e of [...manager.entries.values()]) e.window.destroy();
    if (store) store.close();
    app.exit(1);
  });
