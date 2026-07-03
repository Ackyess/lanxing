// ========================================
// data.js — FINAL STABLE VERSION
// ========================================

// 引用全局配置的 Prompt
const AI_PROMPTS = window.HR_SYSTEM_PROMPTS || {
    SYSTEM_PROMPT: "配置加载失败",
    USER_PROMPT: "配置加载失败"
};
const runtimeConfig = window.LANXING_CONFIG || {};
const fixedAIConfig = runtimeConfig.DEFAULT_AI_CONFIG || {};
const isFixedAIConfig = fixedAIConfig.locked === true;

export { AI_PROMPTS }; // 重新导出以便其他模块使用

function getDefaultAIConfig() {
    return {
        platform: fixedAIConfig.platform || 'custom',
        token: fixedAIConfig.token || '',
        baseUrl: fixedAIConfig.baseUrl || '',
        model: fixedAIConfig.model || 'gpt-5.5',
        clickPrompt: AI_PROMPTS.SYSTEM_PROMPT,
        detailPrompt: AI_PROMPTS.USER_PROMPT,
    };
}

function applyFixedAIConfig() {
    if (!isFixedAIConfig) return;
    Object.assign(serverData.ai_config, getDefaultAIConfig());
}


// 统一的配置对象
export let serverData = {
    ai_config: getDefaultAIConfig(),
    positions: [],
    currentPosition: null,
    ai_expire_time: null,
    isAndMode: false,
    matchLimit: 200,
    enableSound: true,
    scrollDelayMin: 3,
    scrollDelayMax: 5,
    clickFrequency: 7,
    communicationConfig: {
        enabled: false,
        phone: false,
        wechat: false,
        resume: false,
    },
    runModeConfig: {
        greetingEnabled: false,
        communicationEnabled: false,
    },
    // 批量运行配置：多岗位依次执行
    // items: [{ positionId: string, limit: number }]
    batchConfig: {
        enabled: false,
        items: []
    },
    // 许可证信息
    // 每日打招呼统计（仅用于 UI 展示）
    greetDaily: {
        date: null,
        count: 0,
        limit: 200,
    },
};


// ========================================
// 运行时状态
// ========================================
export const runtimeState = {
    isRunning: false,
    matchCount: 0,
    isDownloading: false,
    downloadCount: 0,
    // 批量运行进度（仅用于 UI 展示）
    batchStatus: null
};


// ========================================
// 保存设置
// ========================================
export async function saveSettings() {
    try {
        applyFixedAIConfig();

        if (serverData.currentPosition) {
            const jobDescEl = document.getElementById('job-description');
            if (jobDescEl) {
                serverData.currentPosition.description = jobDescEl.value || '';
            }
        }

        await chrome.storage.local.set({
            hr_assistant_settings: {
                positions: serverData.positions,
                currentPosition: serverData.currentPosition,
                isAndMode: serverData.isAndMode,
                matchLimit: serverData.matchLimit,
                enableSound: serverData.enableSound,
                scrollDelayMin: serverData.scrollDelayMin,
                scrollDelayMax: serverData.scrollDelayMax,
                clickFrequency: serverData.clickFrequency,
                communicationConfig: serverData.communicationConfig,
                runModeConfig: serverData.runModeConfig,
                batchConfig: serverData.batchConfig,
            },
            ai_config: serverData.ai_config,
            ai_expire_time: serverData.ai_expire_time,
        });

    } catch (e) {
        console.error("[data.js] 保存设置失败:", e);
    }
}


// ========================================
// 从 storage 初始化
// ========================================
export async function initializeFromServer() {
    try {
        const GREET_DAILY_STORAGE_KEY = "hr_assistant_greet_daily";
        const getLocalDateString = (d = new Date()) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${year}-${month}-${day}`;
        };

        const result = await chrome.storage.local.get([
            "hr_assistant_settings",
            "ai_expire_time",
            "ai_config",
            GREET_DAILY_STORAGE_KEY,
        ]);

        if (result.hr_assistant_settings) {
            Object.assign(serverData, {
                positions: result.hr_assistant_settings.positions || [],
                currentPosition: result.hr_assistant_settings.currentPosition || null,
                isAndMode: result.hr_assistant_settings.isAndMode ?? false,
                matchLimit: result.hr_assistant_settings.matchLimit ?? 200,
                enableSound: result.hr_assistant_settings.enableSound ?? true,
                scrollDelayMin: result.hr_assistant_settings.scrollDelayMin ?? 3,
                scrollDelayMax: result.hr_assistant_settings.scrollDelayMax ?? 5,
                clickFrequency: result.hr_assistant_settings.clickFrequency ?? 7,
                communicationConfig: result.hr_assistant_settings.communicationConfig || serverData.communicationConfig,
                runModeConfig: {
                    ...(result.hr_assistant_settings.runModeConfig || serverData.runModeConfig),
                    greetingEnabled: false,
                },
                batchConfig: result.hr_assistant_settings.batchConfig || serverData.batchConfig,
            });
        }

        if (result.ai_expire_time) {
            serverData.ai_expire_time = result.ai_expire_time;
        }
        if (result.ai_config && !isFixedAIConfig) {
            Object.assign(serverData.ai_config, result.ai_config);
        }
        applyFixedAIConfig();

        // 读取每日打招呼统计（可能不存在）
        try {
            const stored = result?.[GREET_DAILY_STORAGE_KEY];
            const today = getLocalDateString();
            if (stored && typeof stored === "object") {
                serverData.greetDaily.date = stored.date ? String(stored.date) : null;
                serverData.greetDaily.count = Number(stored.count || 0);
            } else {
                serverData.greetDaily.date = null;
                serverData.greetDaily.count = 0;
            }

            // 跨天自动归零，避免显示昨天数据
            if (serverData.greetDaily.date !== today) {
                serverData.greetDaily.date = today;
                serverData.greetDaily.count = 0;
                await chrome.storage.local.set({
                    [GREET_DAILY_STORAGE_KEY]: { date: today, count: 0 }
                });
            }
        } catch (e) {
            serverData.greetDaily.date = null;
            serverData.greetDaily.count = 0;
        }

    } catch (e) {
        console.error("[data.js] initializeFromServer 错误:", e);
    }
}


// ========================================
// 状态保存与恢复
// ========================================
export async function saveState() {
    return chrome.storage.local.set({
        isRunning: runtimeState.isRunning,
        isDownloading: runtimeState.isDownloading,
        matchCount: runtimeState.matchCount,
        downloadCount: runtimeState.downloadCount
    });
}

export async function loadState() {
    const res = await chrome.storage.local.get([
        "isRunning",
        "isDownloading",
        "matchCount",
        "downloadCount",
    ]);

    runtimeState.isRunning = res.isRunning || false;
    runtimeState.isDownloading = res.isDownloading || false;
    runtimeState.matchCount = res.matchCount || 0;
    runtimeState.downloadCount = res.downloadCount || 0;
}
