// ==============================================
// main.js — FINAL STABLE VERSION
// ==============================================

// 🔹 所有模块入口（顺序很重要）
import { initializeFromServer, loadState, saveSettings, serverData, runtimeState } from "./data.js";
import { addLog, showError, updateUI, updateGreetDailyProgress, loadLogs, restoreLogEntry } from "./ui.js";

import "./messages.js";

// 🔹 分模块 import API（不会循环引用）
import { updateJobDescription } from "./position.js";
import { loadAIConfig, checkAIConnection, saveAIConfig, showAIConfigModal, hideAIConfigModal, refreshModelList } from "./ai.js";
import { startAutoScroll, stopAutoScroll } from "./scroll.js";
import { testCandidateDetailScreenshot } from "./screenshot.js";
import { sendToBossFrame } from "./frame_bridge.js";
import { refreshTalentPoolSummary, exportApprovedTalentPool, clearApprovedTalentPool, rankApprovedTalentPool } from "./talent_pool.js";
import { buildBossPositionTitle, buildPositionDescriptionFromBossJob } from "./job_description.js";

// ======================================================
// 1. 保活 Service Worker（必须）
// ======================================================
let port = chrome.runtime.connect({ name: "popup-keepalive" });

setInterval(() => {
    try {
        port.postMessage({ keepalive: true });
    } catch (e) {
        port = chrome.runtime.connect({ name: "popup-keepalive" });
    }
}, 20000);


