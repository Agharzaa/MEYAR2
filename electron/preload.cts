import { contextBridge, ipcRenderer } from 'electron';
import type { Command, Direction } from '../shared/types.js';

contextBridge.exposeInMainWorld(
  'meyar',
  Object.freeze({
    call: (command: Command) => ipcRenderer.invoke('meyar:command', command),
    backup: () => ipcRenderer.invoke('meyar:backup'),
    importFile: (direction: Direction) => ipcRenderer.invoke('meyar:import', direction),
    template: () => ipcRenderer.invoke('meyar:template'),
    checkUpdate: () => ipcRenderer.invoke('meyar:update-status'),
    version: () => ipcRenderer.invoke('meyar:version'),
  }),
);
