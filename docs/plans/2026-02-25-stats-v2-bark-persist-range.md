# Web 控制台统计功能 V2（Bark 精确统计 + 持久化 + 图表范围/缩放）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在统计功能第一版基础上补齐 Bark 推送精确统计、统计持久化（重启不丢当天统计）和图表时间范围/缩放控制。

**Architecture:** 子进程 `src/bark.js` 增加结构化 `bark` UI 事件，Web 后端接收后写入 `state-store` 统计聚合。统计持久化采用 JSON 文件（不新增数据库依赖），由 `web/server.js` 启动加载、变更后节流写盘。前端统计图在已有 sparkline 基础上增加范围过滤和缩放（横向可滚动）。

**Tech Stack:** Node.js (`http`, `fs`), 原生前端 HTML/CSS/JS, 现有 SSE 事件流, `node:test`

### Task 1: `state-store` 扩展 Bark 统计与导入/导出持久化（TDD）

**Files:**
- Modify: `web/state-store.js`
- Modify: `test/state-store.test.js`

**Step 1: Write the failing tests**
- `recordMetricEvent('bark')` 可统计 `success/failed/deduped`
- `exportStatsState()` / `importStatsState()` 可在新 store 中恢复统计数据

**Step 2: Run tests to verify they fail**
- Run: `npm test -- test/state-store.test.js`
- Expected: FAIL（方法不存在或断言不通过）

**Step 3: Implement minimal code**
- 新增 metric 事件记录接口
- 扩展统计计数字段（barkSuccess/barkFailed/barkDeduped）
- 增加统计状态导入导出接口

**Step 4: Run tests**
- Run: `npm test -- test/state-store.test.js`
- Expected: PASS

### Task 2: Bark UI 事件与后端统计接线

**Files:**
- Modify: `src/bark.js`
- Modify: `web/server.js`

**Step 1: Emit Bark structured events**
- 在 `pushBarkDetailed` 每个返回路径 emit `@@UI@@{"type":"bark"...}`

**Step 2: Consume Bark events in server**
- `sessionManager.on('ui-event')` 处理 `type==='bark'`
- 写入 `state-store` metric，并推送 `stats` 更新

**Step 3: Verify**
- Run: `node --check src/bark.js`
- Run: `node --check web/server.js`

### Task 3: 统计持久化（JSON 文件）

**Files:**
- Modify: `web/server.js`
- Modify: `web/state-store.js`
- Modify: `.gitignore`
- Optional Create: `web/stats-persist.js`（若实现拆分）

**Step 1: Startup load**
- 从项目根 `.qq-farm-ui-stats.json` 读取并 `importStatsState()`

**Step 2: Debounced save**
- 统计变更时节流写盘（例如 800ms）

**Step 3: Delete account cleanup**
- 删除账号后统计文件同步移除对应账号数据

**Step 4: Verify**
- Run: `npm test`

### Task 4: 前端图表范围/缩放与 Bark 统计展示

**Files:**
- Modify: `web/public/index.html`
- Modify: `web/public/app.js`
- Modify: `web/public/styles.css`

**Step 1: Add controls**
- 时间范围：`1h / 6h / 24h / all`
- 图表缩放：`1x / 1.5x / 2x`

**Step 2: Range filtering**
- 根据 `state.stats.ts` 过滤趋势点

**Step 3: Zoom rendering**
- sparkline 变为横向可滚动 SVG 容器

**Step 4: Bark stats display**
- 当前账号和汇总统计中展示 Bark 成功/失败/去重计数

**Step 5: Verify**
- Run: `node --check web/public/app.js`
- Run: `npm test`

### Task 5: 回归验证与收口

**Files:**
- Modify: `README.md`（可选，若本轮时间足够）

**Step 1: 手工回归**
- Bark 测试推送（成功/失败/去重）计数变化
- 重启 Web 后统计保留
- 图表范围切换/缩放有效

**Step 2: 全量测试**
- Run: `npm test`
- Run: `node --check web/public/app.js`
- Run: `node --check web/server.js`
- Run: `node --check web/state-store.js`

