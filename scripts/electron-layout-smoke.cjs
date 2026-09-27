// Exercise the real packaged renderer and sandboxed preload with synthetic data only.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdir, writeFile } = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
let store;
let window;
const timeout = setTimeout(() => {
  console.error('Layout validation timed out');
  app.exit(1);
}, 90000);
const evaluate = (expression) => window.webContents.executeJavaScript(expression);
async function until(expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Renderer condition not met: ${expression}`);
}
async function click(text) {
  const found = await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
  assert.ok(found, `Missing button ${text}`);
  await until(
    `document.querySelector('main')?.getAttribute('aria-busy') === 'false' && document.querySelector('h1')?.textContent === ${JSON.stringify(text === 'Dövriyyə balansı' ? 'Dövriyyə balans cədvəli' : text)}`,
  );
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
    store = new Store(':memory:');
    const { id: companyId } = store.call({
      op: 'company.create',
      name: 'Nümunə MMC',
      taxId: '1234567890',
    });
    const { id: partnerId } = store.call({
      op: 'partner.save',
      companyId,
      name: 'Rabitə xidmətləri MMC',
      taxId: '0123456789',
    });
    const year = new Date().getFullYear();
    for (let i = 1; i <= 65; i++)
      store.call({
        op: 'invoice.save',
        companyId,
        invoice: {
          number: `MT-${String(i).padStart(5, '0')}`,
          date: `${year}-01-01`,
          direction: 'purchase',
          kind: 'service',
          partnerId,
          net: '250',
          vat: '45',
          subaccount: 'Rabitə',
          description: 'Rabitə xidməti',
        },
      });
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      show: false,
      webPreferences: {
        preload: path.join(root, 'dist/main/electron/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    ipcMain.handle('meyar:command', (event, command) => {
      assert.equal(event.sender, window.webContents);
      return store.call(command);
    });
    ipcMain.handle('meyar:version', () => '0.1.1-layout-test');
    await mkdir(path.join(root, 'screenshots'), { recursive: true });
    await window.loadFile(path.join(root, 'dist/renderer/index.html'));
    await until(
      "document.querySelector('.main-nav') && document.querySelector('main')?.getAttribute('aria-busy') === 'false'",
    );
    await click('Gələn qaimələr');
    const results = {};
    results.standard = await layout('purchase-1440', 1440, 940);
    results.minimum = await layout('purchase-1050', 1050, 700);
    results.large = await layout('purchase-1920', 1920, 1080);
    await click('Dövriyyə balansı');
    results.trial = await layout('trial-1440', 1440, 940);
    await writeFile(
      path.join(root, 'screenshots/layout-results.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(
      'Native Electron layout passed: independent windows, 7:93 grid, compact controls, table containment, classic palette.',
    );
    clearTimeout(timeout);
    window.destroy();
    store.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    if (window && !window.isDestroyed()) window.destroy();
    if (store) store.close();
    app.exit(1);
  });
