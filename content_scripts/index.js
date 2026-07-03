
let currentParser = null;
let scrollInterval = null;
let lastProcessedPosition = 0;
let isRunning = false;
let forceStop = false;
let currentDelay = 3000;
let matchLimit = 200;
let scrollDelayMin = 3000;
let scrollDelayMax = 6000;
let port = null;
let matchCount = 0;
let contactCount = 0; // 通过并执行“打招呼”的数量（用于数量上限/批量切换）
let currentPrompt = null;

// ==========================================
// 每日打招呼统计（用于 UI 展示 / 上限提醒）
// ==========================================
const GREET_DAILY_LIMIT = 200;
const GREET_DAILY_STORAGE_KEY = "hr_assistant_greet_daily";
const TALENT_POOL_STORAGE_KEY = "lanxing_approved_candidates_pool";

async function storageGet(keys) {
    try {
        const maybePromise = chrome.storage?.local?.get?.(keys);
        if (maybePromise && typeof maybePromise.then === "function") {
            return await maybePromise;
        }
    } catch (e) {
        // ignore
    }
    return await new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get(keys, (res) => {
                const err = chrome.runtime?.lastError;
                if (err) reject(err);
                else resolve(res);
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function storageSet(items) {
    try {
        const maybePromise = chrome.storage?.local?.set?.(items);
        if (maybePromise && typeof maybePromise.then === "function") {
            await maybePromise;
            return;
        }
    } catch (e) {
        // ignore
    }
    await new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set(items, () => {
                const err = chrome.runtime?.lastError;
                if (err) reject(err);
                else resolve();
            });
        } catch (e) {
            reject(e);
        }
    });
}

let greetDailyState = {
    loaded: false,
    date: "",
    count: 0
};

function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function ensureGreetDailyLoaded() {
    if (greetDailyState.loaded) return;
    greetDailyState.loaded = true;

    try {
        const res = await storageGet([GREET_DAILY_STORAGE_KEY]);
        const stored = res?.[GREET_DAILY_STORAGE_KEY];

        const today = getLocalDateString();
        if (stored && typeof stored === "object") {
            greetDailyState.date = String(stored.date || "");
            greetDailyState.count = Number(stored.count || 0);
        }

        if (greetDailyState.date !== today) {
            greetDailyState.date = today;
            greetDailyState.count = 0;
            await storageSet({
                [GREET_DAILY_STORAGE_KEY]: { date: today, count: 0 }
            });
        }
    } catch (e) {
        // 扩展被重载/无权限时可能失败，忽略但不阻塞主流程
        console.warn("[CONTENT] ensureGreetDailyLoaded failed:", e);
    }
}

async function getTodayGreetDailyCount() {
    await ensureGreetDailyLoaded();
    const today = getLocalDateString();
    if (greetDailyState.date !== today) {
        greetDailyState.date = today;
        greetDailyState.count = 0;
        try {
            await storageSet({
                [GREET_DAILY_STORAGE_KEY]: { date: today, count: 0 }
            });
        } catch (e) {
            console.warn("[CONTENT] reset greet daily failed:", e);
        }
    }
    return greetDailyState.count;
}

async function addGreetDailyCount(delta) {
    await ensureGreetDailyLoaded();
    const today = getLocalDateString();
    if (greetDailyState.date !== today) {
        greetDailyState.date = today;
        greetDailyState.count = 0;
    }

    greetDailyState.count = Math.max(0, greetDailyState.count + Number(delta || 0));

    try {
        await storageSet({
            [GREET_DAILY_STORAGE_KEY]: { date: greetDailyState.date, count: greetDailyState.count }
        });
    } catch (e) {
        console.warn("[CONTENT] save greet daily failed:", e);
    }

    sendMessage({
        type: "GREET_DAILY_PROGRESS",
        data: { date: greetDailyState.date, count: greetDailyState.count, limit: GREET_DAILY_LIMIT }
    }).catch(() => {});
}

async function publishGreetDailyProgress() {
    const count = await getTodayGreetDailyCount();
    sendMessage({
        type: "GREET_DAILY_PROGRESS",
        data: { date: greetDailyState.date, count, limit: GREET_DAILY_LIMIT }
    }).catch(() => {});
}

function getCandidateHelpers() {
    const helpers = globalThis.LanxingCandidateHelpers;
    if (!helpers) {
        throw new Error("LANXING_CANDIDATE_HELPERS_NOT_LOADED");
    }
    return helpers;
}

function normalizeStoredText(value, maxLength = 2000) {
    return getCandidateHelpers().normalizeStoredText(value, maxLength);
}

function normalizeLongStoredText(value, maxLength = 30000) {
    return getCandidateHelpers().normalizeLongStoredText(value, maxLength);
}

function getCandidateStableId(candidate) {
    return getCandidateHelpers().getCandidateStableId(candidate);
}

function getCandidateDisplayName(candidate) {
    return getCandidateHelpers().getCandidateDisplayName(candidate);
}

function buildDecisionCandidateText(data = {}) {
    return getCandidateHelpers().buildDecisionCandidateText(data);
}

function getCandidateIdentityFromAction(data = {}) {
    return getCandidateHelpers().getCandidateIdentityFromAction(data);
}

function rememberCandidateIdentity(element, data = {}) {
    if (!element?.dataset) return;
    const identity = getCandidateIdentityFromAction(data);
    if (identity.candidateId) {
        element.dataset.lanxingCandidateId = identity.candidateId;
    }
    if (identity.candidateName) {
        element.dataset.lanxingCandidateName = identity.candidateName;
    }
}

function elementHasAttributeValue(element, value) {
    const target = String(value || "").trim();
    if (!element || !target) return false;

    const nodes = [element, ...Array.from(element.querySelectorAll("*"))];
    return nodes.some((node) => {
        if (!node.attributes) return false;
        return Array.from(node.attributes).some((attr) => {
            const attrValue = String(attr.value || "").trim();
            return attrValue === target || attrValue.includes(target);
        });
    });
}

async function findCandidateElementByIdentity(identity = {}) {
    if (!currentParser) return null;
    const elements = Array.from(currentParser.findElements() || []);
    const candidateId = String(identity.candidateId || "").trim();
    const candidateName = String(identity.candidateName || "").trim();

    if (candidateId) {
        for (const el of elements) {
            if (el?.dataset?.lanxingCandidateId === candidateId || elementHasAttributeValue(el, candidateId)) {
                return el;
            }
        }
    }

    if (candidateName) {
        for (const el of elements) {
            try {
                const nameEl = currentParser.findNameElement
                    ? await currentParser.findNameElement(el)
                    : null;
                const text = String(nameEl?.textContent || "").trim();
                if (text && (text === candidateName || text.includes(candidateName) || candidateName.includes(text))) {
                    return el;
                }
            } catch (e) {
                // fall back to card text below
            }

            const cardText = String(el?.textContent || "").replace(/\s+/g, " ").trim();
            if (cardText && cardText.includes(candidateName)) {
                return el;
            }
        }
    }

    return null;
}

async function findCandidateElementForAction(data = {}, fallbackElement = null) {
    if (fallbackElement?.isConnected) {
        rememberCandidateIdentity(fallbackElement, data);
        return fallbackElement;
    }

    const identity = getCandidateIdentityFromAction(data);
    if (identity.candidateId || identity.candidateName) {
        const element = await findCandidateElementByIdentity(identity);
        if (element) {
            rememberCandidateIdentity(element, data);
            return element;
        }
    }

    const currentElement = findCurrentProcessingOrUnprocessedElement();
    if (currentElement) {
        rememberCandidateIdentity(currentElement, data);
    }
    return currentElement;
}

function buildApprovedCandidateSnapshot(candidate) {
    return getCandidateHelpers().buildApprovedCandidateSnapshot(candidate);
}

function buildApprovedCandidateRecordId(positionId, positionName, candidate) {
    return getCandidateHelpers().buildApprovedCandidateRecordId(positionId, positionName, candidate);
}

async function upsertApprovedCandidateToPool({
    candidate,
    simpleText,
    detailText,
    resumeText,
    aiReason,
    positionId,
    positionName,
    jobDescription,
    decisionSource = "auto"
}) {
    if (!candidate) {
        throw new Error("APPROVED_CANDIDATE_MISSING");
    }

    const approvedAt = Date.now();
    const snapshot = buildApprovedCandidateSnapshot(candidate);
    const recordId = buildApprovedCandidateRecordId(positionId, positionName, candidate);
    const poolRes = await storageGet([TALENT_POOL_STORAGE_KEY]);
    const pool = Array.isArray(poolRes?.[TALENT_POOL_STORAGE_KEY]) ? [...poolRes[TALENT_POOL_STORAGE_KEY]] : [];
    const existingIndex = pool.findIndex((item) => item?.id === recordId);
    const existing = existingIndex >= 0 ? pool[existingIndex] : null;

    const record = {
        id: recordId,
        candidateId: snapshot.candidateId,
        candidateName: snapshot.candidateName || candidate?.name || "未知候选人",
        positionId: String(positionId || "").trim(),
        positionName: String(positionName || "").trim(),
        jobDescription: normalizeStoredText(jobDescription || "", 4000),
        aiReason: normalizeStoredText(aiReason || "", 120),
        simpleText: normalizeStoredText(simpleText || "", 2400),
        detailText: normalizeLongStoredText(detailText || simpleText || existing?.detailText || "", 12000),
        resumeText: normalizeLongStoredText(resumeText || existing?.resumeText || "", 50000),
        sourceUrl: window.location.href,
        sourceSite: "boss_zhipin",
        decisionSource: String(decisionSource || "auto").trim() || "auto",
        snapshot,
        approvedAt: existing?.approvedAt || approvedAt,
        updatedAt: approvedAt,
        firstApprovedAt: existing?.firstApprovedAt || existing?.approvedAt || approvedAt,
    };

    if (existingIndex >= 0) {
        pool[existingIndex] = { ...existing, ...record };
    } else {
        pool.unshift(record);
    }

    await storageSet({ [TALENT_POOL_STORAGE_KEY]: pool });
    return {
        inserted: existingIndex === -1,
        total: pool.length,
        record
    };
}

// 监听 popup 的清零操作（storage 更新），同步内存态，避免“已清零但仍按旧值拦截”
try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        const next = changes?.[GREET_DAILY_STORAGE_KEY]?.newValue;
        if (!next || typeof next !== "object") return;

        greetDailyState.loaded = true;
        greetDailyState.date = String(next.date || "");
        greetDailyState.count = Number(next.count || 0);
        publishGreetDailyProgress().catch(() => {});
    });
} catch (e) {
    // 在扩展上下文失效时可能抛错，忽略
}

let enableSound = false;

let ParserName = null

// 显示提示信息
function showNotification(message, type = 'status') {
    if (!isExtensionValid()) {
        console.warn('扩展上下文已失效，无法发送通知');
        return;
    }

    const notification = document.createElement('div');

    // 基础样式
    let baseStyle = `
        position: fixed;
        padding: 12px 20px;
        background: rgba(51, 51, 51, 0.9);
        color: white;
        border-radius: 6px;
        z-index: 9999;
        font-size: 14px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.2);
        pointer-events: none;
    `;

    // 根据类型设置不同的位置样式
    if (type === 'status') {
        baseStyle += `
            left: 50%;
            top: 20px;
            transform: translateX(-50%);
        `;
    } else {
        baseStyle += `
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
        `;
    }

    notification.style.cssText = baseStyle;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 1500);
}

