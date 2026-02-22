# QQ Farm Sidebar Console Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the current single-scroll Web UI into a sidebar-driven management console (similar information architecture to `maile456/qq-farm-bot`) while preserving existing multi-account + Bark + friend manual ops behavior.

**Architecture:** Keep the current Node HTTP/SSE backend (`/Users/cyril/qq-farm-bot/web/server.js`) and refactor frontend into route-like views managed in vanilla JS modules (no framework migration in phase 1). Add feature-parity pages incrementally and extend backend APIs only where required (land detail, account runtime config, feature toggles). Prioritize compatibility with existing CLI and existing Web APIs.

**Tech Stack:** Node.js (existing), vanilla HTML/CSS/JS frontend, SSE + existing REST APIs, Node test runner (`node --test`).

### Task 1: Baseline and Gap Freeze

**Files:**
- Create: `/Users/cyril/qq-farm-bot/docs/plans/2026-02-22-sidebar-ui-refactor-plan.md` (this file)
- Modify: `/Users/cyril/qq-farm-bot/README.md`

**Step 1: Lock current capability baseline**
- Record existing pages/sections and APIs as “must not regress”: auth, session start/stop/delete, logs query, friends list/op, Bark settings/test, QR refresh/switch.

**Step 2: Lock reference capability targets**
- Record reference IA targets: dashboard, account home, account settings, account logs, lands, admin users, announcement.

**Step 3: Define priority levels**
- P0 (must): sidebar + multi-page UX using existing features.
- P1 (high): per-account settings page + logs page + dashboard page.
- P2 (optional): lands page, admin users/roles, announcement, DB persistence.

### Task 2: New Frontend Information Architecture (Sidebar + View Router)

**Files:**
- Modify: `/Users/cyril/qq-farm-bot/web/public/index.html`
- Modify: `/Users/cyril/qq-farm-bot/web/public/styles.css`
- Modify: `/Users/cyril/qq-farm-bot/web/public/app.js`
- Create: `/Users/cyril/qq-farm-bot/web/public/views/dashboard.html`
- Create: `/Users/cyril/qq-farm-bot/web/public/views/account-home.html`
- Create: `/Users/cyril/qq-farm-bot/web/public/views/account-settings.html`
- Create: `/Users/cyril/qq-farm-bot/web/public/views/account-logs.html`
- Create: `/Users/cyril/qq-farm-bot/web/public/views/account-friends.html`
- Create: `/Users/cyril/qq-farm-bot/web/public/views/account-bark.html`

**Step 1: Create app shell**
- Add fixed sidebar, topbar, content outlet container.
- Keep mobile drawer behavior for <=980px.

**Step 2: Add hash-based route state**
- Add route keys: `dashboard`, `account-home`, `account-settings`, `account-logs`, `account-friends`, `account-bark`.
- Persist selected account in route query/hash.

**Step 3: Migrate existing section DOM into views**
- Move current single-page sections into isolated partials, mounted by route.

**Step 4: Sidebar interactions**
- Add account selector in sidebar.
- Add running/error status dot rendering in sidebar list.

### Task 3: Frontend State Refactor (Decouple by View)

**Files:**
- Modify: `/Users/cyril/qq-farm-bot/web/public/app.js`

**Step 1: Extract state slices**
- Split state into: auth/session/status/logs/friends/bark/uiSettings/qr.

**Step 2: Extract renderers**
- Implement per-view render functions: `renderDashboard`, `renderAccountHome`, `renderSettings`, `renderLogs`, `renderFriends`, `renderBark`.

**Step 3: Keep SSE contract unchanged**
- Existing SSE events (`log/status/qr/bestCrop/process/settings`) must still drive UI updates.

**Step 4: Maintain login guard**
- Ensure unauthenticated users only see auth panel; sidebar/content hidden.

### Task 4: API Extensions for P1 Parity

**Files:**
- Modify: `/Users/cyril/qq-farm-bot/web/server.js`
- Modify: `/Users/cyril/qq-farm-bot/web/state-store.js`
- Modify: `/Users/cyril/qq-farm-bot/web/session-manager.js`
- Modify: `/Users/cyril/qq-farm-bot/web/session-runner.js`
- Modify: `/Users/cyril/qq-farm-bot/client.js`
- Modify: `/Users/cyril/qq-farm-bot/src/farm.js`

**Step 1: Add account snapshot API**
- `GET /api/accounts` and `GET /api/accounts/:accountId/snapshot` based on current state store.

**Step 2: Add runtime account config API**
- `PUT /api/accounts/:accountId/config` for interval/friendInterval/preferred seed.
- Wire config update through IPC message to child process.

**Step 3: Add logs page API compatibility**
- Keep `/api/logs/query` as backend filter source; add account-scoped helper endpoint if needed for simpler UI calls.

**Step 4: Add lands detail API (optional if P1.5)**
- `GET /api/accounts/:accountId/lands` using existing farm analysis methods.

### Task 5: Missing Feature Backlog (Relative to `maile456/qq-farm-bot`)

**Files (future phases):**
- Create: `/Users/cyril/qq-farm-bot/server/*` (if migrating to DB/role architecture)
- Create: `/Users/cyril/qq-farm-bot/data/*`
- Modify: `/Users/cyril/qq-farm-bot/web/auth.js`
- Modify: `/Users/cyril/qq-farm-bot/web/server.js`

**Step 1: Persistence layer (P2)**
- Add SQLite/sql.js for accounts/session/log persistence.
- Add encrypted stored login token/session.

**Step 2: RBAC (P2)**
- Add admin/user roles, per-account authorization.

**Step 3: Announcement system (P2)**
- Add announcement CRUD + realtime broadcast.

**Step 4: Theme system (P2)**
- Add light/dark theme toggle and persistence.

### Task 6: Testing and Verification

**Files:**
- Modify: `/Users/cyril/qq-farm-bot/test/state-store.test.js`
- Create: `/Users/cyril/qq-farm-bot/test/web-routes.test.js`
- Create: `/Users/cyril/qq-farm-bot/test/ui-route-state.test.js`

**Step 1: API regression tests**
- Ensure current APIs remain backward-compatible.

**Step 2: Route-state tests**
- Validate hash route -> correct view mount.

**Step 3: SSE rendering tests (critical flows)**
- Auth gating, status refresh, QR state transitions, log ordering.

**Step 4: Manual acceptance checklist**
- Desktop/mobile navigation, sidebar account switching, no vertical mega-scroll dependency.

### Task 7: Documentation and Migration Notes

**Files:**
- Modify: `/Users/cyril/qq-farm-bot/README.md`
- Create: `/Users/cyril/qq-farm-bot/docs/sidebar-ui-migration.md`

**Step 1: Update screenshots and IA docs**
- Add new sidebar menu structure and route map.

**Step 2: Add feature parity matrix**
- Mark done/pending against reference repo capabilities.

**Step 3: Deployment impact notes**
- Clarify zero backend breaking change in phase 1; phase 2 introduces optional DB and RBAC.

