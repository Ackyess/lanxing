// token_store.js — AI Token 存储加固
// 活 token 始终只放在 chrome.storage.session（默认仅 TRUSTED_CONTEXTS，content script 读不到）；
// background 从 session 读取并注入 AI 请求。两种存储模式：
//   - session（默认，最安全）：token 只存会话，浏览器重启/扩展重载后需重新输入。
//   - encrypted（便捷）：token 用 AES-GCM(口令派生密钥) 加密后存 storage.local，
//     每会话首次用口令解密进 session；重启免重输 token，但需输一次口令。
// storage.local 的 ai_config 永远不含 token。

const TOKEN_SESSION_KEY = "lanxing_ai_token";        // storage.session：活 token（明文，仅本会话）
const TOKEN_ENC_KEY = "lanxing_ai_token_enc";        // storage.local：{v,salt,iv,ct}
const TOKEN_MODE_KEY = "lanxing_token_storage_mode"; // storage.local：'session' | 'encrypted'

export async function getTokenStorageMode() {
    try {
        const r = await chrome.storage.local.get(TOKEN_MODE_KEY);
        return r?.[TOKEN_MODE_KEY] === "encrypted" ? "encrypted" : "session";
    } catch (e) {
        return "session";
    }
}

export async function setTokenStorageMode(mode) {
    await chrome.storage.local.set({ [TOKEN_MODE_KEY]: mode === "encrypted" ? "encrypted" : "session" });
}

// ---- 会话内活 token（content script 默认读不到） ----
export async function getSessionToken() {
    try {
        const r = await chrome.storage.session.get(TOKEN_SESSION_KEY);
        return r?.[TOKEN_SESSION_KEY] || "";
    } catch (e) {
        return "";
    }
}

async function setSessionToken(token) {
    await chrome.storage.session.set({ [TOKEN_SESSION_KEY]: token });
}

export async function clearSessionToken() {
    try { await chrome.storage.session.remove(TOKEN_SESSION_KEY); } catch (e) { /* ignore */ }
}

// ---- WebCrypto：AES-GCM + PBKDF2 ----
function toB64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(s) {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
    const baseKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(passphrase),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// 导出以便单测（纯函数，不触碰 chrome）
export async function encryptToken(token, passphrase) {
    if (!passphrase) throw new Error("需要口令");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(token)));
    return { v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptToken(blob, passphrase) {
    const key = await deriveKey(passphrase, fromB64(blob.salt));
    const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(blob.iv) },
        key,
        fromB64(blob.ct)
    );
    return new TextDecoder().decode(pt);
}

// ---- 高层操作 ----

// 保存 token：写入会话；加密模式再加密落本地
export async function saveToken(token, { mode, passphrase } = {}) {
    const m = mode || (await getTokenStorageMode());
    await setSessionToken(token);
    if (m === "encrypted") {
        if (!passphrase) throw new Error("加密本地模式需要设置口令");
        const blob = await encryptToken(token, passphrase);
        await chrome.storage.local.set({ [TOKEN_ENC_KEY]: blob });
    } else {
        // 会话模式：确保本地无残留密文
        try { await chrome.storage.local.remove(TOKEN_ENC_KEY); } catch (e) { /* ignore */ }
    }
    await setTokenStorageMode(m);
}

export async function hasEncryptedToken() {
    try {
        const r = await chrome.storage.local.get(TOKEN_ENC_KEY);
        return !!r?.[TOKEN_ENC_KEY];
    } catch (e) {
        return false;
    }
}

// 用口令解锁：解密密文并放入会话（口令错误会抛错）
export async function unlockToken(passphrase) {
    const r = await chrome.storage.local.get(TOKEN_ENC_KEY);
    const blob = r?.[TOKEN_ENC_KEY];
    if (!blob) throw new Error("没有已加密保存的 Token");
    const token = await decryptToken(blob, passphrase);
    await setSessionToken(token);
    return token;
}

// 清空全部 token（会话 + 本地密文）
export async function clearAllToken() {
    await clearSessionToken();
    try { await chrome.storage.local.remove(TOKEN_ENC_KEY); } catch (e) { /* ignore */ }
}

// 一次性迁移：旧版把 token 明文存在 storage.local 的 ai_config 里 —— 挪进会话并抹掉本地明文
export async function migrateLegacyPlaintextToken() {
    try {
        const r = await chrome.storage.local.get("ai_config");
        const legacy = r?.ai_config?.token;
        if (legacy) {
            await setSessionToken(legacy);
            const { token, ...rest } = r.ai_config;
            await chrome.storage.local.set({ ai_config: rest });
            return legacy;
        }
    } catch (e) { /* ignore */ }
    return "";
}
