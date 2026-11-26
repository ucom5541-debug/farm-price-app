#!/usr/bin/env node
// Staging-only history-data publisher. No deployment or Git push in this file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateDailyAppend} from './daily-history-gate.mjs';

const RELEASE = 'test/auto-sync-release-20261122';
const PATH = 'server/price-history.json';
const allowedCrops = ['shallot','kale','pakchoi','chili','coriander','cucumber','longbean','celery','morningglory','cabbage'];
const [mode, outputFile] = process.argv.slice(2);
assert.ok(mode === 'prepare' || mode === 'verify', 'Expected prepare or verify');
assert.ok(outputFile && outputFile.startsWith('/'), 'Output must be an absolute path');
assert.equal(process.env.DEPLOY_BRANCH, RELEASE, 'Staging release branch mismatch');
assert.notEqual(process.env.DEPLOY_BRANCH, 'main', 'Production/default branch forbidden');

const mainSHA = process.env.EXPECTED_MAIN_SHA;
assert.match(mainSHA || '', /^[0-9a-f]{40}$/, 'Missing immutable upstream SHA');

function readGit(ref) {
  return JSON.parse(execFileSync('git', ['show', ref + ':' + PATH], {encoding:'utf8',maxBuffer:16*1024*1024}));
}
const old = readGit('refs/remotes/origin/' + RELEASE);
const main = readGit(mainSHA);
assert.ok(Array.isArray(old) && Array.isArray(main));
assert.ok(old.length >= 10);
assert.deepEqual(main.slice(0, old.length), old, 'Existing release history differs from approved source');

const lastDate = old.at(-1).date;
assert.match(lastDate, /^\d{4}-\d{2}-\d{2}$/);
const nextDate = new Date(Date.parse(lastDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const next = main.slice(old.length, old.length+10);
assert.equal(next.length,10,'Missing complete next-day batch');
assert.ok(next.every(row => row.date === nextDate),'Not exactly the next Bangkok day');
assert.deepEqual([...new Set(next.map(row=>row.crop))].sort(), [...allowedCrops].sort(), 'Daily batch must contain each of ten crops once');
if (main.length > old.length+10) {
  assert.ok(main[old.length+10].date > nextDate, 'The next day contains extra records');
}
const candidate = [...old,...next];
const report = validateDailyAppend(old,candidate,nextDate,{maxAppend:10});
assert.equal(report.appended,10);
if (mode === 'prepare') {
  fs.writeFileSync(outputFile,JSON.stringify(candidate,null,2)+'\n','utf8');
} else {
  const reviewed = JSON.parse(fs.readFileSync(outputFile,'utf8'));
  assert.deepEqual(reviewed,candidate,'Transferred artifact does not match pinned upstream history');
}
console.log(JSON.stringify({status:'STAGING_DATA_ONLY_PASS',mode,from:old.length,to:candidate.length,day:nextDate,crops:report.crops,upstreamSHA:mainSHA}));
