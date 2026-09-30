import { randomUUID as uuid } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { cents, decimal, text, optional, date, safe, sum } from './money.js';
import { scaled, unscaled, converted, lineAmount, QUANTITY_SCALE } from './quantity.js';
import {
  categoryAccounts,
  type ProductInput,
  type InvoiceItemInput,
  type InvoiceItem,
  type ItemCategory,
  type InventoryState,
  type AssetCommissionInput,
  type StockIssueInput,
} from '../shared/inventory.js';
type Row = Record<string, string | number | null>;
export type PostingLine = {
  account: string;
  partnerId?: string;
  subaccount?: string;
  debit: number;
  credit: number;
};
type Posting = {
  date: string;
  type: string;
  id: string;
  number: string;
  version: number;
  reversal: number;
  description: string;
  lines: PostingLine[];
};
type Hooks = {
  open: (companyId: string, date: string) => string;
  post: (companyId: string, p: Posting) => void;
  reverse: (companyId: string, type: string, id: string, version: number, reason: string) => void;
  audit: (companyId: string, action: string, entity: string, description: string) => void;
  company: (id: string) => unknown;
};
export class Inventory {
  constructor(
    private db: DatabaseSync,
    private hooks: Hooks,
  ) {}
  private one(sql: string, ...p: SQLInputValue[]) {
    return this.db.prepare(sql).get(...p) as Row | undefined;
  }
  private all(sql: string, ...p: SQLInputValue[]) {
    return this.db.prepare(sql).all(...p) as Row[];
  }
  private run(sql: string, ...p: SQLInputValue[]) {
    return this.db.prepare(sql).run(...p);
  }
  private product(companyId: string, id: string) {
    const p = this.one(
      'SELECT * FROM products WHERE id=? AND company_id=?',
      text(id, 'Nomenklatura'),
      companyId,
    );
    if (!p) throw new Error('Bu şirkətdə nomenklatura tapılmadı.');
    return p;
  }
  private warehouse(companyId: string, id: string) {
    const w = this.one(
      'SELECT * FROM warehouses WHERE id=? AND company_id=?',
      text(id, 'Anbar'),
      companyId,
    );
    if (!w) throw new Error('Bu şirkətdə anbar tapılmadı.');
    return w;
  }
  saveUnit(companyId: string, code: string, name: string) {
    this.hooks.company(companyId);
    const id = text(code, 'Vahid kodu', 20).toLowerCase(),
      label = text(name, 'Vahid adı', 30);
    if (!/^[a-z0-9_-]+$/.test(id))
      throw new Error('Vahid kodunda latın hərfləri və rəqəmlər istifadə edin.');
    const old = this.one('SELECT * FROM units WHERE id=? OR name=?', id, label);
    if (old) {
      if (old.id === id && old.name === label) return { id, unchanged: 1 };
      throw new Error('Bu vahid kodu və ya adı artıq var.');
    }
    this.run('INSERT INTO units VALUES(?,?)', id, label);
    this.hooks.audit(companyId, 'Yaradıldı', 'Ölçü vahidi', label);
    return { id, created: 1 };
  }
  saveWarehouse(companyId: string, nameValue: string) {
    this.hooks.company(companyId);
    const name = text(nameValue, 'Anbar adı', 100);
    const old = this.one(
      'SELECT id FROM warehouses WHERE company_id=? AND name=?',
      companyId,
      name,
    );
    if (old) return { id: String(old.id), unchanged: 1 };
    const id = uuid();
    this.run('INSERT INTO warehouses VALUES(?,?,?)', id, companyId, name);
    this.hooks.audit(companyId, 'Yaradıldı', 'Anbar', name);
    return { id, created: 1 };
  }
  saveProduct(companyId: string, raw: ProductInput) {
    this.hooks.company(companyId);
    if (!raw || typeof raw !== 'object') throw new Error('Nomenklatura məlumatları yoxdur.');
    const code = text(raw.code, 'Nomenklatura kodu', 60).toUpperCase(),
      name = text(raw.name, 'Nomenklatura adı', 200),
      group = optional(raw.group, 100),
      barcode = optional(raw.barcode, 80);
    const base = text(raw.baseUnitId, 'Əsas vahid', 20),
      purchase = text(raw.purchaseUnitId, 'Alış vahidi', 20),
      factor = scaled(raw.factor);
    if (factor <= 0 || (base === purchase && factor !== QUANTITY_SCALE))
      throw new Error('Eyni ölçü vahidi üçün çevirmə əmsalı 1 olmalıdır.');
    if (
      !this.one('SELECT id FROM units WHERE id=?', base) ||
      !this.one('SELECT id FROM units WHERE id=?', purchase)
    )
      throw new Error('Ölçü vahidi tapılmadı.');
    if (!Object.hasOwn(categoryAccounts, raw.category))
      throw new Error('Uçot kateqoriyası seçilməlidir.');
    const existing = raw.id
      ? this.product(companyId, raw.id)
      : this.one('SELECT * FROM products WHERE company_id=? AND code=?', companyId, code);
    const values = [
      code,
      name,
      group,
      barcode,
      base,
      purchase,
      factor,
      raw.category,
    ] as SQLInputValue[];
    if (existing && !raw.id) {
      if (
        [
          existing.code,
          existing.name,
          existing.group_name,
          existing.barcode,
          existing.base_unit_id,
          existing.purchase_unit_id,
          existing.factor,
          existing.category,
        ].every((v, i) => v === values[i])
      )
        return { id: String(existing.id), unchanged: 1 };
      throw new Error('Bu nomenklatura kodu artıq mövcuddur.');
    }
    const duplicate = this.one(
      "SELECT id FROM products WHERE company_id=? AND (code=? OR (?!='' AND barcode=?)) AND id!=?",
      companyId,
      code,
      barcode,
      barcode,
      raw.id ?? '',
    );
    if (duplicate) throw new Error('Nomenklatura kodu və ya barkod təkrarlanır.');
    const id = existing ? String(existing.id) : uuid();
    if (existing)
      this.run(
        'UPDATE products SET code=?,name=?,group_name=?,barcode=?,base_unit_id=?,purchase_unit_id=?,factor=?,category=? WHERE id=?',
        ...values,
        id,
      );
    else this.run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?)', id, companyId, ...values);
    this.hooks.audit(
      companyId,
      existing ? 'Yeniləndi' : 'Yaradıldı',
      'Nomenklatura',
      code + ' · ' + name,
    );
    return { id, ...(existing ? { updated: 1 } : { created: 1 }) };
  }
  normalize(
    companyId: string,
    raw: InvoiceItemInput[],
    direction: 'purchase' | 'sale',
  ): InvoiceItem[] {
    if (!Array.isArray(raw) || !raw.length || raw.length > 100)
      throw new Error('Qaimədə 1–100 nomenklatura sətri olmalıdır.');
    return raw.map((r, index) => {
      if (!r || typeof r !== 'object') throw new Error('Qaimə sətri düzgün deyil.');
      const p = this.product(companyId, r.productId);
      this.warehouse(companyId, r.warehouseId);
      if (
        !Object.hasOwn(categoryAccounts, r.category) ||
        (direction === 'sale' && r.category === 'asset')
      )
        throw new Error('Sətrin uçot kateqoriyası düzgün deyil.');
      const unit = text(r.unitId, 'Ölçü vahidi', 20);
      if (unit !== p.base_unit_id && unit !== p.purchase_unit_id)
        throw new Error('Vahid nomenklatura kartına uyğun deyil.');
      const factor = unit === p.base_unit_id ? '1' : unscaled(Number(p.factor));
      const baseQuantity = converted(r.quantity, factor),
        net = lineAmount(r.quantity, r.unitPrice),
        vat = cents(r.vat, 'Sətir ƏDV-si');
      if (
        r.category === 'asset' &&
        (baseQuantity % QUANTITY_SCALE !== 0 ||
          baseQuantity / QUANTITY_SCALE > 1000 ||
          net < baseQuantity / QUANTITY_SCALE ||
          !['pcs', 'set', 'pair'].includes(String(p.base_unit_id)))
      )
        throw new Error(
          'Əsas vəsait tam ədəd, dəst və ya cütlə daxil edilməlidir (sətirdə ən çox 1000 inventar).',
        );
      return {
        productId: String(p.id),
        warehouseId: r.warehouseId,
        category: r.category,
        unitId: unit,
        quantity: unscaled(scaled(r.quantity)),
        unitPrice: unscaled(scaled(r.unitPrice, 4), 4),
        vat: decimal(vat),
        productName: String(p.name),
        productCode: String(p.code),
        unitName: String(this.one('SELECT name FROM units WHERE id=?', unit)!.name),
        baseUnitName: String(this.one('SELECT name FROM units WHERE id=?', p.base_unit_id)!.name),
        baseQuantity: unscaled(baseQuantity),
        netCents: net,
        vatCents: vat,
      };
    });
  }
  private balance(
    companyId: string,
    productId: string,
    warehouseId: string,
    category: ItemCategory,
  ) {
    const r = this.one(
      'SELECT COALESCE(SUM(quantity),0) AS q,COALESCE(SUM(value),0) AS v FROM stock_movements WHERE company_id=? AND product_id=? AND warehouse_id=? AND category=?',
      companyId,
      productId,
      warehouseId,
      category,
    )!;
    return { quantity: safe(Number(r.q)), value: safe(Number(r.v)) };
  }
  private chronology(
    companyId: string,
    productId: string,
    warehouseId: string,
    category: ItemCategory,
    d: string,
    outgoing: boolean,
  ) {
    const latest = this.one(
      'SELECT MAX(m.date) AS d FROM stock_movements m WHERE m.company_id=? AND m.product_id=? AND m.warehouse_id=? AND m.category=? AND (?=1 OR m.quantity<0) AND m.reversal=0 AND NOT EXISTS(SELECT 1 FROM stock_movements r WHERE r.company_id=m.company_id AND r.source_type=m.source_type AND r.source_id=m.source_id AND r.version=m.version AND r.line=m.line AND r.reversal=1)',
      companyId,
      productId,
      warehouseId,
      category,
      outgoing ? 1 : 0,
    )?.d;
    if (latest && d < String(latest))
      throw new Error(
        'Bu məhsul üzrə daha sonrakı anbar hərəkəti var. Əvvəl sonrakı çıxışları ləğv edin.',
      );
  }
  private movement(
    companyId: string,
    invoiceId: string | null,
    type: string,
    id: string,
    number: string,
    version: number,
    line: number,
    d: string,
    productId: string,
    warehouseId: string,
    category: ItemCategory,
    quantity: number,
    value: number,
    reversal = 0,
  ) {
    safe(quantity);
    safe(value);
    this.run(
      'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uuid(),
      companyId,
      invoiceId,
      type,
      id,
      number,
      version,
      line,
      d,
      productId,
      warehouseId,
      category,
      quantity,
      value,
      reversal,
    );
  }
  private cost(companyId: string, p: string, w: string, c: ItemCategory, q: number): number {
    const balance = this.balance(companyId, p, w, c);
    if (q <= 0 || balance.quantity < q || balance.value < 0)
      throw new Error('Anbarda kifayət qədər qalıq yoxdur.');
    return q === balance.quantity
      ? balance.value
      : safe(
          Number(
            (BigInt(balance.value) * BigInt(q) + BigInt(balance.quantity) / 2n) /
              BigInt(balance.quantity),
          ),
        );
  }
  applyInvoice(
    companyId: string,
    id: string,
    number: string,
    d: string,
    version: number,
    direction: 'purchase' | 'sale',
    items: InvoiceItem[],
  ): PostingLine[] {
    const result: PostingLine[] = [];
    for (const [index, item] of items.entries()) {
      const q = scaled(item.baseQuantity),
        out = direction === 'sale',
        account = categoryAccounts[item.category];
      this.chronology(companyId, item.productId, item.warehouseId, item.category, d, out);
      const value = out
        ? this.cost(companyId, item.productId, item.warehouseId, item.category, q)
        : item.netCents;
      this.movement(
        companyId,
        id,
        'invoice',
        id,
        number,
        version,
        index,
        d,
        item.productId,
        item.warehouseId,
        item.category,
        out ? -q : q,
        out ? -value : value,
      );
      if (out)
        result.push(
          { account: '701', subaccount: item.productName, debit: value, credit: 0 },
          { account, subaccount: item.productName, debit: 0, credit: value },
        );
      else
        result.push({
          account,
          subaccount: item.productCode + ' · ' + item.productName,
          debit: value,
          credit: 0,
        });
      if (!out && item.category === 'asset') {
        const count = q / QUANTITY_SCALE,
          each = Math.floor(value / count),
          remainder = value % count;
        for (let ordinal = 0; ordinal < count; ordinal++) {
          const assetId = uuid(),
            inventoryNumber = 'EV-' + assetId.slice(0, 8).toUpperCase();
          this.run(
            "INSERT INTO assets(id,company_id,invoice_id,invoice_version,line,ordinal,product_id,warehouse_id,inventory_number,cost,acquired_date,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')",
            assetId,
            companyId,
            id,
            version,
            index,
            ordinal,
            item.productId,
            item.warehouseId,
            inventoryNumber,
            each + (ordinal < remainder ? 1 : 0),
            d,
          );
        }
      }
    }
    return result;
  }
  reverseSource(companyId: string, type: string, id: string, version: number) {
    if (
      type === 'invoice' &&
      this.one(
        "SELECT id FROM assets WHERE company_id=? AND invoice_id=? AND invoice_version=? AND status='active'",
        companyId,
        id,
        version,
      )
    )
      throw new Error('Əvvəl əsas vəsaitin istismara verilməsini ləğv edin.');
    const movements = this.all(
      'SELECT rowid AS row_number,* FROM stock_movements WHERE company_id=? AND source_type=? AND source_id=? AND version=? AND reversal=0',
      companyId,
      type,
      id,
      version,
    );
    for (const m of movements) {
      this.hooks.open(companyId, String(m.date));
      if (
        this.one(
          'SELECT id FROM stock_movements WHERE company_id=? AND source_type=? AND source_id=? AND version=? AND line=? AND reversal=1',
          companyId,
          type,
          id,
          version,
          m.line,
        )
      )
        throw new Error('Anbar hərəkəti artıq ləğv edilib.');
      const later = this.one(
        `SELECT m.id FROM stock_movements m WHERE m.company_id=? AND m.product_id=? AND m.warehouse_id=? AND m.category=? AND m.quantity<0 AND m.reversal=0 AND (m.date>? OR (m.date=? AND m.rowid>?)) AND NOT(m.source_type=? AND m.source_id=? AND m.version=?) AND NOT EXISTS(SELECT 1 FROM stock_movements r WHERE r.company_id=m.company_id AND r.source_type=m.source_type AND r.source_id=m.source_id AND r.version=m.version AND r.line=m.line AND r.reversal=1)`,
        companyId,
        m.product_id,
        m.warehouse_id,
        m.category,
        m.date,
        m.date,
        m.row_number,
        type,
        id,
        version,
      );
      if (later) throw new Error('Bu məhsul üzrə sonrakı anbar çıxışını əvvəl ləğv edin.');
      const b = this.balance(
        companyId,
        String(m.product_id),
        String(m.warehouse_id),
        m.category as ItemCategory,
      );
      if (b.quantity - Number(m.quantity) < 0 || b.value - Number(m.value) < 0)
        throw new Error('Ləğv anbar qalığını mənfi edir.');
    }
    for (const m of movements)
      this.movement(
        companyId,
        m.invoice_id ? String(m.invoice_id) : null,
        type,
        id,
        String(m.source_number),
        version,
        Number(m.line),
        String(m.date),
        String(m.product_id),
        String(m.warehouse_id),
        m.category as ItemCategory,
        -Number(m.quantity),
        -Number(m.value),
        1,
      );
    if (type === 'invoice')
      this.run(
        "UPDATE assets SET status='cancelled' WHERE company_id=? AND invoice_id=? AND invoice_version=? AND status='pending'",
        companyId,
        id,
        version,
      );
  }
  issue(companyId: string, raw: StockIssueInput) {
    this.hooks.company(companyId);
    const p = this.product(companyId, raw.productId);
    this.warehouse(companyId, raw.warehouseId);
    const d = date(raw.date),
      q = scaled(raw.quantity),
      reference = text(raw.reference, 'İstifadə sənədi nömrəsi', 80).toUpperCase(),
      subaccount = text(raw.subaccount, 'Xərc subkontosu', 100);
    const input = JSON.stringify({
      reference,
      date: d,
      productId: raw.productId,
      warehouseId: raw.warehouseId,
      quantity: unscaled(q),
      subaccount,
    });
    const old = this.one(
      'SELECT * FROM stock_issues WHERE company_id=? AND reference=?',
      companyId,
      reference,
    );
    if (old) {
      if (old.input === input && old.status === 'posted')
        return { id: String(old.id), unchanged: 1 };
      throw new Error('Bu istifadə sənədi nömrəsi artıq var.');
    }
    this.hooks.open(companyId, d);
    this.chronology(companyId, raw.productId, raw.warehouseId, 'material', d, true);
    const cost = this.cost(companyId, raw.productId, raw.warehouseId, 'material', q),
      id = uuid();
    if (cost <= 0) throw new Error('Çıxışın dəyəri ən azı 0,01 AZN olmalıdır.');
    this.run(
      "INSERT INTO stock_issues VALUES(?,?,?,?,?,'posted')",
      id,
      companyId,
      reference,
      d,
      input,
    );
    this.movement(
      companyId,
      null,
      'issue',
      id,
      reference,
      1,
      0,
      d,
      raw.productId,
      raw.warehouseId,
      'material',
      -q,
      -cost,
    );
    this.hooks.post(companyId, {
      date: d,
      type: 'issue',
      id,
      number: reference,
      version: 1,
      reversal: 0,
      description: 'Material istifadəsi · ' + p.name,
      lines: [
        { account: '721', subaccount, debit: cost, credit: 0 },
        { account: '201', subaccount: String(p.name), debit: 0, credit: cost },
      ],
    });
    this.hooks.audit(companyId, 'Uçota alındı', 'Material istifadəsi', reference);
    return { id, created: 1 };
  }
  cancelIssue(companyId: string, id: string, reason: string) {
    const old = this.one(
      "SELECT * FROM stock_issues WHERE company_id=? AND id=? AND status='posted'",
      companyId,
      text(id, 'Sənəd'),
    );
    if (!old) throw new Error('Aktiv istifadə sənədi tapılmadı.');
    const why = text(reason, 'Ləğv səbəbi');
    this.reverseSource(companyId, 'issue', id, 1);
    this.hooks.reverse(companyId, 'issue', id, 1, why);
    this.run("UPDATE stock_issues SET status='cancelled' WHERE id=?", id);
    this.hooks.audit(companyId, 'Ləğv edildi', 'Material istifadəsi', why);
    return { id };
  }
  commission(companyId: string, raw: AssetCommissionInput) {
    const a = this.one(
      'SELECT * FROM assets WHERE company_id=? AND id=?',
      companyId,
      text(raw.id, 'İnventar kartı'),
    );
    if (!a || a.status === 'cancelled') throw new Error('Aktiv inventar kartı tapılmadı.');
    const d = date(raw.date),
      number = text(raw.inventoryNumber, 'İnventar nömrəsi', 80).toUpperCase(),
      location = text(raw.location, 'Yerləşdiyi yer', 150),
      responsible = text(raw.responsible, 'Məsul şəxs', 150),
      months = raw.usefulLifeMonths;
    if (!Number.isSafeInteger(months) || months < 1 || months > 1200)
      throw new Error('Faydalı istifadə müddəti 1–1200 ay olmalıdır.');
    if (d < String(a.acquired_date)) throw new Error('İstismar tarixi alışdan əvvəl ola bilməz.');
    if (a.status === 'active') {
      if (
        a.commissioned_date === d &&
        a.inventory_number === number &&
        a.location === location &&
        a.responsible === responsible &&
        Number(a.useful_life_months) === months
      )
        return { id: raw.id, unchanged: 1 };
      throw new Error('Əsas vəsait artıq istismara verilib.');
    }
    if (
      this.one(
        'SELECT id FROM assets WHERE company_id=? AND inventory_number=? AND id!=?',
        companyId,
        number,
        raw.id,
      )
    )
      throw new Error('İnventar nömrəsi təkrarlanır.');
    this.hooks.open(companyId, d);
    this.chronology(companyId, String(a.product_id), String(a.warehouse_id), 'asset', d, true);
    const cost = Number(a.cost),
      version = Number(a.commission_version) + 1;
    const available = this.balance(
      companyId,
      String(a.product_id),
      String(a.warehouse_id),
      'asset',
    );
    if (available.quantity < QUANTITY_SCALE || available.value < cost)
      throw new Error('Əsas vəsaitin anbar qalığı kifayət deyil.');
    this.movement(
      companyId,
      String(a.invoice_id),
      'asset',
      raw.id,
      number,
      version,
      0,
      d,
      String(a.product_id),
      String(a.warehouse_id),
      'asset',
      -QUANTITY_SCALE,
      -cost,
    );
    this.hooks.post(companyId, {
      date: d,
      type: 'asset',
      id: raw.id,
      number,
      version,
      reversal: 0,
      description: 'Əsas vəsait istismara verildi',
      lines: [
        { account: '111', subaccount: number, debit: cost, credit: 0 },
        { account: '113', subaccount: number, debit: 0, credit: cost },
      ],
    });
    this.run(
      "UPDATE assets SET status='active',commission_version=?,commissioned_date=?,inventory_number=?,location=?,responsible=?,useful_life_months=? WHERE id=?",
      version,
      d,
      number,
      location,
      responsible,
      months,
      raw.id,
    );
    this.hooks.audit(companyId, 'İstismara verildi', 'Əsas vəsait', number);
    return { id: raw.id, updated: 1 };
  }
  cancelCommission(companyId: string, id: string, reason: string) {
    const a = this.one(
      "SELECT * FROM assets WHERE company_id=? AND id=? AND status='active'",
      companyId,
      text(id, 'İnventar kartı'),
    );
    if (!a) throw new Error('İstismarda olan inventar kartı tapılmadı.');
    const why = text(reason, 'Ləğv səbəbi'),
      version = Number(a.commission_version);
    this.reverseSource(companyId, 'asset', id, version);
    this.hooks.reverse(companyId, 'asset', id, version, why);
    this.run("UPDATE assets SET status='pending',commissioned_date='' WHERE id=?", id);
    this.hooks.audit(
      companyId,
      'İstismar ləğv edildi',
      'Əsas vəsait',
      String(a.inventory_number) + ' · ' + why,
    );
    return { id };
  }
  read(companyId: string, from: string, to: string): InventoryState {
    const units = this.all(
      'SELECT id,name FROM units ORDER BY name',
    ) as unknown as InventoryState['units'];
    const warehouses = this.all(
      'SELECT id,name FROM warehouses WHERE company_id=? ORDER BY name',
      companyId,
    ) as unknown as InventoryState['warehouses'];
    const products = this.all(
      'SELECT p.*,u.name AS base_name,v.name AS purchase_name FROM products p JOIN units u ON u.id=p.base_unit_id JOIN units v ON v.id=p.purchase_unit_id WHERE company_id=? ORDER BY p.name',
      companyId,
    ).map((p) => ({
      id: String(p.id),
      code: String(p.code),
      name: String(p.name),
      group: String(p.group_name),
      barcode: String(p.barcode),
      baseUnitId: String(p.base_unit_id),
      purchaseUnitId: String(p.purchase_unit_id),
      factor: unscaled(Number(p.factor)),
      category: p.category as ItemCategory,
      baseUnitName: String(p.base_name),
      purchaseUnitName: String(p.purchase_name),
    }));
    const stock = this.all(
      `SELECT m.product_id,m.warehouse_id,m.category,p.code,p.name,w.name AS warehouse_name,u.name AS unit_name,SUM(m.quantity) AS q,SUM(m.value) AS v FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id JOIN units u ON u.id=p.base_unit_id WHERE m.company_id=? AND m.date<=? GROUP BY m.product_id,m.warehouse_id,m.category HAVING SUM(m.quantity)!=0 OR SUM(m.value)!=0 ORDER BY p.name,w.name`,
      companyId,
      to,
    ).map((r) => ({
      id: r.product_id + ':' + r.warehouse_id + ':' + r.category,
      productId: String(r.product_id),
      productCode: String(r.code),
      productName: String(r.name),
      warehouseId: String(r.warehouse_id),
      warehouseName: String(r.warehouse_name),
      category: r.category as ItemCategory,
      unitName: String(r.unit_name),
      quantity: unscaled(Number(r.q)),
      valueCents: safe(Number(r.v)),
    }));
    const stockMovements = this.all(
      `SELECT m.*,p.name AS product_name,w.name AS warehouse_name,u.name AS unit_name FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id JOIN units u ON u.id=p.base_unit_id WHERE m.company_id=? AND m.date>=? AND m.date<=? ORDER BY m.date DESC,m.rowid DESC LIMIT 1000`,
      companyId,
      from,
      to,
    ).map((r) => ({
      id: String(r.id),
      date: String(r.date),
      productName: String(r.product_name),
      warehouseName: String(r.warehouse_name),
      category: r.category as ItemCategory,
      unitName: String(r.unit_name),
      quantity: unscaled(Number(r.quantity)),
      valueCents: safe(Number(r.value)),
      sourceType: String(r.source_type),
      sourceId: String(r.source_id),
      sourceNumber: String(r.source_number),
      reversal: Number(r.reversal),
    }));
    const assets = this.all(
      `SELECT a.*,p.name AS product_name,w.name AS warehouse_name,i.number AS invoice_number FROM assets a JOIN products p ON p.id=a.product_id JOIN warehouses w ON w.id=a.warehouse_id JOIN invoices i ON i.id=a.invoice_id WHERE a.company_id=? ORDER BY a.acquired_date DESC,a.rowid DESC`,
      companyId,
    ).map((a) => ({
      id: String(a.id),
      invoiceId: String(a.invoice_id),
      invoiceNumber: String(a.invoice_number),
      productName: String(a.product_name),
      warehouseName: String(a.warehouse_name),
      inventoryNumber: String(a.inventory_number),
      costCents: Number(a.cost),
      acquiredDate: String(a.acquired_date),
      status: a.status as 'pending' | 'active' | 'cancelled',
      commissionedDate: String(a.commissioned_date),
      location: String(a.location),
      responsible: String(a.responsible),
      usefulLifeMonths: Number(a.useful_life_months),
    }));
    return { units, products, warehouses, stock, stockMovements, assets };
  }
}
