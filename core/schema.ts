export const accounts = [
  ['205', 'Mallar'],
  ['211', 'Alıcı və sifarişçilərin borcları'],
  ['221', 'Kassa'],
  ['223', 'Bank hesabları'],
  ['224.04', 'ƏDV depozit hesabı'],
  ['241', 'Alış üzrə ƏDV'],
  ['422', 'Alınmış avanslar'],
  ['521', 'Vergi öhdəlikləri'],
  ['531', 'Malsatan və podratçılara borclar'],
  ['545', 'Satış üzrə ƏDV'],
  ['601', 'Satış gəliri'],
  ['701', 'Satışın maya dəyəri'],
  ['721', 'İnzibati xərclər'],
] as const;
export const schema = `
CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,tax_id TEXT NOT NULL UNIQUE,closed_through TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS partners(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),name TEXT NOT NULL,tax_id TEXT NOT NULL,UNIQUE(company_id,tax_id));
CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),partner_id TEXT NOT NULL REFERENCES partners(id),number TEXT NOT NULL,date TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN('purchase','sale')),net INTEGER NOT NULL CHECK(net>0),vat INTEGER NOT NULL CHECK(vat>=0),version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('posted','cancelled')),input TEXT NOT NULL,UNIQUE(company_id,partner_id,number,direction));
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),partner_id TEXT NOT NULL REFERENCES partners(id),invoice_id TEXT REFERENCES invoices(id),reference TEXT NOT NULL,date TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN('in','out')),bank_account TEXT NOT NULL CHECK(bank_account IN('223','224.04')),amount INTEGER NOT NULL CHECK(amount>0),status TEXT NOT NULL CHECK(status IN('posted','cancelled')),input TEXT NOT NULL,UNIQUE(company_id,reference,direction,bank_account));
CREATE TABLE IF NOT EXISTS journals(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),date TEXT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,source_number TEXT NOT NULL,version INTEGER NOT NULL,reversal INTEGER NOT NULL CHECK(reversal IN(0,1)),description TEXT NOT NULL,UNIQUE(company_id,source_type,source_id,version,reversal));
CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,journal_id TEXT NOT NULL REFERENCES journals(id),account TEXT NOT NULL,partner_id TEXT REFERENCES partners(id),subaccount TEXT NOT NULL,debit INTEGER NOT NULL CHECK(debit>=0),credit INTEGER NOT NULL CHECK(credit>=0),CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id TEXT NOT NULL REFERENCES companies(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),action TEXT NOT NULL,entity TEXT NOT NULL,description TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS journals_report ON journals(company_id,date);
CREATE INDEX IF NOT EXISTS entries_journal ON entries(journal_id);
CREATE INDEX IF NOT EXISTS entries_account ON entries(account,partner_id);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments(company_id,invoice_id,status);
CREATE TRIGGER IF NOT EXISTS journal_immutable_update BEFORE UPDATE ON journals BEGIN SELECT RAISE(ABORT,'Jurnal dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS journal_immutable_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT,'Jurnal silinə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS entry_immutable_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT,'Yazılış dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS entry_immutable_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT,'Yazılış silinə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS audit_immutable_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS audit_immutable_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit silinə bilməz'); END;
-- Defense in depth: references must belong to the same company, even when a
-- future writer bypasses the application-level validation.
CREATE TRIGGER IF NOT EXISTS invoice_tenant_insert BEFORE INSERT ON invoices BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partners WHERE id=NEW.partner_id AND company_id=NEW.company_id) THEN RAISE(ABORT,'Kontragent şirkətə uyğun deyil') END;
 SELECT CASE WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
 SELECT CASE WHEN typeof(NEW.net)!='integer' OR typeof(NEW.vat)!='integer' OR NEW.net>900000000000 OR NEW.vat>900000000000 THEN RAISE(ABORT,'Məbləğ düzgün deyil') END;
END;
CREATE TRIGGER IF NOT EXISTS invoice_tenant_update BEFORE UPDATE ON invoices BEGIN
 SELECT CASE WHEN NEW.company_id!=OLD.company_id OR NOT EXISTS(SELECT 1 FROM partners WHERE id=NEW.partner_id AND company_id=NEW.company_id) THEN RAISE(ABORT,'Kontragent şirkətə uyğun deyil') END;
 SELECT CASE WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id) OR NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
 SELECT CASE WHEN typeof(NEW.net)!='integer' OR typeof(NEW.vat)!='integer' OR NEW.net>900000000000 OR NEW.vat>900000000000 THEN RAISE(ABORT,'Məbləğ düzgün deyil') END;
END;
CREATE TRIGGER IF NOT EXISTS payment_tenant_insert BEFORE INSERT ON payments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partners WHERE id=NEW.partner_id AND company_id=NEW.company_id) THEN RAISE(ABORT,'Kontragent şirkətə uyğun deyil') END;
 SELECT CASE WHEN NEW.invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND company_id=NEW.company_id AND partner_id=NEW.partner_id AND status='posted' AND direction=CASE NEW.direction WHEN 'in' THEN 'sale' ELSE 'purchase' END AND date<=NEW.date) THEN RAISE(ABORT,'Qaimə ödənişə uyğun deyil') END;
 SELECT CASE WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
 SELECT CASE WHEN typeof(NEW.amount)!='integer' OR NEW.amount>900000000000 THEN RAISE(ABORT,'Məbləğ düzgün deyil') END;
END;
CREATE TRIGGER IF NOT EXISTS payment_tenant_update BEFORE UPDATE ON payments BEGIN
 SELECT CASE WHEN NEW.company_id!=OLD.company_id OR NEW.partner_id!=OLD.partner_id OR NEW.invoice_id IS NOT OLD.invoice_id OR NEW.reference!=OLD.reference OR NEW.date!=OLD.date OR NEW.direction!=OLD.direction OR NEW.bank_account!=OLD.bank_account OR NEW.amount!=OLD.amount OR NEW.input!=OLD.input THEN RAISE(ABORT,'Ödəniş yalnız ləğv edilə bilər') END;
 SELECT CASE WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
END;
CREATE TRIGGER IF NOT EXISTS journal_period_insert BEFORE INSERT ON journals BEGIN
 SELECT CASE WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
END;
CREATE TRIGGER IF NOT EXISTS entry_tenant_insert BEFORE INSERT ON entries BEGIN
 SELECT CASE WHEN NEW.partner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM partners p JOIN journals j ON j.company_id=p.company_id WHERE p.id=NEW.partner_id AND j.id=NEW.journal_id) THEN RAISE(ABORT,'Yazılışın kontragent şirkəti uyğun deyil') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM journals j JOIN companies c ON c.id=j.company_id WHERE j.id=NEW.journal_id AND j.date<=c.closed_through) THEN RAISE(ABORT,'Uçot dövrü bağlanıb') END;
 SELECT CASE WHEN typeof(NEW.debit)!='integer' OR typeof(NEW.credit)!='integer' OR NEW.debit>9007199254740991 OR NEW.credit>9007199254740991 THEN RAISE(ABORT,'Məbləğ düzgün deyil') END;
 SELECT CASE WHEN NEW.account NOT IN (${accounts.map(([code]) => `'${code}'`).join(',')}) THEN RAISE(ABORT,'Hesab tapılmadı') END;
END;
CREATE TRIGGER IF NOT EXISTS company_period_update BEFORE UPDATE OF closed_through ON companies WHEN NEW.closed_through<OLD.closed_through BEGIN SELECT RAISE(ABORT,'Bağlanmış dövr açıla bilməz'); END;
CREATE TRIGGER IF NOT EXISTS partner_tenant_update BEFORE UPDATE OF company_id ON partners WHEN NEW.company_id!=OLD.company_id BEGIN SELECT RAISE(ABORT,'Kontragent şirkəti dəyişdirilə bilməz'); END;
CREATE TRIGGER IF NOT EXISTS invoice_immutable_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'Qaimə yalnız ləğv edilə bilər'); END;
CREATE TRIGGER IF NOT EXISTS payment_immutable_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,'Ödəniş yalnız ləğv edilə bilər'); END;
PRAGMA user_version=2;
`;
