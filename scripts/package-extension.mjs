import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const safeVersion = String(manifest.version || '0.0.0').replace(/[^0-9A-Za-z._-]/g, '_');
const archiveName = `lanxing-${safeVersion}.tgz`;
const archivePath = path.join(distDir, archiveName);
const tempTarPath = path.join(distDir, `.tmp-${Date.now()}.tar`);

fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(archivePath)) {
  fs.rmSync(archivePath, { force: true });
}
if (fs.existsSync(tempTarPath)) {
  fs.rmSync(tempTarPath, { force: true });
}

const excludeNames = new Set(['.git', 'dist']);

function collectEntries(dir, base = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (base === '' && excludeNames.has(entry.name)) {
      continue;
    }
    const relativePath = path.posix.join(base, entry.name);
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push({ type: 'dir', path: relativePath.replace(/\\/g, '/') });
      results.push(...collectEntries(absolutePath, relativePath));
    } else if (entry.isFile()) {
      results.push({ type: 'file', path: relativePath.replace(/\\/g, '/'), absolutePath });
    }
  }
  return results;
}

function writeOctal(buffer, value, offset, length) {
  const octal = value.toString(8).padStart(length - 1, '0');
  buffer.write(octal + '\0', offset, length, 'ascii');
}

function createTarHeader({ name, size, mode, mtime, typeflag }) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, Math.floor(mtime), 136, 12);
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (let i = 0; i < 512; i += 1) {
    checksum += header[i];
  }
  writeOctal(header, checksum, 148, 8);
  return header;
}

function buildTarBuffer() {
  const chunks = [];
  const entries = collectEntries(rootDir).sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of entries) {
    const stats = entry.type === 'file'
      ? fs.statSync(entry.absolutePath)
      : { size: 0, mtimeMs: Date.now() };
    const normalizedPath = entry.type === 'dir' ? `${entry.path}/` : entry.path;
    const header = createTarHeader({
      name: normalizedPath,
      size: entry.type === 'file' ? stats.size : 0,
      mode: entry.type === 'file' ? 0o644 : 0o755,
      mtime: stats.mtimeMs / 1000,
      typeflag: entry.type === 'file' ? '0' : '5'
    });
    chunks.push(header);

    if (entry.type === 'file') {
      const fileBuffer = fs.readFileSync(entry.absolutePath);
      chunks.push(fileBuffer);
      const remainder = fileBuffer.length % 512;
      if (remainder !== 0) {
        chunks.push(Buffer.alloc(512 - remainder, 0));
      }
    }
  }

  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

try {
  const tarBuffer = buildTarBuffer();
  fs.writeFileSync(tempTarPath, tarBuffer);

  await pipeline(
    fs.createReadStream(tempTarPath),
    createGzip({ level: 9 }),
    fs.createWriteStream(archivePath)
  );

  console.log(`Created package: ${archivePath}`);
} finally {
  if (fs.existsSync(tempTarPath)) {
    fs.rmSync(tempTarPath, { force: true });
  }
}
