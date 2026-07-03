import assert from 'node:assert/strict';
import {
  buildManualAIConfig,
  normalizeManualApiBaseUrl,
  normalizeManualToken,
  resolveSelectedModel,
  validateManualAIConfig,
} from '../popup/modules/ai_config.js';

assert.equal(normalizeManualToken('  sk-test-token  '), 'sk-test-token');
assert.equal(normalizeManualApiBaseUrl('  https://api.example.com/v1/chat/completions  '), 'https://api.example.com/v1/chat/completions');
assert.equal(normalizeManualApiBaseUrl('   '), '');
assert.equal(resolveSelectedModel({ selectedValue: 'gpt-5.5' }), 'gpt-5.5');
assert.equal(resolveSelectedModel({ selectedValue: 'custom', customValue: '  custom-model  ' }), 'custom-model');
assert.equal(resolveSelectedModel({ selectedValue: '', fallbackModel: 'fallback-model' }), 'fallback-model');

assert.deepEqual(
  buildManualAIConfig({
    token: '  sk-manual  ',
    selectedModel: 'custom',
    customModel: 'my-model',
    baseUrl: '  https://api.third-party.test/v1/chat/completions  ',
    platform: 'custom',
  }),
  {
    platform: 'custom',
    token: 'sk-manual',
    model: 'my-model',
    baseUrl: 'https://api.third-party.test/v1/chat/completions',
  },
);

assert.equal(validateManualAIConfig({ token: 'sk-ok', model: 'gpt-5.5' }), true);
assert.equal(validateManualAIConfig({ token: 'sk-ok', model: 'gpt-5.5', baseUrl: 'http://127.0.0.1:11434/v1' }), true);
assert.throws(
  () => validateManualAIConfig({ token: '', model: 'gpt-5.5' }),
  /Token/,
);
assert.throws(
  () => validateManualAIConfig({ token: 'sk-ok', model: '' }),
  /模型/,
);
assert.throws(
  () => validateManualAIConfig({ token: 'sk-ok', model: 'gpt-5.5', baseUrl: 'api.example.com/v1' }),
  /URL/,
);

console.log('AI manual token config test passed');
