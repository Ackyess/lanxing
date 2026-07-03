import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../popup/modules/token_store.js';

// AES-GCM + PBKDF2 往返：口令正确可解、口令错误必失败、密文不含明文。
const token = 'sk-test-1234567890-SECRET';
const passphrase = 'correct horse battery staple';

const blob = await encryptToken(token, passphrase);
assert.equal(blob.v, 1);
assert.ok(blob.salt && blob.iv && blob.ct, 'blob must carry salt/iv/ct');

// 密文里不得出现明文 token
const serialized = JSON.stringify(blob);
assert.ok(!serialized.includes(token), 'ciphertext blob must not contain the plaintext token');

// 正确口令可还原
const back = await decryptToken(blob, passphrase);
assert.equal(back, token, 'correct passphrase must recover the token');

// 错误口令必须抛错（GCM 认证失败）
await assert.rejects(() => decryptToken(blob, 'wrong passphrase'), 'wrong passphrase must fail');

// 需要口令
await assert.rejects(() => encryptToken(token, ''), /口令/);

// 每次加密 salt/iv 随机 → 密文不同
const blob2 = await encryptToken(token, passphrase);
assert.notEqual(blob.ct, blob2.ct, 'each encryption should differ (random salt/iv)');

console.log('Token store crypto test passed');