// ======================================================
// 2. Popup 初始化 主入口（唯一 DOMContentLoaded）
// ======================================================
document.addEventListener("DOMContentLoaded", async () => {
    const configBtn = document.getElementById("ai-config-btn");
    if (configBtn) {
        configBtn.onclick = showAIConfigModal;
    }

    try {
        // console.log("[POPUP] 初始化开始...");

        // 基础初始化
        await initializeFromServer();   // 加载 Chrome 本地配置
        await initVersionLabel();
        
        // 3. 绑定事件
        bindUIEvents();

        // 4. 初始化业务模块
        await initializePositions();
        await initializeUI();
        await initializeLogs();
        await refreshTalentPoolSummary();

        // AI 初始化
        initializeAI().catch(e => console.error("AI初始化后台错误:", e));

        addLog("设置加载完成", "success");

    } catch (err) {
        console.error("[POPUP] 初始化失败:", err);
        showError(err);
    }
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


// ======================================================
// 初始化功能模块
// ======================================================

async function initVersionLabel() {
    const version = chrome.runtime.getManifest().version;
    const el = document.getElementById("version");
    if (el) el.textContent = version;
}

async function initializeAI() {
    await loadAIConfig();
}

async function initializePositions() {
    if (!Array.isArray(serverData.positions)) {
        serverData.positions = [];
    }
    if (!serverData.currentPosition && serverData.positions.length > 0) {
        serverData.currentPosition = serverData.positions[0];
    }
    updateJobDescription();
}

async function initializeUI() {
    await loadState();

    // 恢复 UI 状态 (按钮显示等)
    updateUI({ 
        isRunning: runtimeState.isRunning, 
        isDownloading: runtimeState.isDownloading 
    });

    updateJobDescription();
    renderQueue();
    updateGreetDailyProgress();

    // 延迟 UI 恢复
    const min = document.getElementById("delay-min");
    const max = document.getElementById("delay-max");

    if (min) min.value = serverData.scrollDelayMin;
    if (max) max.value = serverData.scrollDelayMax;
}

async function initializeLogs() {
    const logs = await loadLogs();

    const container = document.getElementById("log-container");
    container.innerHTML = "";

    if (logs.length === 0) {
        addLog("系统就绪，等待开始...");
    } else {
        // 从原始文本安全重建，不 innerHTML 存储的 html
        logs.forEach(entry => restoreLogEntry(container, entry));
    }
}


// ======================================================
// UI 按钮事件绑定
// ======================================================
function bindUIEvents() {

    document.getElementById("ai-config-close")?.addEventListener("click", hideAIConfigModal);

    // Token / API 地址变化后自动刷新上游模型列表
    document.getElementById("ai-token")?.addEventListener("change", refreshModelList);
    document.getElementById("ai-base-url")?.addEventListener("change", refreshModelList);

    document.getElementById("ai-config-save2")?.addEventListener("click", () => {
        saveAIConfig();
    });

    // 面板显示方式（弹窗 / 侧边栏），改动即时生效
    const viewModeSelect = document.getElementById("view-mode-select");
    if (viewModeSelect) {
        chrome.storage.local.get("lanxing_view_mode").then((res) => {
            viewModeSelect.value = res.lanxing_view_mode || "popup";
        });
        viewModeSelect.addEventListener("change", async (e) => {
            await chrome.runtime.sendMessage({ type: "LANXING_SET_VIEW_MODE", mode: e.target.value });
            addLog(
                e.target.value === "side"
                    ? "已切换为侧边栏模式，点击工具栏图标将打开侧边栏"
                    : "已切换回弹窗模式",
                "success"
            );
        });
    }

    // 运行日志显示/折叠（默认折叠），改动即时生效
    const logSelect = document.getElementById("log-visible-select");
    if (logSelect) {
        chrome.storage.local.get("lanxing_show_log").then((res) => {
            const shown = !!res.lanxing_show_log;
            logSelect.value = shown ? "shown" : "hidden";
            document.documentElement.classList.toggle("log-shown", shown);
        });
        logSelect.addEventListener("change", (e) => {
            const shown = e.target.value === "shown";
            chrome.storage.local.set({ lanxing_show_log: shown });
            document.documentElement.classList.toggle("log-shown", shown);
        });
    }

    // 页内浮窗（仅 Boss 直聘页面可用）
    document.getElementById("float-panel-btn")?.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !/\.zhipin\.com\//.test(tab.url || "")) {
            addLog("浮窗需要在 Boss 直聘页面上使用：先打开牛人列表页再点浮窗", "warning");
            return;
        }
        try {
            await chrome.tabs.sendMessage(tab.id, { type: "LANXING_TOGGLE_FLOAT_PANEL" });
            window.close();
        } catch (err) {
            addLog("浮窗打开失败，请刷新 Boss 直聘页面后重试", "error");
        }
    });

    // 监听模型选择变化，显示/隐藏自定义输入框
    document.getElementById("ai-model")?.addEventListener("change", (e) => {
        const customInput = document.getElementById("ai-custom-model");
        if (customInput) {
            customInput.style.display = e.target.value === "custom" ? "block" : "none";
        }
    });

    document.getElementById("openPositionManager")?.addEventListener("click", openPositionManagerPage);
	document.getElementById("position-selector")?.addEventListener("change", (event) => {
		handlePositionSelectorChange(event);
	});
	document.getElementById("refresh-position-list")?.addEventListener("click", async (event) => {
		await handlePositionRefresh(event);
	});
    document.getElementById("sync-boss-job-list")?.addEventListener("click", async (event) => {
        await handleBossJobListSync(event);
    });

    document.getElementById("queue-add-btn")?.addEventListener("click", async () => {
        await handleQueueAddRow();
    });

    document.getElementById("greet-daily-reset")?.addEventListener("click", async () => {
        await handleGreetDailyReset();
    });

    document.getElementById("rank-approved-candidates")?.addEventListener("click", async (event) => {
        const btn = event.currentTarget;
        const originalText = btn?.textContent || "AI 横评排序";
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = "横评中...";
            }
            await rankApprovedTalentPool();
        } catch (error) {
            console.error("横评失败:", error);
            addLog(`横评失败：${error.message}`, "error");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    });

    document.getElementById("export-approved-candidates")?.addEventListener("click", async () => {
        await exportApprovedTalentPool();
    });

    document.getElementById("clear-approved-candidates")?.addEventListener("click", async () => {
        await clearApprovedTalentPool();
    });

    document.getElementById("scrollButton")?.addEventListener("click", startAutoScroll);
    document.getElementById("stopButton")?.addEventListener("click", stopAutoScroll);

    document.getElementById("testButton")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        if (button?.disabled) return;

        const originalText = button?.textContent || "单人试跑";
        try {
            if (button) {
                button.disabled = true;
                button.textContent = "试跑中...";
            }

            addLog("单人试跑：只处理当前岗位下第一个未处理候选人，用来验证详情截图和 AI 判断链路。", "info");
            addLog("正在切换推荐列表并打开详情，请等待...", "info");
            const switched = await handleSwitchRecommendListForCurrentPosition();
            if (switched) {
                // 等待推荐页列表刷新与 iframe 稳定，避免立刻点详情导致卡住
                await sleep(1200);
            }
            const result = await testCandidateDetailScreenshot();
            if (result?.aiDecision?.decision === "是") {
                await refreshTalentPoolSummary();
            }
            addLog("单人试跑完成。", "success");
        } catch (error) {
            addLog(`单人试跑失败：${error?.message || error}`, "error");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
    });

    chrome.storage.onChanged.addListener(handleSettingsChange);
}

