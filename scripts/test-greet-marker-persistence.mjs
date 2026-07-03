import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const contentSource = fs.readFileSync(path.join(rootDir, 'content_scripts', 'index.js'), 'utf8');
const screenshotSource = fs.readFileSync(path.join(rootDir, 'popup', 'modules', 'screenshot.js'), 'utf8');

assert.match(contentSource, /function\s+findCandidateElementByIdentity/);
assert.match(contentSource, /function\s+markCandidateDecision/);
assert.match(contentSource, /function\s+getCandidateIdentityFromAction/);

const greetStart = contentSource.indexOf('async function handleGreetCandidate');
const openStart = contentSource.indexOf('async function handleOpenFirstDetail');
assert.ok(greetStart >= 0 && openStart > greetStart, 'handleGreetCandidate should be present before handleOpenFirstDetail');
const greetBlock = contentSource.slice(greetStart, openStart);
assert.match(greetBlock, /clickMatchedItem\(element\)/);
assert.match(greetBlock, /findCandidateElementForAction\(data,\s*element\)/);
assert.match(greetBlock, /markCandidateDecision\(.*data\)/s);

assert.match(contentSource, /handleGreetCandidate\(\{\s*[\s\S]*candidate,/);
assert.match(contentSource, /const\s+markData\s*=\s*\{\s*[\s\S]*candidate,/);
assert.match(contentSource, /markCandidateDecision\([^,]+,\s*markData\)/);

const greetMessageMatches = screenshotSource.match(/action:\s*"GREET_CANDIDATE"[\s\S]{0,260}candidate:\s*candidateInfo/g) || [];
const markMessageMatches = screenshotSource.match(/action:\s*"MARK_CANDIDATE"[\s\S]{0,260}candidate:\s*candidateInfo/g) || [];
assert.ok(greetMessageMatches.length >= 1, 'manual greet should include candidate identity');
assert.ok(markMessageMatches.length >= 2, 'manual pass/fail marks should include candidate identity');

console.log('Greet marker persistence test passed');
