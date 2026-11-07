import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const helper = app.slice(app.indexOf('function formatMarketTime('), app.indexOf('const CROPS ='));
const context = vm.createContext({ URL });
vm.runInContext(helper + ';globalThis.api={safeConnectionDetails,marketIssueMessage};', context);
const { safeConnectionDetails: details, marketIssueMessage: message } = context.api;
const privateError = 'https://username:DO_NOT_EXPOSE_PASSWORD@www.taladsrimuang.com/private/DO_NOT_EXPOSE_PATH?api_key=DO_NOT_EXPOSE_QUERY#DO_NOT_EXPOSE_FRAGMENT ตอบกลับ 503 Authorization: Bearer DO_NOT_EXPOSE_HEADER';

test('connection diagnostics expose only public allowlisted host and HTTP status', () => {
  const result = details(privateError).join(' ');
  assert.ok(result.includes('www.taladsrimuang.com'));
  assert.ok(result.includes('HTTP: 503'));
  assert.ok(!result.includes('DO_NOT_EXPOSE'));
  assert.ok(!result.includes('username'));
  assert.ok(!result.includes('https://'));
});
test('unknown destinations, credentials and arbitrary long error content are omitted', () => {
  assert.equal(details('https://SECRET_HOST.example/path?token=SECRET_QUERY').length, 0);
  assert.equal(details('Authorization: Bearer SECRET_HEADER').length, 0);
  assert.equal(details('X'.repeat(10000)).length, 0);
});
test('invalid diagnostic input and malformed URLs do not throw', () => {
  for (const input of [null, undefined, {}, 503, 'https://[invalid']) {
    assert.doesNotThrow(() => details(input));
    assert.equal(details(input).length, 0);
  }
});
test('safe network codes remain available for diagnosis', () => {
  assert.ok(details('fetch failed EAI_AGAIN').join(' ').includes('EAI_AGAIN'));
  assert.equal(details('HTTP 503 HTTP 503').filter((text) => text.includes('503')).length, 1);
});
test('load failures use a short Thai explanation, never the raw URL or token', () => {
  const result = message({ status: 'load_failed', reason: privateError });
  assert.ok(result.includes('ตลาดโหลดข้อมูลไม่สำเร็จ'));
  assert.ok(!result.includes('https://'));
  assert.ok(!result.includes('DO_NOT_EXPOSE'));
});
test('quality, freshness and selected-size explanations remain explicit', () => {
  for (const [status, expected] of [['invalid_range', 'ช่วงราคาผิดปกติ'], ['stale', 'ราคาเก่า'],
    ['expired', 'หมดอายุ'], ['missing_price', 'ไม่มีราคา'], ['unknown_timestamp', 'ไม่สามารถยืนยันเวลาราคา']]) {
    assert.ok(message({ status }).includes(expected));
  }
  assert.ok(message({ status: 'selected_size_unavailable', selectedSizeStatus: 'invalid_range' }).includes('ช่วงราคาผิดปกติ'));
  assert.ok(message({ status: 'selected_size_unavailable', selectedSizeStatus: 'incomplete_range' }).includes('ศูนย์ด้านเดียว'));
});
test('unknown API status cannot reflect arbitrary unsafe raw reasons', () => {
  const result = message({ status: 'unknown', reason: privateError });
  assert.ok(!result.includes('DO_NOT_EXPOSE'));
  assert.ok(result.includes('ยังไม่มีราคา'));
});
test('actual market JSX preserves prices and large size while safely presenting connection diagnostics', async () => {
  const start = app.indexOf('<div className="market-list">');
  const end = app.indexOf('\n</div>', start) + '\n</div>'.length;
  const { code } = await transformWithOxc(helper + '\nfunction View({item}) { return (' +
    app.slice(start, end) + '); }\nglobalThis.View=View;', 'layout.jsx', { jsx: { runtime: 'classic' } });
  const ctx = vm.createContext({ React, URL });
  vm.runInContext(code, ctx);
  const html = renderToStaticMarkup(React.createElement(ctx.View, { item: { markets: [
    { market: 'ตลาดศรีเมือง ราชบุรี', available: false, status: 'load_failed', reason: privateError },
    { market: 'ตลาดสี่มุมเมือง', available: true, verifiedCurrent: true, productName: 'ต้นคะน้า',
      selectedSize: 'large', min: 42, max: 48, sourceUpdatedAt: '2026-11-05T01:00:00Z' },
  ] } }));
  for (const text of ['ตลาดศรีเมือง ราชบุรี', 'ตลาดสี่มุมเมือง', 'ต้นคะน้า', '(large)', '42 - 48', 'ราคาปัจจุบันที่ผ่านการตรวจสอบ',
    'ตลาดโหลดข้อมูลไม่สำเร็จ', 'รายละเอียดการเชื่อมต่อที่ปลอดภัย', 'HTTP: 503']) assert.ok(html.includes(text));
  assert.ok(!html.includes('DO_NOT_EXPOSE'));
});

test('price page and combined-status headings describe both markets without claiming freshness', async () => {
  const start = app.indexOf('<header', app.indexOf("if (page === 'prices')"));
  const header = app.slice(start, app.indexOf('</header>', start) + '</header>'.length);
  const statusHeading = app.match(/<h3>🏪[^<]*<\/h3>/)?.[0];
  assert.ok(statusHeading, 'combined status heading exists');
  const { code } = await transformWithOxc(`function View() { return (<>${header}${statusHeading}</>); }\nglobalThis.View=View;`,
    'headings.jsx', { jsx: { runtime: 'classic' } });
  const ctx = vm.createContext({ React });
  vm.runInContext(code, ctx);
  const html = renderToStaticMarkup(React.createElement(ctx.View));
  assert.ok(html.includes('สถานะระบบราคาตลาด'));
  assert.ok(html.includes('เปรียบเทียบราคาจากตลาดสี่มุมเมืองและตลาดศรีเมือง ราชบุรี'));
  assert.ok(!html.includes('ข้อมูลล่าสุดจากตลาดสี่มุมเมือง'));
});
