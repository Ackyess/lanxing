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
  fs.readFileSync(path.join(rootDir, 'utils', 'prompts.js'), 'utf8'),
  sandbox,
  { filename: 'utils/prompts.js' },
);
vm.runInNewContext(
  fs.readFileSync(path.join(rootDir, 'utils', 'ai_helper.js'), 'utf8'),
  sandbox,
  { filename: 'utils/ai_helper.js' },
);

const prompts = sandbox.window.HR_SYSTEM_PROMPTS;
const utils = sandbox.window.HR_AI_UTILS;
assert.ok(prompts, 'HR_SYSTEM_PROMPTS should be exposed on window');
assert.ok(utils, 'HR_AI_UTILS should be exposed on window');

const screeningPrompt = `${prompts.SYSTEM_PROMPT}\n${prompts.USER_PROMPT}`;
assert.match(screeningPrompt, /小公司/);
assert.match(screeningPrompt, /默认谨慎筛选/);
assert.match(screeningPrompt, /不要过度保守/);
assert.match(screeningPrompt, /score\s*>=\s*84|84-89/);
assert.match(screeningPrompt, /可培养|有基础/);
assert.match(screeningPrompt, /极其亮眼|破格通过|破例通过/);
assert.match(screeningPrompt, /亚马逊.*AI|Amazon.*AI/);
assert.match(screeningPrompt, /适度加分/);
assert.match(screeningPrompt, /不能.*单独.*通过|不能.*替代/);
assert.doesNotMatch(screeningPrompt, /是否值得查看这位候选人的详细信息/);

async function analyzeWith(response) {
  utils.sendRequest = async () => ({ success: true, response });
  return await utils.analyzeCandidateResume(
    'data:image/png;base64,abc',
    '候选人：A，本科，应届生，英语四级',
    '亚马逊运营',
    '要求 1 年以上 Amazon 运营经验，熟悉广告投放、Listing、FBA 和数据分析。',
    { token: 'test-token', model: 'test-model' },
  );
}

const weakPositive = await analyzeWith(JSON.stringify({
  decision: '是',
  score: 70,
  fitLevel: '可培养',
  reason: '学历英语匹配，可培养',
}));
assert.equal(weakPositive.decision, '否');
assert.match(weakPositive.reason, /未达通过线|弱通过/);

const strongPositive = await analyzeWith(JSON.stringify({
  decision: '是',
  score: 90,
  fitLevel: '强匹配',
  reason: '有 Amazon 广告投放、Listing 优化和 FBA 补货经验，薪资匹配，可优先沟通',
}));
assert.equal(strongPositive.decision, '是');

const vagueText = await analyzeWith('不是很匹配，但学历是本科，可以再看看');
assert.equal(vagueText.decision, '否');

const missingScore = await analyzeWith(JSON.stringify({
  decision: '是',
  fitLevel: '可培养',
  reason: '意向符合，有基础',
}));
assert.equal(missingScore.decision, '否');
assert.match(missingScore.reason, /缺少评分|弱通过/);

const exceptionalPositive = await analyzeWith(JSON.stringify({
  decision: '是',
  score: 82,
  fitLevel: '破格通过',
  reason: '极其亮眼：独立从0到1搭建广告和Listing优化流程，ACOS明显下降，有清楚结果，可破格通过',
  evidence: ['从0到1搭建广告和Listing优化流程', 'ACOS 从 38% 降到 18%'],
  risks: ['工作年限略低'],
}));
assert.equal(exceptionalPositive.decision, '是');
assert.match(exceptionalPositive.reason, /破格通过/);

const amazonAiPositive = await analyzeWith(JSON.stringify({
  decision: '是',
  score: 83,
  fitLevel: '可沟通',
  reason: '有亚马逊AI选品项目，能用AI分析竞品评论、优化Listing卖点，并结合广告数据迭代',
  evidence: ['亚马逊AI选品项目', 'AI分析竞品评论并优化Listing卖点'],
  risks: ['正式工作年限略短'],
}));
assert.equal(amazonAiPositive.decision, '是');
assert.match(amazonAiPositive.reason, /AI项目加分|亚马逊AI/);

const shallowAiMention = await analyzeWith(JSON.stringify({
  decision: '是',
  score: 78,
  fitLevel: '可培养',
  reason: '会使用ChatGPT，有AI兴趣，但亚马逊运营证据不足',
  evidence: ['会使用ChatGPT'],
  risks: ['无亚马逊实操'],
}));
assert.equal(shallowAiMention.decision, '否');

console.log('AI screening strictness test passed');
