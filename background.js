// =====================================================
// Service Worker 基础
// =====================================================

importScripts('config.js', 'utils/ai_helper.js');

self.addEventListener("install", () => {
    // console.log("[BACKGROUND] Service Worker 安装");
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    // console.log("[BACKGROUND] Service Worker 激活");
    e.waitUntil(self.clients.claim());
});

self.addEventListener("error", (e) => console.error("[BACKGROUND] 错误:", e.message));
self.addEventListener("unhandledrejection", (e) => console.error("[BACKGROUND] Promise拒绝:", e.reason));

// =====================================================
// 🧭 frame 路由：把消息定向发送到正确的 iframe（推荐牛人/职位列表）
// =====================================================

const bossFrameCache = new Map();

function nowMs() {
    return Date.now();
}

function getCacheKey(tabId, target) {
    return `${tabId}:${target || "any"}`;
}

function getActiveTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs && tabs.length ? tabs[0] : null);
        });
    });
}

function getAllFrames(tabId) {
    return new Promise((resolve, reject) => {
        if (!chrome.webNavigation?.getAllFrames) {
            reject(new Error("webNavigation 不可用（请检查 manifest 权限）"));
            return;
        }
        chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(frames || []);
        });
    });
}

function sendMessageToFrame(tabId, frameId, message, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("FRAME_MESSAGE_TIMEOUT"));
        }, timeoutMs);

        try {
            chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        } catch (e) {
            clearTimeout(timeout);
            reject(e);
        }
    });
}

function isNoReceiverError(err) {
    const msg = String(err?.message || "");
    return (
        msg.includes("Could not establish connection") ||
        msg.includes("Receiving end does not exist") ||
        msg.includes("The message port closed") ||
        msg.includes("No tab with id")
    );
}

function matchBossTarget(pingResp, target) {
    if (!pingResp?.success) return false;
    if (target === "recommend") return !!pingResp.isBossRecommendContext;
    if (target === "jobList") return !!pingResp.isBossJobListPage;
    return true;
}

function sortFramesForTarget(frames, target) {
    // 优先：非主 frame、URL 更像目标页、然后更深层（frameId 更大）
    const isRecommendUrl = (u) => /\/web\/chat\/recommend/.test(u || "") || /geek_rcmd/.test(u || "");
    const isJobListUrl = (u) => /\/web\/chat\/job\/list/.test(u || "") || /zpjob\/job\/data\/list/.test(u || "");

    return [...frames].sort((a, b) => {
        const aMain = a.frameId === 0 ? 1 : 0;
        const bMain = b.frameId === 0 ? 1 : 0;
        if (aMain !== bMain) return aMain - bMain;

        const aUrl = a.url || "";
        const bUrl = b.url || "";
        const aScore = target === "recommend" ? (isRecommendUrl(aUrl) ? 0 : 1) : target === "jobList" ? (isJobListUrl(aUrl) ? 0 : 1) : 1;
        const bScore = target === "recommend" ? (isRecommendUrl(bUrl) ? 0 : 1) : target === "jobList" ? (isJobListUrl(bUrl) ? 0 : 1) : 1;
        if (aScore !== bScore) return aScore - bScore;

        return (b.frameId || 0) - (a.frameId || 0);
    });
}

async function resolveBossFrameId(tabId, target, pingTimeoutMs = 3000) {
    const cacheKey = getCacheKey(tabId, target);
    const cached = bossFrameCache.get(cacheKey);
    if (cached && nowMs() - cached.ts < 5 * 60 * 1000) {
        try {
            const ping = await sendMessageToFrame(tabId, cached.frameId, { action: "PING_CONTENT" }, pingTimeoutMs);
            if (matchBossTarget(ping, target)) {
                return cached.frameId;
            }
        } catch (e) {
            // 缓存失效，继续扫描
        }
    }

    const frames = await getAllFrames(tabId);
    const ordered = sortFramesForTarget(frames, target);
    const frameHints = ordered.slice(0, 8).map((frame) => `${frame.frameId}:${frame.url || ""}`);

    for (const frame of ordered) {
        try {
            const ping = await sendMessageToFrame(tabId, frame.frameId, { action: "PING_CONTENT" }, pingTimeoutMs);
            if (matchBossTarget(ping, target)) {
                bossFrameCache.set(cacheKey, { frameId: frame.frameId, ts: nowMs() });
                return frame.frameId;
            }
        } catch (e) {
            if (!isNoReceiverError(e)) {
                // 非“无接收端”错误，继续尝试其他 frame（不要直接终止）
            }
        }
    }

    // 兜底：如果目标明确但没找到，返回 null 让调用方提示用户刷新/确认页面
    if (target === "recommend" || target === "jobList") {
        const err = new Error("TARGET_FRAME_NOT_FOUND");
        err.frameHints = frameHints;
        throw err;
    }

    bossFrameCache.set(cacheKey, { frameId: 0, ts: nowMs() });
    return 0;
}

