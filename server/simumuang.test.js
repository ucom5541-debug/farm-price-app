import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
const fixtures = JSON.parse(fs.readFileSync(new URL('./simumuang.fixtures.json', import.meta.url), 'utf8')).products;
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing server section: ${start}`);
  return source.slice(from, to);
}
const context = vm.createContext({ console: { log() {} }, process: { env: {} } });
vm.runInContext([
  section('function bangkokDate(', 'function savePriceHistory('),
  section('const CROPS =', 'const SRIMUANG_URL'),
  section('function round2(', 'function average('),
  section('const SIMUMUANG_PRODUCTS =', 'let simuMuangItemsCache'),
  section('function getSimumuangPriceFromItems(', 'async function getCropMarketData('),
  'globalThis.api = { CROPS, SIMUMUANG_PRODUCTS, getSimumuangPriceFromItems, getSimumuangRange, inspectSimumuangPrices };',
].join('\n'), context);
const { CROPS, SIMUMUANG_PRODUCTS: catalog, getSimumuangPriceFromItems: select,
  getSimumuangRange: range, inspectSimumuangPrices: inspect } = context.api;
const copy = (value) => JSON.parse(JSON.stringify(value));
const product = (key, price = { small: { min: 20, max: 30 } }) => ({
  ...copy(fixtures.find((item) => item._id === catalog[CROPS[key].name][0].id)),
  price: price && { updatedAt: '2026-11-04T01:00:00Z', action_date: '2026-11-04T01:05:00Z', ...price },
});
// Legacy scenarios explicitly choose test sizes; production defaults are tested separately below.
const chosen = (key, extra = {}) => ({ ...CROPS[key],
  simummuangProductId: catalog[CROPS[key].name][0].id, simummuangSize: 'small', ...extra });
const status = (price, size = 'small') => inspect({ price }).find((entry) => entry.size === size).status;

// The 32 original regression scenarios, updated for the intentional strict policy:
// unknown endpoints, merged sizes and automatic identity selection are no longer accepted.
assert.equal(Object.keys(CROPS).length, 10);
for (const key of Object.keys(CROPS)) {
  test(`supported crop: ${key}`, () => {
    const item = product(key);
    const result = select(chosen(key), [item]);
    assert.equal(result.available, true);
    assert.equal(result.productId, item._id);
    assert.equal(result.productName, item.th.name);
    assert.equal(result.min, 20);
    assert.equal(result.max, 30);
    assert.equal(result.mid, 25);
    assert.equal(result.selectedSize, 'small');
    assert.equal(result.unit, 'บาท/กก.');
  });
}
test('skip invalid sizes while preserving a valid size', () => {
  const item = product('kale', { small: { min: 0, max: 20 }, large: { min: 40, max: 50 } });
  const result = select(chosen('kale', { simummuangSize: 'large' }), [item]);
  assert.equal(result.selectedSize, 'large');
  assert.equal(result.mid, 45);
  assert.equal(result.sizes[0].status, 'incomplete_range');
});
test('duplicate product ids are rejected rather than selecting first', () => {
  assert.equal(select(chosen('kale'), [product('kale'), product('kale')]).status, 'duplicate_product');
});
test('specific fresh chili identity excludes broad and dried products', () => {
  const item = product('chili');
  assert.equal(select(chosen('chili'), [{ ...item, _id: 'other', th: { name: 'พริกจินดาแห้ง' } }, item]).productId, item._id);
});
test('a product id with a changed name is rejected', () => {
  assert.equal(select(chosen('kale'), [{ ...product('kale'), th: { name: 'ยอดคะน้า' } }]).status, 'product_identity_mismatch');
});
test('shallot never selects red onion', () => {
  assert.equal(select(chosen('shallot'), [{ ...product('shallot'), th: { name: 'หอมแดง' } }]).available, false);
});
test('celery uses verified identity, not spelling alone', () => {
  assert.equal(select(chosen('celery'), [product('celery')]).available, true);
  assert.equal(select(chosen('celery'), [{ ...product('celery'), th: { name: 'คึ่นช่าย' } }]).available, false);
});
test('missing, invalid, zero and negative prices are rejected', () => {
  for (const price of [undefined, null, {}, { small: { min: 'bad', max: null } },
    { small: { min: 0, max: -1 } }, { small: { min: Infinity, max: NaN } }]) {
    const item = { ...product('kale'), price };
    assert.equal(range(item), null);
    assert.equal(select(chosen('kale'), [item]).status, 'selected_size_unavailable');
  }
});
test('nested numeric strings stay supported but different sizes are not merged', () => {
  const item = product('kale', { small: { min: '20', max: '30' }, large: { min: 40, max: 50 } });
  assert.equal(range(item), null);
  assert.equal(range(item, 'small').max, 30);
  assert.equal(range(item, 'large').min, 40);
});
test('unconfirmed flat and numeric-size formats remain unsupported', () => {
  assert.equal(range({ price: { min: 20, max: 30 } }), null);
  assert.equal(range({ price: { small: 20, medium: 25, large: 30 } }), null);
});
test('existing variety exclusions remain intact', () => {
  for (const [key, name] of [['cucumber', 'แตงกวาญี่ปุ่น'], ['coriander', 'ผักชีฝรั่ง'], ['morningglory', 'ผักบุ้งไทย']]) {
    assert.equal(select(chosen(key), [{ ...product(key), th: { name } }]).available, false);
  }
});
test('empty or unrelated items return product-not-found', () => {
  for (const items of [[], [null, {}, { name: 123 }]]) {
    assert.equal(select(chosen('kale'), items).status, 'selected_product_not_found');
  }
});
for (const [label, value] of [['true', true], ['false', false], ['null', null], ['empty string', ''], ['whitespace', ' \t\n ']]) {
  test(`reject price value: ${label}`, () => {
    for (const size of ['small', 'medium', 'large']) {
      const item = product('kale', { [size]: { min: value, max: value } });
      assert.equal(range(item), null);
      assert.equal(select(chosen('kale'), [item]).available, false);
      for (const endpoints of [{ min: value, max: 30 }, { min: 30, max: value }]) {
        assert.equal(range(product('kale', { [size]: endpoints })), null);
      }
    }
  });
}
for (const value of [1, 20.5, '1', '20.50', ' 20.50 ']) {
  test(`accept existing numeric price: ${JSON.stringify(value)}`, () => {
    for (const size of ['small', 'medium', 'large']) {
      const item = product('kale', { [size]: { min: value, max: value } });
      assert.equal(range(item).min, Number(value));
      assert.equal(range(item).max, Number(value));
      assert.equal(select(chosen('kale', { simummuangSize: size }), [item]).mid, Number(value));
    }
  });
}
test('do not coerce arrays or objects into prices', () => {
  for (const value of [[20], { valueOf: () => 20 }]) {
    assert.equal(range({ price: { small: { min: value, max: value } } }), null);
  }
});

for (const [min, max, expected] of [[30, 20, 'invalid_range'], [0, 20, 'incomplete_range'],
  [20, 0, 'incomplete_range'], [0, 0, 'missing_price'], [20, 30, 'valid']]) {
  test(`classify original range ${min}/${max}`, () => {
    const price = { small: { min, max } };
    assert.equal(status(price), expected);
    const entry = inspect({ price })[0];
    assert.equal(entry.raw.min, min);
    assert.equal(entry.raw.max, max);
    assert.equal(price.small.min, min);
    if (expected !== 'valid') assert.equal(entry.min, null);
  });
}
test('size choice must be explicit if multiple sizes are valid', () => {
  const item = product('kale', { small: { min: 20, max: 30 }, large: { min: 40, max: 50 } });
  assert.equal(select(chosen('kale', { simummuangSize: undefined }), [item]).status, 'size_selection_required');
  const result = select(chosen('kale', { simummuangSize: 'large' }), [item]);
  assert.equal(result.min, 40);
  assert.equal(result.max, 50);
  assert.equal(result.sizes.length, 3);
});
test('no fallback to another size when a confirmed size is invalid', () => {
  const item = product('kale', { small: { min: 30, max: 20 }, large: { min: 40, max: 50 } });
  assert.equal(select(chosen('kale', { simummuangSize: 'small' }), [item]).available, false);
});
test('primary products are explicitly confirmed with large defaults in crop settings', () => {
  for (const key of Object.keys(CROPS)) {
    const identity = catalog[CROPS[key].name][0];
    assert.equal(CROPS[key].simummuangProductId, identity.id);
    assert.equal(CROPS[key].simummuangProductName, identity.name);
    assert.equal(CROPS[key].simummuangSize, 'large');
    assert.equal(select(CROPS[key], [product(key)]).status, 'selected_size_unavailable');
  }
});
test('no substitution for a confirmed primary with an invalid price', () => {
  const options = catalog[CROPS.kale.name];
  const second = copy(fixtures.find((item) => item._id === options[1].id));
  second.price = { large: { min: 40, max: 50 } };
  assert.equal(select(chosen('kale'), [product('kale', {}), second]).status, 'selected_size_unavailable');
});
test('reject piece prices and missing or conflicting unit labels', () => {
  for (const unit of [null, { th: { name: 'ชิ้น' }, en: { name: 'piece' } },
    { th: { name: 'ชิ้น' }, en: { name: 'kg' } }]) {
    assert.equal(select(chosen('chili'), [{ ...product('chili'), prod_unit_id: unit }]).status, 'unsupported_unit');
  }
});
test('isShow false is retained and does not reject a validated price', () => {
  const item = product('shallot'); item.isShow = false;
  const result = select(chosen('shallot'), [item]);
  assert.equal(result.available, true);
  assert.equal(result.isShow, false);
  assert.equal(result.updatedAt, item.price.updatedAt ?? null);
  assert.equal(result.action_date, item.price.action_date ?? null);
});
for (const key of Object.keys(CROPS)) {
  test(`captured real API fixture: ${key}`, () => {
    const item = fixtures.find((entry) => entry._id === chosen(key).simummuangProductId);
    const original = JSON.stringify(item);
    const result = select(CROPS[key], [item]);
    const large = item.price.large;
    assert.equal(result.available, large.min > 0 && large.min <= large.max);
    assert.equal(JSON.stringify(item), original);
    assert.equal(result.candidates[0].sizes[2].raw.min, large.min);
    if (large.min > large.max) assert.equal(result.candidates[0].sizes[2].status, 'invalid_range');
  });
}

// Load real server handlers into a sandbox: never opens a port, calls the network,
// reads production history. History writes are restricted to unique temporary files.
// Exercise real filesystem lock/fsync/rename operations without opening network ports.
const testDirectories = [];
after(() => { for (const directory of testDirectories) fs.rmSync(directory, { recursive: true, force: true }); });
async function sandbox(respond, clock = { now: Date.parse('2026-11-04T06:00:00Z') }, initialHistory = [], policyEnv = {}, sharedHistory = null) {
  let handler;
  let calls = 0;
  let writes = 0;
  let failureStage = null;
  const directory = sharedHistory ? new URL('./', sharedHistory) : pathToFileURL(fs.mkdtempSync('/tmp/farm-history-test-') + '/');
  if (!sharedHistory) testDirectories.push(directory);
  const historyFile = sharedHistory || new URL('price-history.json', directory);
  if (!sharedHistory) fs.writeFileSync(historyFile, JSON.stringify(initialHistory), 'utf8');
  const mockedFs = {
    ...fs,
    readFileSync: (file, ...args) => String(file).endsWith('.pem') ? '' : fs.readFileSync(file, ...args),
    openSync: (file, ...args) => {
      if (failureStage === 'open' && String(file).endsWith('.tmp')) throw Error('mock open failure');
      return fs.openSync(file, ...args);
    },
    writeFileSync: (...args) => {
      if (failureStage === 'write') throw Error('mock disk failure');
      return fs.writeFileSync(...args);
    },
    fsyncSync: (...args) => {
      if (failureStage === 'fsync') throw Error('mock fsync failure');
      return fs.fsyncSync(...args);
    },
    renameSync: (...args) => {
      if (failureStage === 'rename') throw Error('mock rename failure');
      const result = fs.renameSync(...args); writes++; return result;
    },
  };
  const ctx = vm.createContext({ URL, AbortSignal, randomUUID,
    Date: class extends Date { static now() { return clock.now; } },
    console: { log() {}, error() {}, warn() {} },
    process: { env: policyEnv, argv: [], pid: process.pid }, tls: { rootCertificates: [] }, Agent: class {},
    fs: mockedFs,
    http: { createServer(fn) { handler = fn; return { listen() {} }; } },
    setTimeout: (fn) => { fn(); },
    fetch: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, 'https://api.simummuangmarket.com/api/app/products');
      assert.equal(parsed.searchParams.get('limit'), '20');
      assert.deepEqual([...parsed.searchParams.keys()].sort(), ['limit', 'page']);
      calls++;
      return respond(Number(parsed.searchParams.get('page')), calls);
    },
    undiciFetch: async () => ({ ok: true, text: async () => '' }),
  });
  const code = source.replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('server.js', directory).href));
  await vm.runInContext(`(async () => {${code}\nglobalThis.api={CROPS, getSimumuangPrice, savePriceHistory, getCropMarketData, saveDailyPrices, saveOnceExitCode, buildDailyHistory, validateMarketPrice, inspectPriceFreshness, PRICE_POLICY, setSrimuang: (load) => { getSrimuangPrice = load; }};})()`, ctx);
  return { historyFile, directory, failWrites: (fail) => { failureStage = fail ? 'write' : null; },
    failAt: (stage) => { failureStage = stage; }, context: ctx, api: ctx.api, calls: () => calls, writes: () => writes,
    rawHistory: () => JSON.parse(fs.readFileSync(historyFile, 'utf8')),
    request: async (path) => {
      let status, body;
      await handler({ url: path, method: 'GET' }, { setHeader() {}, writeHead(s) { status = s; }, end(text) { body = JSON.parse(text); } });
      return { status, body };
    } };
}

function page(items, currentPage = 1, total = items.length, extra = {}) {
  return { ok: true, json: async () => ({ data: { data: items, total, itemCount: items.length,
    perPage: 20, totalPages: Math.max(1, Math.ceil(total / 20)), currentPage, ...extra } }) };
}
test('complete snapshot is shared and cached; metadata and old API envelope survive', async () => {
  const box = await sandbox(() => page([product('kale')]));
  const crop = { ...chosen('kale') };
  const [a, b] = await Promise.all([box.api.getSimumuangPrice(crop), box.api.getSimumuangPrice(crop)]);
  assert.equal(a.dataCompleteness.complete, true);
  assert.equal(b.available, true);
  assert.equal(box.calls(), 1);
  const response = await box.request('/api/simumuang');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.data.length, 10);
  assert.equal(box.writes(), 0);
});
const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...product('kale'), _id: `other-${index}` }));
for (const [label, respond] of [
  ['HTTP failure', (n) => n === 1 ? page(firstPage, 1, 21) : { ok: false, status: 503 }],
  ['network failure', (n) => { if (n === 2) throw Error('network failure'); return page(firstPage, 1, 21); }],
  ['short page', () => page([product('kale')], 1, 21)],
  ['changed total', (n) => n === 1 ? page(firstPage, 1, 21) : page([product('kale')], 2, 22)],
  ['duplicate id', (n) => n === 1 ? page(firstPage, 1, 21) : page([firstPage[0]], 2, 21)],
  ['invalid JSON', () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } })],
  ['missing schema', () => ({ ok: true, json: async () => ({ data: [] }) })],
  ['bad metadata', () => page([product('kale')], 1, 1, { totalPages: 61 })],
]) {
  test(`incomplete data is rejected and never cached: ${label}`, async () => {
    const box = await sandbox(respond);
    const result = await box.api.getSimumuangPrice(chosen('kale'));
    assert.equal(result.available, false);
    assert.equal(result.dataCompleteness.complete, false);
    const calls = box.calls();
    await box.api.getSimumuangPrice(chosen('kale'));
    assert.ok(box.calls() > calls);
    const data = await box.api.getCropMarketData('kale');
    assert.equal(data.historyEligible, false);
    assert.equal(box.api.savePriceHistory('kale', { ...data, averagePrice: 25 }), false);
    assert.equal(box.writes(), 0);
  });
}
test('complete multi-page snapshot verifies the total and preserves unique ids', async () => {
  const box = await sandbox((n) => n === 1 ? page(firstPage, 1, 21) : page([product('kale')], 2, 21));
  const result = await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(result.available, true);
  assert.equal(result.dataCompleteness.loadedCount, 21);
  assert.equal(result.dataCompleteness.loadedPages.length, 2);
});
test('history guard rejects unverified Simummuang and preserves immutable daily snapshots', async () => {
  const box = await sandbox(() => page([product('kale')]));
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  const market = await box.api.getSimumuangPrice(chosen('kale'));
  const data = { name: 'คะน้า', averagePrice: 25, minPrice: 20, maxPrice: 30,
    sourceCount: 1, historyEligible: true, markets: [market] };
  assert.equal(box.api.savePriceHistory('kale', data), true);
  assert.equal(box.api.savePriceHistory('kale', data), false);
  const history = await box.request('/api/history?crop=kale');
  assert.equal(history.body.data.length, 1);
  assert.equal(box.api.savePriceHistory('kale', { ...data, markets: [{ ...market, validated: false }] }), false);
  assert.equal(box.api.savePriceHistory('kale', { ...data, markets: [{ ...market, dataCompleteness: { complete: false } }] }), false);
  assert.equal(box.writes(), 1);
});

test('a missing confirmed primary never falls back to other products', () => {
  const second = copy(fixtures.find((item) => item._id === catalog[CROPS.kale.name][1].id));
  assert.equal(select(chosen('kale'), [second]).status, 'selected_product_not_found');
});
test('explicit timestamps remain separate when they differ', () => {
  const item = product('kale');
  item.price.updatedAt = '2026-11-03T17:31:45.800Z';
  item.price.action_date = '2026-11-03T17:36:17.337Z';
  const result = select(chosen('kale'), [item]);
  assert.equal(result.updatedAt, item.price.updatedAt);
  assert.equal(result.action_date, item.price.action_date);
  assert.notEqual(result.updatedAt, result.action_date);
});
test('malformed group raw data and original endpoints are preserved', () => {
  const item = product('kale', { small: { min: true, max: 30 }, medium: 25, large: { min: 40, max: 30 } });
  const sizes = inspect(item);
  assert.equal(sizes[0].raw.min, true);
  assert.equal(sizes[1].raw, 25);
  assert.equal(sizes[2].raw.min, 40);
  assert.equal(sizes[2].raw.max, 30);
  assert.equal(sizes[2].status, 'invalid_range');
});
test('unknown ids with an otherwise identical name cannot impersonate a registered crop', () => {
  assert.equal(select(chosen('kale'), [{ ...product('kale'), _id: 'unverified-id' }]).status, 'selected_product_not_found');
});
test('history guard safely rejects missing unit metadata', async () => {
  const box = await sandbox(() => page([product('kale')]));
  const market = await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(box.api.savePriceHistory('kale', { averagePrice: 25, markets: [{ ...market, sourceUnit: null }] }), false);
  assert.equal(box.writes(), 0);
});
test('a valid empty catalog response is complete, not a schema failure', async () => {
  const box = await sandbox(() => page([]));
  const result = await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(result.dataCompleteness.complete, true);
  assert.equal(result.status, 'selected_product_not_found');
});
test('failed expired refresh never serves stale cache as current', async () => {
  const clock = { now: Date.parse('2026-11-04T06:00:00Z') };
  const box = await sandbox((pageNumber, calls) => calls === 1 ? page([product('kale')]) :
    { ok: false, status: 503 }, clock);
  assert.equal((await box.api.getSimumuangPrice(chosen('kale'))).available, true);
  clock.now += 300001;
  const failed = await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(failed.available, false);
  assert.equal(failed.dataCompleteness.complete, false);
  assert.equal(box.calls(), 2);
  await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(box.calls(), 3);
});

test('all ten crops keep the legacy HTTP envelopes and validated size metadata', async () => {
  const products = Object.keys(CROPS).map((key) => product(key));
  const box = await sandbox(() => page(products));
  for (const key of Object.keys(CROPS)) Object.assign(box.api.CROPS[key], chosen(key));
  const prices = await box.request('/api/prices');
  assert.equal(prices.status, 200);
  assert.equal(prices.body.data.length, 10);
  for (const key of Object.keys(CROPS)) {
    const response = await box.request(`/api/price?crop=${key}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.averagePrice, 25);
    assert.equal(response.body.data.markets[1].selectedSize, 'small');
    assert.equal(response.body.data.markets[1].dataCompleteness.complete, true);
  }
  const legacy = await box.request('/api/simumuang');
  assert.equal(legacy.body.data.itemCount, 10);
  for (const item of legacy.body.data.data) {
    assert.equal(item.price.min, 20);
    assert.equal(item.price.medium, 25);
    assert.equal(item.price.max, 30);
    assert.equal(item.sourceCount, 1);
  }
  assert.equal((await box.request('/api/price?crop=unknown')).status, 400);
  assert.equal((await box.request('/api/save-daily-prices')).status, 403);
  assert.equal(box.writes(), 0);
});
test('unconfirmed or invalid Simummuang prices never enter averages', async () => {
  const box = await sandbox(() => page([product('kale', { large: { min: 40, max: 20 } })]));
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  const result = await box.api.getCropMarketData('kale');
  assert.equal(result.sourceCount, 0);
  assert.equal(result.averagePrice, null);
  assert.equal(result.historyEligible, false);
  assert.equal(box.api.savePriceHistory('kale', result), false);
  assert.equal(box.writes(), 0);
});

