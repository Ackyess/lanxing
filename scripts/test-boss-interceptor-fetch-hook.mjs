import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(rootDir, 'content_scripts', 'sites', 'boss_interceptor.js'),
  'utf8',
);

const hookStart = source.indexOf('window.fetch = function (...args)');
assert.notEqual(hookStart, -1, 'fetch hook should be a plain function, not an async wrapper');

const ruleLine = source.indexOf('const rule = matchTargetRule(url);', hookStart);
const bypassLine = source.indexOf('if (!rule)', hookStart);
const originalFetchLine = source.indexOf('return originalFetch.apply(this, args);', hookStart);
const targetFetchLine = source.indexOf('return originalFetch.apply(this, args).then', hookStart);

assert.ok(ruleLine > hookStart, 'fetch hook should classify the URL before fetching');
assert.ok(bypassLine > ruleLine, 'fetch hook should branch on non-target URLs');
assert.ok(originalFetchLine > bypassLine, 'non-target fetches should return the original fetch directly');
assert.ok(targetFetchLine > originalFetchLine, 'target fetches should be the only wrapped fetches');

const hookBody = source.slice(hookStart, source.indexOf('// Hook XHR API', hookStart));
assert.doesNotMatch(hookBody, /await\s+originalFetch/, 'fetch hook must not await all page requests');

console.log('Boss interceptor fetch hook test passed');
