import { contextBridge, ipcRenderer } from 'electron';
import type { Command, Direction } from '../shared/types.js';

contextBridge.exposeInMainWorld(
  'meyar',
  Object.freeze({
    windows: Object.freeze({
      context: () => ipcRenderer.invoke('meyar:window-context'),
      open: (request: unknown) => ipcRenderer.invoke('meyar:window-open', request),
      list: () => ipcRenderer.invoke('meyar:window-list'),
      focus: (id: number) => ipcRenderer.invoke('meyar:window-focus', id),
      close: (id?: number) => ipcRenderer.invoke('meyar:window-close', id),
      minimize: () => ipcRenderer.invoke('meyar:window-minimize'),
      maximize: () => ipcRenderer.invoke('meyar:window-maximize'),
      setDirty: (dirty: boolean) => ipcRenderer.invoke('meyar:window-dirty', dirty),
      confirmDiscard: () => ipcRenderer.invoke('meyar:window-discard'),
      onChanged: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on('meyar:windows-changed', listener);
        return () => ipcRenderer.removeListener('meyar:windows-changed', listener);
      },
      onDataChanged: (callback: (companyId: string) => void) => {
        const listener = (_event: unknown, companyId: string) => callback(companyId);
        ipcRenderer.on('meyar:data-changed', listener);
        return () => ipcRenderer.removeListener('meyar:data-changed', listener);
      },
    }),
    call: (command: Command) => ipcRenderer.invoke('meyar:command', command),
    backup: () => ipcRenderer.invoke('meyar:backup'),
    importFile: (direction: Direction) => ipcRenderer.invoke('meyar:import', direction),
    template: () => ipcRenderer.invoke('meyar:template'),
    checkUpdate: () => ipcRenderer.invoke('meyar:update-status'),
    version: () => ipcRenderer.invoke('meyar:version'),
  }),
);
