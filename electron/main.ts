import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import updater from 'electron-updater';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from '../core/database.js';
import { parseInvoiceFile, writeInvoiceTemplate } from './import.js';
import { validateCommand } from './transport.js';
import type { Direction } from '../shared/types.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = updater;
const dev = !app.isPackaged && process.argv.includes('--dev');
const rendererPath = path.resolve(directory, '../../renderer/index.html');
const rendererURL = pathToFileURL(rendererPath).href;
app.setPath('userData', path.join(app.getPath('appData'), 'Meyar ERP 2'));
const dataPath = path.join(app.getPath('userData'), 'data');
const backupPath = path.join(app.getPath('userData'), 'backups');
const databasePath = path.join(dataPath, 'meyar.sqlite');
let window: BrowserWindow | null = null;
let store: Store | undefined;
const timestamp = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
function allowedURL(value: string): boolean {
  try {
    const url = new URL(value);
    return dev
      ? url.origin === 'http://127.0.0.1:5173'
      : url.protocol === 'file:' && url.href.split('#')[0] === rendererURL;
  } catch {
    return false;
  }
}
function validateSender(event: IpcMainInvokeEvent): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    !event.senderFrame ||
    event.senderFrame !== window.webContents.mainFrame ||
    !allowedURL(event.senderFrame.url)
  )
    throw new Error('Bu pəncərəyə giriş icazəsi verilmir.');
}
function handle(channel: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    validateSender(event);
    return action(...args);
  });
}
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
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    backgroundColor: '#f5f8f6',
    title: 'Meyar ERP 2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: dev,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedURL(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = null;
  });
  const loading = dev ? window.loadURL('http://127.0.0.1:5173') : window.loadFile(rendererPath);
  loading.catch((error) => {
    dialog.showErrorBox('Meyar ERP açıla bilmədi', error.message);
    app.quit();
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
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
      handle('meyar:command', (value) => store!.call(validateCommand(value)));
      handle('meyar:version', () => app.getVersion());
      handle('meyar:update-status', () => updateStatus);
      handle('meyar:backup', async () => {
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
      handle('meyar:import', async (direction: Direction) => {
        if (direction !== 'purchase' && direction !== 'sale')
          throw new Error('Qaimə istiqaməti seçilməlidir.');
        const result = await dialog.showOpenDialog(window!, {
          title: direction === 'purchase' ? 'Gələn qaimələri seç' : 'Gedən qaimələri seç',
          properties: ['openFile'],
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        return result.canceled ? null : parseInvoiceFile(result.filePaths[0], direction);
      });
      handle('meyar:template', async () => {
        const result = await dialog.showSaveDialog(window!, {
          title: 'Qaimə idxal şablonu',
          defaultPath: 'Meyar_Qaime_Sablonu.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) return null;
        await writeInvoiceTemplate(result.filePath);
        return result.filePath;
      });
      createWindow();
      app.on('activate', () => {
        if (!window) createWindow();
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