// 根据当前网站URL选择合适的解析器
async function initializeParser() {
    try {
        const url = window.location.href;
        const extensionUrl = chrome.runtime.getURL('');

        // BOSS 页面可能运行在 about:blank iframe 中（同源继承），此时 URL 不包含 zhipin.com
        // 因此增加 DOM 指纹判断（#page_key_name）来决定是否初始化 BossParser
        const pageKey = document.querySelector('input#page_key_name')?.getAttribute('value') || "";
        const looksLikeBoss = url.includes('zhipin.com') || /^bpc_/.test(pageKey);

        if (looksLikeBoss) {
            ParserName = 'boss'

            // 等待 BossParser 加载完成
            if (!window.BossParser) {
                await new Promise(resolve => {
                    const checkBossParser = () => {
                        if (window.BossParser) {
                            resolve();
                        } else {
                            setTimeout(checkBossParser, 100);
                        }
                    };
                    checkBossParser();
                });
            }

            currentParser = new window.BossParser();
            // showNotification('BOSS初始化完成，请前往推荐牛人页面使用-揽星', 'status');

            // 检查是否在iframe中
            const isInIframe = window !== window.top;
            // 跳过 about:blank 和非主框架页面

            if (!isInIframe) {
                createDraggablePrompt(); // 只在主框架中创建询问框
            }
        }

        if (currentParser) {
            await currentParser.loadSettings();
            // console.log('Boss解析器初始化完成');
        } else {
            console.warn('当前页面不是Boss网站，插件未激活');
        }

    } catch (error) {
        console.error('初始化Boss解析器失败:', error);
        showNotification('⚠️ 初始化解析器失败: ' + error.message, 'status');
        currentParser = null; // 确保失败时设置为null
    }
}

// 确保解析器已就绪（避免 iframe/时序导致的“解析器未初始化”误报）
async function ensureParserReady() {
    if (currentParser) return true;
    try {
        await initializeParser();
    } catch (e) {
        // 初始化失败时不抛出，交由调用方返回错误响应
    }
    return !!currentParser;
}

// ======================================================
// BOSS 职位列表（/web/chat/job/list）手动同步（拦截驱动）
// ======================================================

const BOSS_CHAT_JOB_LIST_PAGE_PATH = "/web/chat/job/list";
const BOSS_JOB_LIST_API_URL = "https://www.zhipin.com/wapi/zpjob/job/data/list";
const BOSS_JOB_PREVIEW_API_URL = "https://www.zhipin.com/wapi/zpjob/job/job/preview";
const BOSS_CHAT_RECOMMEND_PAGE_PATH = "/web/chat/recommend";

function isBossJobListPage() {
    try {
        if (!location.hostname.includes("zhipin.com")) return false;
        if (location.pathname.startsWith(BOSS_CHAT_JOB_LIST_PAGE_PATH)) return true;
        const pageKey = document.querySelector('input#page_key_name')?.getAttribute('value') || "";
        return pageKey === "bpc_chat";
    } catch (e) {
        return false;
    }
}

function isBossRecommendPage() {
    try {
        if (!location.hostname.includes("zhipin.com")) return false;
        if (location.pathname.startsWith(BOSS_CHAT_RECOMMEND_PAGE_PATH)) return true;
        const pageKey = document.querySelector('input#page_key_name')?.getAttribute('value') || "";
        return pageKey === "bpc_geek_rcmd";
    } catch (e) {
        return false;
    }
}

function isBossRecommendContext(doc = document) {
    try {
        const pageKey = doc.querySelector('input#page_key_name')?.getAttribute('value') || "";
        if (pageKey === "bpc_geek_rcmd") return true;
        const win = doc.defaultView;
        if (win?.location?.hostname && win.location.hostname.includes("zhipin.com") && win.location.pathname?.startsWith(BOSS_CHAT_RECOMMEND_PAGE_PATH)) {
            return true;
        }
        if (doc.querySelector("#headerWrap") && doc.querySelector("#recommend-list")) return true;
        if (doc.querySelector("#recommend-list, .recommend-card-list, .card-list")) return true;
        if (doc.querySelector(".candidate-card-wrap, .geek-info-card, [data-geekid]")) return true;
        const bodyText = (doc.body?.innerText || "").slice(0, 3000);
        return bodyText.includes("推荐牛人") && bodyText.includes("打招呼");
    } catch (e) {
        return false;
    }
}

function collectSameOriginDocuments(rootDoc = document, maxDepth = 5) {
    const docs = [];
    const visited = new Set();

    function walk(doc, depth) {
        if (!doc || visited.has(doc) || depth > maxDepth) return;
        visited.add(doc);
        docs.push(doc);

        const iframes = Array.from(doc.querySelectorAll("iframe"));
        for (const iframe of iframes) {
            try {
                const childDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!childDoc) continue;
                walk(childDoc, depth + 1);
            } catch (e) {
                // ignore cross-origin
            }
        }
    }

    walk(rootDoc, 0);
    return docs;
}

function isBossRecommendDocument(doc) {
    try {
        const win = doc.defaultView;
        const pageKey = doc.querySelector("input#page_key_name")?.getAttribute("value") || "";
        if (pageKey === "bpc_geek_rcmd") return true;
        if (win?.location?.hostname && win.location.hostname.includes("zhipin.com") && win.location.pathname?.startsWith(BOSS_CHAT_RECOMMEND_PAGE_PATH)) return true;
        return isBossRecommendContext(doc);
    } catch (e) {
        return false;
    }
}

function findBossRecommendDocument() {
    let rootDoc = document;
    try {
        if (window.top && window.top.document) rootDoc = window.top.document;
    } catch (e) {
        // ignore
    }

    const docs = collectSameOriginDocuments(rootDoc, 6);
    for (const doc of docs) {
        if (isBossRecommendDocument(doc)) return doc;
    }
    return null;
}

function normalizeJobTitleForMatch(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .replace(/\s*_\s*/g, " _ ")
        .trim();
}

function parseJobTitleParts(text) {
    const normalized = normalizeJobTitleForMatch(text);
    const salaryMatch = normalized.match(/\d+\s*-\s*\d+K|\d+K/i);
    const salary = salaryMatch ? salaryMatch[0].replace(/\s+/g, "") : "";

    const pieces = normalized.split(" _ ");
    const title = (pieces[0] || "").trim();
    const right = (pieces[1] || "").trim();
    const city = right ? right.split(" ")[0].trim() : "";

    return { normalized, title, city, salary };
}

function clickElement(el, viewWindow = window) {
    if (!el) return false;
    try {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: viewWindow }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: viewWindow }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: viewWindow }));
        return true;
    } catch (e) {
        try {
            el.click();
            return true;
        } catch (_) {
            return false;
        }
    }
}

async function waitForSelector(selector, { doc = document, timeoutMs = 8000, intervalMs = 100 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const el = doc.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

function getRecommendListFingerprint(doc = document) {
    const listRoot = doc.querySelector("#recommend-list");
    if (!listRoot) return { count: 0, ids: "", text: "" };

    const cards = Array.from(listRoot.querySelectorAll("[data-geekid]"));
    const ids = cards.slice(0, 8).map((el) => el.getAttribute("data-geekid") || "").join("|");

    // 兜底：有些场景 data-geekid 可能拿不到，退回取前几行文本
    const text = cards.length
        ? cards.slice(0, 2).map((el) => normalizeJobTitleForMatch(el.textContent || "")).join("|")
        : normalizeJobTitleForMatch(listRoot.textContent || "").slice(0, 120);

    return { count: cards.length, ids, text };
}

async function waitForRecommendListRefresh(beforeFingerprint, { doc = document, timeoutMs = 12000 } = {}) {
    const startedAt = Date.now();

    // 同时等待：1) DOM 指纹变化；2) 拦截到新的 geek-list 数据
    const waitForGeekList = new Promise((resolve) => {
        const handler = (event) => {
            const data = event?.data;
            if (!data || data.source !== "boss-plugin") return;
            if (data.type !== "geek-list") return;
            if (Date.now() - startedAt < 150) return; // 防抖：过滤掉点击前瞬间的消息
            window.removeEventListener("message", handler);
            resolve(true);
        };
        window.addEventListener("message", handler);
        setTimeout(() => {
            window.removeEventListener("message", handler);
            resolve(false);
        }, timeoutMs);
    });

    const waitForDom = (async () => {
        while (Date.now() - startedAt < timeoutMs) {
            const cur = getRecommendListFingerprint(doc);
            const changed =
                (cur.count > 0 && (cur.ids && cur.ids !== beforeFingerprint.ids)) ||
                (cur.count > 0 && (!cur.ids && cur.text && cur.text !== beforeFingerprint.text));
            if (changed) return true;
            await new Promise((r) => setTimeout(r, 200));
        }
        return false;
    })();

    const [geekListOk, domOk] = await Promise.all([waitForGeekList, waitForDom]);
    return geekListOk || domOk;
}

async function switchBossRecommendJob(targetTitle, doc = document) {
    if (!isBossRecommendDocument(doc)) {
        throw new Error("未找到推荐牛人页面上下文");
    }
    const viewWindow = doc.defaultView || window;

    await waitForSelector("#headerWrap", { doc, timeoutMs: 10000 });
    await waitForSelector("#recommend-list", { doc, timeoutMs: 10000 });

    const items = Array.from(doc.querySelectorAll("#headerWrap li[value]"));
    if (!items.length) throw new Error("未找到推荐页职位列表（#headerWrap li[value]）");

    const target = parseJobTitleParts(targetTitle);
    const before = getRecommendListFingerprint(doc);

    // 如果已处于目标岗位列表，则不重复点击切换
    const selected = items.find((li) => {
        const ariaSelected = li.getAttribute("aria-selected");
        if (ariaSelected === "true") return true;
        const ariaCurrent = li.getAttribute("aria-current");
        if (ariaCurrent) return true;
        // 兼容常见选中态 class（不依赖具体 class 名，只做弱匹配）
        const cls = (li.getAttribute("class") || "").toLowerCase();
        return /\b(cur|curr|current|selected|active)\b/.test(cls);
    });
    if (selected) {
        const selectedText = normalizeJobTitleForMatch(selected.textContent || "");
        if (selectedText === target.normalized) {
            return {
                ok: true,
                refreshed: true,
                already: true,
                matched: selected.textContent?.trim() || "",
                value: selected.getAttribute("value") || ""
            };
        }
    }

    // 先精确匹配规范化全文
    const exact = items.find((li) => {
        const text = normalizeJobTitleForMatch(li.textContent || "");
        return text === target.normalized;
    });
    if (exact) {
        const ok = clickElement(exact, viewWindow);
        const refreshed = ok ? await waitForRecommendListRefresh(before, { doc }) : false;
        return { ok, refreshed, matched: exact.textContent?.trim() || "", value: exact.getAttribute("value") || "" };
    }

    // 再按字段匹配（title + city + salary）
    const scored = items
        .map((li) => {
            const parts = parseJobTitleParts(li.textContent || "");
            let score = 0;
            if (parts.salary && target.salary && parts.salary.replace(/\s+/g, "") === target.salary.replace(/\s+/g, "")) score += 3;
            if (parts.city && target.city && parts.city === target.city) score += 2;
            if (parts.title && target.title) {
                const a = parts.title.toLowerCase();
                const b = target.title.toLowerCase();
                if (a === b) score += 3;
                else if (a.includes(b) || b.includes(a)) score += 1;
            }
            return { li, score, parts };
        })
        .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score <= 0) {
        throw new Error(`未匹配到职位：${targetTitle}`);
    }

    const ok = clickElement(best.li, viewWindow);
    const refreshed = ok ? await waitForRecommendListRefresh(before, { doc }) : false;
    return { ok, refreshed, matched: best.li.textContent?.trim() || "", value: best.li.getAttribute("value") || "", score: best.score };
}

function parseEncryptJobIdFromUrl(url) {
    try {
        const u = new URL(url, location.origin);
        return u.searchParams.get("encryptJobId") || "";
    } catch (e) {
        return "";
    }
}

function mapBossJobStatus(jobStatus) {
    // 已验证：
    // 0 → OPEN     （开放中 / 在招）
    // 1 → CLOSED   （已关闭 / 下线）
    // 3 → PENDING  （待开启 / 未开始）
    if (jobStatus === 0) return "OPEN";
    if (jobStatus === 1) return "CLOSED";
    if (jobStatus === 3) return "PENDING";
    return "UNKNOWN";
}

function computePaidValid(paidJobEndDate) {
    // paidJobEndDate 决定“是否在有效推荐期”
    if (!paidJobEndDate) return { isInPaidPeriod: false, paidJobEndAt: null };
    const timestamp = typeof paidJobEndDate === "number"
        ? paidJobEndDate
        : (Number(paidJobEndDate) || Date.parse(String(paidJobEndDate)));
    if (!timestamp || Number.isNaN(timestamp)) return { isInPaidPeriod: false, paidJobEndAt: null };
    return { isInPaidPeriod: timestamp > Date.now(), paidJobEndAt: timestamp };
}

function normalizeBossJobItem(rawJob) {
    const encryptJobId = rawJob?.encryptJobId || rawJob?.encryptId || "";
    const { isInPaidPeriod, paidJobEndAt } = computePaidValid(rawJob?.paidJobEndDate);
    return {
        encryptJobId,
        jobName: rawJob?.jobName || rawJob?.positionName || "",
        positionName: rawJob?.positionName || rawJob?.jobName || "",
        brandName: rawJob?.brandName || "",
        locationName: rawJob?.locationName || "",
        addressShowText: rawJob?.addressShowText || "",
        salaryDesc: rawJob?.salaryDesc || "",
        experienceName: rawJob?.experienceName || "",
        degreeName: rawJob?.degreeName || "",
        jobTypeName: rawJob?.jobTypeName || rawJob?.workTypeName || "",
        jobStatus: rawJob?.jobStatus,
        jobStatusText: mapBossJobStatus(rawJob?.jobStatus),
        paidJobEndAt,
        isInPaidPeriod,
        // 只保存同步职位所需的关键信息，避免数据过大/请求过快导致封控
    };
}

function waitForBossPluginMessage({ type, predicate, timeoutMs = 15000 }) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            window.removeEventListener("message", onMessage);
            reject(new Error(`等待消息超时: ${type}`));
        }, timeoutMs);

        function onMessage(event) {
            try {
                const data = event?.data;
                if (!data || data.source !== "boss-plugin") return;
                if (data.type !== type) return;
                if (predicate && !predicate(data)) return;
                if (done) return;
                done = true;
                clearTimeout(timer);
                window.removeEventListener("message", onMessage);
                resolve(data);
            } catch (e) {
                // 忽略异常，继续等待
            }
        }

        window.addEventListener("message", onMessage);
    });
}