test('daily save preserves valid other-market prices when Simummuang loading fails', async () => {
  const box = await sandbox(() => ({ ok: false, status: 503 }));
  box.api.setSrimuang(async () => ({market:"ตลาดศรีเมือง ราชบุรี",available:true,min:20,max:30,mid:25,unit:"บาท/กก."}));
  const result = await box.api.saveDailyPrices();
  assert.equal(result.saved, 10);
  assert.equal(result.skipped, 0);
  assert.equal(box.writes(), 10);
});

const otherMarket = (overrides = {}) => ({ market: 'ตลาดศรีเมือง ราชบุรี', available: true,
  min: 20, max: 30, mid: 25, unit: 'บาท/กก.', ...overrides });
for (const [label, overrides, expected] of [
  ['inverted range', { min: 80, max: 20, mid: 50 }, 'invalid_range'],
  ['inconsistent midpoint', { mid: 21 }, 'invalid_mid'],
  ['midpoint outside range', { mid: 100 }, 'invalid_mid'],
  ['boolean price', { min: true }, 'invalid_value'],
  ['numeric string aggregate', { min: '20' }, 'invalid_value'],
  ['zero', { min: 0 }, 'invalid_value'],
  ['negative', { max: -1 }, 'invalid_value'],
  ['NaN', { mid: NaN }, 'invalid_value'],
  ['Infinity', { max: Infinity }, 'invalid_value'],
  ['wrong unit', { unit: 'บาท/ชิ้น' }, 'unsupported_unit'],
]) {
  test(`every market uses the same quality gate: ${label}`, async () => {
    const box = await sandbox(() => page([product('kale')]));
    Object.assign(box.api.CROPS.kale, chosen('kale'));
    box.api.setSrimuang(async () => otherMarket(overrides));
    const data = await box.api.getCropMarketData('kale');
    assert.equal(data.markets[0].available, false);
    assert.equal(data.markets[0].status, expected);
    assert.equal(data.sourceCount, 1);
    assert.equal(data.averagePrice, 25);
    assert.equal(box.api.savePriceHistory('kale', data), true);
    const history = await box.request('/api/history?crop=kale');
    assert.equal(history.body.data[0].markets.length, 1);
    assert.equal(history.body.data[0].markets[0].market, 'ตลาดสี่มุมเมือง');
  });
}
const referenceTime = Date.parse('2026-11-04T06:00:00Z');
for (const [label, timestamp, expected] of [
  ['today UTC', '2026-11-04T01:00:00Z', 'current'],
  ['today Bangkok offset', '2026-11-04T08:00:00+07:00', 'current'],
  ['previous Bangkok day within 24 hours', '2026-11-03T16:00:00Z', 'stale'],
  ['exactly 48 hours', '2026-11-02T06:00:00Z', 'stale'],
  ['over 48 hours', '2026-11-02T05:59:59Z', 'expired'],
  ['old year', '2020-01-01T00:00:00Z', 'expired'],
  ['future', '2026-11-04T06:00:01Z', 'invalid_timestamp'],
  ['unreadable', 'not a time', 'invalid_timestamp'],
  ['missing', null, 'invalid_timestamp'],
  ['empty', '', 'invalid_timestamp'],
  ['timezone missing', '2026-11-04T01:00:00', 'invalid_timestamp'],
  ['invalid calendar date', '2026-02-30T01:00:00Z', 'invalid_timestamp'],
]) {
  test(`Bangkok freshness: ${label}`, async () => {
    const box = await sandbox(() => page([]));
    const result = box.api.inspectPriceFreshness(timestamp, referenceTime);
    assert.equal(result.status, expected);
    assert.equal(result.sourceUpdatedAt, timestamp);
    assert.equal(result.timezone, 'Asia/Bangkok');
  });
}
test('freshness changes across Bangkok midnight, not UTC midnight', async () => {
  const box = await sandbox(() => page([]));
  const now = Date.parse('2026-11-03T17:00:00Z');
  assert.equal(box.api.inspectPriceFreshness('2026-11-03T16:59:59Z', now).status, 'stale');
  assert.equal(box.api.inspectPriceFreshness('2026-11-03T17:00:00Z', now).status, 'current');
});
for (const timestamp of ['2020-01-01T00:00:00Z', '2026-11-03T16:00:00Z', '2026-11-05T00:00:00Z', null, 'bad']) {
  test(`Simummuang timestamp blocks calculation and history: ${timestamp}`, async () => {
    const item = product('kale'); item.price.updatedAt = timestamp;
    const box = await sandbox(() => page([item]));
    Object.assign(box.api.CROPS.kale, chosen('kale'));
    const data = await box.api.getCropMarketData('kale');
    assert.equal(data.markets[1].available, false);
    assert.equal(data.averagePrice, null);
    assert.equal(box.api.savePriceHistory('kale', { ...data, averagePrice: 25 }), false);
    assert.equal(box.writes(), 0);
  });
}
test('unknown source time is explicit, configurable, and never replaced by fetchedAt', async () => {
  const box = await sandbox(() => page([]));
  const input = otherMarket({ fetchedAt: '2026-11-04T06:00:00Z' });
  const result = box.api.validateMarketPrice(input, referenceTime);
  assert.equal(result.available, true);
  assert.equal(result.freshness.status, 'unknown_timestamp');
  assert.equal(result.sourceUpdatedAt, null);
  assert.equal(result.verifiedCurrent, false);
  assert.equal(result.fetchedAt, input.fetchedAt);
  const strict = box.api.validateMarketPrice(input, referenceTime,
    { ...box.api.PRICE_POLICY, allowUnknownTimestamp: false });
  assert.equal(strict.available, false);
  assert.equal(strict.historyEligible, false);
});
test('source updatedAt and action_date remain distinct from snapshot fetchedAt', async () => {
  const box = await sandbox(() => page([product('kale')]));
  const result = await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(result.sourceUpdatedAt, '2026-11-04T01:00:00Z');
  assert.equal(result.action_date, '2026-11-04T01:05:00Z');
  assert.equal(result.fetchedAt, '2026-11-04T06:00:00.000Z');
  assert.equal(result.freshness.status, 'current');
});
test('old action_date cannot make an invalid or absent updatedAt current', async () => {
  const item = product('kale'); item.price.updatedAt = null;
  item.price.action_date = '2026-11-04T01:00:00Z';
  const box = await sandbox(() => page([item]));
  const result = await box.api.getSimumuangPrice(chosen('kale'));
  assert.equal(result.status, 'invalid_timestamp');
  assert.equal(result.available, false);
});
test('freshness policy can change windows and future tolerance without changing source data', async () => {
  const box = await sandbox(() => page([]));
  const policy = { ...box.api.PRICE_POLICY, currentMaxAgeMs: 3600000, staleMaxAgeMs: 7200000, futureToleranceMs: 5000 };
  assert.equal(box.api.inspectPriceFreshness('2026-11-04T01:00:00Z', referenceTime, policy).status, 'expired');
  assert.equal(box.api.inspectPriceFreshness('2026-11-04T06:00:01Z', referenceTime, policy).status, 'current');
});
test('failure of other market still permits verified Simummuang history', async () => {
  const box = await sandbox(() => page([product('kale')]));
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  box.api.setSrimuang(async () => { throw Error('network failure'); });
  const data = await box.api.getCropMarketData('kale');
  assert.equal(data.sourceCount, 1);
  assert.equal(data.priceStatus, 'current');
  assert.equal(data.markets[0].status, 'load_failed');
  assert.equal(box.api.savePriceHistory('kale', data), true);
});
test('valid other market survives stale Simummuang, without being called confirmed current', async () => {
  const item = product('kale'); item.price.updatedAt = '2020-01-01T00:00:00Z';
  const box = await sandbox(() => page([item]));
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  box.api.setSrimuang(async () => otherMarket());
  const data = await box.api.getCropMarketData('kale');
  assert.equal(data.sourceCount, 1);
  assert.equal(data.averagePrice, 25);
  assert.equal(data.priceStatus, 'unverified_freshness');
  assert.equal(box.api.savePriceHistory('kale', data), true);
  const history = (await box.request('/api/history')).body.data;
  assert.equal(history[0].markets[0].market, 'ตลาดศรีเมือง ราชบุรี');
  assert.equal(history[0].markets[0].sourceUpdatedAt, null);
});
test('new immutable history contains metadata while old-format records stay unchanged', async () => {
  const legacy = { crop: 'kale', name: 'คะน้า', averagePrice: 15, minPrice: 10, maxPrice: 20,
    sourceCount: 1, timestamp: '2026-11-01T01:00:00Z', extraLegacyField: 'keep' };
  const box = await sandbox(() => page([product('kale')]), undefined, [legacy]);
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  const data = await box.api.getCropMarketData('kale');
  assert.equal(box.api.savePriceHistory('kale', data), true);
  assert.equal(box.api.savePriceHistory('kale', { ...data, averagePrice: 99 }), false);
  assert.equal(box.api.savePriceHistory('kale', data), false);
  const history = (await box.request('/api/history?crop=kale')).body.data;
  assert.deepEqual(history[0], legacy);
  assert.equal(history.length, 2);
  const record = history[1];
  assert.equal(record.schemaVersion, 3);
  assert.equal(record.markets[0].productId, chosen('kale').simummuangProductId);
  assert.equal(record.markets[0].productName, product('kale').th.name);
  assert.equal(record.markets[0].selectedSize, 'small');
  assert.equal(record.markets[0].unit, 'บาท/กก.');
  assert.equal(record.markets[0].min, 20);
  assert.equal(record.markets[0].max, 30);
  assert.equal(record.markets[0].mid, 25);
  assert.equal(record.markets[0].quality.status, 'valid');
  assert.equal(record.markets[0].freshness.status, 'current');
  assert.notEqual(record.markets[0].sourceUpdatedAt, record.markets[0].fetchedAt);
  assert.notEqual(record.markets[0].sourceUpdatedAt, record.markets[0].action_date);
  assert.equal(box.writes(), 1);
});
test('a legacy record for today is neither overwritten nor duplicated', async () => {
  const legacy = { crop: 'kale', averagePrice: 15, timestamp: '2026-11-04T00:00:00Z' };
  const box = await sandbox(() => page([product('kale')]), undefined, [legacy]);
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  const data = await box.api.getCropMarketData('kale');
  assert.equal(box.api.savePriceHistory('kale', data), false);
  assert.deepEqual((await box.request('/api/history')).body.data, [legacy]);
  assert.equal(box.writes(), 0);
});
test('never delete old history when adding a new daily record', async () => {
  const legacy = Array.from({ length: 5001 }, (_, i) => ({ crop: 'kale', averagePrice: 15,
    timestamp: '2020-01-01T00:00:00Z', legacyId: i }));
  const box = await sandbox(() => page([product('kale')]), undefined, legacy);
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  assert.equal(box.api.savePriceHistory('kale', await box.api.getCropMarketData('kale')), true);
  const history = (await box.request('/api/history')).body.data;
  assert.equal(history.length, 2); // one point per crop/day, even for duplicate legacy rows
  assert.equal(box.rawHistory().length, 5002);
  assert.deepEqual(box.rawHistory().slice(0, 5001), legacy);
});
test('a valid current other-market timestamp produces confirmed-current metadata', async () => {
  const box = await sandbox(() => page([]));
  const market = box.api.validateMarketPrice(otherMarket({ sourceUpdatedAt: '2026-11-04T01:00:00Z' }), referenceTime);
  assert.equal(market.verifiedCurrent, true);
  assert.equal(market.freshness.status, 'current');
});
test('selected invalid size has an explicit reason rather than asking for a new selection', () => {
  const item = product('kale', { small: { min: 30, max: 20 }, large: { min: 40, max: 50 } });
  const result = select(chosen('kale', { simummuangSize: 'small' }), [item]);
  assert.equal(result.status, 'selected_size_unavailable');
  assert.ok(result.reason.includes('ขนาดที่เลือกใช้ไม่ได้'));
});

