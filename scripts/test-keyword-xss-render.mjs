import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 源码级守护：关键词标签必须用 textContent 构建，绝不把用户关键词拼进 innerHTML。
// 无 DOM 环境，故对 keywords.js 源码做结构断言（防 XSS/DOM 注入回归）。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(rootDir, 'popup', 'modules', 'keywords.js'),
  'utf8',
);

const start = source.indexOf('function createTag(');
assert.notEqual(start, -1, 'createTag should exist');
const end = source.indexOf('\n}', start);
const body = source.slice(start, end);

// createTag 内不得出现 innerHTML 赋值
assert.doesNotMatch(body, /\.innerHTML\s*=/, 'createTag must not assign innerHTML');
// 关键词必须走 textContent
assert.match(body, /textContent\s*=\s*keyword/, 'keyword must be rendered via textContent');
// 不得把 keyword 用模板字符串插值进标记
assert.doesNotMatch(body, /`[^`]*\$\{keyword\}[^`]*`/, 'keyword must not be interpolated into an HTML template string');

console.log('Keyword XSS render test passed');
