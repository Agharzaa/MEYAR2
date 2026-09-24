import { JSDOM } from 'jsdom';

// DOM integration only: no layout engine, browser sandbox, or Electron verification.
export const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:4173',
  pretendToBeVisual: true,
});
for (const name of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLDialogElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'MutationObserver',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true,
  configurable: true,
});
// jsdom lacks the dialog top layer. Supply open/close and initial focus only.
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
  this.querySelector<HTMLElement>(
    '[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
  )?.focus();
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
