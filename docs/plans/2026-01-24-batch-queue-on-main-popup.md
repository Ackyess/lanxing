# Batch Queue On Main Popup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在主 popup 首页实现“运行队列”：默认 1 条（岗位+数量），点击 `+` 再新增条目；支持多条但禁止重复岗位（C）；达到每条数量后自动切换下一个岗位继续执行。

**Architecture:** `popup/index.html` 渲染队列 UI；`serverData.batchConfig.items` 存储队列顺序与每条 limit；`popup/modules/scroll.js` 将队列转换为 `batchPlan` 发给 content script；content script 用 batchState 依次切换岗位并执行。

**Tech Stack:** Chrome Extension MV3, popup HTML/CSS/JS, `chrome.storage.local`, content scripts.

---

### Task 1: 主页面 UI 替换为队列组件

**Files:**
- Modify: `popup/index.html`
- Modify: `popup/style.css`

**Steps:**
1. 移除“当前运行岗位/批量运行列表”的分离展示，替换为 `queue-list`。
2. 每条包含岗位下拉+数量输入+删除按钮；顶部包含 `+` 添加按钮。

---

### Task 2: 主页面队列逻辑与持久化

**Files:**
- Modify: `popup/modules/main.js`
- Modify: `popup/modules/data.js`

**Steps:**
1. 初始化：若无队列，创建默认 1 条（limit=200，岗位可为空或取 currentPosition）。
2. 事件：添加/删除行、选择岗位、修改数量（clamp 1-200）。
3. 约束：禁止重复岗位（若选择已被占用则回滚并提示）。
4. 同步：队列第 1 条自动写入 `serverData.currentPosition`（用于测试按钮/切换岗位锚点）。

---

### Task 3: 自动执行按队列切换

**Files:**
- Modify: `popup/modules/scroll.js`
- Modify: `content_scripts/index.js`

**Steps:**
1. `scroll.js` 根据队列顺序生成 `batchPlan`（保持顺序，不再按 positions 排序）。
2. content script 以“通过并打招呼”数量作为达标条件，到达 limit 自动切换下一条并重置计数。

---

### Task 4: 验证

**Run:**
- `node --check popup/modules/main.js popup/modules/scroll.js content_scripts/index.js`

**Manual:**
1. 主页面添加 2 条岗位（不同），分别设定数量 1、2。
2. 点击 `AI 辅助分析简历`：应先切到第 1 条岗位，达标后自动切第 2 条。
3. 尝试选择重复岗位：应被阻止并提示。

