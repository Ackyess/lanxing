import assert from 'node:assert/strict';
import {
  buildRankingApiConfig,
  buildRankingPrompt,
} from '../popup/modules/talent_pool_ranking.js';

const candidates = [
  {
    id: 'pos-1::a',
    candidateName: '候选人A',
    positionId: 'pos-1',
    positionName: '亚马逊运营',
    aiReason: '亚马逊经验匹配',
    resumeText: '负责 Amazon 广告投放、Listing 优化、FBA 补货，ACOS 从 38% 降到 24%。',
    detailText: '姓名：候选人A\n工作年限：2年',
    simpleText: '姓名: 候选人A 工作年限: 2年',
  },
  {
    id: 'pos-1::b',
    candidateName: '候选人B',
    positionId: 'pos-1',
    positionName: '亚马逊运营',
    aiReason: '学历匹配',
    resumeText: '本科英语专业，应届生，熟悉 Excel，暂无亚马逊实操。',
    detailText: '姓名：候选人B\n工作年限：应届生',
    simpleText: '姓名: 候选人B 工作年限: 应届生',
  },
];

const prompt = buildRankingPrompt(
  '亚马逊运营',
  '负责亚马逊 Amazon 站点运营，要求广告投放、Listing、FBA、数据分析。',
  candidates,
);

assert.match(prompt, /请慢下来做充分比较/);
assert.match(prompt, /岗位介绍只是输入之一，不能作为唯一准则/);
assert.match(prompt, /真实履历证据/);
assert.match(prompt, /工作轨迹/);
assert.match(prompt, /数据与广告能力/);
assert.match(prompt, /风险扣分/);
assert.match(prompt, /为什么第 1 名比第 2 名更适合/);
assert.match(prompt, /"evidence"/);
assert.match(prompt, /"concerns"/);
assert.match(prompt, /"decisionBasis"/);
assert.doesNotMatch(prompt, /20字内/);
assert.match(prompt, /reason 不设字数上限/);
assert.doesNotMatch(prompt, /reason[^\n]*(不要超过|不超过|最多|60\s*字|字内)/);

const apiConfig = buildRankingApiConfig({ maxTokens: 1024, temperature: 0.1 });
assert.equal(apiConfig.maxTokens, 200000);
assert.equal(apiConfig.temperature, 0.2);
assert.equal(apiConfig.timeoutMs, 180000);

console.log('Talent pool ranking test passed');