for (const env of [
  { PRICE_CURRENT_MAX_HOURS: '0' }, { PRICE_CURRENT_MAX_HOURS: '' },
  { PRICE_CURRENT_MAX_HOURS: 'bad' }, { PRICE_STALE_MAX_HOURS: '12' },
  { PRICE_ALLOW_UNKNOWN_TIMESTAMP: 'off' }, { PRICE_FUTURE_TOLERANCE_SECONDS: '-1' },
]) {
  test(`invalid policy fails explicitly: ${JSON.stringify(env)}`, async () => {
    await assert.rejects(() => sandbox(() => page([]), undefined, [], env), /PRICE_|price policy/);
  });
}
test('strict unknown-time policy excludes and does not save an undated other-market price', async () => {
  const box = await sandbox(() => page([]), undefined, [], { PRICE_ALLOW_UNKNOWN_TIMESTAMP: 'false' });
  box.api.setSrimuang(async () => otherMarket());
  const data = await box.api.getCropMarketData('kale');
  assert.equal(data.averagePrice, null);
  assert.equal(data.markets[0].freshness.status, 'unknown_timestamp');
  assert.equal(box.api.savePriceHistory('kale', { ...data, averagePrice: 25 }), false);
  assert.equal(box.writes(), 0);
});
test('a source flag invalid_range cannot be promoted into a usable price', async () => {
  const box = await sandbox(() => page([]));
  const result = box.api.validateMarketPrice(otherMarket({ status: 'invalid_range' }), referenceTime);
  assert.equal(result.available, false);
  assert.equal(result.status, 'invalid_range');
});
test('failed persistence leaves old history and dedup state intact', async () => {
  const box = await sandbox(() => page([product('kale')]));
  Object.assign(box.api.CROPS.kale, chosen('kale'));
  const data = await box.api.getCropMarketData('kale');
  box.failWrites(true);
  assert.throws(() => box.api.savePriceHistory('kale', data), /mock disk failure/);
  assert.equal((await box.request('/api/history')).body.count, 0);
  box.failWrites(false);
  assert.equal(box.api.savePriceHistory('kale', data), true);
  assert.equal((await box.request('/api/history')).body.count, 1);
});

