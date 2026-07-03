import assert from 'node:assert/strict';
import {
  buildCandidatePromptText,
  buildExportPayload,
  buildExportRows,
} from '../popup/modules/talent_pool_export.js';

const longResumeText = [
  '工作经历',
  '2022.01-2025.03 某跨境电商公司 亚马逊运营',
  '负责广告投放、Listing 优化、库存周转和利润复盘。',
  '项目经历',
  '独立完成新品从 0 到 1 冷启动，并持续跟踪关键词排名。',
].join('\n');

const item = {
  id: 'job-1::candidate-1',
  candidateName: '宋昊燃',
  positionId: 'job-1',
  positionName: '亚马逊运营专员',
  jobDescription: '需要英语能力、亚马逊运营经验、数据分析能力。',
  aiReason: '学历英语匹配',
  detailText: '姓名：宋昊燃\n年龄：25岁',
  resumeText: longResumeText,
  simpleText: '姓名：宋昊燃 年龄：25岁 学历：硕士',
  snapshot: {
    workYears: '25年应届生',
    education: '硕士',
    university: '谢菲尔德大学',
    expectedPosition: '亚马逊运营',
    expectedLocation: '深圳',
    salary: '5-6K',
    activeText: '离职-随时到岗',
  },
  approvedAt: 1778510847935,
  firstApprovedAt: 1778510847935,
};

const noisyItem = {
  ...item,
  resumeText: [
    '推荐牛人',
    '推荐',
    'A',
    '',
    '宋昊燃  刚刚活跃',
    longResumeText,
  ].join('\n'),
};

const promptText = buildCandidatePromptText(item);
assert.match(promptText, /【在线简历\/OCR全文】/);
assert.match(promptText, /2022\.01-2025\.03 某跨境电商公司/);
assert.doesNotMatch(promptText, /需要英语能力、亚马逊运营经验、数据分析能力/);
assert.match(promptText, /【岗位要求引用】job-1/);
assert.ok(promptText.length > item.detailText.length * 4, 'model prompt should be richer than detailText');

const [row] = buildExportRows([item]);
assert.equal(row.resumeText, longResumeText);
assert.equal(row.detailText, item.detailText);
assert.equal(row.simpleText, item.simpleText);
assert.equal(row.positionContextKey, 'job-1');
assert.equal(row.jobDescription, undefined);
assert.equal(row.hasResumeText, true);
assert.equal(row.resumeTextLength, longResumeText.length);
assert.ok(row.modelPromptTextLength > row.detailTextLength);
assert.equal(row.modelPromptText, promptText);
assert.match(row.modelPromptText, /【候选人】宋昊燃/);
assert.doesNotMatch(row.modelPromptText, /需要英语能力、亚马逊运营经验、数据分析能力/);

const payload = buildExportPayload([item], { exportedAt: '2026-05-11T00:00:00.000Z' });
assert.equal(payload.schemaVersion, 2);
assert.equal(payload.positionContexts.length, 1);
assert.equal(payload.positionContexts[0].jobDescription, item.jobDescription);
assert.equal(payload.candidates.length, 1);
assert.equal(payload.candidates[0].positionContextKey, payload.positionContexts[0].positionContextKey);

const [noisyRow] = buildExportRows([noisyItem]);
assert.doesNotMatch(noisyRow.resumeText, /推荐牛人/);
assert.doesNotMatch(noisyRow.resumeText, /^推荐$/m);
assert.doesNotMatch(noisyRow.resumeText, /^A$/m);
assert.match(noisyRow.resumeText, /^宋昊燃\s+刚刚活跃/);

console.log('Talent pool export test passed');