function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function handleGreetDailyReset() {
    const confirmed = confirm("确定要清零「今日打招呼」计数吗？\n（只影响今天的展示与上限判断）");
    if (!confirmed) return;

    const GREET_DAILY_STORAGE_KEY = "hr_assistant_greet_daily";
    const today = getLocalDateString();

    try {
        await chrome.storage.local.set({
            [GREET_DAILY_STORAGE_KEY]: { date: today, count: 0 }
        });

        serverData.greetDaily = {
            ...serverData.greetDaily,
            date: today,
            count: 0,
            limit: serverData?.greetDaily?.limit || 200,
        };
        updateGreetDailyProgress();
        addLog("已清零：今日打招呼 0/200", "warning");
    } catch (e) {
        console.error("清零今日打招呼失败:", e);
        addLog("清零失败，请刷新后重试", "error");
    }
}

function ensureBatchConfig() {
    if (!serverData.batchConfig) {
        serverData.batchConfig = { enabled: false, items: [] };
    }
    if (!Array.isArray(serverData.batchConfig.items)) {
        serverData.batchConfig.items = [];
    }
}

function clampLimit(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return 1;
    return Math.max(1, Math.min(200, Math.floor(num)));
}

function ensureQueueDefaults() {
    ensureBatchConfig();
    if (serverData.batchConfig.items.length === 0) {
        const defaultId = serverData.currentPosition?.id || "";
        const defaultLimit = clampLimit(serverData.matchLimit || 200);
        serverData.batchConfig.items = [{ positionId: defaultId, limit: defaultLimit }];
        serverData.batchConfig.enabled = !!defaultId;
    }
}

function normalizeQueueUnique() {
    ensureBatchConfig();
    const seen = new Set();
    for (const item of serverData.batchConfig.items) {
        if (!item) continue;
        const id = String(item.positionId || "");
        if (!id) continue;
        if (seen.has(id)) {
            item.positionId = "";
        } else {
            seen.add(id);
        }
    }
}

function syncCurrentPositionFromQueue() {
    ensureQueueDefaults();
    const firstId = String(serverData.batchConfig.items?.[0]?.positionId || "");
    const firstPos = firstId ? (serverData.positions || []).find((p) => p.id === firstId) : null;
    if (firstPos) {
        serverData.currentPosition = firstPos;
    }
}

async function handleQueueAddRow() {
    ensureQueueDefaults();
    normalizeQueueUnique();
    serverData.batchConfig.items.push({ positionId: "", limit: clampLimit(serverData.matchLimit || 200) });
    serverData.batchConfig.enabled = serverData.batchConfig.items.some((x) => x.positionId);
    await saveSettings();
    renderQueue();
}

async function handleQueueRemoveRow(index) {
    ensureQueueDefaults();
    if (serverData.batchConfig.items.length <= 1) return;
    serverData.batchConfig.items.splice(index, 1);
    serverData.batchConfig.enabled = serverData.batchConfig.items.some((x) => x.positionId);
    syncCurrentPositionFromQueue();
    await saveSettings();
    renderQueue();
    updateJobDescription();
}