test('actual market JSX distinguishes freshness, loading, size errors and original selection statuses', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { transformWithOxc } = await import('vite');
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('<div className="market-list">');
  const end = app.indexOf('\n</div>', start) + '\n</div>'.length;
  const helper = app.slice(app.indexOf('function formatMarketTime('), app.indexOf('const CROPS ='));
  const transformed = await transformWithOxc(helper + '\nfunction View({item}) { return (' +
    app.slice(start, end) + '); }\nglobalThis.View=View;', 'market-list.jsx', { jsx: { runtime: 'classic' } });
  const ctx = vm.createContext({ React });
  vm.runInContext(transformed.code, ctx);
  const render = (market) => renderToStaticMarkup(React.createElement(ctx.View, { item: { markets: [market] } }));
  const market = { market: 'ตลาดทดสอบ', productName: 'ต้นคะน้า', selectedSize: 'large', unit: 'บาท/กก.', min: 20, max: 30,
    sourceUpdatedAt: '2026-11-04T01:00:00Z', fetchedAt: '2026-11-04T06:00:00Z' };
  assert.ok(render({ ...market, available: true, verifiedCurrent: true }).includes('ราคาปัจจุบันที่ผ่านการตรวจสอบ'));
  assert.ok(render({ ...market, available: true, verifiedCurrent: false }).includes('ไม่สามารถยืนยันเวลาราคา'));
  const stale = render({ ...market, available: false, freshness: { status: 'stale' }, quality: { status: 'valid' } });
  assert.ok(stale.includes('ราคาเก่า: 20 - 30'));
  assert.ok(stale.includes('ไม่ใช้คำนวณราคาปัจจุบัน'));
  for (const reason of ['ขนาดที่เลือกใช้ไม่ได้', 'รอยืนยันรหัสสินค้าหลัก', 'ตลาดโหลดข้อมูลไม่สำเร็จ']) {
    assert.ok(render({ ...market, available: false, reason }).includes(reason));
  }
  const candidateHtml = render({ ...market, available: false, candidates: [{ productId: 'test',
    productName: 'ทดสอบ', unit: { th: 'กิโลกรัม' }, sizes: [
      { size: 'small', status: 'invalid_range', raw: { min: 30, max: 20 } }, { size: 'medium', status: 'missing_price' },
      { size: 'large', status: 'incomplete_range' },
    ] }] });
  for (const message of ['ช่วงราคาผิดปกติ', 'ไม่มีราคา', 'ช่วงราคาไม่ครบ', 'ต้นคะน้า', '(large)', 'ค่าต้นทาง min/max: 30 / 20']) assert.ok(candidateHtml.includes(message));
});

