import { app, dialog, session } from 'electron';
import updater from 'electron-updater';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../core/database.js';
import { parseInvoiceFile, writeInvoiceTemplate } from './import.js';
import { WindowManager } from './windows.js';
import type { Direction } from '../shared/types.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = updater;
const dev = !app.isPackaged && process.argv.includes('--dev');
const rendererPath = path.resolve(directory, '../../renderer/index.html');
app.setPath('userData', path.join(app.getPath('appData'), 'Meyar ERP 2'));
const dataPath = path.join(app.getPath('userData'), 'data');
const backupPath = path.join(app.getPath('userData'), 'backups');
const databasePath = path.join(dataPath, 'meyar.sqlite');
let windows: WindowManager;
let store: Store | undefined;
const timestamp = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
async function startupBackup() {
  try {
    await stat(databasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const previous = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await backup(previous, path.join(backupPath, `startup-${timestamp()}.sqlite`));
  } finally {
    previous.close();
  }
}
let updateStatus =
  'İmzalanmış yeniləmə kanalı hələ aktiv deyil. Bu versiyada avtomatik yükləmə və quraşdırma bağlıdır.';
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowDowngrade = false;
autoUpdater.on('error', (error) => {
  updateStatus = `Yeniləmə yoxlanmadı: ${error.message}`;
});
// No network check or install command is exposed until a signed release channel exists.
// Any future updater must call this before download/install and keep automatic installation off.
export async function backupBeforeUpdate(): Promise<string> {
  if (!store) throw new Error('Uçot bazası açılmayıb.');
  const target = path.join(backupPath, `before-update-${timestamp()}.sqlite`);
  await store.backup(target);
  return target;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    void windows?.create({ page: 'home', companyId: '' });
  });
  app
    .whenReady()
    .then(async () => {
      await mkdir(dataPath, { recursive: true });
      await mkdir(backupPath, { recursive: true });
      await startupBackup();
      store = new Store(databasePath);
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      windows = new WindowManager(store, rendererPath, path.join(directory, 'preload.cjs'), dev);
      windows.register();
      windows.handle('meyar:version', () => app.getVersion());
      windows.handle('meyar:update-status', () => updateStatus);
      windows.handle('meyar:backup', async ({ window }) => {
        const result = await dialog.showSaveDialog(window!, {
          title: 'Ehtiyat nüsxəni saxla',
          defaultPath: path.join(backupPath, `meyar-${timestamp()}.sqlite`),
          filters: [{ name: 'SQLite ehtiyat nüsxəsi', extensions: ['sqlite'] }],
        });
        if (result.canceled || !result.filePath) return null;
        if (path.resolve(result.filePath) === path.resolve(databasePath))
          throw new Error('Canlı uçot bazasını ehtiyat nüsxə ilə əvəz etmək olmaz.');
        await store!.backup(result.filePath);
        return result.filePath;
      });
      windows.handle('meyar:import', async ({ window }, direction: Direction) => {
        if (direction !== 'purchase' && direction !== 'sale')
          throw new Error('Qaimə istiqaməti seçilməlidir.');
        const result = await dialog.showOpenDialog(window!, {
          title: direction === 'purchase' ? 'Gələn qaimələri seç' : 'Gedən qaimələri seç',
          properties: ['openFile'],
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        return result.canceled ? null : parseInvoiceFile(result.filePaths[0], direction);
      });
      windows.handle('meyar:template', async ({ window }) => {
        const result = await dialog.showSaveDialog(window!, {
          title: 'Qaimə idxal şablonu',
          defaultPath: 'Meyar_Qaime_Sablonu.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) return null;
        await writeInvoiceTemplate(result.filePath);
        return result.filePath;
      });
      await windows.create({ page: 'home', companyId: '' });
      app.on('activate', () => {
        if (!windows.entries.size) void windows.create({ page: 'home', companyId: '' });
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        'Meyar ERP — baza açılmadı',
        `${error.message}\nMövcud məlumatlar silinməyib.`,
      );
      app.quit();
    });
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  store?.close();
});
