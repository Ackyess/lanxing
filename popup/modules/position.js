import { serverData, saveSettings } from "./data.js";
import { addLog } from "./ui.js";

// 编辑器状态
let editorMode = "view"; // view | create | edit
let editingId = null;

// DOM 元素快捷获取
const nameInput = () => document.getElementById("position-editor-name");
const descInput = () => document.getElementById("position-editor-description");

/**
 * 核心功能：初始化入口
 */
export function initPositionManager() {
    ensurePositionIds();

    // 1. 绑定全局按钮事件
    bindGlobalEvents();

    // 2. 绑定列表的点击事件（使用事件委托）
    bindListEvents();

    // 3. 初始渲染
    renderPositions();
    syncEditorWithCurrent();
}

/**
 * 绑定顶部和侧边栏的按钮事件
 */
function bindGlobalEvents() {
    // 新增按钮
    document.getElementById("position-add-btn")?.addEventListener("click", () => {
        editorMode = "create";
        editingId = null;
        resetEditorFields(); // 清空输入框
        nameInput()?.focus();
        // 清除列表选中态
        renderPositions(); 
    });

    // 保存按钮
    document.getElementById("position-save-btn")?.addEventListener("click", handleSave);
    
    // 取消/重置按钮 (原来的关闭按钮逻辑也可放在这，或者作为重置)
    document.getElementById("position-cancel-btn")?.addEventListener("click", handleCancel);

    // 导出
    document.getElementById("position-export-btn")?.addEventListener("click", handleExport);

    // 导入
    const importInput = document.getElementById("position-import-input");
    document.getElementById("position-import-btn")?.addEventListener("click", () => {
        importInput?.click();
    });
    importInput?.addEventListener("change", handleImport);

    // 一键删除同步职位（boss_job:*）
    document.getElementById("position-delete-boss-btn")?.addEventListener("click", handleDeleteSyncedBossPositions);
}

function handleDeleteSyncedBossPositions() {
    const before = serverData.positions.length;
    const toDelete = serverData.positions.filter(p => typeof p.id === 'string' && p.id.startsWith('boss_job:'));
    if (toDelete.length === 0) {
        addLog("暂无可删除的同步职位", "warning");
        return;
    }

    if (!confirm(`确定要删除同步职位吗？\n将删除 ${toDelete.length} 个（不会影响你手动创建的岗位）`)) return;

    serverData.positions = serverData.positions.filter(p => !(typeof p.id === 'string' && p.id.startsWith('boss_job:')));

    // 如果当前选中岗位被删了，重置选择
    if (serverData.currentPosition && typeof serverData.currentPosition.id === 'string' && serverData.currentPosition.id.startsWith('boss_job:')) {
        serverData.currentPosition = serverData.positions[0] || null;
        editorMode = "view";
        editingId = null;
        resetEditorFields();
        syncEditorWithCurrent();
    }

    saveSettings();
    renderPositions();
    addLog(`已删除同步职位：${toDelete.length} 个`, "success");
    // 防止计数不一致
    const after = serverData.positions.length;
    if (before === after) {
        addLog("删除失败或无变化，请刷新页面重试", "warning");
    }
}

/**
 * 绑定列表区域的点击交互 (事件委托)
 */
function bindListEvents() {
    const listContainer = document.getElementById("position-list");
    if (!listContainer) return;

    listContainer.addEventListener("click", (e) => {
        // 找到被点击的卡片元素
        const item = e.target.closest(".position-item");
        if (!item) return;

        const id = item.dataset.id;

        // 情况1：点击了“删除”按钮
        if (e.target.closest(".btn-delete-item")) {
            e.stopPropagation();
            handleDelete(id);
            return;
        }

        // 情况2：点击了“编辑”按钮 或 点击了卡片本身 -> 选中该岗位
        // (注意：现在卡片本身就是选中，右侧即时编辑，逻辑是一样的)
        selectPosition(id);
    });
}

