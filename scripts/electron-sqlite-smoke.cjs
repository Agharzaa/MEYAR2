// Runs with the Electron binary and ELECTRON_RUN_AS_NODE=1 on Windows CI.
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE smoke (amount INTEGER NOT NULL); INSERT INTO smoke VALUES (11800);');
assert.equal(db.prepare('SELECT amount FROM smoke').get().amount, 11800);
db.close();
console.log(`Electron ${process.versions.electron}; Node ${process.versions.node}: node:sqlite OK`);
import('../dist/main/core/database.js')
  .then(({ Store }) => {
    const store = new Store(':memory:');
    const result = store.call({ op: 'company.create', name: 'Runtime smoke', taxId: '1234567890' });
    assert.ok(result.id);
    store.close();
    console.log('Meyar Store migrations and transaction: OK');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
