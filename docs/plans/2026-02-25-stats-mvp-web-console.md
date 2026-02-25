# Web 控制台统计功能（MVP）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为现有 Web 控制台新增“统计功能第一版”，支持多账号实时统计、基础趋势图展示，并通过 REST API + SSE 向前端提供数据。

**Architecture:** 统计聚合放在 `web/state-store.js` 内，直接消费现有 `log/status/session` 更新，避免侵入核心业务逻辑。后端新增 `/api/stats` 查询接口与 `stats` SSE 推送；前端在“账号总览”视图新增统计卡片与 SVG sparkline 趋势图，并在选中账号变更时切换展示。

**Tech Stack:** Node.js (`http`), 原生前端 HTML/CSS/JS, 现有 SSE 事件流, `node:test`

### Task 1: 定义统计数据结构与口径（state-store）

**Files:**
- Modify: `web/state-store.js`
- Test: `test/state-store.test.js`

**Step 1: Write the failing test**

为 `state-store` 增加统计聚合测试，覆盖：
- `setStatus()` 后计算 `expDelta/goldDelta`
- `setSession()` 记录运行时长与状态切换
- `addLog()` 统计 `kickout/wsClose/harvest/plant/friendManual`
- 生成经验/金币趋势点（至少 1 个）

**Step 2: Run test to verify it fails**

Run: `npm test -- test/state-store.test.js`
Expected: FAIL（`getStatsSnapshot` 或统计字段不存在）

**Step 3: Write minimal implementation**

在 `web/state-store.js` 中新增：
- 账号统计对象初始化
- 状态更新/日志更新/会话更新时的统计聚合
- `getStatsSnapshot()` / `getAccountStats(accountId)`

**Step 4: Run test to verify it passes**

Run: `npm test -- test/state-store.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add web/state-store.js test/state-store.test.js
git commit -m "feat(stats): add state-store metrics aggregation"
```

### Task 2: 暴露统计 API 与 SSE 事件

**Files:**
- Modify: `web/server.js`
- Test: `test/state-store.test.js` (indirect coverage) or add `test/server-stats-api.test.js` (optional MVP)

**Step 1: Write the failing test (optional for MVP)**

若新增 API 测试，验证 `/api/state` 或 `/api/stats` 返回统计字段；若不新增 API 测试，则保留后端语法和集成验证。

**Step 2: Implement `/api/stats`**

新增接口：
- `GET /api/stats?accountId=<id|all>`

返回结构（MVP）：

```json
{
  "ok": true,
  "data": {
    "accounts": { "qq-main": { "...": "..." } },
    "summary": { "...": "..." },
    "ts": 1730000000000
  }
}
```

**Step 3: Publish `stats` SSE events**

在以下场景聚合后推送：
- `status` 事件
- `process` 事件（会话状态变化）
- `log` 事件（计数变化）
- `spawn/exit`（会话生命周期）

事件结构：

```json
{"type":"stats","accountId":"qq-main","payload":{"accountStats":{...},"summary":{...}}}
```

**Step 4: Verify**

Run:
- `node --check web/server.js`
- `npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add web/server.js
git commit -m "feat(stats): add stats api and sse events"
```

### Task 3: 前端统计卡片与趋势图（账号总览页）

**Files:**
- Modify: `web/public/index.html`
- Modify: `web/public/app.js`
- Modify: `web/public/styles.css`

**Step 1: Add UI skeleton**

在 `data-view="account-home"` 下新增统计区：
- 今日增量（经验/金币）
- 会话稳定性（运行时长/断线/踢下线）
- 行为计数（收获/种植/好友手动操作）
- 趋势图（经验/金币 sparkline）
- 多账号效率排行（按 exp/h）

**Step 2: Add front-end state and API fetch**

新增：
- `state.stats`
- `GET /api/stats` 初始化加载
- SSE `stats` 事件实时更新

**Step 3: Render charts**

不引入第三方库，使用内联 SVG 路径绘制 sparkline。

**Step 4: Verify**

Run:
- `node --check web/public/app.js`
- `npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add web/public/index.html web/public/app.js web/public/styles.css
git commit -m "feat(ui): add account stats cards and trend charts"
```

### Task 4: 文档补充（可选，非本轮 MVP 必做）

**Files:**
- Modify: `README.md`

**Step 1: 补充统计功能说明**
- 指标定义
- 统计口径（内存态、重启会重置）
- 趋势图采样说明

**Step 2: 验证文案**
- 启动后查看“账号总览”统计区是否实时更新

### MVP 指标口径（本轮）

- **今日经验增量**：当天首次收到状态时的 `exp` 为基线，之后取最新值差值
- **今日金币增量**：同上（`gold`）
- **运行时长**：累计 `running` 状态时长（包含当前进行中的会话）
- **断线次数**：日志中匹配 `WS`/`连接关闭`
- **被踢次数**：日志匹配 `被踢下线`
- **收获/种植次数**：从相关日志文本解析数字
- **好友手动操作次数**：`action=friend_manual` 日志计数
- **exp/h**：`今日经验增量 / 今日运行小时`

### 非目标（后续迭代）

- 持久化统计（SQLite）
- Bark 成功/失败/去重精确统计（需在 `src/bark.js` 增加结构化事件）
- 图表缩放/时间范围切换
- 任务/礼包细分类统计

