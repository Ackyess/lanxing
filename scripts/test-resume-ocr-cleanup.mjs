import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'utils', 'ai_helper.js'), 'utf8');

const sandbox = { console, self: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'utils/ai_helper.js' });

const utils = sandbox.self.HR_AI_UTILS;
assert.ok(utils?.sanitizeResumeOcrText, 'sanitizeResumeOcrText should be exposed');

const noisyText = [
  '推荐牛人',
  '推荐',
  'A',
  'A',
  '',
  '李金月  刚刚活跃',
  '24岁 | 1年 | 本科 | 离职-随时到岗',
  '工作经历    杭州微宜美电子商务有限公司  |  新媒体运营  实习',
].join('\n');

const cleaned = utils.sanitizeResumeOcrText(noisyText, '姓名: 李金月 年龄: 24岁');

assert.doesNotMatch(cleaned, /推荐牛人/);
assert.doesNotMatch(cleaned, /^推荐$/m);
assert.doesNotMatch(cleaned, /^A$/m);
assert.match(cleaned, /^李金月\s+刚刚活跃/);
assert.match(cleaned, /工作经历/);

console.log('Resume OCR cleanup test passed');