async function sendToBossFrame({ tabId, target, message, timeoutMs = 20000 }) {
    const frameId = await resolveBossFrameId(tabId, target);
    const resp = await sendMessageToFrame(tabId, frameId, message, timeoutMs);
    return { frameId, resp };
}

// =====================================================
// 🟦 Offscreen Document 逻辑
// =====================================================

function supportsOffscreenDocument() {
    return !!(chrome.offscreen && typeof chrome.offscreen.hasDocument === "function");
}

function normalizeRect(rect = {}) {
    const dpr = rect.dpr ?? rect.devicePixelRatio ?? 1;
    return {
        ...rect,
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        width: rect.width ?? 0,
        height: rect.height ?? 0,
        dpr
    };
}

// 确保 offscreen 页面存在
async function ensureOffscreen() {
    if (!supportsOffscreenDocument()) {
        throw new Error("当前环境不支持 Offscreen Document");
    }

    if (await chrome.offscreen.hasDocument()) {
        return;
    }

    // console.log("[BACKGROUND] 创建 offscreen document...");

    await chrome.offscreen.createDocument({
        url: "popup/offscreen.html",
        reasons: ["DOM_PARSER", "CANVAS"],
        justification: "用于裁剪 Canvas 截图"
    });
}


// 把截图发送给 offscreen 裁剪
async function cropWithOffscreen(dataUrl, rect) {
    await ensureOffscreen();

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: "OFFSCREEN_CROP_REQUEST",
                data: { dataUrl, rect }
            },
            (resp) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!resp || !resp.success) {
                    reject(new Error(resp?.error || "offscreen 裁剪失败"));
                    return;
                }
                resolve(resp.imageData);
            }
        );
    });
}

async function cropWithWorkerCanvas(dataUrl, rect) {
    const normalizedRect = normalizeRect(rect);
    const dpr = normalizedRect.dpr || 1;

    try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const width = normalizedRect.width * dpr;
        const height = normalizedRect.height * dpr;

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");

        ctx.drawImage(
            bitmap,
            normalizedRect.x * dpr,
            normalizedRect.y * dpr,
            normalizedRect.width * dpr,
            normalizedRect.height * dpr,
            0,
            0,
            width,
            height
        );

        const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
        const arrayBuffer = await croppedBlob.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        return `data:image/png;base64,${base64}`;
    } catch (error) {
        throw new Error(`本地裁剪失败: ${error.message}`);
    }
}

function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function cropScreenshot(dataUrl, rect) {
    const normalizedRect = normalizeRect(rect);

    if (supportsOffscreenDocument()) {
        try {
            return await cropWithOffscreen(dataUrl, normalizedRect);
        } catch (error) {
            console.warn("[BACKGROUND] offscreen 裁剪失败，尝试使用本地裁剪:", error);
        }
    }

    return cropWithWorkerCanvas(dataUrl, normalizedRect);
}


// =====================================================
// 📸 主功能：可视区域截图 + 裁剪 canvas 区域
// =====================================================
async function captureResumeArea(rect, sendResponse) {
    try {
        const normalizedRect = normalizeRect(rect);
        // console.log("[BACKGROUND] captureResumeArea 开始，rect:", normalizedRect);

        // 1. 截图整个可视区域
        chrome.tabs.captureVisibleTab(null, { format: "png" }, async (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error("[BACKGROUND] captureVisibleTab 失败:", chrome.runtime.lastError);
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
                return;
            }

            // console.log("[BACKGROUND] 已截取全屏，准备裁剪...");

            try {
                // 2. 裁剪目标区域
                const cropped = await cropScreenshot(dataUrl, normalizedRect);

                sendResponse({
                    success: true,
                    imageData: cropped
                });
            } catch (err) {
                console.error("[BACKGROUND] 裁剪失败:", err);
                sendResponse({
                    success: false,
                    error: err.message
                });
            }
        });
    } catch (e) {
        console.error("[BACKGROUND] captureResumeArea 异常:", e);
        sendResponse({
            success: false,
            error: e.message
        });
    }
}