async function requestBossJobListPageViaIntercept(params) {
    const url = new URL(BOSS_JOB_LIST_API_URL);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value ?? ""));
    });

    const requestId = `job_list_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const waiter = waitForBossPluginMessage({
        type: "job-list",
        predicate: (msg) => msg.requestId === requestId,
        timeoutMs: 20000
    });

    // 通过 postMessage 让已注入的 boss_interceptor.js 在页面上下文发起请求（规避 CSP inline script）
    window.postMessage({
        source: "lanxing",
        type: "LANXING_FETCH",
        requestId,
        url: url.toString()
    }, "*");

    const message = await waiter;
    const json = message?.data;
    const code = json?.code;
    if (typeof code === "number" && code !== 0) {
        throw new Error(`接口返回错误: code=${code} message=${json?.message || ""}`);
    }
    return json;
}

async function requestBossJobPreviewViaIntercept(encryptJobId) {
    if (!encryptJobId) throw new Error("encryptJobId 为空");
    const url = new URL(BOSS_JOB_PREVIEW_API_URL);
    url.searchParams.set("encryptJobId", encryptJobId);

    const requestId = `job_preview_${encryptJobId}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const waiter = waitForBossPluginMessage({
        type: "job-preview",
        predicate: (msg) => msg.requestId === requestId,
        timeoutMs: 20000
    });

    window.postMessage({
        source: "lanxing",
        type: "LANXING_FETCH",
        requestId,
        url: url.toString()
    }, "*");

    const message = await waiter;
    const json = message?.data;
    const code = json?.code;
    if (typeof code === "number" && code !== 0) {
        throw new Error(`预览接口返回错误: code=${code} message=${json?.message || ""}`);
    }
    return json;
}

async function syncBossJobsViaIntercept(options = {}) {
    if (!isBossJobListPage()) {
        throw new Error("请打开 BOSS 职位列表页：https://www.zhipin.com/web/chat/job/list");
    }
    if (window.__lanxingBossJobSyncRunning) {
        throw new Error("正在同步中，请稍后再试");
    }
    window.__lanxingBossJobSyncRunning = true;

    const {
        position = 0,
        type = 0,
        searchStr = "",
        comId = "",
        tagIdStr = "",
        maxPages = 200,
        maxJobs = 500,
        includePreview = true
    } = options;

    try {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const jobs = [];
        const previewByEncryptJobId = {};
        const seen = new Set();

        let page = 1;
        let hasMore = true;

        await sendMessage({
            type: 'LOG_MESSAGE',
            data: { message: '开始同步职位：分页拉取列表 + 逐个预览（3秒/个）', type: 'info' }
        }).catch(() => {});

        while (hasMore && page <= maxPages && jobs.length < maxJobs) {
            await sendMessage({
                type: 'LOG_MESSAGE',
                data: { message: `拉取职位列表第 ${page} 页...`, type: 'info' }
            }).catch(() => {});

            const json = await requestBossJobListPageViaIntercept({
                position,
                type,
                searchStr,
                comId,
                tagIdStr,
                page,
                _: Date.now()
            });

            const zpData = json?.zpData || {};
            const pageJobsRaw = Array.isArray(zpData.data) ? zpData.data : [];

            for (const rawJob of pageJobsRaw) {
                const normalized = normalizeBossJobItem(rawJob);
                const jobKey = normalized.encryptJobId || normalized.jobName;
                if (!jobKey || seen.has(jobKey)) continue;
                seen.add(jobKey);
                jobs.push(normalized);
                if (jobs.length >= maxJobs) break;
            }

            hasMore = !!zpData.hasMore;
            page += 1;
        }

        if (includePreview) {
            // 只对 OPEN 职位请求预览，降低请求量避免封控
            const openJobs = jobs.filter((j) => j.jobStatus === 0);
            const total = openJobs.length;
            let index = 0;

            await sendMessage({
                type: 'LOG_MESSAGE',
                data: { message: `职位列表已获取：共 ${jobs.length} 个（OPEN：${total} 个），开始逐个预览...`, type: 'success' }
            }).catch(() => {});

            for (const job of openJobs) {
                if (!job.encryptJobId) continue;
                index += 1;

                await sendMessage({
                    type: 'LOG_MESSAGE',
                    data: { message: `预览 ${index}/${total}：${job.jobName || job.positionName || job.encryptJobId}`, type: 'info' }
                }).catch(() => {});

                try {
                    const previewJson = await requestBossJobPreviewViaIntercept(job.encryptJobId);
                    const zp = previewJson?.zpData || null;
                    const previewZpData = zp
                        ? {
                            paidJobEndDate: zp.paidJobEndDate ?? null,
                            postDescription: zp.postDescription ?? ''
                        }
                        : null;

                    previewByEncryptJobId[job.encryptJobId] = previewZpData;

                    // paidJobEndDate 以预览接口为准（若列表里没有）
                    if (previewZpData && previewZpData.paidJobEndDate) {
                        const { isInPaidPeriod, paidJobEndAt } = computePaidValid(previewZpData.paidJobEndDate);
                        job.isInPaidPeriod = isInPaidPeriod;
                        job.paidJobEndAt = paidJobEndAt;
                    }

                    await sendMessage({
                        type: 'LOG_MESSAGE',
                        data: {
                            message: `完成：${job.jobName || job.positionName} | 状态=${job.jobStatusText} | 有效推荐期=${job.isInPaidPeriod ? '是' : '否'}`,
                            type: 'success'
                        }
                    }).catch(() => {});
                } catch (e) {
                    previewByEncryptJobId[job.encryptJobId] = null;
                    await sendMessage({
                        type: 'LOG_MESSAGE',
                        data: { message: `预览失败：${job.jobName || job.positionName}（${e.message}）`, type: 'warning' }
                    }).catch(() => {});
                }

                // 3秒一个（不要一下全获取），降低封控风险
                await sleep(3000 + Math.floor(Math.random() * 1001));
            }
        }

        // 只保留：OPEN 且在有效推荐期（paidJobEndDate 决定）
        const effectiveJobs = jobs.filter((j) => j.jobStatus === 0 && j.isInPaidPeriod === true);
        const effectivePreviewByEncryptJobId = {};
        for (const job of effectiveJobs) {
            if (!job.encryptJobId) continue;
            effectivePreviewByEncryptJobId[job.encryptJobId] = previewByEncryptJobId[job.encryptJobId] || null;
        }

        const stored = {
            fetchedAt: Date.now(),
            source: "intercept:wapi/zpjob/job/data/list + wapi/zpjob/job/job/preview",
            params: { position, type, searchStr, comId, tagIdStr },
            meta: {
                totalFetched: jobs.length,
                openFetched: jobs.filter((j) => j.jobStatus === 0).length,
                effectiveCount: effectiveJobs.length
            },
            jobs: effectiveJobs,
            previewByEncryptJobId: effectivePreviewByEncryptJobId
        };

        await chrome.storage.local.set({ bossZhipinJobs: stored });

        await sendMessage({
            type: 'LOG_MESSAGE',
            data: { message: `同步完成：有效职位 ${stored.jobs.length} 个（OPEN 且有效推荐期），已缓存到 bossZhipinJobs`, type: 'success' }
        }).catch(() => {});

        return stored;
    } finally {
        window.__lanxingBossJobSyncRunning = false;
    }
}

// 添加随机延迟函数
function randomDelay(message2 = "无") {
    // AI模式：使用AI设置
    const currentMin = currentParser?.aiSettings?.scrollDelayMin || 3;
    const currentMax = currentParser?.aiSettings?.scrollDelayMax || 5;

    // 使用设置值
    const actualMin = currentMin;
    const actualMax = currentMax;

    // 生成随机延迟（秒）
    const delaySeconds = Math.floor(Math.random() * (actualMax - actualMin + 1) + actualMin);

    // 转换为毫秒
    const delayMs = delaySeconds * 1000;



    sendMessage({
        type: 'LOG_MESSAGE',
        data: {
            message: `随机停止 ${delaySeconds} 秒 ${message2}`,
            type: 'info'
        }
    });
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

// 提取出来的图片处理函数
async function processAndSaveImage(imageData, candidateName) {
    // 内部函数：裁剪
    const cropImage = (dUrl, { topRatio = 0, bottomRatio = 0 } = {}) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const width = img.width;
                const totalHeight = img.height;
                const startY = totalHeight * topRatio;
                const endY = totalHeight * (1 - bottomRatio);
                const height = endY - startY;

                if (height <= 0) {
                    resolve(dUrl);
                    return;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, startY, width, height, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = dUrl;
        });
    };

    // 内部函数：缩放与压缩
    const resizeAndCompress = (dUrl, maxWidth = 1000, quality = 0.9) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (maxWidth > 0 && width > maxWidth) {
                    const ratio = maxWidth / width;
                    width = maxWidth;
                    height = height * ratio;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = dUrl;
        });
    };

    try {
        // 1. 裁剪
        let processedData = await cropImage(imageData, { topRatio: 0, bottomRatio: 0.6 });
        
        // 2. 缩放压缩
        processedData = await resizeAndCompress(processedData, 0, 0.9);

        // 3. 保存
        // await saveScreenshot(processedData, `resume_${candidateName || 'unknown'}_${Date.now()}.jpg`);
        // console.log('[CONTENT] 截图已保存');
        
        return processedData;

    } catch (e) {
        console.error("图片处理或保存失败:", e);
        return imageData; // 如果处理失败，返回原图
    }
}


