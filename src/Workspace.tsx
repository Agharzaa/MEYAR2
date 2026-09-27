import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
  useRef,
  type PointerEvent,
} from 'react';
import App from './App';
import { NativeDocument } from './NativeWindows';
import { api } from './api';
import { today } from './components';
import {
  windowTitles,
  type WindowBridge,
  type WindowContext,
  type WindowRequest,
} from '../shared/windows';
import type { State } from '../shared/types';

type Pane = {
  context: WindowContext;
  title: string;
  key: string;
  dirty: boolean;
  restored: boolean;
};
class WorkspaceController {
  panes: Pane[] = [];
  active = 0;
  private nextId = 1;
  private revision = 0;
  private listeners = new Set<() => void>();
  private bridges = new Map<number, WindowBridge>();
  private closing = new Set<number>();
  constructor(private host: WindowBridge) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private notify() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private async dirtyHost() {
    await this.host.setDirty(this.panes.some((p) => p.dirty));
  }
  private async open(request: WindowRequest, sourceId: number) {
    if (request.page === 'home') {
      this.active = 0;
      this.notify();
      return;
    }
    const source = this.panes.find((p) => p.context.id === sourceId);
    if (source && source.context.companyId !== request.companyId)
      throw new Error('Başqa şirkət üçün iş masasından bölmə açın.');
    const state = (await api.call({
      op: 'state',
      companyId: request.companyId,
      filter: { from: '2000-01-01', to: today(), account: '' },
    })) as State;
    const key = JSON.stringify([
      request.page,
      request.companyId,
      request.form ?? '',
      request.documentId ?? '',
      request.filter ?? null,
    ]);
    const existing = this.panes.find((p) => p.key === key);
    if (existing && (!request.form || request.documentId)) {
      this.active = existing.context.id;
      this.notify();
      return;
    }
    const id = this.nextId++;
    const title = `${request.form ? (request.documentId ? 'Qaiməyə düzəliş' : request.form === 'invoice' ? 'Yeni qaimə' : 'Yeni ödəniş') + ' · ' : ''}${windowTitles[request.page]} · ${state.company.name}`;
    this.panes = [
      ...this.panes,
      { context: { ...request, id }, title, key, dirty: false, restored: !!request.form },
    ];
    this.active = id;
    this.notify();
  }
  private async close(id: number) {
    const pane = this.panes.find((p) => p.context.id === id);
    if (!pane || this.closing.has(id)) return;
    this.closing.add(id);
    try {
      if (pane.dirty && !(await this.host.confirmDiscard())) return;
      this.panes = this.panes.filter((p) => p.context.id !== id);
      this.bridges.delete(id);
      if (this.active === id) this.active = this.panes.at(-1)?.context.id ?? 0;
      this.notify();
      await this.dirtyHost();
    } finally {
      this.closing.delete(id);
    }
  }
  bridge(id: number): WindowBridge {
    let bridge = this.bridges.get(id);
    if (bridge) return bridge;
    bridge = {
      context: async () =>
        this.panes.find((p) => p.context.id === id)?.context ?? {
          id: 0,
          page: 'home',
          companyId: '',
        },
      open: (r) => this.open(r, id),
      list: async () => [
        { id: 0, title: 'İş masası', companyId: '', page: 'home', dirty: false },
        ...this.panes.map((p) => ({
          id: p.context.id,
          title: p.title,
          companyId: p.context.companyId,
          page: p.context.page,
          dirty: p.dirty,
        })),
      ],
      focus: async (target) => {
        if (target === 0 || this.panes.some((p) => p.context.id === target)) {
          this.active = target;
          this.notify();
        }
      },
      close: (target) => this.close(target ?? id),
      minimize: async () => {
        this.active = 0;
        this.notify();
      },
      maximize: async () => {
        this.panes = this.panes.map((p) =>
          p.context.id === id ? { ...p, restored: !p.restored } : p,
        );
        this.notify();
      },
      setDirty: async (dirty) => {
        const p = this.panes.find((p) => p.context.id === id);
        if (p && p.dirty !== dirty) {
          p.dirty = dirty;
          this.notify();
          await this.dirtyHost();
        }
      },
      confirmDiscard: () => this.host.confirmDiscard(),
      onChanged: this.subscribe,
      onDataChanged: (callback) => this.host.onDataChanged(callback),
    };
    this.bridges.set(id, bridge);
    return bridge;
  }
}
function InternalPane({
  pane,
  active,
  controller,
}: {
  pane: Pane;
  active: boolean;
  controller: WorkspaceController;
}) {
  const [position, setPosition] = useState({ x: 24, y: 16 });
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = element.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      if (!active) return;
      const node = element.current!;
      setPosition((p) => ({
        x: Math.max(0, Math.min(p.x, parent.clientWidth - node.offsetWidth)),
        y: Math.max(0, Math.min(p.y, parent.clientHeight - node.offsetHeight)),
      }));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [active]);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  function start(e: PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (
      !pane.restored ||
      !target.closest('.page-heading,.native-document-heading') ||
      target.closest('button,input,select,textarea')
    )
      return;
    drag.current = { x: e.clientX, y: e.clientY, left: position.x, top: position.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  return (
    <div
      ref={element}
      hidden={!active}
      data-pane-id={pane.context.id}
      data-page={pane.context.page}
      data-form={pane.context.form ?? ''}
      className={`internal-pane ${pane.restored ? 'restored' : ''} ${pane.context.form ? 'document-pane' : ''}`}
      style={
        pane.restored
          ? {
              left: position.x,
              top: position.y,
              maxWidth: `calc(100% - ${position.x}px)`,
              maxHeight: `calc(100% - ${position.y}px)`,
            }
          : undefined
      }
      onPointerDown={start}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const parent = e.currentTarget.parentElement!;
        setPosition({
          x: Math.max(
            0,
            Math.min(
              parent.clientWidth - e.currentTarget.offsetWidth,
              drag.current.left + e.clientX - drag.current.x,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              parent.clientHeight - e.currentTarget.offsetHeight,
              drag.current.top + e.clientY - drag.current.y,
            ),
          ),
        });
      }}
    >
      {pane.context.form ? (
        <NativeDocument
          context={pane.context}
          windowBridge={controller.bridge(pane.context.id)}
          hideWindowBar
        />
      ) : (
        <App
          nativeContext={pane.context}
          windowBridge={controller.bridge(pane.context.id)}
          hideWindowBar
        />
      )}
    </div>
  );
}
export function Workspace({ host }: { host: WindowBridge }) {
  const controller = useMemo(() => new WorkspaceController(host), [host]);
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  const home = useMemo<WindowContext>(() => ({ id: 0, page: 'home', companyId: '' }), []);
  return (
    <App
      nativeContext={home}
      windowBridge={controller.bridge(0)}
      activeWindowId={controller.active}
      navigationPage={
        controller.panes.find((p) => p.context.id === controller.active)?.context.page ?? 'home'
      }
      workspaceCompanyId={
        controller.panes.find((p) => p.context.id === controller.active)?.context.companyId
      }
      workspaceActive={controller.active !== 0}
      workspace={
        <div className="internal-workspace" hidden={controller.active === 0}>
          {controller.panes.map((pane) => (
            <InternalPane
              key={pane.context.id}
              pane={pane}
              active={controller.active === pane.context.id}
              controller={controller}
            />
          ))}
        </div>
      }
    />
  );
}
