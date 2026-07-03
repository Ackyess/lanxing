import { addLog } from "./ui.js";
import { sendDirectAIRequest } from "./ai.js";
import { serverData } from "./data.js";
import { sendToBossFrame } from "./frame_bridge.js";
import { buildExportPayload } from "./talent_pool_export.js";
import { buildRankingApiConfig, buildRankingPrompt } from "./talent_pool_ranking.js";

const TALENT_POOL_STORAGE_KEY = "lanxing_approved_candidates_pool";

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatTime(ts) {
    if (!ts) return "--";
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN", {
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length ? tabs[0] : null;
}

async function requestTalentPoolAction(message, timeoutMs = 15000) {
    const tab = await getActiveTab();
    if (!tab?.id) {
        throw new Error("未找到当前标签页");
    }

    const resp = await sendToBossFrame({
        tabId: tab.id,
        target: "recommend",
        message,
        timeoutMs
    }).then((result) => result?.data);

    if (!resp?.success) {
        throw new Error(resp?.error || "人才池操作失败");
    }

    return resp;
}

export async function loadApprovedTalentPool() {
    try {
        const result = await chrome.storage.local.get([TALENT_POOL_STORAGE_KEY]);
        return Array.isArray(result?.[TALENT_POOL_STORAGE_KEY]) ? result[TALENT_POOL_STORAGE_KEY] : [];
    } catch (e) {
        console.error("加载通过人才池失败:", e);
        return [];
    }
}

export async function refreshTalentPoolSummary() {
    const list = await loadApprovedTalentPool();
    const countEl = document.getElementById("talent-pool-count");
    const listEl = document.getElementById("talent-pool-list");

    if (countEl) {
        countEl.textContent = `${list.length} 人`;
    }

    if (!listEl) return list;

    if (!list.length) {
        listEl.innerHTML = '<div class="talent-pool-empty">暂无 AI 审核通过的人才</div>';
        return list;
    }

    listEl.innerHTML = list.slice(0, 6).map((item, index) => {
        const candidateName = escapeHtml(item?.candidateName || "未知候选人");
        const positionName = escapeHtml(item?.positionName || "未归类岗位");
        const aiReason = escapeHtml(item?.aiReason || "--");
        const scoreText = item?.ranking?.score ? ` · ${escapeHtml(item.ranking.score)}` : "";
        const rankText = item?.ranking?.rank ? `#${item.ranking.rank}` : `${index + 1}`;
        return `
            <div class="talent-pool-item">
                <div class="talent-pool-item-top">
                    <span class="talent-pool-rank">${rankText}</span>
                    <span class="talent-pool-name">${candidateName}</span>
                    <span class="talent-pool-time">${formatTime(item?.updatedAt || item?.approvedAt)}</span>
                </div>
                <div class="talent-pool-item-meta">${positionName}${scoreText}</div>
                <div class="talent-pool-item-reason">${aiReason}</div>
            </div>
        `;
    }).join("");

    return list;
}

function downloadTextFile(filename, content, mimeType = "application/json") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function exportApprovedTalentPool() {
    const pool = await loadApprovedTalentPool();
    if (!pool.length) {
        addLog("通过人才池为空，暂无可导出数据", "warning");
        return;
    }

    const payload = buildExportPayload(pool);
    downloadTextFile(
        `揽星_通过人才_${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(payload, null, 2),
        "application/json"
    );
    addLog(`已导出通过人才 ${payload.candidates.length} 人`, "success");
}

export async function clearApprovedTalentPool() {
    const pool = await loadApprovedTalentPool();
    if (!pool.length) {
        addLog("通过人才池已为空", "warning");
        return;
    }

    const confirmed = confirm(`确定清空通过人才池吗？\n当前共有 ${pool.length} 人`);
    if (!confirmed) return;

    try {
        await requestTalentPoolAction({ action: "CLEAR_APPROVED_CANDIDATES" }, 15000);
    } catch (e) {
        await chrome.storage.local.set({ [TALENT_POOL_STORAGE_KEY]: [] });
    }

    await refreshTalentPoolSummary();
    addLog("已清空通过人才池", "warning");
}

function parseRankingResponse(text) {
    const raw = String(text || "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error("横评结果不是合法 JSON");
    }
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed?.ranked) || parsed.ranked.length === 0) {
        throw new Error("横评结果缺少 ranked 列表");
    }
    return parsed;
}

export async function rankApprovedTalentPool() {
    const pool = await loadApprovedTalentPool();
    if (pool.length < 2) {
        addLog("横评至少需要 2 个已通过候选人", "warning");
        return;
    }

    const positionId = String(serverData.currentPosition?.id || "");
    const positionName = serverData.currentPosition?.name || "";
    const jobDescription = serverData.currentPosition?.description || "";

    const scopedPool = pool.filter((item) => {
        if (positionId) return String(item?.positionId || "") === positionId;
        if (positionName) return String(item?.positionName || "") === positionName;
        return true;
    });

    const candidates = scopedPool.length >= 2 ? scopedPool : pool;
    const scopeText = scopedPool.length >= 2 ? `当前岗位 ${positionName || '未命名岗位'}` : "全部岗位通过人才池";
    addLog(`开始横评：${scopeText}，共 ${candidates.length} 人`, "info");
    addLog("横评将综合履历证据、岗位相关经验、数据能力、稳定性和风险点，不只按岗位介绍排序", "info");

    const prompt = buildRankingPrompt(positionName, jobDescription, candidates);
    const rankingApiConfig = buildRankingApiConfig();
    const result = await sendDirectAIRequest([{ role: "user", content: prompt }], rankingApiConfig);
    if (!result?.success) {
        throw new Error(result?.error || "横评请求失败");
    }

    const parsed = parseRankingResponse(result.response);
    const rankedMap = new Map(parsed.ranked.map((item) => [String(item.id), item]));
    const nextPool = pool.map((item) => {
        const ranked = rankedMap.get(String(item.id));
        if (!ranked) return item;
        return {
            ...item,
            ranking: {
                rank: Number(ranked.rank || 0) || null,
                score: String(ranked.score || "").trim(),
                reason: String(ranked.reason || "").trim(),
                evidence: Array.isArray(ranked.evidence) ? ranked.evidence.map((x) => String(x || "").trim()).filter(Boolean) : [],
                concerns: Array.isArray(ranked.concerns) ? ranked.concerns.map((x) => String(x || "").trim()).filter(Boolean) : [],
                fitLevel: String(ranked.fitLevel || "").trim(),
                summary: String(parsed.summary || "").trim()
            },
            updatedAt: Date.now()
        };
    }).sort((a, b) => {
        const aRank = Number(a?.ranking?.rank || Number.MAX_SAFE_INTEGER);
        const bRank = Number(b?.ranking?.rank || Number.MAX_SAFE_INTEGER);
        if (aRank !== bRank) return aRank - bRank;
        return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
    });

    await chrome.storage.local.set({ [TALENT_POOL_STORAGE_KEY]: nextPool });
    await refreshTalentPoolSummary();

    const top = nextPool.find((item) => item?.ranking?.rank === 1) || nextPool[0];
    addLog(`横评完成，Top1：${top?.candidateName || "未知候选人"}`, "success");
    if (parsed.summary) {
        addLog(`横评总结：${parsed.summary}`, "info");
    }
}
