import assert from 'node:assert/strict';
import {
  buildBatchPlan,
  clampBatchLimit,
} from '../popup/modules/batch_plan.js';

assert.equal(clampBatchLimit(undefined), 1);
assert.equal(clampBatchLimit('0'), 1);
assert.equal(clampBatchLimit('3.8'), 3);
assert.equal(clampBatchLimit(500), 200);

const positions = [
  { id: 'p1', name: '亚马逊运营', description: '负责 Amazon 店铺运营' },
  { id: 'p2', name: '广告投放', description: '负责广告投放和数据分析' },
];

assert.equal(buildBatchPlan({ batchConfig: { enabled: false, items: [] }, positions }), null);
assert.equal(buildBatchPlan({ batchConfig: { enabled: true, items: [] }, positions }), null);

assert.deepEqual(
  buildBatchPlan({
    batchConfig: {
      enabled: true,
      items: [
        { positionId: 'missing', limit: 20 },
        { positionId: 'p2', limit: 201 },
        { positionId: '', limit: 10 },
        { positionId: 'p1', limit: '2.9' },
      ],
    },
    positions,
  }),
  [
    {
      positionId: 'p2',
      positionName: '广告投放',
      jobDescription: '负责广告投放和数据分析',
      matchLimit: 200,
    },
    {
      positionId: 'p1',
      positionName: '亚马逊运营',
      jobDescription: '负责 Amazon 店铺运营',
      matchLimit: 2,
    },
  ],
);

console.log('Batch plan test passed');
