import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Token 隔离守护：AI Token 绝不通过消息进入 content script。
// data.js 有 window/serverData 顶层依赖，无法在 node 里直接 import，故做源码级断言。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(rootDir, ...p), 'utf8');

// 1) data.js 提供剥离 token 的 helper
const dataSrc = read('popup', 'modules', 'data.js');
assert.match(dataSrc, /export function aiConfigForContent/, 'aiConfigForContent must exist');
const fnStart = dataSrc.indexOf('export function aiConfigForContent');
const fnBody = dataSrc.slice(fnStart, fnStart + 240);
assert.match(fnBody, /const \{ token, \.\.\.rest \} = /, 'aiConfigForContent must destructure token out');
assert.match(fnBody, /return rest/, 'aiConfigForContent must return the token-less rest');

// saveSettings 落 storage.local 的 ai_config 必须是去 token 版本（不明文存 token）
assert.match(dataSrc, /ai_config:\s*aiConfigForContent\(serverData\.ai_config\)/, 'saveSettings must persist token-less ai_config');
assert.doesNotMatch(dataSrc, /ai_config:\s*serverData\.ai_config\s*,/, 'saveSettings must not persist raw ai_config with token');

// 2) 所有发往 content 的 aiConfig 都用 aiConfigForContent()，不再直接传 serverData.ai_config
for (const file of [
  ['popup', 'modules', 'scroll.js'],
  ['popup', 'modules', 'safety.js'],
  ['popup', 'modules', 'screenshot.js'],
]) {
  const src = read(...file);
  const name = file.join('/');
  assert.doesNotMatch(src, /aiConfig:\s*serverData\.ai_config\b/, `${name} must not send raw serverData.ai_config`);
  assert.match(src, /aiConfig:\s*aiConfigForContent\(\)/, `${name} must send aiConfigForContent()`);
}

// 3) background 从存储注入 token，忽略消息里的 token
const bg = read('background.js');
assert.match(bg, /async function getStoredAiToken\(\)/, 'background must define getStoredAiToken');
const reqStart = bg.indexOf('case "LANXING_AI_REQUEST"');
const reqBody = bg.slice(reqStart, reqStart + 900);
assert.match(reqBody, /const storedToken = await getStoredAiToken\(\)/, 'AI request must read stored token');
assert.match(reqBody, /token:\s*storedToken/, 'AI request aiConfig.token must come from storedToken');
assert.doesNotMatch(reqBody, /token:\s*providedConfig\.token/, 'AI request must not trust the message-provided token');

console.log('Token not-in-content-message test passed');