// =====================================================
// 📩 消息路由
// =====================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const type = msg.type || msg.action;
    // console.log("[BACKGROUND] 收到消息:", type, msg);

    switch (type) {
        case "LANXING_SEND_TO_BOSS_FRAME":
            (async () => {
                try {
                    const target = msg?.data?.target || "any";
                    const message = msg?.data?.message;
                    const timeoutMs = msg?.data?.timeoutMs ?? 20000;
                    let tabId = msg?.data?.tabId;

                    if (!message) {
                        sendResponse({ success: false, error: "missing_message" });
                        return;
                    }

                    if (!tabId) {
                        const tab = await getActiveTab();
                        tabId = tab?.id;
                    }

                    if (!tabId) {
                        sendResponse({ success: false, error: "missing_tabId" });
                        return;
                    }

                    const { frameId, resp } = await sendToBossFrame({ tabId, target, message, timeoutMs });
                    sendResponse({ success: true, tabId, frameId, data: resp });
                } catch (e) {
                    sendResponse({
                        success: false,
                        error: e?.message || String(e),
                        frameHints: e?.frameHints || []
                    });
                }
            })();
            return true;

        // =====================================================
        // 📢 转发/兜底：让 content_script 的日志消息始终有接收端
        // （否则 popup 未打开时会触发 "Receiving end does not exist"）
        // =====================================================
        case "LOG_MESSAGE":
        case "ERROR":
        case "MATCH_SUCCESS":
        case "SCROLL_COMPLETE":
        case "BATCH_STATUS":
        case "UPDATE_PROGRESS":
            sendResponse({ ok: true });
            return false;

        case "PING":
            sendResponse({ status: "pong", ts: Date.now() });
            return true;

        case "CAPTURE_SCREENSHOT":
            chrome.tabs.captureVisibleTab(null, { format: "png" }, (url) => {
                sendResponse({ success: true, imageData: url });
            });
            return true;

        case "CAPTURE_CANVAS_AREA":
            captureResumeArea(msg.data, sendResponse);
            return true;

        case "LANXING_AI_REQUEST":
            (async () => {
                try {
                    const defaultConfig = self.LANXING_CONFIG?.DEFAULT_AI_CONFIG || {};
                    const providedConfig = msg?.data?.aiConfig || {};
                    const apiConfig = HR_AI_UTILS.buildApiConfig
                        ? HR_AI_UTILS.buildApiConfig(msg?.data?.apiConfig || {}, providedConfig)
                        : (msg?.data?.apiConfig || self.LANXING_CONFIG?.DEFAULT_API || {});
                    const aiConfig = {
                        ...defaultConfig,
                        ...providedConfig,
                        token: providedConfig.token || defaultConfig.token,
                        model: providedConfig.model || defaultConfig.model
                    };
                    const messages = msg?.data?.messages;

                    if (!Array.isArray(messages) || messages.length === 0) {
                        sendResponse({ success: false, error: "AI_REQUEST_MESSAGES_EMPTY" });
                        return;
                    }
                    if (!aiConfig.token) {
                        sendResponse({ success: false, error: "AI_TOKEN_EMPTY" });
                        return;
                    }

                    const result = await HR_AI_UTILS.sendRequest(apiConfig, aiConfig, messages);
                    sendResponse(result);
                } catch (e) {
                    sendResponse({ success: false, error: e?.message || String(e) });
                }
            })();
            return true;

        default:
            console.warn("[BACKGROUND] 未知消息:", type);
            sendResponse({ success: false, error: "unknown_message" });
            return false;
    }
});


// =====================================================
// 🔄 保持 Service Worker 存活
// =====================================================
chrome.runtime.onConnect.addListener((port) => {
    // console.log("[BACKGROUND] 新的 port 连接:", port.name);
});


// =====================================================
// 🪟 面板显示方式（popup 弹窗 / side 侧边栏）
// =====================================================
const VIEW_MODE_KEY = "lanxing_view_mode";

async function applyViewMode(mode) {
    try {
        if (mode === "side") {
            await chrome.sidePanel.setOptions({ path: "popup/index.html?view=side", enabled: true });
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            await chrome.action.setPopup({ popup: "" });
        } else {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
            await chrome.action.setPopup({ popup: "popup/index.html" });
        }
    } catch (e) {
        console.error("[BACKGROUND] applyViewMode 失败:", e);
    }
}

async function restoreViewMode() {
    const store = await chrome.storage.local.get(VIEW_MODE_KEY);
    await applyViewMode(store[VIEW_MODE_KEY] || "popup");
}

chrome.runtime.onInstalled.addListener(restoreViewMode);
chrome.runtime.onStartup.addListener(restoreViewMode);
restoreViewMode(); // service worker 每次唤醒重放一次，幂等

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if ((msg.type || msg.action) !== "LANXING_SET_VIEW_MODE") return;
    (async () => {
        await chrome.storage.local.set({ [VIEW_MODE_KEY]: msg.mode });
        await applyViewMode(msg.mode);
        sendResponse({ success: true });
    })();
    return true;
});
