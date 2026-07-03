// ======================================================
// ui.js — FINAL VERSION
// ======================================================

import { serverData } from "./data.js";


// ------------------------------------------------------
// 日志持久化
// ------------------------------------------------------
async function saveLogs(logs) {
    try {
        await chrome.storage.local.set({ hr_logs: logs });
    } catch (e) {
        console.error("保存日志失败:", e);
    }
}

export async function loadLogs() {
    try {
        const data = await chrome.storage.local.get("hr_logs");
        return data.hr_logs || [];
    } catch (e) {
        console.error("加载日志失败:", e);
        return [];
    }
}


// ------------------------------------------------------
// 统一错误显示
// ------------------------------------------------------
export function showError(error) {
    addLog(`错误: ${error.message}`, "error");
    console.error("详细错误:", error);
}


// ------------------------------------------------------
// 日志输出
// ------------------------------------------------------
const LOG_TYPES = new Set(["info", "success", "warning", "error"]);
const LOG_PREFIX = { error: "!", warning: "?", success: "√", info: ">" };

// 安全渲染一条日志：全程 textContent，杜绝候选人姓名 / AI 输出等不可信内容
// 经 innerHTML 注入到扩展特权上下文（会导致 API Token 被窃取）。
function renderLogEntry(container, entry) {
    const type = LOG_TYPES.has(entry.type) ? entry.type : "info";

    const div = document.createElement("div");
    div.className = "log-entry";
    div.style.display = "flex";

    const prefix = document.createElement("span");
    prefix.className = "log-prefix";
    prefix.textContent = LOG_PREFIX[type];

    const body = document.createElement("span");
    body.className = "log-msg log-" + type;
    body.textContent = `[${entry.ts}] ${entry.msg}`;

    div.appendChild(prefix);
    div.appendChild(body);
    container.appendChild(div);
}

// 恢复历史日志（供 main.js 调用）：从原始文本重建，绝不信任存储里的 html
export function restoreLogEntry(container, entry) {
    renderLogEntry(container, {
        type: entry?.type,
        ts: entry?.ts || "",
        msg: String(entry?.msg ?? ""),
    });
}

export async function addLog(message, type = "info") {
    const logContainer = document.getElementById("log-container");
    if (!logContainer) return;

    const t = LOG_TYPES.has(type) ? type : "info";

    // 出错时自动展开运行日志提醒用户；仅本次可见，不改动用户的持久化设置
    if (t === "error") {
        document.documentElement.classList.add("log-shown");
    }

    const ts = new Date().toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
    const msg = String(message ?? "");

    renderLogEntry(logContainer, { type: t, ts, msg });
    logContainer.parentElement.scrollTop = logContainer.parentElement.scrollHeight;

    // 持久化：只存原始文本，不再存 html（旧 html 也不再被信任）
    try {
        const logs = await loadLogs();
        logs.push({ type: t, ts, msg });

        if (logs.length > 100) logs.splice(0, logs.length - 100);

        await saveLogs(logs);
    } catch (e) {
        console.error("保存日志失败:", e);
    }
}


// ------------------------------------------------------
// UI 状态切换（开始 / 停止）
// ------------------------------------------------------
export function updateUI({ isRunning = false, isDownloading = false }) {
    const initial = document.getElementById("initialButtons");
    const stop = document.getElementById("stopButtons");

    if (!initial || !stop) return;

    if (isRunning || isDownloading) {
        initial.classList.add("hidden");
        stop.classList.remove("hidden");
    } else {
        initial.classList.remove("hidden");
        stop.classList.add("hidden");
    }
}


// ------------------------------------------------------
// UI 更新总入口（外部会调用）
// ------------------------------------------------------
export function updateAllUI() {
    updateAIConfigUI();
    updatePositionsUI();
    updateGeneralSettings();
    updateGreetDailyProgress();
}


// ------------------------------------------------------
// UI：更新岗位和筛选等输入框
// ------------------------------------------------------
function updateGeneralSettings() {
    const cfg = serverData;

    setIfExists("match-limit", cfg.matchLimit);
    setIfExists("delay-min", cfg.scrollDelayMin);
    setIfExists("delay-max", cfg.scrollDelayMax);
    setIfExists("click-frequency", cfg.clickFrequency);
    setIfExistsChecked("enable-sound", cfg.enableSound);
}


// 工具函数：设置 input.value
function setIfExists(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
}

// 工具函数：设置 checkbox.checked
function setIfExistsChecked(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.checked = val;
}


// ------------------------------------------------------
// 播放提示音（单例 audio）
// ------------------------------------------------------
let audioPlayer = null;

export function playNotificationSound() {
    if (!audioPlayer) {
        audioPlayer = new Audio(chrome.runtime.getURL("sounds/notification2.mp3"));
        audioPlayer.volume = 0.5;
    }

    audioPlayer.currentTime = 0;
    audioPlayer.play().catch((err) => console.error("播放提示音失败:", err));
}


// ------------------------------------------------------
// 预留的外部注入 UI 更新函数（由其他模块实现）
// ------------------------------------------------------
export function updateAIConfigUI() {}
export function updatePositionsUI() {}

// ------------------------------------------------------
// 批量/进度展示
// ------------------------------------------------------
export function updateBatchStatus(status) {
    const box = document.getElementById("batch-status-box");
    const text = document.getElementById("batch-status-text");
    if (!box || !text) return;

    if (!status) {
        box.style.display = "none";
        text.textContent = "--";
        return;
    }

    box.style.display = "block";
    text.textContent = status;
}

// ------------------------------------------------------
// 每日打招呼进度展示
// ------------------------------------------------------
export function updateGreetDailyProgress() {
    const el = document.getElementById("greet-daily-progress");
    if (!el) return;

    const limit = Number(serverData?.greetDaily?.limit || 200);
    const count = Math.max(0, Number(serverData?.greetDaily?.count || 0));
    const date = serverData?.greetDaily?.date ? String(serverData.greetDaily.date) : "";

    el.textContent = `今日打招呼：${count}/${limit}`;
    el.title = date ? `日期：${date}` : "";
}
