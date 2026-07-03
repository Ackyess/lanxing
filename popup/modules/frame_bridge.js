// popup/modules/frame_bridge.js
// 统一通过 background 选择正确的 BOSS iframe(frameId) 并定向发送消息

function sendMessageToBackground(msg, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("BACKGROUND_TIMEOUT"));
        }, timeoutMs);

        chrome.runtime.sendMessage(msg, (resp) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(resp);
        });
    });
}

export async function sendToBossFrame({ tabId, target, message, timeoutMs = 20000 }) {
    const resp = await sendMessageToBackground({
        type: "LANXING_SEND_TO_BOSS_FRAME",
        data: { tabId, target, message, timeoutMs }
    }, Math.max(15000, timeoutMs + 2000));

    if (!resp?.success) {
        let message = resp?.error || "SEND_TO_FRAME_FAILED";
        if (message === "TARGET_FRAME_NOT_FOUND") {
            message = "TARGET_FRAME_NOT_FOUND，请刷新 BOSS 推荐牛人页面后重试";
        }
        const err = new Error(message);
        err.details = resp;
        throw err;
    }

    return resp;
}

