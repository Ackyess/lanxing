# Fix BOSS iframe messaging Implementation Plan

> **For Codex:** 执行时按任务逐个验证；避免同时改多处导致定位困难。

**Goal:** 让 `popup` 的“测试/AI 自动/同步岗位/关键词更新”等消息在 BOSS 页面 iframe 场景下稳定投递到正确 frame，并对“扩展重载(Extension context invalidated)”给出可恢复的降级行为。

**Architecture:** 在 `background.js` 增加“按 target 选择 frameId + 定向 `tabs.sendMessage`”能力；`popup` 统一走该路由；`content_scripts/index.js` 对关键消息增加上下文校验与按需初始化解析器，避免错误 frame 收到消息时无响应。

**Tech Stack:** Chrome Extension MV3, `chrome.webNavigation.getAllFrames`, `chrome.tabs.sendMessage(frameId)`, content scripts(all_frames).

---

### Task 1: 定位正确 frame（推荐/职位列表）

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`

**Step 1: 增加权限**
- 在 `manifest.json` 增加 `webNavigation` permission。

**Step 2: 增加 background 路由**
- 新增消息类型 `HRLENS_SEND_TO_BOSS_FRAME`：
  - 枚举 `chrome.webNavigation.getAllFrames({tabId})`
  - 对每个 frame 发送 `PING_CONTENT`
  - 选择满足 `target`（`recommend|jobList`）的 frameId
  - 将原始消息定向发送到该 frameId 并回传响应
  - 做好超时/兜底（返回“请刷新页面/未找到目标 frame”）

---

### Task 2: popup 统一改为 background 路由发送

**Files:**
- Create: `popup/modules/frame_bridge.js`
- Modify: `popup/modules/scroll.js`
- Modify: `popup/modules/screenshot.js`
- Modify: `popup/modules/keywords.js`
- Modify: `popup/modules/main.js`

**Step 1: 抽一个 `sendToBossFrame`**
- `sendToBossFrame({ target, message, tabId })` -> Promise

**Step 2: 替换所有 `chrome.tabs.sendMessage`**
- `START_AI_SCROLL/STOP_SCROLL/OPEN_FIRST_DETAIL/GET_RESUME_RECT/...` 统一走 `sendToBossFrame(target='recommend')`
- `SYNC_BOSS_JOBS` 走 `target='jobList'`
- `UPDATE_KEYWORDS` 走 `target='recommend'`

---

### Task 3: content script 上下文兜底与按需初始化

**Files:**
- Modify: `content_scripts/index.js`

**Step 1: `SWITCH_RECOMMEND_JOB` 优先使用当前 document**
- 若 `isBossRecommendContext(document)` 为真，不再强制查找 iframe。

**Step 2: 关键消息加 `ensureParserReady`**
- `START_AI_SCROLL/OPEN_FIRST_DETAIL/UPDATE_KEYWORDS/...` 在需要时调用 `initializeParser()`，避免“解析器未初始化”误报。

**Step 3: 避免返回 `false` 导致 port closed**
- 对可能被误投递的消息返回 `{success:false, error:'ignored'}`（尤其是 `PING_CONTENT` 之外的关键链路）。

---

### Task 4: 验证

**Run:**
- 手动在 BOSS 页面（推荐牛人、职位列表）测试：
  - “测试”按钮：可打开详情/截图/关闭/标记
  - “AI 自动”按钮：能启动/停止
  - “一键同步岗位”：能抓取并写入 positions 管理页
  - 关键词变更：能让列表筛选生效

