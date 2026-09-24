import ExcelJS from 'exceljs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { cents, date, decimal, optional, taxId, text } from '../core/money.js';
import type { Direction, ImportRow } from '../shared/types.js';

export const HEADERS = [
  'Number',
  'Date',
  'TaxId',
  'Partner',
  'Kind',
  'Net',
  'VAT',
  'Subaccount',
  'Description',
] as const;
function stringCell(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString().slice(0, 10);
  throw new Error(
    'Formula, xəta və mürəkkəb xana dəyərləri qəbul edilmir; yalnız mətn, tarix və rəqəm istifadə edin.',
  );
}
export async function parseInvoiceFile(path: string, direction: Direction): Promise<ImportRow[]> {
  if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('Excel faylı 5 MB-dan böyükdür.');
  return parseInvoiceBuffer(await readFile(path), direction);
}
export async function parseInvoiceBuffer(
  buffer: Buffer,
  direction: Direction,
): Promise<ImportRow[]> {
  if (direction !== 'purchase' && direction !== 'sale')
    throw new Error('İdxaldan əvvəl alış və ya satış istiqamətini seçin.');
  if (buffer.length > 5 * 1024 * 1024) throw new Error('Excel faylı 5 MB-dan böyükdür.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount > 1001)
    throw new Error('İlk vərəqdə başlıq və ən çox 1000 məlumat sətri olmalıdır.');
  HEADERS.forEach((header, index) => {
    if (stringCell(sheet.getCell(1, index + 1)) !== header)
      throw new Error(`Sütun ${index + 1}: başlıq ${header} olmalıdır. Şablondan istifadə edin.`);
  });
  if (sheet.columnCount > HEADERS.length) throw new Error('Şablondan kənar sütunlar var.');
  const rows: ImportRow[] = [];
  for (let index = 2; index <= sheet.rowCount; index++) {
    try {
      const values = HEADERS.map((_, column) => stringCell(sheet.getCell(index, column + 1)));
      if (values.every((value) => value === '')) continue;
      const [number, rawDate, rawTax, partnerName, rawKind, net, vat, subaccount, description] =
        values;
      if (rawKind !== 'goods' && rawKind !== 'service')
        throw new Error('Kind goods (mal) və ya service (xidmət) olmalıdır.');
      if (direction === 'purchase' && rawKind === 'service' && !subaccount)
        throw new Error('Xidmət alışında Subaccount doldurulmalıdır.');
      if (cents(net, 'Net') <= 0) throw new Error('Net sıfırdan böyük olmalıdır.');
      rows.push({
        number: text(number, 'Number', 80),
        date: date(rawDate),
        taxId: taxId(rawTax),
        partnerName: text(partnerName, 'Partner'),
        direction,
        kind: rawKind,
        net: decimal(cents(net, 'Net')),
        vat: decimal(cents(vat, 'VAT')),
        subaccount: optional(subaccount, 100),
        description: optional(description),
      });
    } catch (error) {
      throw new Error(
        `Excel sətri ${index}: ${error instanceof Error ? error.message : 'Məlumat düzgün deyil.'}`,
      );
    }
  }
  if (!rows.length) throw new Error('İdxal ediləcək qaimə yoxdur.');
  return rows;
}
export async function writeInvoiceTemplate(path: string): Promise<void> {
  await writeFile(path, await invoiceTemplateBuffer());
}
export async function invoiceTemplateBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Meyar ERP 2';
  const sheet = workbook.addWorksheet('Qaimələr', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = HEADERS.map((header) => ({
    header,
    key: header,
    width: header === 'Description' ? 40 : header === 'Partner' ? 30 : 19,
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087F5B' } };
  sheet.getRow(1).height = 28;
  sheet.autoFilter = 'A1:I1';
  for (let index = 2; index <= 1001; index++) {
    for (const column of [1, 2, 3, 6, 7]) sheet.getCell(index, column).numFmt = '@';
    sheet.getCell(index, 5).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"goods,service"'],
      showErrorMessage: true,
      errorTitle: 'Qaimə növü',
      error: 'goods və ya service seçin.',
    };
  }
  sheet.getCell('B1').note = 'YYYY-MM-DD formatında yazın. Məsələn: 2026-09-23.';
  sheet.getCell('C1').note = '10 rəqəmli VÖEN. Əvvəldəki sıfırları saxlayın.';
  sheet.getCell('F1').note =
    'ƏDV-siz məbləğ; ən çox iki onluq rəqəm. Minlik ayırıcı istifadə etməyin.';
  sheet.getCell('G1').note = 'ƏDV məbləği. ƏDV yoxdursa 0 yazın; boş saxlamayın.';
  sheet.getCell('H1').note = 'Xidmət alışlarında məcburidir. Məsələn: Rabitə.';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
