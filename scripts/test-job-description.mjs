import assert from 'node:assert/strict';
import {
  buildBossPositionTitle,
  buildPositionDescriptionFromBossJob,
  extractJobResponsibilitiesAndRequirements,
  normalizeJobDescriptionText,
} from '../popup/modules/job_description.js';

const htmlDescription = '<p>岗位职责：</p><p>1. 负责 Amazon 店铺运营</p><br><p>任职要求：</p><p>1. 熟悉广告投放</p><p>福利待遇：</p><p>五险一金</p>';
const normalized = normalizeJobDescriptionText(htmlDescription);

assert.equal(
  normalized,
  '岗位职责：\n\n1. 负责 Amazon 店铺运营\n\n任职要求：\n\n1. 熟悉广告投放\n\n福利待遇：\n\n五险一金',
);

assert.equal(
  extractJobResponsibilitiesAndRequirements(normalized),
  '岗位职责：\n1. 负责 Amazon 店铺运营\n\n任职要求：\n1. 熟悉广告投放',
);

assert.equal(
  buildPositionDescriptionFromBossJob({}, { postDescription: htmlDescription }),
  '岗位职责：\n1. 负责 Amazon 店铺运营\n\n任职要求：\n1. 熟悉广告投放',
);

assert.equal(
  buildPositionDescriptionFromBossJob({}, { postDesc: '完整职位描述\n没有标准标题' }),
  '完整职位描述\n没有标准标题',
);

assert.equal(
  buildBossPositionTitle({
    positionName: '亚马逊运营',
    addressShowText: '深圳',
    salaryDesc: '8-12K',
  }),
  '亚马逊运营 _ 深圳 8-12K',
);

assert.equal(buildBossPositionTitle({ jobName: '客服专员' }), '客服专员');
assert.equal(buildBossPositionTitle({}), '未命名职位');

console.log('Job description test passed');
