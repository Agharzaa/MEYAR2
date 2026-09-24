// Local, disposable browser QA only. Never bind this server to a public interface.
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../core/database.js';
import { validateCommand } from '../electron/transport.js';
import { invoiceTemplateBuffer, parseInvoiceBuffer } from '../electron/import.js';

const port = Number(process.env.MEYAR_PREVIEW_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('MEYAR_PREVIEW_PORT must be 1024–65535.');
const origin = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(path.join(tmpdir(), 'meyar-erp-qa-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer');
const store = new Store(path.join(directory, 'preview.sqlite'));
const packageData = JSON.parse(
  await readFile(path.resolve(root, '../../package.json'), 'utf8'),
) as { version: string };
async function jsonBody(request: IncomingMessage, limit = 2_000_000): Promise<any> {
  if (
    request.headers.origin !== origin ||
    request.headers['content-type']?.split(';')[0].trim() !== 'application/json'
  )
    throw new Error('Origin və JSON Content-Type tələb olunur.');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('Sorğu çox böyükdür.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
  );
  try {
    if (request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(403).end('Forbidden host');
      return;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403).end('Forbidden origin');
      return;
    }
    const url = new URL(request.url ?? '/', origin);
    if (request.method === 'POST' && url.pathname === '/api') {
      const result = store.call(validateCommand(await jsonBody(request)));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/import') {
      const body = await jsonBody(request, 8_000_000);
      if (!body || typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))
        throw new Error('Excel məzmunu düzgün deyil.');
      const rows = await parseInvoiceBuffer(Buffer.from(body.base64, 'base64'), body.direction);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/template') {
      response
        .writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="Meyar_Qaime_Sablonu.xlsx"',
        })
        .end(await invoiceTemplateBuffer());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/version') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ version: packageData.version }));
      return;
    }
    if (request.method !== 'GET' || url.pathname.startsWith('/api')) {
      response.writeHead(404).end('Not found');
      return;
    }
    const relative =
      decodeURIComponent(url.pathname) === '/'
        ? 'index.html'
        : decodeURIComponent(url.pathname).slice(1);
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden path');
      return;
    }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    };
    const data = await readFile(target);
    response
      .writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream' })
      .end(data);
  } catch (error) {
    response
      .writeHead(400, { 'Content-Type': 'application/json' })
      .end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Əməliyyat alınmadı.' }),
      );
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Meyar QA: ${origin} — temporary database; all preview data is removed on exit.`),
);
async function close() {
  server.close();
  server.closeAllConnections();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