// Step 52: literal identities from the user's confirmation, independent of catalog order.
const confirmedPrimaries = {
  shallot: ['698aaceeee6cbda61dfbd207', 'ต้นหอม'],
  kale: ['698aacecee6cbda61dfbd1c3', 'ต้นคะน้า'],
  pakchoi: ['698aacedee6cbda61dfbd1e5', 'กวางตุ้งใบ'],
  chili: ['698aacebee6cbda61dfbd16f', 'พริกจินดาแดง'],
  coriander: ['698aaceeee6cbda61dfbd20e', 'ผักชีไทย'],
  celery: ['698aaceeee6cbda61dfbd22a', 'ขึ้นฉ่าย/ตั้งโอ๋ ดิน'],
  morningglory: ['698aacf1ee6cbda61dfbd2b8', 'ผักบุ้งจีน'],
  cucumber: ['6989c1bd2f44a006e423550e', 'แตงกวา'],
  longbean: ['6989c1be2f44a006e423552f', 'ถั่วฝักยาว เนื้อ'],
  cabbage: ['698aacefee6cbda61dfbd246', 'กะหล่ำปลีเขียว'],
};
assert.deepEqual(Object.keys(confirmedPrimaries).sort(), Object.keys(CROPS).sort());
for (const [key, [id, name]] of Object.entries(confirmedPrimaries)) {
  test(`confirmed default uses only large and saves verified metadata: ${key}`, async () => {
    assert.equal(CROPS[key].simummuangProductId, id);
    assert.equal(CROPS[key].simummuangProductName, name);
    assert.equal(CROPS[key].simummuangSize, 'large');
    const item = product(key, { small: { min: 1, max: 2 }, medium: { min: 3, max: 4 }, large: { min: 20, max: 30 } });
    assert.equal(item._id, id);
    assert.equal(item.th.name, name);
    const box = await sandbox(() => page([item]));
    // Do not overwrite CROPS: exercise the actual production defaults.
    const data = await box.api.getCropMarketData(key);
    const market = data.markets[1];
    assert.equal(market.productId, id);
    assert.equal(market.productName, name);
    assert.equal(market.selectedSize, 'large');
    assert.equal(market.min, 20);
    assert.equal(market.max, 30);
    assert.equal(market.mid, 25);
    assert.equal(market.sizes.length, 3);
    assert.equal(market.freshness.status, 'current');
    assert.equal(market.verifiedCurrent, true);
    assert.equal(data.averagePrice, 25);
    assert.equal(data.priceStatus, 'current');
    assert.equal(box.api.savePriceHistory(key, data), true);
    assert.equal(box.api.savePriceHistory(key, data), false);
    const record = (await box.request(`/api/history?crop=${key}`)).body.data[0];
    assert.equal(record.markets[0].productId, id);
    assert.equal(record.markets[0].productName, name);
    assert.equal(record.markets[0].selectedSize, 'large');
    assert.equal(record.markets[0].freshness.status, 'current');
    assert.notEqual(record.markets[0].sourceUpdatedAt, record.markets[0].fetchedAt);
  });
  test(`unusable large never falls back or reaches averages/history: ${key}`, async () => {
    for (const [large, expected] of [
      [{ min: 30, max: 20 }, 'invalid_range'],
      [{ min: 0, max: 30 }, 'incomplete_range'],
      [{ min: 20, max: 0 }, 'incomplete_range'],
      [{ min: 0, max: 0 }, 'missing_price'],
      [{ min: true, max: 30 }, 'invalid_value'],
      [undefined, 'missing_price'],
    ]) {
      const item = product(key, { small: { min: 1, max: 2 }, medium: { min: 3, max: 4 }, ...(large ? { large } : {}) });
      const original = JSON.stringify(item);
      const box = await sandbox(() => page([item]));
      const data = await box.api.getCropMarketData(key);
      const market = data.markets[1];
      assert.equal(market.available, false);
      assert.equal(market.productName, name);
      assert.equal(market.selectedSize, 'large');
      assert.equal(market.selectedSizeStatus, expected);
      assert.equal(market.quality.status, expected);
      assert.equal(market.sourceUpdatedAt, item.price.updatedAt);
      assert.ok(market.reason.includes('ขนาดที่เลือกใช้ไม่ได้'));
      assert.equal(market.candidates[0].sizes[0].status, 'valid');
      assert.equal(data.averagePrice, null);
      assert.equal(data.sourceCount, 0);
      assert.equal(box.api.savePriceHistory(key, { ...data, averagePrice: 25 }), false);
      assert.equal(box.writes(), 0);
      assert.equal(JSON.stringify(item), original);
    }
  });
  test(`identity mismatch and alternatives cannot replace confirmed primary: ${key}`, () => {
    const item = product(key, { large: { min: 20, max: 30 } });
    const wrongName = select(CROPS[key], [{ ...item, th: { name: `${name}ชนิดอื่น` } }]);
    assert.equal(wrongName.status, 'product_identity_mismatch');
    assert.equal(wrongName.available, false);
    assert.equal(wrongName.productName, name);
    const wrongId = select(CROPS[key], [{ ...item, _id: 'another-id' }]);
    assert.equal(wrongId.status, 'selected_product_not_found');
    assert.equal(wrongId.available, false);
    const alternatives = fixtures.filter((entry) => entry._id !== id &&
      catalog[CROPS[key].name].some((option) => option.id === entry._id));
    const absent = select(CROPS[key], alternatives);
    assert.equal(absent.available, false);
    assert.equal(absent.status, 'selected_product_not_found');
    const invalidPrimary = { ...item, price: { ...item.price, large: { min: 30, max: 20 } } };
    assert.equal(select(CROPS[key], [...alternatives, invalidPrimary]).status, 'selected_size_unavailable');
  });
  test(`large requires current source time and kg regardless of isShow: ${key}`, async () => {
    for (const [timestamp, expected] of [
      ['2020-01-01T00:00:00Z', 'expired'],
      ['2026-11-03T16:00:00Z', 'stale'],
      [null, 'invalid_timestamp'], ['bad', 'invalid_timestamp'],
      ['2026-11-05T06:00:00Z', 'invalid_timestamp'],
    ]) {
      const item = product(key, { large: { min: 20, max: 30 }, updatedAt: timestamp });
      item.isShow = false;
      const box = await sandbox(() => page([item]));
      const data = await box.api.getCropMarketData(key);
      assert.equal(data.markets[1].freshness.status, expected);
      assert.equal(data.markets[1].available, false);
      assert.equal(data.averagePrice, null);
      assert.equal(box.api.savePriceHistory(key, data), false);
      assert.equal(box.writes(), 0);
    }
    const item = product(key, { large: { min: 20, max: 30 } });
    item.isShow = false;
    const box = await sandbox(() => page([item]));
    assert.equal((await box.api.getCropMarketData(key)).markets[1].available, true);
    const piece = { ...item, prod_unit_id: { th: { name: 'ชิ้น' }, en: { name: 'piece' } } };
    assert.equal(select(CROPS[key], [piece]).status, 'unsupported_unit');
  });
}
test('unconfigured future selector still requests explicit identity rather than guessing', () => {
  const crop = { ...CROPS.kale, simummuangProductId: undefined, simummuangProductName: undefined, simummuangSize: undefined };
  assert.equal(select(crop, [product('kale')]).status, 'selection_required');
});
test('unknown-time other-market policy is unchanged when primary large is rejected', async () => {
  const box = await sandbox(() => page([product('kale', { large: { min: 30, max: 20 } })]));
  box.api.setSrimuang(async () => otherMarket());
  const data = await box.api.getCropMarketData('kale');
  assert.equal(data.markets[1].quality.status, 'invalid_range');
  assert.equal(data.markets[0].freshness.status, 'unknown_timestamp');
  assert.equal(data.priceStatus, 'unverified_freshness');
  assert.equal(data.averagePrice, 25);
  assert.equal(box.api.savePriceHistory('kale', data), true);
  const record = (await box.request('/api/history')).body.data[0];
  assert.equal(record.markets.length, 1);
  assert.equal(record.markets[0].market, 'ตลาดศรีเมือง ราชบุรี');
  assert.equal(record.priceStatus, 'unverified_freshness');
});

