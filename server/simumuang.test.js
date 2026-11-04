import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

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
// Explicit product selections here are test-only, not permanent crop settings.
const chosen = (key, extra = {}) => ({ ...CROPS[key],
  simummuangProductId: catalog[CROPS[key].name][0].id, ...extra });
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
  const result = select(chosen('kale'), [item]);
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
  assert.equal(select(chosen('kale'), [{ ...product('kale'), th: { name: 'ยอดคะน้า' } }]).status, 'product_not_found');
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
    assert.equal(select(chosen('kale'), [item]).status, 'no_valid_price');
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
    assert.equal(select(chosen('kale'), items).status, 'product_not_found');
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
      assert.equal(select(chosen('kale'), [item]).mid, Number(value));
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
  assert.equal(select(chosen('kale'), [item]).status, 'size_selection_required');
  const result = select(chosen('kale', { simummuangSize: 'large' }), [item]);
  assert.equal(result.min, 40);
  assert.equal(result.max, 50);
  assert.equal(result.sizes.length, 3);
});
test('no fallback to another size when a confirmed size is invalid', () => {
  const item = product('kale', { small: { min: 30, max: 20 }, large: { min: 40, max: 50 } });
  assert.equal(select(chosen('kale', { simummuangSize: 'small' }), [item]).available, false);
});
test('primary products remain unconfirmed in production crop settings', () => {
  for (const key of Object.keys(CROPS)) {
    assert.equal(CROPS[key].simummuangProductId, undefined);
    assert.equal(select(CROPS[key], [product(key)]).status, 'selection_required');
  }
});
test('no substitution for a confirmed primary with an invalid price', () => {
  const options = catalog[CROPS.kale.name];
  const second = copy(fixtures.find((item) => item._id === options[1].id));
  second.price = { large: { min: 40, max: 50 } };
  assert.equal(select(chosen('kale'), [product('kale', {}), second]).status, 'no_valid_price');
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
    const result = select(chosen(key), [item]);
    const large = item.price.large;
    assert.equal(result.available, large.min > 0 && large.min <= large.max);
    assert.equal(JSON.stringify(item), original);
    assert.equal(result.candidates[0].sizes[2].raw.min, large.min);
    if (large.min > large.max) assert.equal(result.candidates[0].sizes[2].status, 'invalid_range');
  });
}

// Load real server handlers into a sandbox: never opens a port, calls the network,
// reads actual history or writes to disk. Test the real pagination/cache/history code.
async function sandbox(respond, clock = { now: Date.parse('2026-11-04T06:00:00Z') }, initialHistory = [], policyEnv = {}) {
  let handler;
  let calls = 0;
  let writes = 0;
  let writeError = false;
  const ctx = vm.createContext({ URL, AbortSignal,
    Date: class extends Date { static now() { return clock.now; } },
    console: { log() {}, error() {}, warn() {} },
    process: { env: policyEnv, argv: [] }, tls: { rootCertificates: [] }, Agent: class {},
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify(initialHistory), writeFileSync: () => { if (writeError) throw Error('mock disk failure'); writes++; } },
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
  const code = source.replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///mock/server.js'));
  await vm.runInContext(`(async () => {${code}\nglobalThis.api={CROPS, getSimumuangPrice, savePriceHistory, getCropMarketData, saveDailyPrices, validateMarketPrice, inspectPriceFreshness, PRICE_POLICY, setSrimuang: (load) => { getSrimuangPrice = load; }};})()`, ctx);
  return { failWrites: (fail) => { writeError = fail; }, context: ctx, api: ctx.api, calls: () => calls, writes: () => writes,
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
  assert.equal(select(chosen('kale'), [{ ...product('kale'), _id: 'unverified-id' }]).status, 'product_not_found');
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
  assert.equal(result.status, 'product_not_found');
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
  assert.equal(record.schemaVersion, 2);
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
  assert.equal(history.length, 5002);
  assert.deepEqual(history.slice(0, 5001), legacy);
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
  const market = { market: 'ตลาดทดสอบ', unit: 'บาท/กก.', min: 20, max: 30,
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
      { size: 'small', status: 'invalid_range' }, { size: 'medium', status: 'missing_price' },
      { size: 'large', status: 'incomplete_range' },
    ] }] });
  for (const message of ['ช่วงราคาผิดปกติ', 'ไม่มีราคา', 'ช่วงราคาไม่ครบ']) assert.ok(candidateHtml.includes(message));
});
