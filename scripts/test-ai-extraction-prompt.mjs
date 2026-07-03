import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'utils', 'ai_helper.js'), 'utf8');

const sandbox = {
  console,
  self: {},
  setTimeout,
  clearTimeout,
  AbortController,
};
sandbox.globalThis = sandbox;

vm.runInNewContext(source, sandbox, { filename: 'utils/ai_helper.js' });

const utils = sandbox.self.HR_AI_UTILS;
assert.ok(utils, 'HR_AI_UTILS should be exposed on self');

let capturedMessages = null;
utils.sendRequest = async (_apiConfig, _aiConfig, messages) => {
  capturedMessages = messages;
  return {
    success: true,
    response: '{"resume_text":"原文"}',
  };
};

await utils.extractResumeText(
  'data:image/png;base64,abc',
  '候选人基础信息',
  { token: 'test-token', model: 'test-model' },
);

assert.ok(Array.isArray(capturedMessages), 'extractResumeText should build chat messages');

const systemPrompt = capturedMessages[0]?.content || '';
const userPrompt = capturedMessages[1]?.content?.[0]?.text || '';
const combinedPrompt = `${systemPrompt}\n${userPrompt}`;

assert.match(combinedPrompt, /逐字/);
assert.match(combinedPrompt, /一字不改/);
assert.match(combinedPrompt, /不要总结/);
assert.doesNotMatch(combinedPrompt, /summary/);

console.log('AI extraction prompt test passed');
