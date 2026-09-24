import type {
  Command,
  DesktopAPI,
  Direction,
  ImportRow,
  MutationResult,
  State,
} from '../shared/types';
async function response<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => {
    throw new Error('Proqramdan düzgün cavab alınmadı. Bağlantını yoxlayın.');
  });
  if (!res.ok) throw new Error(data.error || 'Əməliyyat alınmadı.');
  return data as T;
}
export const api: DesktopAPI = {
  call(command: Command) {
    return window.meyar
      ? window.meyar.call(command)
      : fetch('/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        }).then(response<State | MutationResult>);
  },
  backup() {
    if (window.meyar) return window.meyar.backup();
    return Promise.reject(new Error('Ehtiyat nüsxə masaüstü proqramda yaradılır.'));
  },
  async importFile(direction: Direction) {
    if (window.meyar) return window.meyar.importFile(direction);
    return new Promise<ImportRow[] | null>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx';
      input.addEventListener('cancel', () => resolve(null));
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          if (file.size > 5 * 1024 * 1024) throw new Error('Excel faylı 5 MB-dan böyükdür.');
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Fayl oxunmadı.'));
          reader.onload = async () => {
            try {
              resolve(
                await response<ImportRow[]>(
                  await fetch('/api/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      direction,
                      base64: String(reader.result).split(',')[1],
                    }),
                  }),
                ),
              );
            } catch (e) {
              reject(e);
            }
          };
          reader.readAsDataURL(file);
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  },
  async template() {
    if (window.meyar) return window.meyar.template();
    const res = await fetch('/api/template');
    if (!res.ok) {
      await response(res);
      return null;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Meyar_Qaime_Sablonu.xlsx';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return null;
  },
  checkUpdate() {
    if (window.meyar) return window.meyar.checkUpdate();
    return Promise.resolve('Yeniləmə yoxlaması quraşdırılmış masaüstü proqramda işləyir.');
  },
  version() {
    if (window.meyar) return window.meyar.version();
    return fetch('/api/version')
      .then(response<{ version: string }>)
      .then((r) => r.version);
  },
};
