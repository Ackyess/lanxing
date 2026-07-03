// safety.js — 账号安全模式（面板侧）
// 默认严格：主按钮改为“分析当前可见候选人”（只读初筛），
// 平台自动化能力（打招呼/自动开详情/自动滚动/岗位同步/批量队列）在 UI 与内容脚本双重关闭。
// 高级“授权集成模式”需显式解锁，不作为普通开关暴露。

import { serverData, ACCOUNT_SAFETY_MODE_KEY, aiConfigForContent } from "./data.js";
import { addLog } from "./ui.js";
import { sendToBossFrame } from "./frame_bridge.js";
import { refreshTalentPoolSummary } from "./talent_pool.js";

const UNLOCK_PHRASE = "我已获得BOSS授权";

// 账号安全模式是唯一写入方：直接写独立 key，不经 saveSettings，
// 避免与岗位/关键词等设置混在一起被陈旧面板覆盖。
async function persistSafetyMode(mode) {
    const value = mode === "advanced" ? "advanced" : "strict";
    serverData.accountSafetyMode = value;
    await chrome.storage.local.set({ [ACCOUNT_SAFETY_MODE_KEY]: value });
}

export function isSafetyStrict() {
    return serverData.accountSafetyMode !== "advanced";
}

// 根据当前模式给 <html> 打标记，驱动 CSS 显隐；并同步主按钮文案。
export function applySafetyModeUI() {
    const strict = isSafetyStrict();
    document.documentElement.classList.toggle("safety-strict", strict);

    const label = document.querySelector("#scrollButton span");
    if (label) {
        label.textContent = strict ? "分析当前可见候选人" : "AI 辅助分析简历";
    }

    const statusEl = document.getElementById("safety-mode-status");
    if (statusEl) {
        statusEl.textContent = strict ? "严格（默认，推荐）" : "授权集成（高级，已解锁）";
    }
}

function mapAnalyzeError(code) {
    switch (code) {
        case "NOT_RECOMMEND_CONTEXT": return "请先打开 BOSS 牛人推荐列表页";
        case "PARSER_NOT_READY": return "页面未就绪，请刷新 BOSS 页面后重试";
        case "AI_TOKEN_MISSING": return "请先在设置里配置 AI Token";
        case "AI_UTILS_MISSING": return "AI 模块未加载，请刷新 BOSS 页面";
        default: return code || "未知错误";
    }
}

// 只读分析当前可见候选人：读取已渲染卡片文本 → AI 建议 → 页面本地高亮。
// 不点击、不翻页、不打招呼、不打开详情。
export async function analyzeVisibleCandidates() {
    if (!serverData.ai_config?.token) {
        addLog("请先在「设置」里配置 AI Token", "error");
        return;
    }
    const pos = serverData.currentPosition;
    if (!pos || !pos.name) {
        addLog("请先在「运行队列」里选择岗位（用于匹配判断）", "error");
        return;
    }

    const btn = document.getElementById("scrollButton");
    const label = btn?.querySelector("span");
    const originalText = label?.textContent || "分析当前可见候选人";
    if (btn) btn.disabled = true;
    if (label) label.textContent = "分析中...";

    try {
        addLog(`开始只读初筛：分析当前可见候选人（岗位：${pos.name}）`, "info");
        const resp = await sendToBossFrame({
            target: "recommend",
            message: {
                action: "ANALYZE_VISIBLE_CANDIDATES",
                data: {
                    positionId: pos.id,
                    positionName: pos.name,
                    jobDescription: pos.description,
                    aiConfig: aiConfigForContent()
                }
            },
            timeoutMs: 180000
        });

        const data = resp?.data || {};

        if (data.blocked) {
            addLog("该操作已被账号安全模式拦截", "warning");
        } else if (data.breaker) {
            addLog(`⛔ BOSS 页面出现安全 / 验证提示（信号：${data.signal || "未知"}），为保护账号已停止。请在平台内按官方流程处理。`, "error");
        } else if (data.success) {
            if (data.analyzed === 0) {
                addLog("当前没有待分析的新卡片；安全模式不会自动翻页，请手动滚动后再点分析", "info");
            } else {
                addLog(`分析完成：本次 ${data.analyzed} 张卡片，推荐看详情 ${data.recommended} 人（已加入本地人才池，需你手动查看/沟通）`, "success");
                if (data.pending > 0) {
                    addLog(`还有 ${data.pending} 张待分析，手动滚动后可再次点击`, "info");
                }
            }
            await refreshTalentPoolSummary().catch(() => {});
        } else {
            addLog(`分析失败：${mapAnalyzeError(data.error)}`, "error");
        }
    } catch (e) {
        console.error("只读分析失败:", e);
        addLog("分析失败：无法连接页面，请刷新 BOSS 推荐牛人页面后重试", "error");
    } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = originalText === "分析中..." ? "分析当前可见候选人" : originalText;
    }
}

// 切回严格安全模式（始终允许）
export async function switchToStrictMode() {
    await persistSafetyMode("strict");
    applySafetyModeUI();
    addLog("已切换为账号安全模式（严格）：平台自动化能力全部关闭", "success");
}

// 解锁高级授权集成模式：需输入确认短语，非普通开关
export async function unlockAdvancedMode() {
    const input = document.getElementById("integration-unlock-input");
    const phrase = String(input?.value || "").trim();
    if (phrase !== UNLOCK_PHRASE) {
        addLog(`解锁失败：请完整输入「${UNLOCK_PHRASE}」`, "error");
        return false;
    }
    await persistSafetyMode("advanced");
    applySafetyModeUI();
    addLog("⚠️ 已解锁授权集成模式（高级）：请确保已获得 BOSS 书面授权，平台自动化风险由你承担", "warning");
    return true;
}

export { UNLOCK_PHRASE };
