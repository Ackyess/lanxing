import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'content_scripts', 'index.js'), 'utf8');

const start = source.indexOf('function addHighlightReason');
const end = source.indexOf('// 处理单个元素的函数', start);
assert.ok(start >= 0 && end > start, 'addHighlightReason should exist');

const block = source.slice(start, end);
assert.match(block, /left:\s*50%/);
assert.match(block, /transform:\s*translateX\(-50%\)/);
assert.doesNotMatch(block, /left:\s*0;/);
assert.match(block, /max-width:/);
assert.match(block, /white-space:\s*normal/);
assert.match(block, /overflow:\s*visible/);
assert.match(block, /word-break:\s*break-word/);
assert.doesNotMatch(block, /text-overflow:\s*ellipsis/);
assert.doesNotMatch(block, /white-space:\s*nowrap/);

console.log('Highlight reason position test passed');
