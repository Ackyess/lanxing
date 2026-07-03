import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 源码级守护：确保账号安全模式的“硬门禁 + 允许清单”不被回归破坏。
// 无法在 node 里跑真实 onMessage 监听（依赖 chrome/DOM），故对内容脚本源码做结构断言。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(rootDir, 'content_scripts', 'index.js'),
  'utf8',
);

// 1) 允许清单存在且内容正确
const setMatch = source.match(/const SAFETY_ALLOWED_MESSAGE_TYPES = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(setMatch, 'SAFETY_ALLOWED_MESSAGE_TYPES set should exist');
const allowed = new Set(
  [...setMatch[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]),
);

const mustAllow = ['PING_CONTENT', 'STOP_SCROLL', 'ANALYZE_VISIBLE_CANDIDATES'];
for (const t of mustAllow) {
  assert.ok(allowed.has(t), `${t} must be on the strict allowlist`);
}

// 任何平台自动化动作都不得出现在允许清单里
const mustBlock = [
  'START_AI_SCROLL',
  'GREET_CANDIDATE',
  'OPEN_FIRST_DETAIL',
  'SYNC_BOSS_JOBS',
  'SWITCH_RECOMMEND_JOB',
  'GET_RESUME_RECT',
  'CLOSE_DETAIL',
  'SCROLL_TO_NEXT',
];
for (const t of mustBlock) {
  assert.ok(!allowed.has(t), `${t} must NOT be on the strict allowlist`);
}

// 2) 门禁代码存在：严格模式下非允许消息返回 ACCOUNT_SAFETY_MODE_BLOCKED
assert.match(
  source,
  /if \(ACCOUNT_SAFETY_STRICT && !SAFETY_ALLOWED_MESSAGE_TYPES\.has\(messageType\)\)/,
  'strict-mode gate condition must exist before the switch',
);
assert.match(source, /ACCOUNT_SAFETY_MODE_BLOCKED/, 'gate must return ACCOUNT_SAFETY_MODE_BLOCKED');

// 门禁必须位于 HANDLED 校验之后、message 分发 switch 之前
const handledIdx = source.indexOf('if (!HANDLED_MESSAGE_TYPES.has(messageType))');
const gateIdx = source.indexOf('ACCOUNT_SAFETY_STRICT && !SAFETY_ALLOWED_MESSAGE_TYPES.has(messageType)');
const switchIdx = source.indexOf('switch (message.action || message.type)');
assert.ok(handledIdx !== -1 && gateIdx !== -1 && switchIdx !== -1, 'gate anchors should be present');
assert.ok(handledIdx < gateIdx && gateIdx < switchIdx, 'gate must sit between HANDLED check and switch dispatch');

// 3) 默认 fail-safe：标记初始化为严格
assert.match(source, /let ACCOUNT_SAFETY_STRICT = true;/, 'ACCOUNT_SAFETY_STRICT must default to strict');

// 4) 自动化循环内有严格护栏与熔断（H2/H3）
assert.match(source, /async function executeScroll\(\)[\s\S]{0,400}if \(ACCOUNT_SAFETY_STRICT\)/, 'executeScroll must hard-stop when strict');
assert.match(source, /async function executeScroll\(\)[\s\S]{0,800}detectPlatformRisk\(\)/, 'executeScroll must run the circuit breaker');

console.log('Safety gate allowlist test passed');
