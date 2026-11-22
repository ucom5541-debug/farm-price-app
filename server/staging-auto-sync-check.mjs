#!/usr/bin/env node
// Staging-only regression checks. Reads local fixtures and history; never writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const historyFile = 'server/price-history.json';
const newHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
assert.ok(Array.isArray(newHistory), 'History must be a JSON array');
const allowed = new Set(['shallot','kale','pakchoi','chili','coriander','cucumber','longbean','celery','morningglory','cabbage']);
const bangkokDay = value => {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const f = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${f.year}-${f.month}-${f.day}`;
};
function validateAppend(previous, proposed, expectedDate) {
  assert.ok(Array.isArray(previous) && Array.isArray(proposed), 'History must be arrays');
  assert.ok(proposed.length >= previous.length, 'History shortened');
  assert.ok(proposed.length - previous.length <= 20, 'More than 20 new records');
  for(let i=0;i<previous.length;i++) assert.deepEqual(proposed[i], previous[i], `History overwritten at index ${i}`);
  const ids = new Set(previous.map(r=>r.eventId).filter(Boolean));
  for(const row of proposed.slice(previous.length)) {
    assert.equal(row.schemaVersion, 3);
    assert.equal(row.recordType, 'market_append');
    assert.ok(allowed.has(row.crop), 'Invalid crop');
    assert.equal(row.date, expectedDate);
    assert.equal(bangkokDay(row.timestamp), expectedDate);
    assert.ok(typeof row.eventId==='string' && row.eventId && !ids.has(row.eventId), 'Duplicate eventId');
    ids.add(row.eventId);
    assert.ok(Array.isArray(row.markets) && row.markets.length, 'Missing markets');
  }
}
function mustReject(name, fn) {assert.throws(fn, undefined, `${name} should fail`);}
const ids = newHistory.map(r=>r.eventId).filter(Boolean);
assert.equal(ids.length,new Set(ids).size,'Existing history contains duplicate eventIds');
assert.ok(newHistory.length > 0);
const last = newHistory.at(-1);
const d = last.date || bangkokDay(last.timestamp);
const copy = structuredClone(newHistory);
validateAppend(copy, copy, d);
const sample = {schemaVersion:3, recordType:'market_append',crop:'shallot',name:'หอมแบ่ง',date:d,timestamp:new Date().toISOString(),eventId:'staging-test-unique-id',markets:[{market:'ตลาดศรีเมือง ราชบุรี'}]};
const event = {...sample,timestamp:last.timestamp};
validateAppend(copy,[...copy,event],d);
mustReject('old history edit', ()=>validateAppend(copy,[{...copy[0],crop:'tampered'},...copy.slice(1)],d));
mustReject('history deletion', ()=>validateAppend(copy,copy.slice(0,-1),d));
mustReject('eventId duplication', ()=>validateAppend(copy,[...copy,{...event,eventId:ids.at(-1)}],d));
mustReject('bad observation date', ()=>validateAppend(copy,[...copy,{...event,date:'2000-01-01'}],d));
mustReject('unapproved crop', ()=>validateAppend(copy,[...copy,{...event,crop:'unknown'}],d));
mustReject('more than 20 appends', ()=>validateAppend(copy,[...copy,...Array.from({length:21},(_,i)=>({...event,eventId:'synthetic-'+i}))],d));
const envTarget = process.env.STAGING_RENDER_SERVICE_ID;
assert.notEqual(envTarget, 'srv-dajd485g1s2s73a9r850', 'PRODUCTION BACKEND IS FORBIDDEN');
assert.notEqual(envTarget, 'srv-dbguk5d9fdbs73d44ung', 'PRODUCTION FRONTEND IS FORBIDDEN');
if(envTarget) assert.equal(envTarget, 'srv-dc1dtf2fngtc73fd19bg', 'Unexpected staging target');
const sha = process.env.GITHUB_SHA;
if(sha) assert.match(sha,/^[0-9a-f]{40}$/);
console.log('STAGING CHECK OK: read-only regression cases passed; records='+newHistory.length+'; target=staging only');