function renderQueue() {
    ensureQueueDefaults();
    normalizeQueueUnique();

    const container = document.getElementById("queue-list");
    if (!container) return;

    const positions = serverData.positions || [];
    const selectedIds = serverData.batchConfig.items.map((x) => String(x.positionId || ""));

    const rowsHtml = serverData.batchConfig.items.map((item, index) => {
        const currentId = String(item?.positionId || "");
        const limit = clampLimit(item?.limit ?? (serverData.matchLimit || 200));

        const options = [
            `<option value="">选择岗位...</option>`,
            ...positions.map((p) => {
                const id = String(p.id || "");
                const name = escapeHtml(p.name || "未命名岗位");
                const usedByOther = id && id !== currentId && selectedIds.includes(id);
                const disabled = usedByOther ? "disabled" : "";
                const selected = id && id === currentId ? "selected" : "";
                return `<option value="${escapeHtml(id)}" ${selected} ${disabled}>${name}</option>`;
            })
        ].join("");

        const disableRemove = serverData.batchConfig.items.length <= 1 ? "disabled" : "";

        return `
            <div class="queue-row" data-index="${index}">
                <select class="queue-select">${options}</select>
                <input class="queue-limit" type="number" min="1" max="200" value="${limit}" />
                <button class="queue-remove" type="button" title="删除" ${disableRemove}>×</button>
            </div>
        `;
    }).join("");

    container.innerHTML = rowsHtml;

    if (!container.__lanxingQueueBound) {
        container.__lanxingQueueBound = true;

        container.addEventListener("click", async (e) => {
            const btn = e.target.closest(".queue-remove");
            if (!btn) return;
            const row = e.target.closest(".queue-row");
            if (!row) return;
            const index = Number(row.dataset.index || 0);
            await handleQueueRemoveRow(index);
        });

        container.addEventListener("change", async (e) => {
            const row = e.target.closest(".queue-row");
            if (!row) return;
            const index = Number(row.dataset.index || 0);
            const item = serverData.batchConfig.items[index];
            if (!item) return;

            const select = e.target.closest(".queue-select");
            if (select) {
                const nextId = String(select.value || "");
                const prevId = String(item.positionId || "");
                if (nextId && serverData.batchConfig.items.some((x, i) => i !== index && String(x.positionId || "") === nextId)) {
                    select.value = prevId;
                    addLog("⚠️ 该岗位已在队列中，不能重复选择", "warning");
                    return;
                }
                item.positionId = nextId;
                serverData.batchConfig.enabled = serverData.batchConfig.items.some((x) => x.positionId);
                syncCurrentPositionFromQueue();
                await saveSettings();
                renderQueue();
                updateJobDescription();
                return;
            }

            const limitInput = e.target.closest(".queue-limit");
            if (limitInput) {
                const limit = clampLimit(limitInput.value);
                limitInput.value = String(limit);
                item.limit = limit;
                await saveSettings();
            }
        });
    }
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function handleSwitchRecommendListForCurrentPosition() {
    const currentTitle = serverData?.currentPosition?.name || "";
    if (!currentTitle) {
        addLog("⚠️ 未选择岗位，无法切换推荐页职位列表", "warning");
        return;
    }

    const tab = await getActiveTab();
    if (!tab?.id) {
        addLog("❌ 未找到当前标签页", "error");
        return;
    }

    const resp = await sendMessageToTab(tab.id, {
        action: "SWITCH_RECOMMEND_JOB",
        data: { targetTitle: currentTitle }
    }, "recommend", 20000);

    if (!resp?.success) {
        addLog(`⚠️ 切换失败：${resp?.error || "未知错误"}（请在推荐牛人页面执行）`, "warning");
        return false;
    }

    const matched = resp?.data?.matched || "";
    const refreshed = resp?.data?.refreshed;
    const already = resp?.data?.already;
    if (refreshed) {
        if (already) {
            addLog(`✅ 已在当前推荐列表：${matched || currentTitle}`, "success");
        } else {
            addLog(`✅ 已切换推荐列表：${matched || currentTitle}`, "success");
        }
        return true;
    }
    addLog(`⚠️ 已点击切换：${matched || currentTitle}，但列表未确认刷新，建议稍等再点测试`, "warning");
    return false;
}

function openPositionManagerPage() {
    const url = chrome.runtime.getURL("popup/positions.html");
    if (chrome.tabs) {
        chrome.tabs.create({ url });
    } else {
        window.open(url, "_blank");
    }
}

function handleSettingsChange(changes, areaName) {
    if (areaName !== "local") return;

    if (changes.hr_assistant_settings) {
        const newValue = changes.hr_assistant_settings.newValue;
        if (newValue) {
            serverData.positions = newValue.positions || [];
            serverData.currentPosition = newValue.currentPosition || null;
            updateJobDescription();
            renderQueue();
        }
    }

    const GREET_DAILY_STORAGE_KEY = "hr_assistant_greet_daily";
    if (changes[GREET_DAILY_STORAGE_KEY]) {
        const next = changes[GREET_DAILY_STORAGE_KEY].newValue;
        if (next && typeof next === "object") {
            serverData.greetDaily = {
                ...serverData.greetDaily,
                date: next.date ? String(next.date) : null,
                count: Number(next.count || 0),
                limit: serverData?.greetDaily?.limit || 200,
            };
            updateGreetDailyProgress();
        }
    }

    if (changes.lanxing_approved_candidates_pool) {
        refreshTalentPoolSummary().catch((error) => {
            console.error("刷新通过人才池失败:", error);
        });
    }
}

async function handlePositionSelectorChange(event) {
	const selectEl = event.target;
	if (!(selectEl instanceof HTMLSelectElement)) return;
	const selectedId = selectEl.value;
	if (!selectedId) {
		serverData.currentPosition = null;
		updateJobDescription();
		await saveSettings();
		return;
	}
	const selected = serverData.positions.find(p => p.id === selectedId);
	if (!selected) return;
	serverData.currentPosition = selected;
	updateJobDescription();
	await saveSettings();
}

async function handlePositionRefresh(event) {
	const btn = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    let originalText = "🔄";
    
	if (btn) {
		btn.disabled = true;
        // 保存原始文本（可能是 "刷新"），但如果按钮主要是图标，我们可能不需要
        // 这里假设按钮原本就是 "🔄" 或者你想改成只显示图标加动画
		btn.textContent = "🔄"; 
        btn.classList.add('spin-animation');
	}
	try {
		await initializeFromServer();
		updateJobDescription();
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.textContent = "刷新"; // 恢复为文字或者你想要的任何东西
            // 如果原本是 "🔄"，那么应该恢复 "🔄"
            // 根据之前的代码，之前是 "刷新中..." -> "刷新"
            // 如果你想让它一直显示图标，可以改成 "🔄"
            // 这里为了符合 "刷新" 的语境，我还是改回 "刷新" 吧，但如果想要一直转，就不应该改回中文
            // 根据用户的描述 "给刷新加上动画"，我理解是点击时候转。
            // 但如果恢复成 "刷新" 文字，就不存在旋转了（或者整个文字旋转）
            // 之前的HTML是 <button ...>🔄</button>，但JS里把它改成了文字。
            // 最好是保留图标，或者让文字旁边的图标旋转。
            // 由于按钮很小 (icon-btn-small)，可能只适合放图标。
            // 让我们把它改回图标。
            btn.textContent = "🔄";
            btn.classList.remove('spin-animation');
            // 如果需要文字提示，可以用 title 属性
		}
	}
}

