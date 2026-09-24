import type { Command } from '../shared/types.js';

const operations = new Set([
  'state',
  'company.create',
  'partner.save',
  'invoice.save',
  'invoice.cancel',
  'payment.save',
  'payment.cancel',
  'period.close',
  'invoice.import',
]);
export function validateCommand(value: unknown): Command {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Əməliyyat düzgün deyil.');
  const command = value as Record<string, unknown>;
  if (typeof command.op !== 'string' || !operations.has(command.op))
    throw new Error('Əməliyyata icazə verilmir.');
  if (JSON.stringify(value).length > 2_000_000)
    throw new Error('Sorğunun həcmi icazə verilən həddi keçir.');
  if (command.op !== 'company.create' && typeof command.companyId !== 'string')
    throw new Error('Şirkət seçilməlidir.');
  if (command.op === 'state' && (!command.filter || typeof command.filter !== 'object'))
    throw new Error('Hesabat filtri yoxdur.');
  return value as Command;
}
