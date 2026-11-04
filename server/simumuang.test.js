import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Evaluate only pure declarations from the real server: no HTTP, history writes,
// API calls, certificates, or server startup are performed by these tests.
const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
const context = vm.createContext({ console: { log() {} } });
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing server section: ${start}`);
  return source.slice(from, to);
}
vm.runInContext([
  section('const CROPS =', 'const SRIMUANG_URL'),
  section('function round2(', 'function average('),
  section('function getSimumuangName(', 'let simuMuangItemsCache'),
  section('function getSimumuangPriceFromItems(', 'async function getCropMarketData('),
  'globalThis.subject = { CROPS, getSimumuangPriceFromItems, getSimumuangRange };',
].join('\n'), context);
const { CROPS, getSimumuangPriceFromItems: select, getSimumuangRange: range } = context.subject;
// Synthetic prices are confined to tests and never used by the application.
const item = (name, price = { small: { min: 20, max: 30 } }) => ({ th: { name }, price });
const names = {
  shallot: 'ต้นหอม', kale: 'คะน้า', pakchoi: 'กวางตุ้ง', chili: 'พริกจินดาแดง',
  coriander: 'ผักชีไทย', cucumber: 'แตงกวา', longbean: 'ถั่วฝักยาว',
  celery: 'คึ่นช่าย', morningglory: 'ผักบุ้งจีน', cabbage: 'กะหล่ำปลี',
};
assert.deepEqual(Object.keys(names).sort(), Object.keys(CROPS).sort());
for (const [key, name] of Object.entries(names)) {
  test(`supported crop: ${key}`, () => {
    const result = select(CROPS[key], [item(name)]);
    assert.equal(result.available, true);
    assert.equal(result.productName, name);
    assert.equal(result.min, 20);
    assert.equal(result.max, 30);
    assert.equal(result.mid, 25);
    assert.equal(result.unit, 'บาท/กก.');
  });
}

test('skip first match without price, including identical names', () => {
  for (const firstName of ['คะน้า', 'คะน้าต้น']) {
    const result = select(CROPS.kale, [item(firstName, {}), item('คะน้า')]);
    assert.equal(result.available, true);
    assert.equal(result.mid, 25);
  }
});
test('duplicate valid names use stable API order', () => {
  assert.equal(select(CROPS.kale, [item('คะน้า'), item('คะน้า', { small: { min: 40, max: 50 } })]).mid, 25);
});
test('specific chili name wins over broad name regardless of order', () => {
  const items = [item('พริก'), item('พริกจินดาแดง')];
  for (const list of [items, [...items].reverse()]) {
    assert.equal(select(CROPS.chili, list).productName, 'พริกจินดาแดง');
  }
});
test('exact match wins over a suffixed match of equal specificity', () => {
  assert.equal(select(CROPS.kale, [item('คะน้าต้น'), item('คะน้า')]).productName, 'คะน้า');
});
test('shallot never selects red onion', () => {
  assert.equal(select(CROPS.shallot, [item('หอมแดง'), item('ต้นหอม')]).productName, 'ต้นหอม');
  assert.equal(select(CROPS.shallot, [item('หอมแดง')]).available, false);
  assert.equal(select(CROPS.shallot, [item('หอมแดง'), item('ต้นหอม', {})]).reason, 'ไม่มีข้อมูลราคา');
});
test('configured celery spelling is used', () => {
  assert.equal(select(CROPS.celery, [item('คึ่นช่าย')]).available, true);
});
test('missing, invalid, zero and negative prices are rejected', () => {
  for (const price of [undefined, null, {}, { small: { min: 'bad', max: null } },
    { small: { min: 0, max: -1 } }, { small: { min: Infinity, max: NaN } }]) {
    const product = { th: { name: 'คะน้า' }, price };
    assert.equal(range(product), null);
    assert.equal(select(CROPS.kale, [product]).reason, 'ไม่มีข้อมูลราคา');
    assert.equal(select(CROPS.kale, [product, item('คะน้า')]).available, true);
  }
});
test('existing nested numeric-string price format remains supported', () => {
  const result = range(item('คะน้า', { small: { min: '20', max: '30' }, large: { min: 40, max: 50 } }));
  assert.equal(result.min, 20);
  assert.equal(result.max, 50);
});
test('unconfirmed flat and numeric-size formats remain unsupported', () => {
  assert.equal(range(item('คะน้า', { min: 20, max: 30 })), null);
  assert.equal(range(item('คะน้า', { small: 20, medium: 25, large: 30 })), null);
});
test('existing variety exclusions remain intact', () => {
  assert.equal(select(CROPS.cucumber, [item('แตงกวาญี่ปุ่น'), item('แตงกวา')]).productName, 'แตงกวา');
  assert.equal(select(CROPS.coriander, [item('ผักชีฝรั่ง'), item('ผักชีไทย')]).productName, 'ผักชีไทย');
});
test('empty or unrelated items return product-not-found', () => {
  for (const items of [[], [null, {}, { name: 123 }, item('มะเขือเทศ')]]) {
    assert.equal(select(CROPS.kale, items).reason, 'วันนี้ API ไม่พบสินค้ารายการนี้');
  }
});

for (const [label, value] of [
  ['true', true], ['false', false], ['null', null],
  ['empty string', ''], ['whitespace', ' \t\n '],
]) {
  test(`reject price value: ${label}`, () => {
    for (const size of ['small', 'medium', 'large']) {
      const product = item('คะน้า', { [size]: { min: value, max: value } });
      assert.equal(range(product), null);
      assert.equal(select(CROPS.kale, [product]).available, false);
      assert.equal(select(CROPS.kale, [product, item('คะน้า')]).mid, 25);
      // A rejected endpoint must not hide a valid endpoint.
      for (const endpoints of [{ min: value, max: 30 }, { min: 30, max: value }]) {
        const result = range(item('คะน้า', { [size]: endpoints }));
        assert.equal(result.min, 30);
        assert.equal(result.max, 30);
      }
    }
  });
}

for (const value of [1, 20.5, '1', '20.50', ' 20.50 ']) {
  test(`accept existing numeric price: ${JSON.stringify(value)}`, () => {
    for (const size of ['small', 'medium', 'large']) {
      const product = item('คะน้า', { [size]: { min: value, max: value } });
      const result = range(product);
      assert.equal(result.min, Number(value));
      assert.equal(result.max, Number(value));
      assert.equal(select(CROPS.kale, [product]).available, true);
      assert.equal(select(CROPS.kale, [product]).mid, Number(value));
    }
  });
}

test('do not coerce arrays or objects into prices', () => {
  for (const value of [[20], { valueOf: () => 20 }]) {
    assert.equal(range(item('คะน้า', { small: { min: value, max: value } })), null);
  }
});