/**
 * 渲染左侧岗位列表 (适配新 UI)
 */
export function renderPositions() {
    const container = document.getElementById("position-list");
    const countEl = document.getElementById("position-count");
    if (!container) return;

    ensurePositionIds();
    
    // 更新计数
    if (countEl) countEl.textContent = `${serverData.positions.length} 个`;

    // 空状态
    if (serverData.positions.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; color:#94a3b8; padding:40px 0; font-size:13px;">
                暂无岗位<br>点击上方「+ 新增岗位」开始
            </div>`;
        return;
    }

    // 生成 HTML 字符串
    // 注意：这里使用了 escapeHtml 防止 XSS，并使用了 .position-preview 类来实现 CSS 省略
    const html = serverData.positions.map(p => {
        // 判断是否高亮当前编辑的 ID
        // 注意：如果是 create 模式，editingId 为 null，列表都不高亮
        const isActive = (editorMode === 'edit' && p.id === editingId) || 
                         (serverData.currentPosition?.id === p.id && editorMode !== 'create');
        
        const activeClass = isActive ? "active" : "";
        const descText = p.description || "暂无描述...";

        return `
            <div class="position-item ${activeClass}" data-id="${p.id}">
                <div class="position-info">
                    <div class="position-title">${escapeHtml(p.name)}</div>
                </div>
                
                <div class="position-preview">${escapeHtml(descText)}</div>

                <div class="position-actions">
                    <button class="action-btn btn-edit-item">编辑</button>
                    <button class="action-btn btn-delete-item">删除</button>
                </div>
            </div>
        `;
    }).join("");

    container.innerHTML = html;
}

/**
 * 选中某个岗位 -> 填充编辑器
 */
export async function selectPosition(positionId) {
    ensurePositionIds();
    const position = serverData.positions.find(p => p.id === positionId);
    
    if (!position) {
        // 可能是刚删除了，重置到 view 模式
        editorMode = "view";
        editingId = null;
        return;
    }

    // 更新全局状态
    serverData.currentPosition = position;
    editorMode = "edit";
    editingId = position.id;

    // 填充右侧输入框
    setEditorFields(position);
    
    // 重新渲染列表(为了更新 active 样式)
    renderPositions();
    
    // 保存选中状态到本地存储
    await saveSettings();
}

/**
 * 保存逻辑 (新增或更新)
 */
async function handleSave() {
    const nameEl = nameInput();
    const descEl = descInput();
    if (!nameEl || !descEl) return;

    const name = nameEl.value.trim();
    const description = descEl.value.trim();

    if (!name) {
        alert("请输入岗位名称"); // 简单提示，也可以用 addLog
        return;
    }

    if (editorMode === "create" || !editingId) {
        // --- 新增逻辑 ---
        const newPos = {
            id: createUUID(),
            name,
            description,
            createdAt: Date.now()
        };
        // 加到数组最前面
        serverData.positions.unshift(newPos);
        
        // 切换到编辑模式
        serverData.currentPosition = newPos;
        editorMode = "edit";
        editingId = newPos.id;
        
        addLog(`新增岗位：${name}`, "success");
    } else {
        // --- 更新逻辑 ---
        const target = serverData.positions.find(p => p.id === editingId);
        if (target) {
            target.name = name;
            target.description = description;
            target.updatedAt = Date.now();
            serverData.currentPosition = target;
            addLog(`已更新岗位：${name}`, "success");
        }
    }

    await saveSettings();
    renderPositions();
    
    // 保存成功的视觉反馈
    const btn = document.getElementById("position-save-btn");
    if(btn) {
        const originText = btn.textContent;
        btn.textContent = "已保存";
        setTimeout(() => btn.textContent = originText, 1000);
    }
}

/**
 * 删除逻辑
 */
function handleDelete(positionId) {
    const target = serverData.positions.find(p => p.id === positionId);
    if (!target) return;
    
    if (!confirm(`确定要删除「${target.name}」吗？`)) return;

    // 过滤掉该 ID
    serverData.positions = serverData.positions.filter(p => p.id !== positionId);

    // 如果删除了当前选中的
    if (editingId === positionId) {
        editorMode = "create"; // 或者 view
        editingId = null;
        resetEditorFields();
        serverData.currentPosition = serverData.positions[0] || null;
    }

    saveSettings();
    renderPositions();
    addLog(`已删除岗位：${target.name}`, "warning");
}

/**
 * 辅助：设置编辑器内容
 */
function setEditorFields(position) {
    const nameEl = nameInput();
    const descEl = descInput();
    if (nameEl && descEl) {
        nameEl.value = position ? (position.name || "") : "";
        descEl.value = position ? (position.description || "") : "";
    }
}

function resetEditorFields() {
    setEditorFields(null);
}

function syncEditorWithCurrent() {
    if (serverData.currentPosition) {
        selectPosition(serverData.currentPosition.id);
    } else if (serverData.positions.length > 0) {
        // 如果没有选中，默认选第一个
        selectPosition(serverData.positions[0].id);
    } else {
        // 没有任何数据
        editorMode = "create";
        resetEditorFields();
    }
}

function handleCancel() {
    // 重置回当前选中的内容
    if (editingId && serverData.currentPosition) {
        setEditorFields(serverData.currentPosition);
    } else {
        resetEditorFields();
    }
}

// --- 数据处理工具函数 (保留你原有的) ---

function createUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `uuid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensurePositionIds() {
    if (!Array.isArray(serverData.positions)) {
        serverData.positions = [];
        return;
    }
    serverData.positions.forEach(position => {
        if (!position.id) position.id = createUUID();
    });
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- 导入导出 (保留逻辑) ---

function handleExport() {
    const data = serverData.positions.map(({ id, name, description }) => ({ id, name, description }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `揽星_岗位_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog("岗位数据已导出", "success");
}

function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const data = JSON.parse(reader.result);
            if (!Array.isArray(data)) throw new Error("JSON格式错误");
            
            const imported = [];
            data.forEach(item => {
                if (item && item.name) {
                    imported.push({
                        id: createUUID(),
                        name: item.name.trim(),
                        description: (item.description || "").trim()
                    });
                }
            });
            
            if (imported.length === 0) throw new Error("未找到有效数据");
            
            // 追加模式
            serverData.positions.push(...imported);
            
            await saveSettings();
            renderPositions();
            addLog(`成功导入 ${imported.length} 个岗位`, "success");
        } catch (error) {
            console.error(error);
            alert(`导入失败: ${error.message}`);
        }
    };
    reader.readAsText(file, "utf-8");
}
/**
 * 更新主页面的岗位描述显示（兼容主页面的UI逻辑）
 */
export function updateJobDescription() {
    const nameEl = document.getElementById("current-position-name");
    // const descEl = document.getElementById("current-position-desc"); // 主页面该元素已删除
    const selector = document.getElementById("position-selector");

    // 更新下拉选择器状态
    if (selector) {
        updatePositionSelectorOptions(selector);
    }

    if (serverData.currentPosition) {
        if (nameEl) nameEl.textContent = serverData.currentPosition.name || "未命名岗位";
    } else {
        if (nameEl) nameEl.textContent = "暂无岗位";
    }
}

function updatePositionSelectorOptions(selector) {
    if (!selector) return;
    
    const targetId = serverData.currentPosition?.id || "";

    selector.innerHTML = "";
    
    // 默认选项
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = serverData.positions.length ? "请选择岗位" : "暂无岗位";
    selector.appendChild(placeholder);

    serverData.positions.forEach(position => {
        const option = document.createElement("option");
        option.value = position.id;
        option.textContent = position.name || "未命名岗位";
        selector.appendChild(option);
    });

    // 恢复选中状态
    if (targetId && serverData.positions.some(p => p.id === targetId)) {
        selector.value = targetId;
    } else {
        selector.value = "";
    }
}
