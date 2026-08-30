import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');

const html = read('ksp-stock-market/index.html');
assert.match(html, /stability-v3\.js/, 'unified stability layer must be loaded');
for (const path of [
  'ksp-stock-market/index.html',
  'ksp-stock-market/styles.css',
  'ksp-stock-market/supabase-config.js',
  'ksp-stock-market/market-data.json',
  'ksp-stock-market/stability-v3.js'
]) assert.ok(fs.existsSync(new URL(path, root)), 'missing ' + path);

const market = JSON.parse(read('ksp-stock-market/market-data.json'));
assert.ok(Array.isArray(market.companies), 'companies must be an array');
const jsa = market.companies.find(c => c.ticker === 'JSA');
assert.ok(jsa, 'JSA must be listed');
assert.ok((jsa.relatedMembers || []).includes('Agus'), 'JSA must keep Agus as related member');

const workflow = read('.github/workflows/ksp-market-daily.yml');
assert.match(workflow, /cron:\s*['"]\*\/5 \* \* \* \*['"]/, 'Discord market workflow must poll every 5 minutes');

console.log('KSP Market T/E smoke checks: PASS');