// 添加一个函数来获取所有可用的文档对象
function getAllDocuments() {
    const documents = [document];

    const frames = document.getElementsByTagName('iframe');
    for (const frame of frames) {
        try {
            if (frame.contentDocument) {
                documents.push(frame.contentDocument);
            }
        } catch (error) {
            console.warn('无法访问 iframe:', error);
        }
    }

    return documents;
}

// 修改自动滚动功能
async function startAutoScroll() {

    // console.log('开始自动滚动');

    if (isRunning) return;

    // 检查AI模式的配置要求
    if (!currentParser?.aiSettings?.aiConfig?.token) {
        console.error('AI模式需要配置Token');
        sendMessage({
            type: 'LOG_MESSAGE',
            data: {
                message: 'AI模式需要配置Token，请先配置AI设置',
                type: 'error'
            }
        });
        showNotification('⚠️ AI模式需要配置Token', 'status');
        return;
    }

    if (!currentParser?.aiSettings?.positionName || !currentParser.aiSettings.positionName.trim() || 
        !currentParser?.aiSettings?.jobDescription || !currentParser.aiSettings.jobDescription.trim()) {
        console.error('AI模式需要完整岗位信息');
        sendMessage({
            type: 'LOG_MESSAGE',
            data: {
                message: '请选择完整的岗位信息(包含标题和详情)',
                type: 'error'
            }
        });
        showNotification('⚠️ 请选择完整的岗位信息', 'status');
        return;
    }

    try {
        await ensureGreetDailyLoaded();
        await publishGreetDailyProgress();

        const greetingEnabled = currentParser?.aiSettings?.greetingEnabled === true;
        const dailyCount = greetingEnabled ? await getTodayGreetDailyCount() : 0;
        if (greetingEnabled && dailyCount >= GREET_DAILY_LIMIT) {
            sendMessage({
                type: 'LOG_MESSAGE',
                data: {
                    message: `已达到今日打招呼上限：${dailyCount}/${GREET_DAILY_LIMIT}，请明天再试`,
                    type: 'warning'
                }
            });
            showNotification(`⚠️ 今日打招呼已达上限 ${dailyCount}/${GREET_DAILY_LIMIT}`, 'status');
            return;
        }

        isRunning = true;
        forceStop = false; // 重置强制停止标志
        lastProcessedPosition = 0;
        matchCount = 0;
        contactCount = 0;

        // ==========================================

        // AI模式设置
        matchLimit = currentParser?.aiSettings?.matchLimit || 200;
        scrollDelayMin = currentParser?.aiSettings?.scrollDelayMin || 3;
        scrollDelayMax = currentParser?.aiSettings?.scrollDelayMax || 5;

        window.scrollTo(0, 0);

        sendMessage({
            type: 'LOG_MESSAGE',
            data: {
                message: `开始滚动`,
                type: 'info'
            }
        });

        executeScroll();
        showNotification('开始自动滚动', 'status');
    } catch (error) {
        isRunning = false;
        console.error('启动失败:', error);
        showNotification('⚠️ ' + error.message, 'status');
        throw error;
    }
}

// 将 rolling 逻辑提取为单独的函数
async function executeScroll() {
    if (forceStop || !isRunning || !currentParser) {
        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
        isRunning = false;
        forceStop = false;
        return;
    }

    try {
        const greetingEnabled = currentParser?.aiSettings?.greetingEnabled === true;
        const dailyCount = greetingEnabled ? await getTodayGreetDailyCount() : 0;
        if (greetingEnabled && dailyCount >= GREET_DAILY_LIMIT) {
            await sendMessage({
                type: 'LOG_MESSAGE',
                data: { message: `已达到今日打招呼上限：${dailyCount}/${GREET_DAILY_LIMIT}，自动停止`, type: 'warning' }
            }).catch(() => {});

            await sendMessage({
                type: 'SCROLL_COMPLETE',
                data: {
                    processedCount: matchCount,
                    contactCount: contactCount,
                    limit: matchLimit,
                    positionName: currentParser?.aiSettings?.positionName || ''
                }
            }).catch(() => {});

            try {
                if (chrome?.runtime?.id && chrome?.storage?.local) {
                    await chrome.storage.local.set({ isRunning: false });
                }
            } catch (e) {}

            stopAutoScroll();
            return;
        }

        await currentParser.loadSettings();
        
        // 尝试处理一个候选人
        const processedResult = await processElement();

        // 再次检查停止标志，如果已停止则不再继续
        if (forceStop || !isRunning) {
            // console.log('[CONTENT] 检测到停止信号，退出滚动循环');
            return;
        }

             if (processedResult && processedResult.processed) {
             matchCount += 1;
             if (processedResult.contacted) {
                 contactCount += 1;
                 await addGreetDailyCount(1);

                 const nextDaily = await getTodayGreetDailyCount();
                 if (nextDaily >= GREET_DAILY_LIMIT) {
                     await sendMessage({
                         type: 'LOG_MESSAGE',
                         data: { message: `已达到今日打招呼上限：${nextDaily}/${GREET_DAILY_LIMIT}，自动停止`, type: 'warning' }
                     }).catch(() => {});
                 }
                 // 每次“通过并打招呼”后输出进度：1/2（当前/目标）
                 if (matchLimit > 0) {
                     await sendMessage({
                         type: 'LOG_MESSAGE',
                         data: { message: `通过进度：${contactCount}/${matchLimit}`, type: 'success' }
                     }).catch(() => {});
                 }
             }
             
             // 发送进度更新消息
             sendMessage({
                 type: 'BATCH_STATUS',
                 data: {
                     processedCount: matchCount,
                     contactCount: contactCount,
                     limit: matchLimit,
                     // 批量状态（如果有）
                     batch: currentParser?.aiSettings?.batchState || null,
                     positionName: currentParser?.aiSettings?.positionName || ''
                 }
             });

             const progressCount = greetingEnabled ? contactCount : matchCount;
             if (matchLimit > 0) {
                 await sendMessage({
                     type: 'LOG_MESSAGE',
                     data: { message: greetingEnabled ? `通过进度：${progressCount}/${matchLimit}` : `分析进度：${progressCount}/${matchLimit}`, type: 'success' }
                 }).catch(() => {});
             }

             if (matchLimit > 0 && progressCount >= matchLimit) {
                 const batchState = currentParser?.aiSettings?.batchState;
                 const plan = Array.isArray(batchState?.plan) ? batchState.plan : null;
                 const index = typeof batchState?.index === 'number' ? batchState.index : 0;
                 const hasNext = !!plan && index < plan.length - 1;

                 if (hasNext) {
                     const nextIndex = index + 1;
                     const next = plan[nextIndex];

                     await sendMessage({
                         type: 'LOG_MESSAGE',
                         data: { message: `达到岗位数量：${contactCount}/${matchLimit}，切换下一个（${nextIndex + 1}/${plan.length}）`, type: 'warning' }
                     }).catch(() => {});

                     // 更新当前岗位设置
                     currentParser.aiSettings.positionId = next.positionId || '';
                     currentParser.aiSettings.positionName = next.positionName || '';
                     currentParser.aiSettings.jobDescription = next.jobDescription || '';
                     currentParser.aiSettings.matchLimit = next.matchLimit || 200;
                     matchLimit = currentParser.aiSettings.matchLimit;
                     matchCount = 0;
                     contactCount = 0;
                     currentParser.aiSettings.batchState = { ...batchState, index: nextIndex };

                     // 切换推荐页岗位列表（如果已经是目标岗位会自动跳过）
                     const recommendDoc = isBossRecommendContext(document) ? document : findBossRecommendDocument();
                     if (recommendDoc) {
                         try {
                             const result = await switchBossRecommendJob(next.positionName || "", recommendDoc);
                             if (result?.refreshed) {
                                 await new Promise((r) => setTimeout(r, 1200));
                             }
                         } catch (e) {
                             await sendMessage({
                                 type: 'LOG_MESSAGE',
                                 data: { message: `批量切换失败：${e.message}，已停止`, type: 'error' }
                             }).catch(() => {});
                             stopAutoScroll();
                             return;
                         }
                     }

                     // 继续执行下一个岗位
                     if (!forceStop && isRunning) {
                         executeScroll();
                     }
                     return;
                 }

                 // 自动完成：通知 popup 切回初始按钮，并清理存储状态
                 await sendMessage({
                     type: 'SCROLL_COMPLETE',
                     data: {
                         processedCount: matchCount,
                         contactCount: contactCount,
                         limit: matchLimit,
                         positionName: currentParser?.aiSettings?.positionName || ''
                     }
                 }).catch(() => {});

                 try {
                     if (chrome?.runtime?.id && chrome?.storage?.local) {
                         await chrome.storage.local.set({ isRunning: false });
                     }
                 } catch (e) {
                     // 扩展被重载时可能失败，忽略
                 }

                 stopAutoScroll();
                 return;
             }
             // randomDelay 内含日志，暂时直接用 setTimeout 
             await new Promise(resolve => setTimeout(resolve, currentDelay || 3000));
             
             // 延迟后再次检查
             if (!forceStop && isRunning) {
                 executeScroll();
             }
        } else {
            // 当前页面未找到可处理的候选人，尝试滚动加载更多
             if (ParserName === 'hliepin' && currentParser && typeof currentParser.shouldNavigateToNextPage === 'function') {
                 // 猎聘翻页逻辑保留
                 const elements = currentParser.findElements();
                 const shouldNavigate = currentParser.shouldNavigateToNextPage(elements);
                 if (shouldNavigate) {
                     await currentParser.clickNextPageButton();
                     await new Promise(resolve => setTimeout(resolve, 3000));
                     await currentParser.loadSettings();
                     window.scrollTo(0, 0);
                     lastProcessedPosition = 0;
                     if (!forceStop && isRunning) executeScroll();
                     return;
                 }
             }

             // 向下滚动
             window.scrollBy({ top: 300, behavior: 'smooth' });
             await new Promise(resolve => setTimeout(resolve, 2000));
             if (!forceStop && isRunning) executeScroll();
        }

    } catch (error) {
        console.error('滚动处理失败:', error);
        showNotification('⚠️ 滚动处理出错', 'status');
        stopAutoScroll();
    }
}


