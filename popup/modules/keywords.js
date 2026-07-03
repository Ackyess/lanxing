import { serverData, saveSettings } from "./data.js";
import { addLog } from "./ui.js";
import { sendToBossFrame } from "./frame_bridge.js";

//------------------------------------------------------
// keywords.js - 岗位关键词管理模块
//------------------------------------------------------

// 🛠 确保两个数组初始化
function ensureKeywordArrays() {
    if (!serverData.currentPosition.keywords) {
        serverData.currentPosition.keywords = [];
    }
    if (!serverData.currentPosition.excludeKeywords) {
        serverData.currentPosition.excludeKeywords = [];
    }
}


//------------------------------------------------------
// 1️⃣ 添加关键词
//------------------------------------------------------
function addKeyword() {
    if (!serverData.currentPosition) {
        addLog("⚠️ 请先选择岗位", "error");
        return;
    }

    ensureKeywordArrays();

    const input = document.getElementById("keyword-input");
    if (!input) {
        addLog("⚠️ 页面错误：找不到关键词输入框", "error");
        return;
    }

    const keyword = input.value.trim();
    if (!keyword) return;

    if (!serverData.currentPosition.keywords.includes(keyword)) {
        serverData.currentPosition.keywords.push(keyword);
        saveSettings();
        renderKeywords();
        notifyKeywordsUpdate();
    }

    input.value = "";
}


//------------------------------------------------------
// 2️⃣ 删除关键词
//------------------------------------------------------
function removeKeyword(keyword) {
    if (!serverData.currentPosition) return;

    ensureKeywordArrays();

    serverData.currentPosition.keywords =
        serverData.currentPosition.keywords.filter(k => k !== keyword);

    saveSettings();
    renderKeywords();
    notifyKeywordsUpdate();
}


//------------------------------------------------------
// 3️⃣ 添加排除关键词
//------------------------------------------------------
function addExcludeKeyword() {
    if (!serverData.currentPosition) {
        addLog("⚠️ 请先选择岗位", "error");
        return;
    }

    ensureKeywordArrays();

    const input = document.getElementById("keyword-input");
    if (!input) {
        addLog("⚠️ 页面错误：找不到输入框", "error");
        return;
    }

    const keyword = input.value.trim();
    if (!keyword) return;

    if (!serverData.currentPosition.excludeKeywords.includes(keyword)) {
        serverData.currentPosition.excludeKeywords.push(keyword);
        saveSettings();
        renderExcludeKeywords();
        notifyKeywordsUpdate();
    }

    input.value = "";
}


//------------------------------------------------------
// 4️⃣ 删除排除关键词
//------------------------------------------------------
function removeExcludeKeyword(keyword) {
    if (!serverData.currentPosition) return;

    ensureKeywordArrays();

    serverData.currentPosition.excludeKeywords =
        serverData.currentPosition.excludeKeywords.filter(k => k !== keyword);

    saveSettings();
    renderExcludeKeywords();
    notifyKeywordsUpdate();
}


//------------------------------------------------------
// 5️⃣ UI 渲染标签（通用组件）
//------------------------------------------------------
function createTag(keyword, onRemove, options = {}) {
    const div = document.createElement("div");
    div.className = "keyword-tag";

    if (options.exclude) {
        div.style.backgroundColor = "#ffe0e0";
        div.style.borderColor = "#ff4444";
        div.style.color = "#ff4444";
    }

    // 用 textContent 构建，绝不把用户关键词拼进 innerHTML（防扩展特权页 DOM 注入/XSS）
    const label = document.createElement("span");
    label.className = "keyword-text";
    label.textContent = keyword;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-keyword";
    button.textContent = "×";
    button.dataset.keyword = keyword;
    if (options.exclude) button.style.color = "#ff4444";
    button.addEventListener("click", () => {
        onRemove(keyword);
    });

    div.append(label, " ", button);

    return div;
}


//------------------------------------------------------
// 6️⃣ 渲染普通关键词
//------------------------------------------------------
export function renderKeywords() {
    const container = document.getElementById("keyword-list");
    if (!container) throw new Error("缺少 keyword-list 容器");

    container.innerHTML = "";

    if (!serverData.currentPosition) return;

    ensureKeywordArrays();

    serverData.currentPosition.keywords.forEach(keyword => {
        container.appendChild(
            createTag(keyword, removeKeyword, { exclude: false })
        );
    });
}


//------------------------------------------------------
// 7️⃣ 渲染排除关键词
//------------------------------------------------------
export function renderExcludeKeywords() {
    const container = document.getElementById("exclude-keyword-list");
    if (!container) throw new Error("缺少 exclude-keyword-list 容器");

    container.innerHTML = "";

    if (!serverData.currentPosition) return;

    ensureKeywordArrays();

    serverData.currentPosition.excludeKeywords.forEach(keyword => {
        container.appendChild(
            createTag(keyword, removeExcludeKeyword, { exclude: true })
        );
    });
}


//------------------------------------------------------
// 8️⃣ 通知 content_script 更新关键词（安全发送）
//------------------------------------------------------
function notifyKeywordsUpdate() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs || !tabs[0]) return;

        try {
            sendToBossFrame({
                tabId: tabs[0].id,
                target: "recommend",
                message: {
                    action: "UPDATE_KEYWORDS",
                    data: {
                        keywords: serverData.currentPosition.keywords || [],
                        excludeKeywords: serverData.currentPosition.excludeKeywords || [],
                        isAndMode: serverData.isAndMode
                    }
                },
                timeoutMs: 8000
            }).catch((e) => {
                console.warn("UPDATE_KEYWORDS 发送失败：", e?.message || e);
            });
        } catch (e) {
            console.warn("notifyKeywordsUpdate 失败：", e);
        }
    });
}

function bindKeywordEvents() {
    const input = document.getElementById("keyword-input");
    const includeBtn = document.getElementById("keyword-add-btn");
    const excludeBtn = document.getElementById("keyword-exclude-btn");

    includeBtn?.addEventListener("click", () => addKeyword());
    excludeBtn?.addEventListener("click", () => addExcludeKeyword());

    input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
                addExcludeKeyword();
            } else {
                addKeyword();
            }
        }
    });
}

document.addEventListener("DOMContentLoaded", bindKeywordEvents);
