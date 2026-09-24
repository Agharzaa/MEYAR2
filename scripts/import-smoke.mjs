import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  HEADERS,
  invoiceTemplateBuffer,
  parseInvoiceBuffer,
} from '../dist/main/electron/import.js';

async function fixture(changes = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Qaimələr');
  sheet.addRow([...HEADERS]);
  const row = [
    'INV-01',
    '2026-09-23',
    '0123456789',
    'Rabitə MMC',
    'service',
    '100,50',
    '18.09',
    'Rabitə',
    'Aylıq xidmət',
  ];
  for (const [column, value] of Object.entries(changes)) row[Number(column)] = value;
  sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const valid = await parseInvoiceBuffer(await fixture(), 'purchase');
assert.equal(valid.length, 1);
assert.equal(valid[0].taxId, '0123456789');
assert.equal(valid[0].net, '100.50');
assert.equal(valid[0].direction, 'purchase');
assert.equal((await parseInvoiceBuffer(await fixture(), 'sale'))[0].direction, 'sale');
await assert.rejects(parseInvoiceBuffer(await fixture(), undefined), /istiqamət/);
await assert.rejects(parseInvoiceBuffer(await fixture({ 7: '' }), 'purchase'), /Subaccount/);
await assert.rejects(parseInvoiceBuffer(await fixture({ 1: '2026-02-30' }), 'purchase'), /Tarix/);
await assert.rejects(parseInvoiceBuffer(await fixture({ 5: '100.501' }), 'purchase'), /Net/);
await assert.rejects(parseInvoiceBuffer(await fixture({ 6: '' }), 'purchase'), /VAT/);
await assert.rejects(
  parseInvoiceBuffer(await fixture({ 5: { formula: '1+1', result: 2 } }), 'purchase'),
  /Formula/,
);
await assert.rejects(parseInvoiceBuffer(await fixture({ 2: '123456789' }), 'purchase'), /VÖEN/);
await assert.rejects(parseInvoiceBuffer(await invoiceTemplateBuffer(), 'purchase'), /qaimə yoxdur/);
console.log(
  'Excel import: strict direction, dates, money, formula rejection, VÖEN and empty template passed.',
);
