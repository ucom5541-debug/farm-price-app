import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateDailyAppend} from './daily-history-gate.mjs';
const actual=JSON.parse(fs.readFileSync('server/price-history.json','utf8'));
const old=structuredClone(actual.slice(0,-10));
const fresh=structuredClone(actual.slice(-10));
const day=fresh[0].date;
const expected=[...old,...fresh];
test('real historical daily batch is append-only',()=>{
  assert.equal(fresh.length,10);
  assert.equal(new Set(fresh.map(x=>x.crop)).size,10);
  assert.deepEqual(validateDailyAppend(old,expected,day).appended,10);
});
const reject=(name,proposal,date=day)=>test(name,()=>assert.throws(()=>validateDailyAppend(old,proposal,date)));
reject('reject changed previous record',[{...old[0],crop:'unknown'},...old.slice(1),...fresh]);
reject('reject deleted previous record',[...old.slice(0,-1),...fresh]);
reject('reject duplicate event id',[...old,...fresh.slice(0,9),{...fresh[9],eventId:old.find(x=>typeof x.eventId==='string' && x.eventId).eventId}]);
reject('reject duplicate crop',[...old,...fresh.slice(0,9),{...fresh[9],crop:fresh[0].crop}]);
reject('reject invalid observation day',[...old,...fresh.slice(0,9),{...fresh[9],date:'2000-01-01'}]);
reject('reject invalid timestamp',[...old,...fresh.slice(0,9),{...fresh[9],timestamp:'not-a-date'}]);
reject('reject unknown crop',[...old,...fresh.slice(0,9),{...fresh[9],crop:'unknown'}]);
reject('reject missing markets',[...old,...fresh.slice(0,9),{...fresh[9],markets:[]}]);
reject('reject more than 20 new records',[...old,...fresh,...Array.from({length:11},(_,i)=>({...fresh[0],eventId:'extra-'+i}))]);
reject('reject no-op history',old);
test('reject yesterday when expecting today',()=>assert.throws(()=>validateDailyAppend(old,expected,'2026-12-31')));
test('valid partial daily batch',()=>assert.equal(validateDailyAppend(old,[...old,fresh[0]],day).appended,1));

test('future daily batch is accepted without a fixed replay date',()=>{
  const futureDate='2026-12-02';
  const tomorrow=fresh.map((row,i)=>({...row,date:futureDate,timestamp:'2026-12-02T01:17:00.000Z',eventId:'future-staging-'+i}));
  const result=validateDailyAppend(actual,[...actual,...tomorrow],futureDate);
  assert.equal(result.appended,10);
  assert.equal(result.date,futureDate);
});
test('future batch with mismatched Bangkok day is rejected',()=>{
  const future={...fresh[0],date:'2026-12-02',timestamp:'2026-12-01T01:17:00.000Z',eventId:'future-mismatch'};
  assert.throws(()=>validateDailyAppend(actual,[...actual,future],'2026-12-02'));
});
test('future day should not deploy when no data is added',()=>{
  assert.throws(()=>validateDailyAppend(actual,actual,'2026-12-02'));
});
