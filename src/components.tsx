import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react';
export const money = (n: number) =>
  new Intl.NumberFormat('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    n / 100,
  );
export const day = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : d;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function Status({ cancelled = false }: { cancelled?: boolean }) {
  return (
    <span className={`status ${cancelled ? 'cancelled' : ''}`}>
      <i />
      {cancelled ? 'Ləğv edilib' : 'Uçota alınıb'}
    </span>
  );
}
export function Empty({
  title = 'Hələ sənəd yoxdur',
  description = 'Yeni sənəd əlavə etdikdə burada görünəcək.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileText size={25} />
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Pəncərəni bağla"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  full = false,
  hint,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
  hint?: string;
}) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export interface Column<T> {
  label: string;
  key: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  className?: string;
}
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  empty,
  onOpen,
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  empty?: ReactNode;
  onOpen?: (row: T) => void;
  footer?: ReactNode;
}) {
  const [page, setPage] = useState(0),
    [size, setSize] = useState(25);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * size, (current + 1) * size);
  useEffect(() => setPage(0), [rows.length]);
  return (
    <div className="data-table">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.numeric ? 'numeric' : ''} ${c.className ?? ''}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} onDoubleClick={() => onOpen?.(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.numeric ? 'numeric' : ''} ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && footer && <tfoot>{footer}</tfoot>}
        </table>
        {!rows.length && (empty || <Empty />)}
      </div>
      <div className="table-bottom">
        <span>
          <b>{rows.length.toLocaleString('az-AZ')}</b> sətir{' '}
          {rows.length > 0 &&
            `· ${current * size + 1}–${Math.min((current + 1) * size, rows.length)} göstərilir`}
        </span>
        <div className="pagination">
          <label>
            Sətirlər səhifədə{' '}
            <select
              aria-label="Sətirlər səhifədə"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
            >
              <option>25</option>
              <option>50</option>
              <option>100</option>
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="Əvvəlki səhifə"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            className="icon-button"
            aria-label="Növbəti səhifə"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
