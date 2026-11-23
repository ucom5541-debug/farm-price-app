// Pure, production-candidate history gate. No network, credentials, git writes or deployment.
import assert from 'node:assert/strict';

export const CROPS = new Set(['shallot','kale','pakchoi','chili','coriander','cucumber','longbean','celery','morningglory','cabbage']);
export function bangkokDay(value) {
  assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid timestamp');
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function validateDailyAppend(baseline, candidate, expectedDate, {maxAppend=20}={}) {
  assert.ok(Array.isArray(baseline) && Array.isArray(candidate), 'History must be arrays');
  assert.match(expectedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(candidate.length > baseline.length, 'No new history records; do not deploy');
  assert.ok(candidate.length - baseline.length <= maxAppend, 'Too many new records');
  for (let i=0;i<baseline.length;i++) assert.deepEqual(candidate[i],baseline[i],`Old record changed at ${i}`);
  const seen = new Set();
  for (const row of baseline) {
    assert.ok(row && typeof row === 'object', 'Malformed baseline record');
    // Legacy records predate eventId. Their unchanged bytes are protected above.
    if (row.schemaVersion === 3) assert.ok(typeof row.eventId === 'string' && row.eventId, 'Invalid v3 baseline eventId');
    if (row.eventId !== undefined && row.eventId !== null) {
      assert.ok(typeof row.eventId === 'string' && row.eventId, 'Invalid baseline eventId');
      assert.ok(!seen.has(row.eventId), 'Duplicate baseline eventId');
      seen.add(row.eventId);
    }
  }
  const newCrops = new Set();
  for(const row of candidate.slice(baseline.length)){
    assert.ok(row && typeof row === 'object');
    assert.equal(row.schemaVersion,3);
    assert.equal(row.recordType,'market_append');
    assert.ok(CROPS.has(row.crop), 'Unknown crop');
    assert.ok(typeof row.name === 'string' && row.name.trim(), 'Missing name');
    assert.equal(row.date,expectedDate,'Unexpected Bangkok observation date');
    assert.equal(bangkokDay(row.timestamp),expectedDate,'Timestamp and date disagree');
    assert.ok(typeof row.eventId==='string' && row.eventId && !seen.has(row.eventId),'Duplicate or missing eventId');
    seen.add(row.eventId);
    assert.ok(!newCrops.has(row.crop),'Duplicate crop in same daily batch');
    newCrops.add(row.crop);
    assert.ok(Array.isArray(row.markets) && row.markets.length>0,'No market observations');
  }
  return {previous:baseline.length,total:candidate.length,appended:candidate.length-baseline.length,crops:[...newCrops],date:expectedDate};
}