// 添加高亮原因标签函数
function addHighlightReason(element, reason, color) {
    // 移除旧的原因标签
    element.querySelector('.lanxing-highlight-reason')?.remove();
    
    // 移除处理中状态标记
    element.classList.remove('lanxing-processing');

    const reasonEl = document.createElement('div');
    reasonEl.className = 'lanxing-highlight-reason';
    reasonEl.textContent = reason;
    reasonEl.style.cssText = `
                position: absolute;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                background-color: ${color};
                color: white;
                padding: 4px 12px;
                font-size: 12px;
                line-height: 1.4;
                max-width: min(760px, 68%);
                overflow: visible;
                white-space: normal;
                word-break: break-word;
                text-align: left;
                border-bottom-left-radius: 8px;
                border-bottom-right-radius: 8px;
                z-index: 100;
                font-weight: bold;
                pointer-events: none;
                box-sizing: border-box;
                box-shadow: 1px 1px 4px rgba(0,0,0,0.2);
            `;
    
    // 确保父元素 relative 定位
    if (getComputedStyle(element).position === 'static') {
        element.style.position = 'relative';
    }
    element.appendChild(reasonEl);

    const COLORS = window.HR_COLORS;

    // 根据 color 设置高亮样式
    let bgColor = COLORS.DEFAULT.background;
    if (color === COLORS.SUCCESS.border) bgColor = COLORS.SUCCESS.background;
    else if (color === COLORS.FAIL.border) bgColor = COLORS.FAIL.background;

    const styles = {
        'background-color': bgColor,
        'border': `2px solid ${color}`,
        'box-shadow': `0 0 10px ${color}4d`, // 30% opacity
        'transition': 'all 0.3s ease',
        'outline': 'none' // Remove processing outline
    };

    Object.entries(styles).forEach(([property, value]) => {
        element.style.setProperty(property, value, 'important');
    });
}


// 处理单个元素的函数
async function processElement() {
    // 检查是否强制停止
    if (forceStop) {
        return false;
    }

    // 使用 handleOpenFirstDetail 自动找到第一个未处理的候选人并打开详情
    const result = await handleOpenFirstDetail({}); 
    
    if (forceStop) {
        // console.log('[CONTENT] 处理过程中检测到停止信号');
        if (result && currentParser) {
            await currentParser.closeDetail();
        }
        return false;
    }

    if (!result || !result.element || !result.candidate) {
        return false;
    }

    const { element, candidate } = result;
    const targetElement = element;

    try {
        await currentParser.loadSettings();
        

        // 处理消息提示检测 (如果有必要)
        await currentParser.checkMessageTip(element,
            currentParser.filterSettings?.communicationConfig?.collectPhone||false,
            currentParser.filterSettings?.communicationConfig?.collectWechat||false,
            currentParser.filterSettings?.communicationConfig?.collectResume||false
        );

        let AiMsg = "";
        let shouldContact = false;
        
        // 简单候选人信息 (用于 AI Prompt)
        const simpleText = currentParser.getSimpleCandidateInfo(candidate);

        if (currentParser.aiMode) {
             // 详情页已由 handleOpenFirstDetail 打开

             // 2. 获取 Canvas
             // 直接调用本地函数，因为它包含处理 iframe 递归的逻辑，比工具类更准确
             let canvasRect = await waitForResumeCanvasRect(10000, 500);

             if (canvasRect) {
                 // 3. 截图 Canvas
                 let imageData = null;

                 try {
                     // 增加重试机制
                     for (let i = 0; i < 3; i++) {
                        imageData = await takeCanvasScreenshot(canvasRect);
                        if (imageData) break;
                        await new Promise(r => setTimeout(r, 1000));
                     }
                 } catch (e) {
                     console.error("获取简历内容失败:", e);
                 }

                 if (imageData) {
                     // 获取简历内容成功
                     sendMessage({
                         type: 'LOG_MESSAGE',
                         data: { message: `获取简历内容成功：${candidate.name || '未知'}`, type: 'info' }
                     });

                     // 优化图片并保存
                     imageData = await processAndSaveImage(imageData, candidate.name);

                     if (forceStop) {
                         await currentParser.closeDetail();
                         return false;
                     }

                     // 4. AI 分析
                     const aiConfig = currentParser.aiSettings?.aiConfig;
                     const positionName = currentParser.aiSettings?.positionName;
                     const jobDescription = currentParser.aiSettings?.jobDescription;

                     if (window.HR_AI_UTILS) {
                         const detailText = await getCandidateInfo(candidate);
                         let resumeFullText = "";
                         let ocrError = "";

                         if (window.HR_AI_UTILS?.extractResumeText) {
                            try {
                                await sendMessage({
                                    type: 'LOG_MESSAGE',
                                    data: { message: `正在OCR简历全文：${candidate.name || '未知'}`, type: 'info' }
                                }).catch(() => {});

                                const extracted = await window.HR_AI_UTILS.extractResumeText(
                                    imageData,
                                    `${simpleText}\n\n${detailText}`,
                                    aiConfig
                                );

                                if (extracted?.success && extracted?.text) {
                                    resumeFullText = extracted.text;
                                } else {
                                    ocrError = extracted?.error || "OCR未提取到文字";
                                }
                            } catch (extractError) {
                                ocrError = extractError?.message || String(extractError);
                                console.warn('[CONTENT] 提取简历全文失败:', extractError);
                            }
                         } else {
                            ocrError = "OCR模块未加载";
                         }

                         if (forceStop) {
                             await currentParser.closeDetail();
                             return false;
                         }

                         const decisionCandidateText = buildDecisionCandidateText({
                            simpleText,
                            detailText,
                            resumeText: resumeFullText,
                            ocrError
                         });

                         const decisionResult = await window.HR_AI_UTILS.analyzeCandidateResume(
                             imageData,
                             decisionCandidateText,
                             positionName,
                             jobDescription,
                             aiConfig
                         );

                         if (forceStop) {
                             await currentParser.closeDetail();
                             return false;
                         }

                         AiMsg = decisionResult.reason;
                         shouldContact = (decisionResult.decision === "是");
                         const markData = {
                            decision: decisionResult.decision,
                            reason: decisionResult.reason,
                            candidate,
                            candidateId: getCandidateStableId(candidate),
                            candidateName: getCandidateDisplayName(candidate)
                         };

                         if (shouldContact) {
                            try {
                                const poolResult = await upsertApprovedCandidateToPool({
                                    candidate,
                                    simpleText,
                                    detailText,
                                    resumeText: resumeFullText,
                                    aiReason: decisionResult.reason,
                                    positionId: currentParser?.aiSettings?.positionId,
                                    positionName,
                                    jobDescription,
                                    decisionSource: "auto"
                                });
                                await sendMessage({
                                    type: 'TALENT_POOL_UPDATED',
                                    data: {
                                        total: poolResult.total,
                                        inserted: poolResult.inserted,
                                        candidateName: candidate?.name || '未知候选人',
                                        positionName: positionName || ''
                                    }
                                }).catch(() => {});
                            } catch (poolError) {
                                console.error('[CONTENT] 保存通过人才失败:', poolError);
                                await sendMessage({
                                    type: 'LOG_MESSAGE',
                                    data: { message: `保存通过人才失败：${poolError.message}`, type: 'warning' }
                                }).catch(() => {});
                            }
                         }

                         // 如果需要打招呼
                         if (shouldContact && currentParser?.aiSettings?.greetingEnabled === true) {
                            if (forceStop) {
                                await currentParser.closeDetail();
                                return false;
                            }
                            await handleGreetCandidate({
                                ...markData,
                                decision: true
                            });
                        }

                         // 标记结果
                         const markerElement = await findCandidateElementForAction(markData, targetElement);
                         markCandidateDecision(markerElement || targetElement, markData);

                         // 发送日志
                         sendMessage({
                             type: 'LOG_MESSAGE',
                             data: {
                                 message: `AI 决策: ${decisionResult.decision} (${decisionResult.reason || ''})`.trim(),
                                 type: shouldContact ? 'success' : 'info'
                             }
                         });
                     } else {
                         console.error("HR_AI_UTILS 未加载");
                         sendMessage({
                             type: 'LOG_MESSAGE',
                             data: { message: `AI模块未加载，跳过：${candidate.name || '未知'}`, type: 'error' }
                         });
                         addHighlightReason(targetElement, 'AI模块未加载', window.HR_COLORS.FAIL.border);
                     }
                 } else {
                     // 获取详情失败，标记红色并记录日志
                     console.error("获取详情失败");
                     sendMessage({
                         type: 'LOG_MESSAGE',
                         data: { message: `获取详情失败，跳过：${candidate.name || '未知'}`, type: 'error' }
                     });
                     addHighlightReason(targetElement, '获取详情失败', window.HR_COLORS.FAIL.border);
                 }
             } else {
                 // 未找到简历内容，标记红色并记录日志
                 console.error("获取详情失败：未找到简历内容");
                 sendMessage({
                     type: 'LOG_MESSAGE',
                     data: { message: `获取详情失败，跳过：${candidate.name || '未知'}`, type: 'error' }
                 });
                 addHighlightReason(targetElement, '获取详情失败', window.HR_COLORS.FAIL.border);
             }

             // 6. 关闭详情页
             await currentParser.closeDetail();
             // 等待关闭动画
             await new Promise(resolve => setTimeout(resolve, 800));
        } else {
             // 非AI模式，也要关闭详情页，防止卡死
             await currentParser.closeDetail();
             await new Promise(resolve => setTimeout(resolve, 800));
        }

        return { processed: true, contacted: shouldContact && currentParser?.aiSettings?.greetingEnabled === true };

    } catch (error) {
        console.error('处理元素失败:', error);
        // 发送错误日志
        sendMessage({
            type: 'LOG_MESSAGE',
            data: { message: `处理失败：${error.message || '未知错误'}`, type: 'error' }
        });
        // 标记红色，避免卡在橙色
        if (element) {
            addHighlightReason(element, `处理失败: ${error.message || '未知错误'}`, window.HR_COLORS?.FAIL?.border || '#f44336');
        }
        // 尝试关闭详情页
        try { await currentParser?.closeDetail(); } catch (e) {}
        return false;
    }
}

function playNotificationSound() {
    if (enableSound) {
        const audio = new Audio(chrome.runtime.getURL('sounds/notification2.mp3'));
        audio.volume = 0.5; // 设置音量
        audio.play().catch(error => console.error('播放提示音失败:', error));
    }
}


// 递归查找canvas（支持嵌套iframe）
function findCanvasInDocument(doc, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) {
        // console.log(`[CONTENT] 达到最大递归深度 ${maxDepth}，停止查找`);
        return null;
    }

    const indent = '  '.repeat(depth);
    // console.log(`${indent}[CONTENT] 在文档中查找canvas，深度: ${depth}`);

    // 在当前文档中查找canvas
    const canvas = doc.querySelector('canvas#resume');
    if (canvas) {
        // console.log(`${indent}[CONTENT] ✓ 找到canvas！`);
        return { canvas, doc, depth };
    }

    // 查找当前文档中的所有iframe
    const iframes = doc.querySelectorAll('iframe');
    // console.log(`${indent}[CONTENT] 当前文档iframe数量: ${iframes.length}`);

    for (let i = 0; i < iframes.length; i++) {
        const iframe = iframes[i];
        try {
            // console.log(`${indent}[CONTENT] 检查iframe[${i}]: ${iframe.src?.substring(0, 60) || 'about:blank'}...`);
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            
            if (iframeDoc) {
                // console.log(`${indent}[CONTENT] iframe文档访问成功，继续递归查找...`);
                const result = findCanvasInDocument(iframeDoc, depth + 1, maxDepth);
                if (result) {
                    // 找到了，返回结果（包含iframe引用）
                    return {
                        ...result,
                        iframes: [iframe, ...(result.iframes || [])]
                    };
                }
            } else {
                // console.log(`${indent}[CONTENT] iframe文档为空`);
            }
        } catch (error) {
            // console.log(`${indent}[CONTENT] iframe访问受限: ${error.message}`);
        }
    }

    return null;
}

