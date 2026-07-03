// ===============================
// screenshot.js — FINAL VERSION
// ===============================

import { addLog } from "./ui.js";
import { serverData, AI_PROMPTS } from "./data.js";
import { sendDirectAIRequest } from "./ai.js";
import { sendToBossFrame } from "./frame_bridge.js";


// ------------------------------------------------------
// 统一 Promise 包装 chrome.runtime.sendMessage
// ------------------------------------------------------
function sendMessageAsync(msg, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        let timeout = setTimeout(() => {
            console.error("[POPUP] sendMessage 超时:", msg);
            reject(new Error("Service Worker 未响应（超时）"));
        }, timeoutMs);

        chrome.runtime.sendMessage(msg, (response) => {
            clearTimeout(timeout);

            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }

            resolve(response);
        });
    });
}

function sendMessageToTab(tabId, msg, timeoutMs = 10000) {
    return sendToBossFrame({
        tabId,
        target: "recommend",
        message: msg,
        timeoutMs
    }).then((resp) => resp?.data);
}

function normalizeStoredText(value, maxLength = 3000) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
}

function normalizeLongText(value, maxLength = 50000) {
    const text = String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n...[已截断]`;
}

function buildCandidateDetailText(candidateInfo) {
    if (!candidateInfo) return "";

    const lines = [];
    if (candidateInfo.name) lines.push(`姓名：${candidateInfo.name}`);
    if (candidateInfo.age) lines.push(`年龄：${candidateInfo.age}`);
    if (candidateInfo.education) lines.push(`学历：${candidateInfo.education}`);
    if (candidateInfo.university) lines.push(`学校：${candidateInfo.university}`);
    if (candidateInfo.salary) lines.push(`期望薪资：${candidateInfo.salary}`);
    if (candidateInfo.location) lines.push(`期望地点：${candidateInfo.location}`);
    if (candidateInfo.activeText) lines.push(`在线状态：${candidateInfo.activeText}`);
    if (Array.isArray(candidateInfo.extraInfo) && candidateInfo.extraInfo.length > 0) {
        lines.push("其他信息：");
        candidateInfo.extraInfo.forEach((item) => {
            lines.push(`- ${item.type || '信息'}: ${item.value || ''}`);
        });
    }
    return lines.join("\n");
}

function buildDecisionCandidateText({ candidateText, detailText, resumeText, ocrError } = {}) {
    const parts = [];
    const base = String(candidateText || "").trim();
    const detail = String(detailText || "").trim();
    const resume = String(resumeText || "").trim();
    const error = String(ocrError || "").trim();

    if (base) {
        parts.push(`【候选人基础信息】\n${base}`);
    }
    if (detail) {
        parts.push(`【候选人结构化信息】\n${detail}`);
    }
    if (resume) {
        parts.push(`【OCR简历全文】\n${resume}`);
    } else if (error) {
        parts.push(`【OCR状态】未提取到可用全文：${error}`);
    } else {
        parts.push("【OCR状态】未提取到可用全文");
    }

    return parts.join("\n\n").trim() || "未提供候选人信息";
}



// ------------------------------------------------------
// 统筹截图处理流程 (截图 -> 裁剪 -> 缩放 -> 保存)
// ------------------------------------------------------
async function processAndSaveScreenshot(rect) {
    // 1. 截图
    let imageData = await captureCanvasArea(rect);

    try {
        addLog("正在优化图片...", "info");
        
        // 使用 utils/image.js 中的公共方法
        if (window.LanxingImageUtils) {
            imageData = await window.LanxingImageUtils.processImage(imageData, {
                crop: { topRatio: 0, bottomRatio: 0.6 },
                resize: { maxWidth: 0, quality: 0.9 } // maxWidth=0 保持原宽, quality=0.9
            });
        } else {
            console.error("LanxingImageUtils 未加载");
        }
        
    } catch (e) {
        console.error("图片处理失败:", e);
        addLog("图片优化失败，将保存原图", "warning");
    }

    return imageData;
}


// ------------------------------------------------------
// 统一 canvas 区域截图
// ------------------------------------------------------
export async function captureCanvasArea(rect) {
    // addLog(`截图区域: ${rect.width}x${rect.height}`, "info");

    if (window.LanxingImageUtils) {
        try {
            return await window.LanxingImageUtils.captureCanvasArea(rect);
        } catch (e) {
            addLog(`失败: ${e.message}`, "error");
            throw e;
        }
    }

    // Fallback (如果 LanxingImageUtils 未加载)
    const normalizedRect = {
        ...rect,
        dpr: rect?.dpr ?? rect?.devicePixelRatio ?? window.devicePixelRatio ?? 1
    };

    addLog("测试Service Worker连接...", "info");
    try {
        await sendMessageAsync({ type: "PING" }, 5000);
    } catch (error) {
        addLog(`Service Worker未响应: ${error.message}`, "error");
        throw error;
    }

    addLog("等待background响应...", "info");
    const result = await sendMessageAsync({
        type: "CAPTURE_CANVAS_AREA",
        data: normalizedRect,
    }, 20000);

    if (!result?.success) {
        throw new Error(result?.error || "截图失败");
    }

    return result.imageData;
}


// ------------------------------------------------------
// 自动从 content script 获取 Canvas 位置
// ------------------------------------------------------
async function getResumeCanvasRect(tabId) {
    if (window.LanxingImageUtils) {
        return await window.LanxingImageUtils.getResumeCanvasRect(tabId);
    }

    addLog("尝试获取 Canvas 区域...", "info");

    for (let i = 1; i <= 3; i++) {
        try {
            const rect = await sendMessageToTab(tabId, { type: "GET_RESUME_RECT" }, 8000);

            if (rect && rect.width && rect.height) {
                return rect;
            }
        } catch (e) {}

        await new Promise((r) => setTimeout(r, 800));
    }

    return null;
}


// ------------------------------------------------------
// 主动截取详情页 Canvas（完整流程：打开 -> 截图 -> AI分析 -> 决策）
// ------------------------------------------------------
export async function captureResume() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes("zhipin.com")) {
        const err = new Error("请在 Boss-牛人列表 页面使用此功能");
        addLog(err.message, "error");
        throw err;
    }

    addLog("1. 寻找未处理的候选人并打开详情...", "info");

    // 1. 打开候选人详情页
    const openResult = await sendMessageToTab(tab.id, {
        action: "OPEN_FIRST_DETAIL",
        data: {
            positionId: serverData.currentPosition?.id,
            positionName: serverData.currentPosition?.name,
            jobDescription: serverData.currentPosition?.description,
            aiConfig: serverData.ai_config,
            skipProcessed: true // 告诉 content script 跳过已处理（红/绿）的
        },
    }, 30000).catch((error) => {
        let msg = error.message;
        if (msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection")) {
            msg = "连接失败，请刷新 Boss 页面后重试";
        }
        addLog(`打开详情页失败: ${msg}`, "error");
        throw error;
    });

    // 获取候选人信息
    const candidateInfo = openResult.candidate;
    const candidateText = candidateInfo ? (candidateInfo.simpleText || JSON.stringify(candidateInfo)) : "未获取到候选人文本信息";

    // 已经在 Content Script 统一等待了 3 秒，这里不需要再等

    // 2. 获取 Canvas 区域
    const rect = await getResumeCanvasRect(tab.id);
    if (!rect) {
        throw new Error("未找到 Canvas 区域");
    }

    // 3. 处理截图
    const imageData = await processAndSaveScreenshot(rect);
    
    if (!window.HR_AI_UTILS) {
        throw new Error("AI 工具库未加载");
    }

    const detailText = normalizeStoredText(buildCandidateDetailText(candidateInfo) || candidateText, 3200);
    let resumeFullText = "";
    let ocrError = "";

    if (window.HR_AI_UTILS?.extractResumeText) {
        try {
            addLog("正在 OCR 简历全文...", "info");
            const extracted = await window.HR_AI_UTILS.extractResumeText(
                imageData,
                `${candidateText}\n\n${detailText}`,
                serverData.ai_config
            );
            if (extracted?.success && extracted?.text) {
                resumeFullText = normalizeLongText(extracted.text, 50000);
            } else {
                ocrError = extracted?.error || "OCR未提取到文字";
            }
        } catch (extractError) {
            ocrError = extractError?.message || String(extractError);
            console.warn("提取简历全文失败:", extractError);
        }
    } else {
        ocrError = "OCR模块未加载";
    }

    const decisionCandidateText = buildDecisionCandidateText({
        candidateText,
        detailText,
        resumeText: resumeFullText,
        ocrError
    });

    // 4. AI 分析
    addLog("正在请求 AI 进行分析...", "info");

    const aiDecision = await window.HR_AI_UTILS.analyzeCandidateResume(
        imageData,
        decisionCandidateText,
        serverData.currentPosition?.name,
        serverData.currentPosition?.description,
        serverData.ai_config
    );

    addLog(`AI 决策: ${aiDecision.decision} (${aiDecision.reason})`, aiDecision.decision === "是" ? "success" : "warning");

    // 5. 执行操作
    if (aiDecision.decision === "是") {
        try {
            const addResp = await sendMessageToTab(tab.id, {
                action: "ADD_APPROVED_CANDIDATE",
                data: {
                    candidate: candidateInfo,
                    candidateText,
                    detailText,
                    resumeText: resumeFullText,
                    aiReason: aiDecision.reason,
                    positionId: serverData.currentPosition?.id,
                    positionName: serverData.currentPosition?.name,
                    jobDescription: serverData.currentPosition?.description,
                    decisionSource: "manual"
                }
            }, 20000);

            addLog(`AI 通过：${candidateInfo?.name || '未知候选人'}，已纳入通过人才池`, "success");
            if (addResp?.success && addResp?.data?.total) {
                addLog(`当前通过人才池：${addResp.data.total} 人`, "info");
            }
        } catch (e) {
            addLog(`写入通过人才池失败：${e.message}`, "warning");
        }

        if (serverData.runModeConfig?.greetingEnabled === true) addLog("执行打招呼操作...", "info");
        if (serverData.runModeConfig?.greetingEnabled === true) {
            await sendMessageToTab(tab.id, {
                action: "GREET_CANDIDATE",
                data: { decision: true, reason: aiDecision.reason, candidate: candidateInfo }
            });
        } else {
            addLog("AI passed; greeting is disabled by default.", "info");
        }
        
        await sendMessageToTab(tab.id, { action: "CLOSE_DETAIL" });

        await sendMessageToTab(tab.id, { 
            action: "MARK_CANDIDATE",
            data: { decision: true, reason: aiDecision.reason, candidate: candidateInfo }
        });
        
        
    } else {
        // 不合适，关闭详情页
        addLog("执行关闭详情页操作...", "info");
        await sendMessageToTab(tab.id, { action: "CLOSE_DETAIL" });
        
        // 标记为红色
        await sendMessageToTab(tab.id, { 
            action: "MARK_CANDIDATE",
            data: { decision: false, reason: aiDecision.reason, candidate: candidateInfo }
        });
    }

    return {
        imageData,
        candidateInfo,
        candidateText: normalizeStoredText(buildCandidateDetailText(candidateInfo) || candidateText, 3200),
        aiDecision
    };
}


export const testCandidateDetailScreenshot = captureResume;
