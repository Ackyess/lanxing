import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');

const testFiles = fs.readdirSync(scriptsDir)
  .filter((name) => /^test-.*\.mjs$/.test(name))
  .sort();

if (testFiles.length === 0) {
  console.log('No test files found in scripts/test-*.mjs');
  process.exit(0);
}

let failures = 0;

for (const testFile of testFiles) {
  const relativePath = path.posix.join('scripts', testFile);
  console.log(`RUN  ${relativePath}`);

  const result = spawnSync(process.execPath, [relativePath], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    console.log(`PASS ${relativePath}`);
  } else {
    failures += 1;
    const exitLabel = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.error(`FAIL ${relativePath} (${exitLabel})`);
  }
}

if (failures > 0) {
  console.error(`\nTest run failed: ${failures}/${testFiles.length} test file(s) failed.`);
  process.exit(1);
}

console.log(`\nTest run passed: ${testFiles.length} test file(s).`);