// ======================================================
// 一键同步 BOSS 职位列表 -> 写入插件岗位列表
// ======================================================

function getActiveTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs && tabs.length ? tabs[0] : null);
        });
    });
}

async function sendMessageToTab(tabId, msg, target = "any", timeoutMs = 20000) {
    try {
        const resp = await sendToBossFrame({ tabId, target, message: msg, timeoutMs });
        return resp?.data || { success: false, error: "无响应" };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
}

async function handleBossJobListSync(event) {
    const btn = event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    if (btn) {
        btn.disabled = true;
        btn.classList.add("is-loading");
    }

    try {
        const tab = await getActiveTab();
        if (!tab?.id || !tab.url) {
            addLog("❌ 未找到当前标签页", "error");
            return;
        }

        addLog("开始同步职位列表（请保持页面打开）...", "info");

        const resp = await sendMessageToTab(tab.id, {
            action: "SYNC_BOSS_JOBS",
            data: { includePreview: true }
        }, "jobList", 600000);

        if (!resp?.success) {
            addLog(`❌ 同步失败：${resp?.error || "未知错误"}（请确认已打开并登录 BOSS 的职位列表页）`, "error");
            return;
        }

        const payload = resp.data;
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        const previewByEncryptJobId = payload?.previewByEncryptJobId || {};

        if (!jobs.length) {
            addLog("⚠️ 未获取到任何有效职位（仅保存 OPEN 且在有效推荐期的职位）", "warning");
            return;
        }

        // 合并到岗位列表：使用 boss_job:<encryptJobId> 作为稳定 id，避免重复
        const existingById = new Map((serverData.positions || []).map(p => [p.id, p]));
        let createdCount = 0;
        let updatedCount = 0;

        for (const job of jobs) {
            const encryptJobId = job?.encryptJobId || "";
            if (!encryptJobId) continue;

            const id = `boss_job:${encryptJobId}`;
            const name = buildBossPositionTitle(job);
            const previewZpData = previewByEncryptJobId[encryptJobId] || null;

            const existing = existingById.get(id);
            if (!existing) {
                serverData.positions.unshift({
                    id,
                    name,
                    description: buildPositionDescriptionFromBossJob(job, previewZpData),
                    createdAt: Date.now(),
                    source: "boss"
                });
                createdCount += 1;
            } else {
                existing.name = name;
                // 不覆盖用户手动编辑过的内容：仅在 description 为空时写入
                if (!existing.description) {
                    existing.description = buildPositionDescriptionFromBossJob(job, previewZpData);
                }
                existing.updatedAt = Date.now();
                updatedCount += 1;
            }
        }

        await saveSettings();
        updateJobDescription();

        addLog(`✅ 同步完成：新增 ${createdCount}，更新 ${updatedCount}（已写入岗位列表）`, "success");
    } catch (e) {
        console.error("同步职位列表出错:", e);
        addLog(`❌ 同步异常：${e.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove("is-loading");
        }
    }
}


// ======================================================
// 导出模块能力（可选）
// ======================================================
export default {
    startAutoScroll,
    stopAutoScroll,
    testCandidateDetailScreenshot
};
