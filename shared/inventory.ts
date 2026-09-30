export type ItemCategory = 'goods' | 'material' | 'asset';
export const categoryNames: Record<ItemCategory, string> = {
  goods: 'Satış üçün mal',
  material: 'Material / sərfiyyat',
  asset: 'Əsas vəsait',
};
export const categoryAccounts: Record<ItemCategory, string> = {
  goods: '205',
  material: '201',
  asset: '113',
};
export interface Unit {
  id: string;
  name: string;
}
export interface ProductInput {
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
  id: string;
  baseUnitName: string;
  purchaseUnitName: string;
}
export interface Warehouse {
  id: string;
  name: string;
}
export interface InvoiceItemInput {
  productId: string;
  warehouseId: string;
  category: ItemCategory;
  unitId: string;
  quantity: string;
  unitPrice: string;
  vat: string;
}
export interface InvoiceItem extends InvoiceItemInput {
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
