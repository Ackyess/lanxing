// consent.js — 首次使用风险提示门禁：须输入「我同意」方可继续
// 三种形态（弹窗 / 侧边栏 / 浮窗）共用同一份 chrome.storage.local，
// 因此任一形态同意一次后即写入标记，其余形态与后续启动都不再弹出。

const CONSENT_KEY = "lanxing_risk_consent";
const CONSENT_PHRASE = "我同意";

// 返回 Promise：用户已同意（曾同意或本次刚同意）后 resolve。
export async function ensureRiskConsent() {
    let stored = null;
    try {
        const res = await chrome.storage.local.get(CONSENT_KEY);
        stored = res?.[CONSENT_KEY] || null;
    } catch (e) {
        // 读取失败时保守起见仍弹出提示
        stored = null;
    }

    if (stored && stored.agreed) {
        return; // 已同意过，直接放行
    }

    await showConsentGate();
}

function showConsentGate() {
    return new Promise((resolve) => {
        const overlay = document.getElementById("risk-consent-modal");
        const input = document.getElementById("risk-consent-input");
        const confirmBtn = document.getElementById("risk-consent-confirm");

        // 兜底：找不到弹窗节点时不阻塞，避免面板卡死
        if (!overlay || !input || !confirmBtn) {
            resolve();
            return;
        }

        overlay.classList.add("active");
        setTimeout(() => input.focus(), 50);

        const matches = () => input.value.trim() === CONSENT_PHRASE;
        const sync = () => { confirmBtn.disabled = !matches(); };

        const onInput = () => sync();

        const onConfirm = async () => {
            if (!matches()) return;
            confirmBtn.disabled = true;
            try {
                await chrome.storage.local.set({
                    [CONSENT_KEY]: {
                        agreed: true,
                        version: chrome.runtime.getManifest().version,
                        at: Date.now(),
                    }
                });
            } catch (e) {
                // 存储失败也放行本次，但下次仍会提示
            }
            cleanup();
            overlay.classList.remove("active");
            resolve();
        };

        const onKeydown = (e) => {
            if (e.key === "Enter" && matches()) onConfirm();
        };

        function cleanup() {
            input.removeEventListener("input", onInput);
            confirmBtn.removeEventListener("click", onConfirm);
            input.removeEventListener("keydown", onKeydown);
        }

        input.addEventListener("input", onInput);
        confirmBtn.addEventListener("click", onConfirm);
        input.addEventListener("keydown", onKeydown);
        sync();
    });
}
