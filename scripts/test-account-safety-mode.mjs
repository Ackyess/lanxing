import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const sandbox = {
  console,
  window: {},
  self: {},
  setTimeout,
  clearTimeout,
  AbortController,
};
sandbox.globalThis = sandbox;

vm.runInNewContext(
  fs.readFileSync(path.join(rootDir, 'utils', 'compliance.js'), 'utf8'),
  sandbox,
  { filename: 'utils/compliance.js' },
);
vm.runInNewContext(
  fs.readFileSync(path.join(rootDir, 'utils', 'prompts.js'), 'utf8'),
  sandbox,
  { filename: 'utils/prompts.js' },
);
vm.runInNewContext(
  fs.readFileSync(path.join(rootDir, 'utils', 'ai_helper.js'), 'utf8'),
  sandbox,
  { filename: 'utils/ai_helper.js' },
);

// --- 合规脱敏 ---
const compliance = sandbox.window.LANXING_COMPLIANCE;
assert.ok(compliance, 'LANXING_COMPLIANCE should be exposed on window');

const clean = compliance.filterText('该候选人经验匹配，建议查看详情');
assert.equal(clean.redacted, false);
assert.equal(clean.text, '该候选人经验匹配，建议查看详情');

for (const risky of ['加我微信详聊', '扫码进群', '留个QQ', '日结高薪轻松', '发身份证和银行卡']) {
  const r = compliance.filterText(risky);
  assert.equal(r.redacted, true, `should redact: ${risky}`);
  assert.match(r.text, /▇▇/, `should contain mask block: ${risky}`);
}
assert.doesNotMatch(compliance.filterText('加我微信详聊').text, /微信/);

// --- 只读卡片三档初筛 ---
const utils = sandbox.window.HR_AI_UTILS;
assert.equal(typeof utils.analyzeCandidateCard, 'function', 'analyzeCandidateCard should exist');

assert.equal(utils.normalizeCardLevel('推荐'), '推荐');
assert.equal(utils.normalizeCardLevel('优先沟通'), '推荐');
assert.equal(utils.normalizeCardLevel('不建议'), '不建议');
assert.equal(utils.normalizeCardLevel('淘汰'), '不建议');
assert.equal(utils.normalizeCardLevel('说不清'), '待定');
// M2 回归：否定词包含正向子串，不能被误判为“推荐”
assert.equal(utils.normalizeCardLevel('不推荐'), '不建议');
assert.equal(utils.normalizeCardLevel('非优先'), '不建议');
assert.equal(utils.normalizeCardLevel('not recommended'), '不建议');

async function cardWith(response) {
  utils.sendRequest = async () => ({ success: true, response });
  return await utils.analyzeCandidateCard(
    '姓名: 张三\n学历: 本科\n期望: 运营',
    '运营岗',
    '要求本科以上，1年运营经验',
    { token: 'test-token', model: 'test-model' },
  );
}

const rec = await cardWith(JSON.stringify({ level: '推荐', reason: '经验与岗位匹配' }));
assert.equal(rec.level, '推荐');
assert.equal(rec.reason, '经验与岗位匹配');

const no = await cardWith(JSON.stringify({ level: '不建议', reason: '方向不符' }));
assert.equal(no.level, '不建议');

// M2 端到端：AI 返回“不推荐”时必须判为“不建议”（否则会误标绿并入池）
const rejected = await cardWith(JSON.stringify({ level: '不推荐', reason: '经验不符' }));
assert.equal(rejected.level, '不建议');

// 非结构化响应保守归入“待定”，不误判为推荐
const vague = await cardWith('这个人看起来还行吧');
assert.equal(vague.level, '待定');

// 缺 Token 直接返回待定，不发起请求
const noToken = await utils.analyzeCandidateCard('x', 'y', 'z', {});
assert.equal(noToken.level, '待定');
assert.match(noToken.reason, /Token/);

console.log('Account safety mode test passed');
