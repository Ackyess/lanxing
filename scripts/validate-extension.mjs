import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('manifest.json not found in current directory');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const checks = [];

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

function recordFile(kind, relativePath) {
  const rel = toPosix(relativePath);
  const absolutePath = path.join(rootDir, rel);
  checks.push({
    kind,
    path: rel,
    ok: fs.existsSync(absolutePath)
  });
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

function recordPattern(kind, relativePattern) {
  const rel = toPosix(relativePattern);
  const dir = path.dirname(rel);
  const base = path.basename(rel);
  const absoluteDir = path.join(rootDir, dir);

  let ok = false;
  if (fs.existsSync(absoluteDir) && fs.statSync(absoluteDir).isDirectory()) {
    const matcher = wildcardToRegExp(base);
    ok = fs.readdirSync(absoluteDir).some((entry) => matcher.test(entry));
  }

  checks.push({ kind, path: rel, ok, pattern: true });
}

function recordResource(kind, value) {
  if (String(value).includes('*')) {
    recordPattern(kind, value);
    return;
  }
  recordFile(kind, value);
}

if (manifest.background?.service_worker) {
  recordFile('background.service_worker', manifest.background.service_worker);
}

if (manifest.action?.default_popup) {
  recordFile('action.default_popup', manifest.action.default_popup);
}

for (const [size, iconPath] of Object.entries(manifest.icons || {})) {
  recordFile(`icons.${size}`, iconPath);
}

for (const [index, contentScript] of (manifest.content_scripts || []).entries()) {
  for (const scriptPath of contentScript.js || []) {
    recordFile(`content_scripts[${index}].js`, scriptPath);
  }
  for (const cssPath of contentScript.css || []) {
    recordFile(`content_scripts[${index}].css`, cssPath);
  }
}

for (const [index, resourceGroup] of (manifest.web_accessible_resources || []).entries()) {
  for (const resourcePath of resourceGroup.resources || []) {
    recordResource(`web_accessible_resources[${index}]`, resourcePath);
  }
}

const missing = checks.filter((entry) => !entry.ok);

for (const entry of checks) {
  const status = entry.ok ? 'OK  ' : 'MISS';
  console.log(`${status} ${entry.kind} -> ${entry.path}`);
}

if (missing.length > 0) {
  console.error(`\nValidation failed: ${missing.length} referenced resource(s) missing.`);
  process.exit(1);
}

console.log(`\nValidation passed: ${checks.length} manifest reference(s) resolved.`);
