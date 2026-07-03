import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');

const rootFiles = [
  'background.js',
  'config.js',
  'popup/offscreen.js',
].filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)));

const scanDirs = [
  'utils',
  'popup/modules',
  'content_scripts',
];

function toPosix(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function collectJsFiles(relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const results = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const childRelative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(childRelative));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(toPosix(childRelative));
    }
  }
  return results;
}

const files = Array.from(new Set([
  ...rootFiles,
  ...scanDirs.flatMap(collectJsFiles),
])).sort();

let failures = 0;

for (const relativePath of files) {
  const result = spawnSync(process.execPath, ['--check', relativePath], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    console.log(`OK   ${relativePath}`);
    continue;
  }

  failures += 1;
  console.error(`MISS ${relativePath}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (failures > 0) {
  console.error(`\nSyntax check failed: ${failures}/${files.length} file(s) failed.`);
  process.exit(1);
}

console.log(`\nSyntax check passed: ${files.length} file(s).`);
