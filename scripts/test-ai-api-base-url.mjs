import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;

vm.runInNewContext(
  fs.readFileSync(path.join(rootDir, 'config.js'), 'utf8'),
  sandbox,
  { filename: path.join(rootDir, 'config.js') },
);
vm.runInNewContext(
  fs.readFileSync(path.join(rootDir, 'utils', 'ai_helper.js'), 'utf8'),
  sandbox,
  { filename: path.join(rootDir, 'utils', 'ai_helper.js') },
);

const utils = sandbox.HR_AI_UTILS;
assert.ok(utils, 'AI utils should be attached to globalThis');

assert.equal(
  utils.buildApiConfig({}, { baseUrl: 'https://api.third-party.test' }).baseUrl,
  'https://api.third-party.test/v1/chat/completions',
);
assert.equal(
  utils.buildApiConfig({}, { baseUrl: 'https://api.example.com/' }).baseUrl,
  'https://api.example.com/v1/chat/completions',
);
assert.equal(
  utils.buildApiConfig({}, { baseUrl: 'https://api.third-party.test/v1/chat/completions' }).baseUrl,
  'https://api.third-party.test/v1/chat/completions',
);
assert.equal(
  utils.buildApiConfig({ baseUrl: 'https://override.test/v1' }, { baseUrl: 'https://api.third-party.test' }).baseUrl,
  'https://override.test/v1/chat/completions',
);
assert.equal(
  utils.buildApiConfig({ timeoutMs: 180000 }, { baseUrl: 'https://api.third-party.test/v1' }).timeoutMs,
  180000,
);

const popupHtml = fs.readFileSync(path.join(rootDir, 'popup', 'index.html'), 'utf8');
assert.match(
  popupHtml,
  /id="ai-base-url"[^>]+placeholder="https:\/\/api\.openai\.com\/v1"/,
);

console.log('AI API base URL test passed');
