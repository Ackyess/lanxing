import { serverData, saveState, runtimeState } from "./data.js";
import { addLog, updateUI, updateBatchStatus, updateGreetDailyProgress } from "./ui.js";
import { stopAutoScroll } from "./scroll.js";
import { refreshTalentPoolSummary } from "./talent_pool.js";

//----------------------------------------------
// messages.js - 统一处理来自 content_script 的消息
//----------------------------------------------

// ⚠️ 注意：本文件依赖以下全局变量来自 data.js 或 scroll.js：
// serverData
// matchCount / matchLimit
// isRunning
// stopAutoScroll()
// addLog()
// updateUI()
// saveState()

// 测试用：发送简单消息
chrome.runtime.sendMessage({ message: "hello" }, (response) => {
    // console.log("收到来自background的回复：", response);
});


//----------------------------------------------
// 主消息监听器
//----------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    try {

        //------------------------------------------
        // 1️⃣ AI 匹配成功 MATCH_SUCCESS
        //------------------------------------------
        if (message.type === "MATCH_SUCCESS") {

            handleMatchSuccess(message.data);
            sendResponse({ ok: true });
            return true;
        }


        //------------------------------------------
        // 2️⃣ 内容脚本通知滚动结束
        //------------------------------------------
        if (message.type === "SCROLL_COMPLETE") {

            handleScrollComplete();
            sendResponse({ ok: true });
            return true;
        }


        //------------------------------------------
        // 3️⃣ 内容脚本发送 log 到 popup
        //------------------------------------------
        if (message.type === "LOG_MESSAGE") {
            addLog(message.data.message, message.data.type || "info");
            sendResponse({ ok: true });
            return true;
        }

        //------------------------------------------
        // 3.5️⃣ 批量/进度状态
        //------------------------------------------
        if (message.type === "BATCH_STATUS") {
            const processedCount = Number(message?.data?.processedCount || 0);
            const contactCount = Number(message?.data?.contactCount || 0);
            const limit = Number(message?.data?.limit || 0);
            const positionName = String(message?.data?.positionName || "");

            const batch = message?.data?.batch;
            const plan = Array.isArray(batch?.plan) ? batch.plan : null;
            const index = typeof batch?.index === "number" ? batch.index : 0;
            const total = typeof batch?.total === "number" ? batch.total : (plan ? plan.length : 0);

            if (total > 0) {
                updateBatchStatus(`批量：${index + 1}/${total} | 当前：${positionName} | 通过：${contactCount}/${limit} | 已处理：${processedCount}`);
            } else {
                updateBatchStatus(`当前：${positionName} | 通过：${contactCount}/${limit} | 已处理：${processedCount}`);
            }

            runtimeState.batchStatus = { processedCount, contactCount, limit, positionName, index, total };
            sendResponse({ ok: true });
            return true;
        }

        //------------------------------------------
        // 3.6️⃣ 每日打招呼进度
        //------------------------------------------
        if (message.type === "GREET_DAILY_PROGRESS") {
            const count = Math.max(0, Number(message?.data?.count || 0));
            const limit = Math.max(1, Number(message?.data?.limit || 200));
            const date = message?.data?.date ? String(message.data.date) : null;

            serverData.greetDaily = {
                ...serverData.greetDaily,
                date,
                count,
                limit,
            };
            updateGreetDailyProgress();
            sendResponse({ ok: true });
            return true;
        }


        //------------------------------------------
        // 3.7️⃣ 通过人才池状态
        //------------------------------------------
        if (message.type === "TALENT_POOL_UPDATED") {
            const total = Number(message?.data?.total || 0);
            const candidateName = String(message?.data?.candidateName || "");
            const inserted = message?.data?.inserted === true;
            const cleared = message?.data?.cleared === true;

            refreshTalentPoolSummary().catch((error) => {
                console.error("刷新通过人才池失败:", error);
            });

            if (cleared) {
                addLog("通过人才池已清空", "warning");
            } else if (candidateName) {
                addLog(`${inserted ? "新增" : "更新"}通过人才：${candidateName}，当前 ${total} 人`, "success");
            }

            sendResponse({ ok: true });
            return true;
        }

        //------------------------------------------
        // 4️⃣ 内容脚本发送错误
        //------------------------------------------
        if (message.type === "ERROR") {
            addLog(`❌ 错误: ${message.error}`, "error");
            sendResponse({ ok: true });
            return true;
        }


        //------------------------------------------
        // 5️⃣ DEBUG 信息
        //------------------------------------------
        if (message.type === "DEBUG") {
            // console.log("DEBUG 来自 content_script:", message.data);
            sendResponse({ ok: true });
            return true;
        }

    } catch (err) {
        console.error("messages.js 错误:", err);
        addLog("messages.js 处理异常：" + err.message, "error");
    }

    
    // 我们只对自己处理过的消息返回 true，其他的让它继续传递（return false）
    return false;
});



//----------------------------------------------
// ⚙️ MATCH_SUCCESS 处理逻辑
//----------------------------------------------
function handleMatchSuccess(data) {
    runtimeState.matchCount++;

    const { name, age, education, university, extraInfo, clicked } = data;

    let logText = `[${runtimeState.matchCount}] ${name}`;

    if (extraInfo?.length > 0) {
        const joined = extraInfo.map(info => `${info.type}: ${info.value}`).join(" | ");
        logText += ` | ${joined}`;
    }

    if (clicked) logText += " [已点击]";

    addLog(logText, "success");


    //----------------------------------------------
    // 播放提示音
    //----------------------------------------------
    if (serverData.enableSound) {
        const audio = new Audio(chrome.runtime.getURL("sounds/notification2.mp3"));
        audio.volume = 0.5;
        audio.play().catch(err => console.warn("播放提示音失败:", err));
    }


    //----------------------------------------------
    // 达到上限 → 自动停止
    //----------------------------------------------
    const limit = serverData.matchLimit || 200;

    if (runtimeState.matchCount >= limit) {
        safeStopAutoScroll();
        addLog(`已达到设定打招呼数量 ${limit}，自动停止`, "warning");

        if (serverData.enableSound) {
            const audio = new Audio(chrome.runtime.getURL("sounds/error.mp3"));
            audio.volume = 0.5;
            audio.play().catch(() => {});
        }
    }

    saveState();
}



//----------------------------------------------
// ⚙️ 处理滚动结束 SCROLL_COMPLETE
//----------------------------------------------
function handleScrollComplete() {

    runtimeState.isRunning = false;
    updateUI({ isRunning: runtimeState.isRunning, isDownloading: runtimeState.isDownloading });

    addLog(`滚动完成，共匹配 ${runtimeState.matchCount} 个候选人`, "success");

    runtimeState.matchCount = 0;
    runtimeState.batchStatus = null;
    updateBatchStatus(null);

    saveState();
}



//----------------------------------------------
// ⚠️ 安全停止自动滚动，防止函数未初始化报错
//----------------------------------------------
function safeStopAutoScroll() {
    try {
        stopAutoScroll();
    } catch (e) {
        console.error("safeStopAutoScroll 错误:", e);
    }
}
