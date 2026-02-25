# Web 控制台安全加固（登录限流 + IP 白名单 + CSRF + 脱敏）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Web 控制台增加基础安全防护能力，降低公开部署时的暴露面和被滥用风险，同时保持现有功能兼容。

**Architecture:** 在 `web/server.js` 增加请求前安全检查（IP 白名单、登录限流、CSRF 校验），将可测试的纯逻辑抽到 `web/security.js` 与 `web/auth.js` helper。前端 `fetchJson` 为非 GET 请求自动附带 CSRF 头。对不需要暴露完整 Bark URL 的接口返回脱敏数据。

**Tech Stack:** Node.js (`http`, `crypto`), 原生前端 JS, `node:test`

### Task 1: 安全 helper（限流、IP 白名单、脱敏）TDD

**Files:**
- Create: `web/security.js`
- Create: `test/web-security.test.js`

**Step 1: Write failing tests**
- 登录限流固定窗口
- IP 白名单匹配（精确 IP + IPv4 CIDR）
- Bark URL 脱敏

**Step 2: Run tests (expect fail)**
- `npm test -- test/web-security.test.js`

**Step 3: Implement minimal helpers**
- `createLoginRateLimiter`
- `parseIpWhitelist`
- `isIpAllowed`
- `maskBarkPushUrl` / `maskBarkSettings`

**Step 4: Run tests (expect pass)**
- `npm test -- test/web-security.test.js`

### Task 2: CSRF token helper（auth.js）TDD

**Files:**
- Modify: `web/auth.js`
- Modify: `test/web-auth.test.js`

**Step 1: Write failing tests**
- `buildCsrfToken` / `verifyCsrfToken` roundtrip
- 错误 token 验证失败

**Step 2: Run tests (expect fail)**
- `npm test -- test/web-auth.test.js`

**Step 3: Implement minimal helpers**
- CSRF token 绑定当前 auth token 的 HMAC
- 导出常量 `AUTH_CSRF_HEADER_NAME`

**Step 4: Run tests (expect pass)**
- `npm test -- test/web-auth.test.js`

### Task 3: 服务端接入（限流、白名单、CSRF、脱敏）

**Files:**
- Modify: `web/server.js`

**Step 1: IP 白名单**
- 环境变量：`WEB_UI_ALLOW_IPS`（逗号分隔，支持 IPv4 CIDR）
- 不在白名单时返回 `403`

**Step 2: 登录限流**
- 环境变量：
  - `WEB_UI_LOGIN_RATE_LIMIT_MAX`（默认 10）
  - `WEB_UI_LOGIN_RATE_LIMIT_WINDOW_MS`（默认 10 分钟）
- 登录失败计数，超限返回 `429`

**Step 3: CSRF 校验**
- 认证成功时返回 `csrfToken`
- 非 GET `/api/*`（除 `/api/auth/login`）要求 `X-CSRF-Token`

**Step 4: Bark 脱敏**
- `/api/state` 中 `settings.bark` 返回脱敏 `pushUrl`
- 保留 `GET /api/settings/bark` 完整值用于编辑（已认证）

### Task 4: 前端接入 CSRF 头与脱敏兼容

**Files:**
- Modify: `web/public/app.js`

**Step 1: 保存 `csrfToken`**
- `loadAuthStatus` / `onLogin` 写入 `state.auth.csrfToken`

**Step 2: 非 GET 请求自动带头**
- `fetchJson` 注入 `X-CSRF-Token`

**Step 3: Bark 配置兼容**
- `bootstrap` 不再依赖 `/api/state` 的完整 Bark URL
- 启动后额外调用 `GET /api/settings/bark`

### Task 5: 回归验证

**Step 1: 单元测试**
- `npm test -- test/web-security.test.js`
- `npm test -- test/web-auth.test.js`

**Step 2: 全量回归**
- `npm test`
- `node --check web/server.js`
- `node --check web/public/app.js`

**Step 3: 手工验证**
- 429 登录限流
- 白名单拦截
- CSRF 缺失返回 403
- 前端正常登录/保存 Bark/启动会话不受影响

