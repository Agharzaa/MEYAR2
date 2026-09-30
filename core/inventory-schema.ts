export const unitSeeds=[['pcs','Ədəd'],['l','Litr'],['kg','Kq'],['m','Metr'],['m2','m²'],['pair','Cüt'],['set','Dəst'],['box','Qutu'],['ton','Ton'],['m3','m³']] as const;
export const inventorySchema=`
CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),code TEXT NOT NULL,name TEXT NOT NULL,group_name TEXT NOT NULL,barcode TEXT NOT NULL,base_unit_id TEXT NOT NULL REFERENCES units(id),purchase_unit_id TEXT NOT NULL REFERENCES units(id),factor INTEGER NOT NULL CHECK(typeof(factor)='integer' AND factor>0),category TEXT NOT NULL CHECK(category IN('goods','material','asset')),UNIQUE(company_id,code));
CREATE UNIQUE INDEX IF NOT EXISTS product_barcode ON products(company_id,barcode) WHERE barcode!='';
CREATE TABLE IF NOT EXISTS warehouses(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),name TEXT NOT NULL,UNIQUE(company_id,name));
CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),invoice_id TEXT REFERENCES invoices(id),source_type TEXT NOT NULL,source_id TEXT NOT NULL,source_number TEXT NOT NULL,version INTEGER NOT NULL,line INTEGER NOT NULL,date TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),category TEXT NOT NULL CHECK(category IN('goods','material','asset')),quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity!=0),value INTEGER NOT NULL CHECK(typeof(value)='integer'),reversal INTEGER NOT NULL CHECK(reversal IN(0,1)),UNIQUE(company_id,source_type,source_id,version,line,reversal));
CREATE INDEX IF NOT EXISTS stock_balance ON stock_movements(company_id,product_id,warehouse_id,category,date);
CREATE TABLE IF NOT EXISTS stock_issues(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),reference TEXT NOT NULL,date TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('posted','cancelled')),UNIQUE(company_id,reference));
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),invoice_id TEXT NOT NULL REFERENCES invoices(id),invoice_version INTEGER NOT NULL,line INTEGER NOT NULL,ordinal INTEGER NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),inventory_number TEXT NOT NULL,cost INTEGER NOT NULL CHECK(typeof(cost)='integer' AND cost>0),acquired_date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','active','cancelled')),commission_version INTEGER NOT NULL DEFAULT 0,commissioned_date TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',responsible TEXT NOT NULL DEFAULT '',useful_life_months INTEGER NOT NULL DEFAULT 0,UNIQUE(company_id,inventory_number),UNIQUE(invoice_id,invoice_version,line,ordinal));
CREATE TRIGGER IF NOT EXISTS stock_immutable_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT,'Anbar hərəkəti dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS stock_immutable_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT,'Anbar hərəkəti silinə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS stock_tenant_insert BEFORE INSERT ON stock_movements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id) OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND company_id=NEW.company_id) THEN RAISE(ABORT,'Nomenklatura və anbar şirkətə uyğun deyil') END;
 SELECT CASE WHEN NEW.invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND company_id=NEW.company_id) THEN RAISE(ABORT,'Anbar qaiməsi şirkətə uyğun deyil') END;
 SELECT CASE WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
END;
CREATE TRIGGER IF NOT EXISTS product_tenant_update BEFORE UPDATE ON products BEGIN
 SELECT CASE WHEN NEW.company_id!=OLD.company_id THEN RAISE(ABORT,'Nomenklatura şirkəti dəyişdirilə bilməz') END;
 SELECT CASE WHEN NEW.base_unit_id!=OLD.base_unit_id AND EXISTS(SELECT 1 FROM stock_movements WHERE product_id=OLD.id) THEN RAISE(ABORT,'Hərəkəti olan nomenklaturanın əsas vahidi dəyişdirilə bilməz') END;
END;
CREATE TRIGGER IF NOT EXISTS product_conversion_update BEFORE UPDATE OF purchase_unit_id,factor ON products
WHEN (NEW.purchase_unit_id!=OLD.purchase_unit_id OR NEW.factor!=OLD.factor) AND EXISTS(SELECT 1 FROM stock_movements WHERE product_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'Hərəkəti olan nomenklaturanın alış vahidi və çevirmə əmsalı dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS warehouse_tenant_update BEFORE UPDATE OF company_id ON warehouses WHEN NEW.company_id!=OLD.company_id BEGIN SELECT RAISE(ABORT,'Anbar şirkəti dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS asset_tenant_insert BEFORE INSERT ON assets BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id) OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND company_id=NEW.company_id) OR NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND company_id=NEW.company_id) THEN RAISE(ABORT,'İnventar kartı şirkətə uyğun deyil') END;
END;
CREATE TRIGGER IF NOT EXISTS asset_tenant_update BEFORE UPDATE ON assets BEGIN
 SELECT CASE WHEN NEW.company_id!=OLD.company_id OR NEW.product_id!=OLD.product_id OR NEW.warehouse_id!=OLD.warehouse_id OR NEW.invoice_id!=OLD.invoice_id OR NEW.cost!=OLD.cost THEN RAISE(ABORT,'İnventar kartının mənbəyi dəyişdirilə bilməz') END;
END;
INSERT OR IGNORE INTO warehouses(id,company_id,name) SELECT 'default:'||id,id,'Əsas anbar' FROM companies;
PRAGMA user_version=3;
`;
