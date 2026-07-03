import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');
const helperPath = path.join(rootDir, 'content_scripts', 'candidate_helpers.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(helperSource, sandbox, { filename: helperPath });

const helpers = sandbox.LanxingCandidateHelpers;
assert.ok(helpers, 'candidate helper API should be attached to globalThis');

assert.equal(helpers.normalizeStoredText('  A   B \n C  ', 20), 'A B C');
assert.equal(helpers.normalizeStoredText('abcdef', 3), 'abc...');
assert.equal(helpers.normalizeLongStoredText('A\r\n\r\n\r\n\r\nB', 50), 'A\n\n\nB');
assert.equal(helpers.normalizeLongStoredText('abcdef', 3), 'abc\n...[已截断]');

const candidate = {
  name: '张三',
  age: '26',
  education: '本科',
  extraInfo: [{ type: '优势', value: '  数据分析   广告投放  ' }, { type: '', value: '' }],
  geekCard: {
    encryptGeekId: 'geek-123',
    geekName: '张三',
    geekDegree: '硕士',
    geekEdu: { school: '深圳大学', major: '市场营销' },
    geekWorkYear: '3年',
    salary: '8-10K',
    expectPositionName: '亚马逊运营',
    expectLocationName: '深圳',
    applyStatusDesc: '离职-随时到岗',
    geekDesc: { content: '熟悉关键词广告和 Listing 优化。' },
  },
};

assert.equal(helpers.getCandidateStableId(candidate), 'geek-123');
assert.equal(helpers.getCandidateDisplayName({ candidateName: '李四' }), '李四');
const inferredIdentity = helpers.getCandidateIdentityFromAction({ candidate });
assert.equal(inferredIdentity.candidateId, 'geek-123');
assert.equal(inferredIdentity.candidateName, '张三');

const manualIdentity = helpers.getCandidateIdentityFromAction({ candidateId: 'manual-id', candidateName: '手填名', candidate });
assert.equal(manualIdentity.candidateId, 'manual-id');
assert.equal(manualIdentity.candidateName, '手填名');

const snapshot = helpers.buildApprovedCandidateSnapshot(candidate);
assert.equal(snapshot.candidateId, 'geek-123');
assert.equal(snapshot.candidateName, '张三');
assert.equal(snapshot.education, '本科');
assert.equal(snapshot.university, '深圳大学');
assert.equal(snapshot.major, '市场营销');
assert.equal(snapshot.workYears, '3年');
assert.equal(snapshot.selfIntro, '熟悉关键词广告和 Listing 优化。');
assert.equal(snapshot.extraInfo.length, 1);
assert.equal(snapshot.extraInfo[0].type, '优势');
assert.equal(snapshot.extraInfo[0].value, '数据分析 广告投放');

assert.equal(
  helpers.buildApprovedCandidateRecordId('job-1', '运营岗', candidate),
  'job-1::geek-123',
);
assert.equal(
  helpers.buildApprovedCandidateRecordId('', '运营岗', { name: '王五' }),
  '运营岗::王五',
);

const decisionText = helpers.buildDecisionCandidateText({
  simpleText: '基础摘要',
  detailText: '结构化详情',
  resumeText: 'OCR 全文',
});
assert.match(decisionText, /【候选人基础信息】\n基础摘要/);
assert.match(decisionText, /【候选人结构化信息】\n结构化详情/);
assert.match(decisionText, /【OCR简历全文】\nOCR 全文/);

assert.match(
  helpers.buildDecisionCandidateText({ ocrError: '图片模糊' }),
  /【OCR状态】未提取到可用全文：图片模糊/,
);
assert.equal(helpers.buildDecisionCandidateText(), '【OCR状态】未提取到可用全文');

console.log('Content candidate helper test passed');