// 获取简历Canvas的矩形区域信息
function getResumeCanvasRect() {
    // console.log('[CONTENT] 开始获取简历Canvas矩形区域...');

    // 使用递归函数查找canvas
    const result = findCanvasInDocument(document);

    if (!result) {
        // console.log('[CONTENT] 未找到canvas元素');
        return null;
    }

    // console.log('[CONTENT] 找到canvas，深度:', result.depth);
    // console.log('[CONTENT] iframe层级数:', result.iframes?.length || 0);

    const canvas = result.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    // console.log('[CONTENT] Canvas边界矩形:', canvasRect);

    // 计算所有iframe的累积偏移量
    let totalOffsetX = 0;
    let totalOffsetY = 0;

    if (result.iframes && result.iframes.length > 0) {
        // console.log('[CONTENT] 计算iframe偏移量...');
        // iframe数组是从内到外的顺序，需要累加所有偏移量
        for (let i = result.iframes.length - 1; i >= 0; i--) {
            const iframe = result.iframes[i];
            const iframeRect = iframe.getBoundingClientRect();
            // console.log(`[CONTENT] iframe[${i}]偏移量:`, { 
            //     left: iframeRect.left, 
            //     top: iframeRect.top 
            // });
            totalOffsetX += iframeRect.left;
            totalOffsetY += iframeRect.top;
        }
        // console.log('[CONTENT] 总偏移量:', { totalOffsetX, totalOffsetY });
    }

    const rectResult = {
        x: canvasRect.left + totalOffsetX + window.scrollX,
        y: canvasRect.top + totalOffsetY + window.scrollY,
        width: canvasRect.width,
        height: canvasRect.height,
        devicePixelRatio: window.devicePixelRatio
    };

    // console.log('[CONTENT] Canvas区域信息:', rectResult);
    return rectResult;
}

