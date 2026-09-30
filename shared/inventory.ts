export type ItemCategory = 'goods' | 'material' | 'asset';
export const categoryNames: Record<ItemCategory, string> = {
  goods: 'Satış üçün mal',
  material: 'Material / sərfiyyat',
  asset: 'Əsas vəsait',
};
export type InventoryAccount = '205' | '201' | '113';
export const categoryAccounts: Record<ItemCategory, InventoryAccount> = {
  goods: '205',
  material: '201',
  asset: '113',
};
export const inventoryAccounts: { code: InventoryAccount; name: string; category: ItemCategory }[] =
  [
    { code: '205', name: 'Mallar', category: 'goods' },
    { code: '201', name: 'Material ehtiyatları', category: 'material' },
    { code: '113', name: 'Əsas vəsait üzrə kapitallaşdırılan məsrəflər', category: 'asset' },
  ];
/** Category is retained for compatibility with existing stock registers. */
export function resolveInventoryAccount(
  account: unknown,
  category: ItemCategory,
): InventoryAccount {
  if (!Object.hasOwn(categoryAccounts, category)) throw new Error('Uçot hesabı seçilməlidir.');
  const expected = categoryAccounts[category];
  if (account !== undefined && account !== expected)
    throw new Error('Uçot hesabı nomenklaturanın uçot növünə uyğun deyil.');
  return expected;
}
export interface Unit {
  id: string;
  name: string;
}
export interface ProductInput {
  account?: InventoryAccount;
  id?: string;
  code: string;
  name: string;
  group: string;
  barcode: string;
  baseUnitId: string;
  purchaseUnitId: string;
  factor: string;
  category: ItemCategory;
}
export interface Product extends ProductInput {
  account: InventoryAccount;
  id: string;
  baseUnitName: string;
  purchaseUnitName: string;
}
export interface Warehouse {
  id: string;
  name: string;
}
export interface InvoiceItemInput {
  account?: InventoryAccount;
  productId: string;
  warehouseId: string;
  category: ItemCategory;
  unitId: string;
  quantity: string;
  unitPrice: string;
  vat: string;
}
export interface InvoiceItem extends InvoiceItemInput {
  account: InventoryAccount;
  productName: string;
  productCode: string;
  unitName: string;
  baseUnitName: string;
  baseQuantity: string;
  netCents: number;
  vatCents: number;
}
export interface StockBalance {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  category: ItemCategory;
  unitName: string;
  quantity: string;
  valueCents: number;
}
export interface StockMovement {
  id: string;
  date: string;
  productName: string;
  warehouseName: string;
  category: ItemCategory;
  unitName: string;
  quantity: string;
  valueCents: number;
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  reversal: number;
}
export interface Asset {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  productName: string;
  warehouseName: string;
  inventoryNumber: string;
  costCents: number;
  acquiredDate: string;
  status: 'pending' | 'active' | 'cancelled';
  commissionedDate: string;
  location: string;
  responsible: string;
  usefulLifeMonths: number;
}
export interface StockIssueInput {
  reference: string;
  date: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  subaccount: string;
}
export interface AssetCommissionInput {
  id: string;
  date: string;
  inventoryNumber: string;
  location: string;
  responsible: string;
  usefulLifeMonths: number;
}
export interface InventoryState {
  units: Unit[];
  products: Product[];
  warehouses: Warehouse[];
  stock: StockBalance[];
  stockMovements: StockMovement[];
  assets: Asset[];
}
