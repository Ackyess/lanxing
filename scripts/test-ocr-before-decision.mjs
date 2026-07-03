import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const contentSource = fs.readFileSync(path.join(rootDir, 'content_scripts', 'index.js'), 'utf8');
const screenshotSource = fs.readFileSync(path.join(rootDir, 'popup', 'modules', 'screenshot.js'), 'utf8');
const helperSource = fs.readFileSync(path.join(rootDir, 'utils', 'ai_helper.js'), 'utf8');

function assertOrder(source, first, second, label) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0, `${label}: missing ${first}`);
  assert.ok(secondIndex >= 0, `${label}: missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${label}: ${first} should happen before ${second}`);
}

const processStart = contentSource.indexOf('async function processElement');
const processEnd = contentSource.indexOf('function playNotificationSound');
assert.ok(processStart >= 0 && processEnd > processStart, 'processElement block should be found');
const processBlock = contentSource.slice(processStart, processEnd);

assert.match(processBlock, /buildDecisionCandidateText/);
assertOrder(processBlock, 'extractResumeText', 'analyzeCandidateResume', 'auto flow');
assert.match(processBlock, /const\s+decisionCandidateText\s*=\s*buildDecisionCandidateText/);
assert.match(processBlock, /analyzeCandidateResume\(\s*imageData,\s*decisionCandidateText,/);
assert.match(processBlock, /resumeText:\s*resumeFullText/);

const captureStart = screenshotSource.indexOf('export async function captureResume');
assert.ok(captureStart >= 0, 'captureResume block should be found');
const captureBlock = screenshotSource.slice(captureStart);

assert.match(captureBlock, /buildDecisionCandidateText/);
assertOrder(captureBlock, 'extractResumeText', 'analyzeCandidateResume', 'manual flow');
assert.match(captureBlock, /const\s+decisionCandidateText\s*=\s*buildDecisionCandidateText/);
assert.match(captureBlock, /analyzeCandidateResume\(\s*imageData,\s*decisionCandidateText,/);
assert.match(captureBlock, /resumeText:\s*resumeFullText/);

assert.match(helperSource, /timeoutMs:\s*Math\.max[\s\S]*120000/);

console.log('OCR before decision test passed');