async function waitForResumeCanvasRect(timeoutMs = 10000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    let lastRect = null;

    while (Date.now() < deadline) {
        lastRect = getResumeCanvasRect();
        if (lastRect && lastRect.width > 0 && lastRect.height > 0) {
            return lastRect;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return lastRect;
}


// 截取canvas区域（直接截取canvas在页面中的位置和尺寸）
async function takeCanvasScreenshot(canvasRect) {
    return new Promise((resolve, reject) => {
        try {
            // console.log('[CONTENT] 开始截取canvas区域...');
            // console.log('[CONTENT] Canvas区域信息:', canvasRect);

            if (!canvasRect) {
                // console.log('[CONTENT] Canvas区域信息为空');
                resolve(null);
                return;
            }

            // 直接截取canvas区域，不尝试获取canvas内部内容
            chrome.runtime.sendMessage({
                action: 'CAPTURE_CANVAS_AREA',
                data: canvasRect
            }, (response) => {
                // console.log('[CONTENT] 收到canvas区域截图响应:', response);
                if (chrome.runtime.lastError) {
                    console.error('[CONTENT] Canvas区域截图请求失败:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                if (response && response.success && response.imageData) {
                    // console.log('[CONTENT] Canvas区域截图成功，数据长度:', response.imageData.length);
                    resolve(response.imageData);
                } else {
                    console.error('[CONTENT] Canvas区域截图失败，响应:', response);
                    resolve(null);
                }
            });

        } catch (error) {
            console.error('[CONTENT] Canvas截图出错:', error);
            resolve(null);
        }
    });
}

// 处理来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 只在主frame中处理某些消息
    const isMainFrame = window.top === window.self;
    const mainFrameOnlyMessages = ['START_AI_SCROLL', 'STOP_SCROLL', 'GET_RESUME_RECT', 'OPEN_FIRST_DETAIL', 'CLOSE_DETAIL', 'SCROLL_TO_NEXT'];
    
    const messageType = message.action || message.type;

    // BOSS 推荐牛人页面通常在 iframe 内：
    // - popup 默认只给 top frame 发消息（frameId=0）
    // - background 会按 frameId 定向投递
    // 为了避免“message port closed before a response”这类错误，这里对不处理的消息也返回一个明确响应
    if (!isMainFrame && mainFrameOnlyMessages.includes(messageType) && !isBossRecommendContext(document)) {
        sendResponse({ success: false, ignored: true, error: "NOT_RECOMMEND_CONTEXT" });
        return true;
    }

    // SYNC_BOSS_JOBS 只允许在职位列表上下文响应
    if (messageType === 'SYNC_BOSS_JOBS' && !isBossJobListPage()) {
        sendResponse({ success: false, ignored: true, error: "NOT_JOB_LIST_PAGE" });
        return true;
    }

    // SWITCH_RECOMMEND_JOB：允许在任意 frame 接收（popup 默认只发到 top frame），由代码自行定位推荐页上下文

    // 立即执行异步操作的 IIFE，但不等待它
    (async () => {
        try {
            // console.log('[CONTENT] 收到消息:', message.action || message.type, message);
            
            switch (message.action || message.type) {
                case 'PING_CONTENT':
                    sendResponse({
                        success: true,
                        pageKey: document.querySelector('input#page_key_name')?.getAttribute('value') || '',
                        isMainFrame: window.top === window.self,
                        isBossRecommendContext: isBossRecommendContext(document),
                        isBossJobListPage: isBossJobListPage(),
                        url: window.location.href
                    });
                    break;
                case 'START_AI_SCROLL':
                    // ... (代码保持不变)
                    // 检查解析器是否已初始化
                    if (!isBossRecommendContext(document)) {
                        sendResponse({ status: 'error', message: '当前不是推荐牛人页面上下文' });
                        return;
                    }
                    if (!await ensureParserReady()) {
                        console.error('解析器未初始化，无法启动AI滚动');
                        sendResponse({ status: 'error', message: '解析器未初始化' });
                        return;
                    }

                    // 更新AI设置
                    if (message.data.clickFrequency !== undefined) {
                        currentParser.clickCandidateConfig.frequency = message.data.clickFrequency;
                    }

                    // 设置AI筛选模式
                    currentParser.aiMode = true;
                    currentParser.aiSettings = {
                        positionId: message.data.positionId,
                        positionName: message.data.positionName,
                        jobDescription: message.data.jobDescription,
                        aiConfig: message.data.aiConfig,
                        matchLimit: message.data.matchLimit,
                        // 批量模式：[{ positionName, jobDescription, matchLimit }]
                        batchState: null,
                        scrollDelayMin: message.data.scrollDelayMin,
                        scrollDelayMax: message.data.scrollDelayMax,
                        enableSound: message.data.enableSound,
                        greetingEnabled: message.data.greetingEnabled === true,
                        communicationEnabled: message.data.communicationEnabled,
                        communicationConfig: message.data.communicationConfig
                    };

                    // 批量计划初始化（如果有）
                    if (Array.isArray(message?.data?.batchPlan) && message.data.batchPlan.length > 0) {
                        const plan = message.data.batchPlan
                            .map((x) => ({
                                positionId: String(x?.positionId || "").trim(),
                                positionName: String(x?.positionName || "").trim(),
                                jobDescription: String(x?.jobDescription || "").trim(),
                                matchLimit: Math.max(1, Math.min(200, Number(x?.matchLimit || 1))),
                            }))
                            .filter((x) => x.positionName && x.jobDescription);

                        if (plan.length > 0) {
                            currentParser.aiSettings.batchState = { plan, index: 0, total: plan.length };
                            // 强制以第一个岗位为准，避免 popup/currentPosition 与 batch 第一项不一致
                            currentParser.aiSettings.positionId = plan[0].positionId || "";
                            currentParser.aiSettings.positionName = plan[0].positionName;
                            currentParser.aiSettings.jobDescription = plan[0].jobDescription;
                            currentParser.aiSettings.matchLimit = plan[0].matchLimit;
                        }
                    }

                    // 注意：自动模式是长任务，不能 await，否则 popup 会一直等不到响应，表现为“按钮没反应”
                    // 这里先立刻响应 popup，再异步启动切换+滚动流程
                    sendResponse({ status: 'started' });

                    (async () => {
                        // 自动模式：只在第一次启动时尝试切换到对应岗位列表，后续不重复切换
                        try {
                            const targetTitle = currentParser?.aiSettings?.positionName || message.data.positionName || "";
                            if (targetTitle) {
                                // 每次启动自动任务都做一次“对齐检查”：
                                // - 若已在目标岗位列表，switchBossRecommendJob 会返回 already=true 且不会点击
                                // - 若不在目标岗位列表，才会点击并等待刷新确认
                                const recommendDoc = isBossRecommendContext(document) ? document : findBossRecommendDocument();
                                if (recommendDoc) {
                                    await sendMessage({
                                        type: 'LOG_MESSAGE',
                                        data: { message: `自动模式：对齐岗位列表 -> ${targetTitle}`, type: 'info' }
                                    }).catch(() => {});

                                    const result = await switchBossRecommendJob(targetTitle, recommendDoc);
                                    window.__lanxingAutoSwitchedRecommendTitle = targetTitle;

                                    if (result?.already) {
                                        await sendMessage({
                                            type: 'LOG_MESSAGE',
                                            data: { message: `自动模式：已在目标岗位列表：${result?.matched || targetTitle}`, type: 'success' }
                                        }).catch(() => {});
                                    } else if (result?.refreshed) {
                                        await sendMessage({
                                            type: 'LOG_MESSAGE',
                                            data: { message: `自动模式：已切换岗位列表：${result?.matched || targetTitle}`, type: 'success' }
                                        }).catch(() => {});
                                        await new Promise((r) => setTimeout(r, 1200));
                                    } else {
                                        await sendMessage({
                                            type: 'LOG_MESSAGE',
                                            data: { message: `自动模式：已点击切换（未确认刷新）：${result?.matched || targetTitle}`, type: 'warning' }
                                        }).catch(() => {});
                                    }
                                } else {
                                    await sendMessage({
                                        type: 'LOG_MESSAGE',
                                        data: { message: "自动模式：未找到推荐页上下文，跳过岗位对齐", type: 'warning' }
                                    }).catch(() => {});
                                }
                            }
                        } catch (e) {
                            await sendMessage({
                                type: 'LOG_MESSAGE',
                                data: { message: `切换推荐岗位失败：${e.message}`, type: 'warning' }
                            }).catch(() => {});
                        }

                        // 直接使用原有的滚动逻辑（不要 await 到消息响应链路）
                        try {
                            await startAutoScroll();
                        } catch (e) {
                            await sendMessage({
                                type: 'LOG_MESSAGE',
                                data: { message: `自动执行失败：${e.message}`, type: 'error' }
                            }).catch(() => {});
                        }
                    })();
                    break;
                case 'STOP_SCROLL':
                    stopAutoScroll();
                    window.__lanxingAutoSwitchedRecommendTitle = null;
                    sendResponse({ status: 'stopped' });
                    break;
                case 'UPDATE_KEYWORDS':
                    if (!await ensureParserReady()) {
                        sendResponse({ status: 'error', message: '解析器未初始化' });
                        return;
                    }
                    if (currentParser) {
                        currentParser.setFilterSettings(message.data);
                        sendResponse({ status: 'updated' });
                    } else {
                        sendResponse({ status: 'error', message: '解析器未初始化' });
                    }
                    break;
                case 'SETTINGS_UPDATED':
                    if (!await ensureParserReady()) {
                        sendResponse({ status: 'error', message: '解析器未初始化' });
                        return;
                    }
                    if (currentParser) {
                        // 更新解析器的设置
                        currentParser.setFilterSettings({
                            ...message.data,
                            scrollDelayMin: message.data.scrollDelayMin || 3,
                            scrollDelayMax: message.data.scrollDelayMax || 5
                        });
                        sendResponse({ status: 'ok' });
                    } else {
                        console.error('解析器未初始化');
                        sendResponse({ status: 'error', message: '解析器未初始化' });
                    }
                    break;
                case 'COMMUNICATION_PROCESS':
                    // 处理沟通功能
                    if (currentParser) {
                        // 将沟通处理数据传递给解析器
                        if (message.data.communicationConfig) {
                            currentParser.communicationConfig = message.data.communicationConfig;
                        }
                        if (message.data.runModeConfig) {
                            currentParser.runModeConfig = message.data.runModeConfig;
                        }
                        
                        sendResponse({ status: 'success' });
                    } else {
                        sendResponse({ status: 'error', message: '解析器未初始化' });
                    }
                    break;
                case 'OPEN_FIRST_DETAIL':
                    // console.log('[CONTENT] 处理OPEN_FIRST_DETAIL消息');
                    if (!isBossRecommendContext(document)) {
                        sendResponse({ success: false, error: '当前不是推荐牛人页面上下文' });
                        return;
                    }
                    if (!await ensureParserReady()) {
                        sendResponse({ success: false, error: '解析器未初始化' });
                        return;
                    }
                    const result = await handleOpenFirstDetail(message.data);
                    // console.log('[CONTENT] OPEN_FIRST_DETAIL处理完成');
                    if (result) {
                        sendResponse({ success: true, candidate: result.candidate });
                    } else {
                        sendResponse({ success: false });
                    }
                    break;
                case 'MARK_CANDIDATE':
                     // console.log('[CONTENT] 处理MARK_CANDIDATE消息');
                     if (!await ensureParserReady()) {
                         sendResponse({ success: false, error: '解析器未初始化' });
                         return;
                     }
                     await handleMarkCandidate(message.data);
                     sendResponse({ success: true });
                     break;
                case 'GREET_CANDIDATE':
                     // console.log('[CONTENT] 处理GREET_CANDIDATE消息');
                     if (!await ensureParserReady()) {
                         sendResponse({ success: false, error: '解析器未初始化' });
                         return;
                     }
                     await ensureGreetDailyLoaded();
                     await publishGreetDailyProgress();
                     {
                         const daily = await getTodayGreetDailyCount();
                         if (daily >= GREET_DAILY_LIMIT) {
                             await sendMessage({
                                 type: 'LOG_MESSAGE',
                                 data: { message: `已达到今日打招呼上限：${daily}/${GREET_DAILY_LIMIT}，请明天再试`, type: 'warning' }
                             }).catch(() => {});
                             sendResponse({ success: false, error: 'DAILY_GREET_LIMIT_REACHED' });
                             break;
                         }
                     }
                     await handleGreetCandidate(message.data);
                     await addGreetDailyCount(1);
                     sendResponse({ success: true });
                     break;
                case 'GET_RESUME_RECT':
                    // console.log('[CONTENT] 处理GET_RESUME_RECT消息');
                    const rect = getResumeCanvasRect();
                    // console.log('[CONTENT] 准备返回rect:', rect);
                    sendResponse(rect);
                    // console.log('[CONTENT] rect已通过sendResponse返回');
                    break;
                case 'SCROLL_TO_NEXT':
                    // console.log('[CONTENT] 处理 SCROLL_TO_NEXT 消息');
                    // 滚动页面一段距离，触发新的加载或寻找下一个元素
                    window.scrollBy({
                        top: 200,
                        behavior: 'smooth'
                    });
                    sendResponse({ success: true });
                    break;
                case 'CLOSE_DETAIL':
                    // console.log('[CONTENT] 处理CLOSE_DETAIL消息');
                    if (!await ensureParserReady()) {
                        sendResponse({ success: false, error: '解析器未初始化' });
                        return;
                    }
                    if (currentParser) {
                        await currentParser.closeDetail().then(() => {
                            // console.log('[CONTENT] 详情页已关闭');
                        }).catch((error) => {
                            console.error('[CONTENT] 关闭详情页失败:', error);
                        });
                    }
                    sendResponse({ success: true });
                    break;
                case 'REMOVE_ADS':
                     // 已废弃消息，兼容处理
                     sendResponse({ status: 'ignored' });
                     break;
                case 'SHOW_ADS':
                     // 忽略 SHOW_ADS 消息，不报错
                     sendResponse({ status: 'ignored' });
                     break;
                case 'ADD_APPROVED_CANDIDATE': {
                    try {
                        const detailText = message?.data?.detailText || message?.data?.candidateText || "";
                        const resumeText = message?.data?.resumeText || "";
                        const result = await upsertApprovedCandidateToPool({
                            candidate: message?.data?.candidate,
                            simpleText: message?.data?.candidateText,
                            detailText,
                            resumeText,
                            aiReason: message?.data?.aiReason,
                            positionId: message?.data?.positionId,
                            positionName: message?.data?.positionName,
                            jobDescription: message?.data?.jobDescription,
                            decisionSource: message?.data?.decisionSource || 'manual'
                        });
                        await sendMessage({
                            type: 'TALENT_POOL_UPDATED',
                            data: {
                                total: result.total,
                                inserted: result.inserted,
                                candidateName: result.record?.candidateName || '',
                                positionName: result.record?.positionName || ''
                            }
                        }).catch(() => {});
                        sendResponse({ success: true, data: result });
                    } catch (e) {
                        sendResponse({ success: false, error: e?.message || String(e) });
                    }
                    break;
                }
                case 'EXPORT_APPROVED_CANDIDATES': {
                    try {
                        const poolRes = await storageGet([TALENT_POOL_STORAGE_KEY]);
                        const pool = Array.isArray(poolRes?.[TALENT_POOL_STORAGE_KEY]) ? poolRes[TALENT_POOL_STORAGE_KEY] : [];
                        sendResponse({ success: true, data: pool });
                    } catch (e) {
                        sendResponse({ success: false, error: e?.message || String(e) });
                    }
                    break;
                }
                case 'CLEAR_APPROVED_CANDIDATES': {
                    try {
                        await storageSet({ [TALENT_POOL_STORAGE_KEY]: [] });
                        await sendMessage({
                            type: 'TALENT_POOL_UPDATED',
                            data: { total: 0, inserted: false, cleared: true }
                        }).catch(() => {});
                        sendResponse({ success: true });
                    } catch (e) {
                        sendResponse({ success: false, error: e?.message || String(e) });
                    }
                    break;
                }
                case 'SYNC_BOSS_JOBS':
                    try {
                        const result = await syncBossJobsViaIntercept(message.data || {});
                        sendResponse({ success: true, data: result });
                    } catch (e) {
                        sendResponse({ success: false, error: e.message });
                    }
                    break;
                case 'SWITCH_RECOMMEND_JOB':
                    try {
                        const targetTitle = message?.data?.targetTitle || "";
                        if (!targetTitle) {
                            sendResponse({ success: false, error: "targetTitle 为空" });
                            return;
                        }
                        const recommendDoc = isBossRecommendContext(document) ? document : findBossRecommendDocument();
                        if (!recommendDoc) {
                            sendResponse({ success: false, error: "未找到推荐牛人页面 iframe" });
                            return;
                        }
                        const result = await switchBossRecommendJob(targetTitle, recommendDoc);
                        sendResponse({ success: true, data: result });
                    } catch (e) {
                        sendResponse({ success: false, error: e.message });
                    }
                    break;
                default:
                    console.error('未知的消息类型:', message.action);
                    sendResponse({ status: 'error', message: '未知的消息类型' });
            }
        } catch (error) {
            console.error('处理消息时出错:', error);
            isRunning = false;
            try {
                sendResponse({ status: 'error', message: error.message });
            } catch (e) {
                console.error('发送错误响应失败:', e);
            }
        }
    })();

    return true;  // 必须同步返回 true，表示会异步发送响应
});

// 停止滚动时重置位置
function stopAutoScroll() {
    try {
        isRunning = false;
        forceStop = true; // 设置强制停止标志
        matchCount = 0;
        contactCount = 0;
        if (currentParser?.aiSettings?.batchState) {
            currentParser.aiSettings.batchState = null;
        }

        // 同步 popup 的持久化运行状态，避免 UI 重开后仍显示“停止运行”
        try {
            if (chrome?.runtime?.id && chrome?.storage?.local) {
                chrome.storage.local.set({ isRunning: false }, () => {});
            }
        } catch (e) {
            // 扩展被重载时可能失败，忽略
        }

        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
        lastProcessedPosition = 0;

        if (currentParser) {
            document.querySelectorAll(`[class^="${currentParser.selectors.items}"], [class*=" ${currentParser.selectors.items}"]`)
                .forEach(el => {
                    el.style.cssText = '';
                });
        }

        if (isExtensionValid()) {
            showNotification('已停止自动滚动', 'status');
        } else {
            console.warn('扩展已重新加载，自动滚动已停止');
        }
    } catch (error) {
        console.error('停止失败:', error);
    }
}

// 查找并返回当前正在处理的候选人元素（橘色框）
function findCurrentProcessingOrUnprocessedElement() {
    if (!currentParser) return null;
    const elements = currentParser.findElements();
    if (!elements || elements.length === 0) return null;

    const COLORS = window.HR_COLORS;

    // 1. 优先寻找正在处理中（标记了class或橘色框）的元素
    for (const el of elements) {
        // 优先检查 class
        if (el.classList.contains('lanxing-processing')) {
             // console.log('[CONTENT] 找到正在处理中的元素 (class)');
             return el;
        }

        const styleBorder = el.style.border || '';
        const styleBg = el.style.backgroundColor || '';
        
        // 使用工具类判断 (兼容旧逻辑)
        if (COLORS.isState(styleBorder, 'PROCESSING') || COLORS.isState(styleBg, 'PROCESSING')) {
            // console.log('[CONTENT] 找到正在处理中的元素 (颜色)');
            // 检查是否被错误地同时标记了原因
            if (!el.querySelector('.lanxing-highlight-reason')) {
                return el;
            }
        }
    }
    
    console.warn('[CONTENT] 未找到正在处理中的元素 (class/橘色)');
    return null;
}

function markCandidateDecision(element, data = {}) {
    if (!element) return false;

    const COLORS = window.HR_COLORS || {
        SUCCESS: { border: '#4caf50' },
        FAIL: { border: '#ef4444' }
    };

    // decision: true (Green), false (Red)
    const color = (data.decision === '是' || data.decision === true) ? COLORS.SUCCESS.border : COLORS.FAIL.border; 
    const text = `AI:${(data.decision === '是' || data.decision === true) ? '通过' : '淘汰'} ${data.reason ? '(' + data.reason + ')' : ''}`;

    rememberCandidateIdentity(element, data);
    addHighlightReason(element, text, color);
    return true;
}

// 标记候选人颜色
async function handleMarkCandidate(data) {
    const element = await findCandidateElementForAction(data);

    if (!element) {
        console.warn('[CONTENT] 找不到要标记的候选人元素');
        return;
    }

    markCandidateDecision(element, data);
}

// 对候选人打招呼
async function handleGreetCandidate(data) {
    const element = await findCandidateElementForAction(data);
    
    if (!element) {
        console.error('[CONTENT] 找不到要打招呼的候选人元素');
        return false;
    }

    rememberCandidateIdentity(element, data);
    
    // console.log('[CONTENT] 执行打招呼操作...');
    let clicked = false;
    
    try {
        clicked = await currentParser.clickMatchedItem(element);
        if (clicked) {
            // console.log('[CONTENT] 打招呼点击成功');
        } else {
            console.error('[CONTENT] 打招呼点击失败');
        }
    } catch (e) {
        console.error('[CONTENT] 打招呼异常:', e);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (data && ('decision' in data || data.reason)) {
        const refreshedElement = await findCandidateElementForAction(data, element);
        if (refreshedElement) {
            markCandidateDecision(refreshedElement, data);
        }

        setTimeout(() => {
            findCandidateElementForAction(data)
                .then((latestElement) => {
                    if (latestElement) {
                        markCandidateDecision(latestElement, data);
                    }
                })
                .catch((e) => console.warn('[CONTENT] 打招呼后补标记失败:', e));
        }, 2500);
    }

    return clicked;
}

// 只打开未处理（红/绿）的第一个详情页
async function handleOpenFirstDetail(data) {
    let candidateInfo = null;
    try {
        // console.log('[CONTENT] 开始打开第一个详情页');
        // console.log('[CONTENT] 接收到的数据:', data);

        if (!currentParser) {
            console.error('[CONTENT] 解析器未初始化');
            return null;
        }
        // console.log('[CONTENT] 解析器已初始化:', currentParser.constructor.name);

        // 设置AI配置
        if (data.aiConfig) {
            // console.log('[CONTENT] 设置AI配置...');
            currentParser.aiSettings = {
                positionId: data.positionId,
                positionName: data.positionName,
                jobDescription: data.jobDescription,
                aiConfig: data.aiConfig,
                matchLimit: 1, // 测试只处理一个
                scrollDelayMin: data.scrollDelayMin || 3,
                scrollDelayMax: data.scrollDelayMax || 5,
                enableSound: false // 测试时不播放声音
            };
        }

        // 找到第一个牛人
        // console.log('[CONTENT] 找到第一个牛人...');
        
        let elements = currentParser.findElements();
        // console.log('[CONTENT] findElements结果:', elements);

        if (!elements || elements.length === 0) {
            console.error('[CONTENT] 未找到候选人元素');
            sendMessage({
                type: 'LOG_MESSAGE',
                data: {
                    message: '未找到候选人元素，请确保在候选人列表页面',
                    type: 'error'
                }
            });
            return null;
        }

        let firstElement = null;

        const COLORS = window.HR_COLORS;

        // 查找第一个未处理（未标记红/绿）的元素
        // 修改：始终寻找第一个不为红色和绿色的牛人框
        for (const el of elements) {
            // 检查是否已有标记
            const hasReason = el.querySelector('.lanxing-highlight-reason');
            
            // 检查行内样式中的特定颜色
            const styleBorder = el.style.border || '';
            const styleBg = el.style.backgroundColor || '';
            
            const isProcessed = COLORS.isProcessed(styleBorder) || COLORS.isProcessed(styleBg);

            if (!hasReason && !isProcessed) {
                firstElement = el;
                break;
            }
        }
        
        if (!firstElement) {
            // console.log('[CONTENT] 所有可见元素都已处理');
            sendMessage({
                type: 'LOG_MESSAGE',
                data: {
                    message: '当前页面所有候选人都已处理，请向下滚动加载更多',
                    type: 'warning'
                }
            });
            return null;
        }

        // 确保元素在屏幕中可见
        // console.log('[CONTENT] 滚动到目标元素...');
        firstElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 提取候选人信息
        try {
            const candidates = await currentParser.extractCandidates([firstElement]);
            if (candidates && candidates.length > 0) {
                 candidateInfo = candidates[0];
                 // 获取用于AI决策的文本信息
                 candidateInfo.simpleText = currentParser.getSimpleCandidateInfo(candidateInfo);
            }
        } catch (e) {
            console.error('[CONTENT] 提取候选人信息失败:', e);
        }

        // console.log('[CONTENT] 第一个牛人元素:', firstElement);
        // console.log('[CONTENT] 牛人信息:', firstElement.textContent?.substring(0, 100) + '...');

        // 高亮第一个元素
        // console.log('[CONTENT] 高亮第一个元素...');
        firstElement.style.cssText = `
            background-color: #fff3e0 !important;
            transition: background-color 0.3s ease;
            outline: 2px solid #ffa726 !important;
            box-shadow: 0 0 10px rgba(255, 167, 38, 0.3) !important;
        `;

        sendMessage({
            type: 'LOG_MESSAGE',
            data: {
                message: '已找到第一个候选人，正在点击详情...',
                type: 'info'
            }
        });

        // 点击详情
        // console.log('[CONTENT] 开始点击详情...');
        const clicked = await currentParser.clickCandidateDetail(firstElement);
        // console.log('[CONTENT] 点击结果:', clicked);

        if (!clicked) {
            console.error('[CONTENT] 点击详情失败');
            sendMessage({
                type: 'LOG_MESSAGE',
                data: {
                    message: '点击详情失败',
                    type: 'error'
                }
            });
            return null; // Return null on failure
        }

        sendMessage({
            type: 'LOG_MESSAGE',
            data: {
                message: '详情已打开，等待加载...',
                type: 'info'
            }
        });

        // 统一等待 3 秒，确保详情页加载完成
        // console.log('[CONTENT] 统一等待详情页加载 3 秒...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        // console.log('[CONTENT] 等待结束，返回响应');

        // Return both candidate info and the element
        return { candidate: candidateInfo, element: firstElement };

    } catch (error) {
        console.error('[CONTENT] 打开详情页失败:', error);
        sendMessage({
            type: 'LOG_MESSAGE',
            data: {
                message: '打开详情页失败: ' + error.message,
                type: 'error'
            }
        });
    }
}

// 获取候选人详细信息
async function getCandidateInfo(candidate) {
    try {
        const lines = [];
        const gc = candidate?.geekCard || {};
        const name = candidate?.name || gc?.geekName || '未知';

        lines.push(`姓名：${name}`);

        const age = candidate?.age || gc?.ageDesc || '';
        const education = candidate?.education || gc?.geekDegree || '';
        const university = candidate?.university || gc?.geekEdu?.school || '';
        const major = gc?.geekEdu?.major || '';
        const workYears = candidate?.experience || gc?.geekWorkYear || '';
        const salary = candidate?.salary || gc?.salary || '';
        const expectedPosition = gc?.expectPositionName || '';
        const location = candidate?.location || gc?.expectLocationName || '';
        const activeText = candidate?.activeText || gc?.applyStatusDesc || '';
        const intro = gc?.geekDesc?.content || candidate?.description || '';

        if (age) lines.push(`年龄：${age}`);
        if (education) lines.push(`学历：${education}`);
        if (university) lines.push(`学校：${university}`);
        if (major) lines.push(`专业：${major}`);
        if (workYears) lines.push(`工作年限：${workYears}`);
        if (salary) lines.push(`期望薪资：${salary}`);
        if (expectedPosition) lines.push(`期望职位：${expectedPosition}`);
        if (location) lines.push(`期望地点：${location}`);
        if (activeText) lines.push(`在线状态：${activeText}`);
        if (intro) lines.push(`在线介绍：${intro}`);

        if (candidate.extraInfo && candidate.extraInfo.length > 0) {
            lines.push(`其他信息：`);
            candidate.extraInfo.forEach(item => {
                const type = item?.type || '信息';
                const value = item?.value || '';
                if (type || value) {
                    lines.push(`- ${type}: ${value}`);
                }
            });
        }
        if (candidate.colleagueContactedInfo) {
            lines.push(`同事沟通过候选人的信息：`);
            lines.push(String(candidate.colleagueContactedInfo));
        }

        return lines.join('\n').trim();
    } catch (error) {
        console.error('获取候选人信息失败:', error);
        return `姓名：${candidate?.name || '未知'}`;
    }
}

// 添加一个检查扩展状态的函数
function isExtensionValid() {
    return chrome.runtime && chrome.runtime.id;
}

// 初始化连接
function initializeConnection() {
    try {
        port = chrome.runtime.connect({ name: 'content-script-connection' });
        return true;
    } catch (error) {
        console.error('建立连接失败:', error);
        return false;
    }
}

// 封装消息发送函数
async function sendMessage(message) {
    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
        try {
            if (!isExtensionValid()) {
                // 可能处于 prerender / 扩展重载中，此时不要阻断业务流程
                console.warn('扩展上下文不可用，跳过发送消息');
                return null;
            }

            // 确保连接存在
            if (!port && !initializeConnection()) {
                throw new Error('无法建立连接');
            }


            return await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(message, function (response) {
                    const lastError = chrome.runtime.lastError;
                    if (lastError) {
                        // 没有接收端时（例如 popup 未打开、background 未处理该消息），不应当让流程报错
                        if (lastError.message.includes('Receiving end does not exist')) {
                            resolve(null);
                            return;
                        }
                        // 如果是扩展上下文失效，抛出特殊错误
                        if (lastError.message.includes('Extension context invalidated')) {
                            console.warn('扩展上下文已失效，可能是扩展被重新加载');
                            reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
                            return;
                        }
                        console.error('发送消息失败:', lastError);
                        reject(lastError);
                        return;
                    }
                    resolve(response);
                });
            });
        } catch (error) {
            retryCount++;
            console.error(`发送消息失败 (尝试 ${retryCount}/${MAX_RETRIES}):`, error);

            if (retryCount === MAX_RETRIES) {
                throw error;
            }

            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
    }
}