async function enrichmentScenario(initialHistory = [], sharedHistory = null) {
  const clock = { now: Date.parse('2026-11-04T01:00:00Z') };
  let recovered = false;
  let other = otherMarket({ productName: 'คะน้าต้น' });
  let item = product('kale', { large: { min: 40, max: 60 }, updatedAt: '2026-11-04T01:00:00Z' });
  const box = await sandbox(() => recovered ? page([item]) : { ok: false, status: 503 }, clock,
    initialHistory, {}, sharedHistory);
  box.api.setSrimuang(async () => {
    if (!other) throw Error('market A unavailable');
    return copy(other);
  });
  return { box, clock, recover: () => { recovered = true; clock.now = Date.parse('2026-11-04T06:00:00Z'); },
    setItem: (value) => { item = value; }, setOther: (value) => { other = value; },
    data: () => box.api.getCropMarketData('kale') };
}
function chartMap(history, crop = 'kale') {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(app.slice(app.indexOf('const DAY_MS'), app.indexOf('function App()')) +
    ';globalThis.build=buildDailyHistoryMap;', ctx);
  return ctx.build(history, crop);
}
test('morning A plus afternoon B appends only missing market and produces one graph point', async () => {
  const flow = await enrichmentScenario();
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), true);
  const firstEvent = copy(flow.box.rawHistory()[0]);
  assert.equal(firstEvent.markets.length, 1);
  flow.recover();
  flow.setOther(otherMarket({ min: 100, max: 200, mid: 150 }));
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), true);
  const raw = flow.box.rawHistory();
  assert.equal(raw.length, 2);
  assert.deepEqual(raw[0], firstEvent);
  assert.equal(raw[1].markets.length, 1);
  assert.equal(raw[1].markets[0].market, 'ตลาดสี่มุมเมือง');
  const response = await flow.box.request('/api/history?crop=kale');
  assert.equal(response.body.count, 1);
  const day = response.body.data[0];
  assert.equal(day.sourceCount, 2);
  assert.equal(day.averagePrice, 37.5); // original A midpoint 25, not replacement 150; B midpoint 50
  assert.equal(day.markets[0].mid, 25);
  assert.equal(day.recordCount, 2);
  assert.equal(day.priceStatus, 'unverified_freshness');
  assert.equal(chartMap(response.body.data).size, 1);
  assert.equal(chartMap(response.body.data).get('2026-11-04').averagePrice, 37.5);
});
test('repeated calls do not change bytes or create duplicate market observations', async () => {
  const flow = await enrichmentScenario();
  flow.recover();
  const data = await flow.data();
  assert.equal(flow.box.api.savePriceHistory('kale', data), true);
  const bytes = fs.readFileSync(flow.box.historyFile, 'utf8');
  assert.equal(flow.box.api.savePriceHistory('kale', data), false);
  assert.equal(fs.readFileSync(flow.box.historyFile, 'utf8'), bytes);
  assert.equal(flow.box.writes(), 1);
});
for (const [label, large, updatedAt] of [
  ['inverted', { min: 60, max: 40 }, '2026-11-04T01:00:00Z'],
  ['incomplete', { min: 0, max: 60 }, '2026-11-04T01:00:00Z'],
  ['missing', { min: 0, max: 0 }, '2026-11-04T01:00:00Z'],
  ['invalid value', { min: true, max: 60 }, '2026-11-04T01:00:00Z'],
  ['stale', { min: 40, max: 60 }, '2026-11-03T16:00:00Z'],
  ['expired', { min: 40, max: 60 }, '2020-01-01T00:00:00Z'],
  ['invalid timestamp', { min: 40, max: 60 }, null],
]) {
  test(`B recovery with ${label} cannot append an unusable price`, async () => {
    const flow = await enrichmentScenario();
    flow.box.api.savePriceHistory('kale', await flow.data());
    const original = fs.readFileSync(flow.box.historyFile, 'utf8');
    flow.setItem(product('kale', { large, updatedAt }));
    flow.recover();
    assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), false);
    assert.equal(fs.readFileSync(flow.box.historyFile, 'utf8'), original);
    assert.equal((await flow.box.request('/api/history')).body.data[0].sourceCount, 1);
  });
}
test('A disappearing from the next request does not remove its original observation', async () => {
  const flow = await enrichmentScenario();
  flow.box.api.savePriceHistory('kale', await flow.data());
  flow.setOther(null);
  flow.recover();
  const data = await flow.data();
  assert.equal(data.sourceCount, 1);
  assert.equal(flow.box.api.savePriceHistory('kale', data), true);
  const day = (await flow.box.request('/api/history')).body.data[0];
  assert.equal(day.sourceCount, 2);
  assert.equal(day.averagePrice, 37.5);
});
test('a different Bangkok date permits the same market without duplicating the prior day', async () => {
  const flow = await enrichmentScenario();
  flow.clock.now = Date.parse('2026-11-04T16:59:00Z');
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), true);
  flow.clock.now = Date.parse('2026-11-04T17:01:00Z');
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), true);
  const data = (await flow.box.request('/api/history')).body.data;
  assert.equal(data.length, 2);
  assert.equal(chartMap(data).size, 2);
  assert.equal(flow.box.rawHistory()[0].date, '2026-11-04');
  assert.equal(flow.box.rawHistory()[1].date, '2026-11-05');
});
test('schema 2 observations can be enriched while the original record stays byte-equivalent', async () => {
  const original = { schemaVersion: 2, crop: 'kale', name: 'คะน้า', averagePrice: 25, minPrice: 20,
    maxPrice: 30, sourceCount: 1, timestamp: '2026-11-04T01:00:00Z', priceStatus: 'unverified_freshness',
    markets: [{ market: 'ตลาดศรีเมือง ราชบุรี', productId: null, productName: 'คะน้าต้น', selectedSize: null,
      unit: 'บาท/กก.', sourceUnit: null, min: 20, max: 30, mid: 25, sourceUpdatedAt: null,
      fetchedAt: '2026-11-04T01:00:00Z', quality: { status: 'valid' },
      freshness: { status: 'unknown_timestamp' }, status: 'unknown_timestamp' }] };
  const flow = await enrichmentScenario([original]);
  flow.recover(); flow.setOther(null);
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), true);
  assert.deepEqual(flow.box.rawHistory()[0], original);
  const day = (await flow.box.request('/api/history')).body.data[0];
  assert.equal(day.averagePrice, 37.5);
  assert.equal(day.sourceCount, 2);
});
test('legacy same-day aggregate cannot be enriched by guessing its missing markets', async () => {
  const original = { crop: 'kale', averagePrice: 25, sourceCount: 1, timestamp: '2026-11-04T01:00:00Z' };
  const flow = await enrichmentScenario([original]); flow.recover();
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), false);
  assert.deepEqual(flow.box.rawHistory(), [original]);
  assert.deepEqual((await flow.box.request('/api/history')).body.data, [original]);
});
for (const stage of ['open', 'write', 'fsync', 'rename']) {
  test(`atomic history failure at ${stage} preserves original file and removes own lock/temp`, async () => {
    const flow = await enrichmentScenario();
    flow.box.api.savePriceHistory('kale', await flow.data());
    const original = fs.readFileSync(flow.box.historyFile, 'utf8');
    flow.recover();
    const data = await flow.data();
    flow.box.failAt(stage);
    assert.throws(() => flow.box.api.savePriceHistory('kale', data), /mock/);
    assert.equal(fs.readFileSync(flow.box.historyFile, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(flow.box.directory), ['price-history.json']);
    assert.equal((await flow.box.request('/api/history')).body.count, 1);
    flow.box.failAt(null);
    assert.equal(flow.box.api.savePriceHistory('kale', data), true);
    assert.equal(flow.box.rawHistory().length, 2);
  });
}

test('malformed JSON is not repaired or overwritten and GET history reports an error', async () => {
  const flow = await enrichmentScenario();
  const data = await flow.data();
  fs.writeFileSync(flow.box.historyFile, '{broken json', 'utf8');
  assert.throws(() => flow.box.api.savePriceHistory('kale', data));
  assert.equal(fs.readFileSync(flow.box.historyFile, 'utf8'), '{broken json');
  assert.equal((await flow.box.request('/api/history')).status, 500);
  assert.deepEqual(fs.readdirSync(flow.box.directory), ['price-history.json']);
});
test('valid JSON with invalid history structure is never overwritten', async () => {
  const flow = await enrichmentScenario();
  const data = await flow.data();
  fs.writeFileSync(flow.box.historyFile, JSON.stringify([{ crop: 'kale', timestamp: 'bad' }]), 'utf8');
  const bytes = fs.readFileSync(flow.box.historyFile, 'utf8');
  assert.throws(() => flow.box.api.savePriceHistory('kale', data), /รูปแบบประวัติ/);
  assert.equal(fs.readFileSync(flow.box.historyFile, 'utf8'), bytes);
});
test('an existing lock prevents writing and is never removed by a competing caller', async () => {
  const flow = await enrichmentScenario();
  const data = await flow.data();
  const lock = new URL('.price-history.json.lock', flow.box.directory);
  const fd = fs.openSync(lock, 'wx');
  try {
    assert.throws(() => flow.box.api.savePriceHistory('kale', data), /history_busy/);
    assert.equal(fs.existsSync(lock), true);
    assert.equal(flow.box.rawHistory().length, 0);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  assert.equal(flow.box.api.savePriceHistory('kale', data), true);
});
test('two stale server contexts reload inside the lock before appending to a shared temporary file', async () => {
  const first = await enrichmentScenario();
  const second = await enrichmentScenario([], first.box.historyFile);
  assert.equal(first.box.api.savePriceHistory('kale', await first.data()), true);
  second.recover(); second.setOther(null);
  assert.equal(second.box.api.savePriceHistory('kale', await second.data()), true);
  assert.equal(first.box.rawHistory().length, 2);
  const day = (await first.box.request('/api/history')).body.data[0];
  assert.equal(day.sourceCount, 2);
  assert.equal(day.averagePrice, 37.5);
});
test('concurrent calls for the same observation produce exactly one append', async () => {
  const flow = await enrichmentScenario();
  const data = await flow.data();
  const results = await Promise.all([Promise.resolve().then(() => flow.box.api.savePriceHistory('kale', data)),
    Promise.resolve().then(() => flow.box.api.savePriceHistory('kale', data))]);
  assert.deepEqual(results, [true, false]);
  assert.equal(flow.box.rawHistory().length, 1);
  assert.equal(flow.box.writes(), 1);
});
test('a changed identity, unit or known size is not merged into a daily history', async () => {
  const flow = await enrichmentScenario();
  flow.setOther(otherMarket({ selectedSize: 'small' }));
  flow.box.api.savePriceHistory('kale', await flow.data());
  flow.recover(); flow.setOther(null);
  assert.equal(flow.box.api.savePriceHistory('kale', await flow.data()), false);
  assert.equal(flow.box.rawHistory().length, 1);
  const box = await sandbox(() => page([]));
  const rawWrong = otherMarket({ productName: 'ผักชีไทย' });
  const validated = box.api.validateMarketPrice(rawWrong, referenceTime);
  assert.equal(box.api.savePriceHistory('kale', { name: 'คะน้า', averagePrice: 25,
    historyEligible: true, markets: [validated] }), false);
});
test('historical current status is evaluated at recording time, not at the day of reading', async () => {
  const flow = await enrichmentScenario(); flow.recover(); flow.setOther(null);
  flow.box.api.savePriceHistory('kale', await flow.data());
  flow.clock.now = Date.parse('2026-12-01T06:00:00Z');
  const row = (await flow.box.request('/api/history')).body.data[0];
  assert.equal(row.markets[0].freshness.status, 'current');
  assert.equal(row.priceStatus, 'current');
  assert.equal(row.date, '2026-11-04');
  assert.equal(row.freshnessScope, 'at_observation');
  assert.equal(row.markets[0].freshness.scope, 'at_observation');
});
test('a duplicate successful daily run is a no-op success for GitHub Actions', async () => {
  const box = await sandbox(() => ({ ok: false, status: 503 }));
  box.api.setSrimuang(async () => otherMarket());
  const first = await box.api.saveDailyPrices();
  assert.equal(first.saved, 10);
  assert.equal(box.api.saveOnceExitCode(first), 0);
  const bytes = fs.readFileSync(box.historyFile, 'utf8');
  const second = await box.api.saveDailyPrices();
  assert.equal(second.saved, 0);
  assert.equal(second.unchanged, 10);
  assert.equal(second.failed, 0);
  assert.equal(box.api.saveOnceExitCode(second), 0);
  assert.equal(fs.readFileSync(box.historyFile, 'utf8'), bytes);
  assert.equal(box.writes(), 10); // workflow's git diff stays empty on the second run
});
test('daily no-data and actual write failures remain errors rather than false no-op success', async () => {
  const box = await sandbox(() => ({ ok: false, status: 503 }));
  const noData = await box.api.saveDailyPrices();
  assert.equal(noData.saved, 0);
  assert.equal(noData.eligible, 0);
  assert.equal(box.api.saveOnceExitCode(noData), 1);
  box.api.setSrimuang(async () => otherMarket());
  box.failAt('rename');
  const failed = await box.api.saveDailyPrices();
  assert.equal(failed.failed, 10);
  assert.equal(box.api.saveOnceExitCode(failed), 1);
  assert.equal(box.rawHistory().length, 0);
});
test('daily-view grouping never merges crops on the same date and the chart retains separate keys', async () => {
  const legacy = ['kale', 'shallot'].map((crop) => ({ crop, averagePrice: 25, timestamp: '2026-11-04T01:00:00Z' }));
  const box = await sandbox(() => page([]), undefined, legacy);
  const response = await box.request('/api/history');
  assert.equal(response.body.count, 2);
  assert.equal(chartMap(response.body.data, null).size, 2);
  assert.equal(chartMap(response.body.data, 'kale').size, 1);
});

test('a current timestamp with unknown product/size metadata is not called fully confirmed history', async () => {
  const box = await sandbox(() => page([]));
  box.api.setSrimuang(async () => otherMarket({ sourceUpdatedAt: '2026-11-04T01:00:00Z' }));
  assert.equal(box.api.savePriceHistory('kale', await box.api.getCropMarketData('kale')), true);
  const row = (await box.request('/api/history')).body.data[0];
  assert.equal(row.priceStatus, 'unverified_metadata');
  assert.equal(row.metadataStatus, 'incomplete_source_identity');
});
test('invalid legacy averages cannot hide another usable record for the same day', async () => {
  const valid = { crop: 'kale', minPrice: 10, averagePrice: 15, sourceCount: 1, timestamp: '2026-11-04T01:00:00Z' };
  const invalid = { ...valid, averagePrice: 0, sourceCount: 2, timestamp: '2026-11-04T06:00:00Z' };
  const box = await sandbox(() => page([]), undefined, [valid, invalid]);
  assert.deepEqual((await box.request('/api/history')).body.data, [valid]);
  assert.deepEqual(box.rawHistory(), [valid, invalid]);
});
test('duplicate market observations in existing metadata never replace the first observation', async () => {
  const flow = await enrichmentScenario();
  flow.box.api.savePriceHistory('kale', await flow.data());
  const first = flow.box.rawHistory()[0];
  const duplicate = copy(first);
  duplicate.eventId = 'duplicate-source-record';
  duplicate.markets[0].min = 100; duplicate.markets[0].max = 200; duplicate.markets[0].mid = 150;
  fs.writeFileSync(flow.box.historyFile, JSON.stringify([first, duplicate]), 'utf8');
  const data = (await flow.box.request('/api/history')).body.data;
  assert.equal(data.length, 1);
  assert.equal(data[0].sourceCount, 1);
  assert.equal(data[0].averagePrice, 25);
  assert.equal(flow.box.rawHistory().length, 2);
});
