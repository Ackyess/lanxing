import assert from 'node:assert/strict';
import {
  validateSecureApiBaseUrl,
  validateManualAIConfig,
} from '../popup/modules/ai_config.js';

// 空地址（用默认/内置 baseUrl）允许
assert.equal(validateSecureApiBaseUrl(''), true);
assert.equal(validateSecureApiBaseUrl('   '), true);

// HTTPS 一律允许
assert.equal(validateSecureApiBaseUrl('https://api.openai.com/v1'), true);
assert.equal(validateSecureApiBaseUrl('https://api.third-party.test/v1/chat/completions'), true);

// HTTP 仅允许本机回环
assert.equal(validateSecureApiBaseUrl('http://localhost:1234/v1'), true);
assert.equal(validateSecureApiBaseUrl('http://127.0.0.1:8080/v1'), true);
assert.equal(validateSecureApiBaseUrl('http://127.0.0.5/v1'), true);
assert.equal(validateSecureApiBaseUrl('http://[::1]:11434/v1'), true);

// 非回环 HTTP 必须拒绝
for (const bad of [
  'http://api.openai.com/v1',
  'http://203.0.113.9/v1',
  'http://evil.example.com/v1/chat/completions',
]) {
  assert.throws(() => validateSecureApiBaseUrl(bad), /HTTPS/, `should reject: ${bad}`);
}

// 非法协议/URL 拒绝
assert.throws(() => validateSecureApiBaseUrl('ftp://api.example.com'), /HTTPS|有效/);
assert.throws(() => validateSecureApiBaseUrl('not a url'), /有效/);

// validateManualAIConfig 组合校验：token+model 齐全但外部 HTTP 非回环 → 拒绝
assert.throws(
  () => validateManualAIConfig({ token: 't', model: 'gpt-5.5', baseUrl: 'http://api.example.com/v1' }),
  /HTTPS/,
);
// 回环 HTTP 放行
assert.equal(
  validateManualAIConfig({ token: 't', model: 'gpt-5.5', baseUrl: 'http://127.0.0.1:1234/v1' }),
  true,
);
// 缺 token 仍先报缺 token
assert.throws(
  () => validateManualAIConfig({ token: '', model: 'gpt-5.5', baseUrl: 'https://api.example.com' }),
  /Token/,
);

console.log('AI URL https-only test passed');