function createDraggablePrompt() {
    return

}

// 初始化函数
async function initExtension() {
    // 防止重复初始化
    if (window.hasLanxingInitialized) {
        // console.log('[CONTENT] 插件已初始化，跳过重复执行');
        return;
    }
    window.hasLanxingInitialized = true;

    try {
        // 检查是否在iframe中
        const isInIframe = window !== window.top;
        
        // console.log(`[CONTENT] 开始初始化 (是否iframe: ${isInIframe})`);

        await initializeParser();
        
    } catch (error) {
        console.error('初始化失败:', error);
        showNotification('⚠️ 初始化失败', 'status');
    }
}



// 监听窗口可见性变化，检测最小化状态
document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        // 窗口被隐藏（可能是最小化、切换标签页等）
        // console.log('窗口状态变为隐藏');

        // 检查是否真的是最小化（而不是切换标签页）
        setTimeout(() => {
            if (document.hidden && document.visibilityState === 'hidden') {
                // 如果插件正在运行，显示警告
                if (isRunning) {
                    handleWindowMinimized();
                }
            }
        }, 100);
    } else {
        // 窗口变为可见
        // console.log('窗口状态变为可见');
    }
});

// 监听页面卸载事件，清除广告显示状态
window.addEventListener('beforeunload', function() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        try {
            chrome.storage.local.remove(['adDisplayed'], () => {
                if (chrome.runtime.lastError) {
                    console.warn('清理广告状态失败:', chrome.runtime.lastError);
                }
            });
        } catch (error) {
            console.warn('扩展上下文不可用，跳过广告状态清理:', error);
        }
    }
});

// 处理窗口最小化的函数
function handleWindowMinimized() {
    try {
        // 暂停当前操作
        if (isRunning) {
            console.warn('检测到窗口最小化，暂停插件运行');

            // 发送日志消息 - 添加扩展上下文检查
            sendMessage({
                type: 'LOG_MESSAGE',
                data: {
                    message: '检测到窗口最小化，已暂停运行',
                    type: 'warning'
                }
            }).catch(extensionError => {
                if (extensionError.message === 'EXTENSION_CONTEXT_INVALIDATED') {
                    console.warn('扩展上下文已失效，可能是扩展被重新加载。请刷新页面重新加载扩展。');
                    showNotification('⚠️ 扩展已更新，请刷新页面重新加载', 'warning');
                    return;
                }
                console.error('发送日志消息失败:', extensionError);
            });

            // 弹出警告提示
            // alert('揽星 提醒您：为了你的账号安全，请勿在最小化时运行。\n\n如果需要做别的，你可以新开一个浏览器窗口。\n\n插件已自动暂停，请恢复窗口后重新启动。');

            // 停止自动滚动
            // stopAutoScroll();
        }
    } catch (error) {
        console.error('处理窗口最小化时出错:', error);
    }
}

// 执行初始化
initExtension();

// 初始化连接
initializeConnection();
