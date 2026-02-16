const MAX_LOG_LINES = 5000;
const LOG_QUERY_LIMIT = 200;
const FRIEND_DANGEROUS_ACTIONS = new Set(['putBug', 'putWeed', 'bad']);

const state = {
  sessions: {},
  selectedAccountId: 'default',
  bark: null,
  ui: {
    friendOps: {
      allowBadOps: true,
      confirmDangerous: true,
    },
  },
  friends: {},
  logView: {
    items: [],
    cursor: null,
    loading: false,
    hasLoaded: false,
  },
  auth: {
    enabled: false,
    authenticated: true,
    username: '',
  },
};

const els = {
  serverMeta: document.getElementById('serverMeta'),
  authPanel: document.getElementById('authPanel'),
  authUsername: document.getElementById('authUsername'),
  authPassword: document.getElementById('authPassword'),
  authStatus: document.getElementById('authStatus'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  consolePanels: Array.from(document.querySelectorAll('.control-panel, .metrics, .bark-panel, .logs-panel')),
  accountId: document.getElementById('accountId'),
  logScope: document.getElementById('logScope'),
  sessionList: document.getElementById('sessionList'),
  mode: document.getElementById('mode'),
  platform: document.getElementById('platform'),
  code: document.getElementById('code'),
  useQr: document.getElementById('useQr'),
  interval: document.getElementById('interval'),
  friendInterval: document.getElementById('friendInterval'),
  decodeData: document.getElementById('decodeData'),
  decodeHex: document.getElementById('decodeHex'),
  decodeGate: document.getElementById('decodeGate'),
  decodeType: document.getElementById('decodeType'),
  runFields: document.getElementById('runFields'),
  decodeFields: document.getElementById('decodeFields'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  clearLogsBtn: document.getElementById('clearLogsBtn'),
  sessionStatus: document.getElementById('sessionStatus'),
  metricPlatform: document.getElementById('metricPlatform'),
  metricName: document.getElementById('metricName'),
  metricLevel: document.getElementById('metricLevel'),
  metricExp: document.getElementById('metricExp'),
  metricExpToNext: document.getElementById('metricExpToNext'),
  metricGold: document.getElementById('metricGold'),
  bestCropName: document.getElementById('bestCropName'),
  bestCropCurrent: document.getElementById('bestCropCurrent'),
  bestCropNext: document.getElementById('bestCropNext'),
  bestCropExp: document.getElementById('bestCropExp'),
  bestCropSource: document.getElementById('bestCropSource'),
  qrPhase: document.getElementById('qrPhase'),
  qrImage: document.getElementById('qrImage'),
  qrLink: document.getElementById('qrLink'),
  qrMessage: document.getElementById('qrMessage'),
  logs: document.getElementById('logs'),
  barkEnabled: document.getElementById('barkEnabled'),
  barkPushUrl: document.getElementById('barkPushUrl'),
  barkGroup: document.getElementById('barkGroup'),
  barkDedupSeconds: document.getElementById('barkDedupSeconds'),
  catFatal: document.getElementById('catFatal'),
  catNetwork: document.getElementById('catNetwork'),
  catBusiness: document.getElementById('catBusiness'),
  allowBadOps: document.getElementById('allowBadOps'),
  confirmDangerous: document.getElementById('confirmDangerous'),
  saveFriendUiBtn: document.getElementById('saveFriendUiBtn'),
  refreshFriendsBtn: document.getElementById('refreshFriendsBtn'),
  friendUiStatus: document.getElementById('friendUiStatus'),
  friendList: document.getElementById('friendList'),
  logLevel: document.getElementById('logLevel'),
  logTag: document.getElementById('logTag'),
  logKeyword: document.getElementById('logKeyword'),
  logAction: document.getElementById('logAction'),
  applyLogFiltersBtn: document.getElementById('applyLogFiltersBtn'),
  loadMoreLogsBtn: document.getElementById('loadMoreLogsBtn'),
  logsStatus: document.getElementById('logsStatus'),
  saveBarkBtn: document.getElementById('saveBarkBtn'),
  testBarkBtn: document.getElementById('testBarkBtn'),
  barkStatus: document.getElementById('barkStatus'),
};

let eventStream = null;

function setText(el, text) {
  el.textContent = text;
}

function setConsoleVisible(visible) {
  for (const panel of els.consolePanels) {
    panel.classList.toggle('hidden', !visible);
  }
}

function applyAuthState(auth) {
  const next = {
    enabled: Boolean(auth && auth.enabled),
    authenticated: Boolean(auth && auth.authenticated),
    username: String((auth && auth.username) || ''),
  };
  state.auth = next;

  const loginRequired = next.enabled && !next.authenticated;
  els.authPanel.classList.toggle('hidden', !loginRequired);
  els.logoutBtn.classList.toggle('hidden', !(next.enabled && next.authenticated));
  setConsoleVisible(!loginRequired);

  if (loginRequired) {
    setText(els.authStatus, '请输入账号密码');
  } else {
    setText(els.authStatus, '');
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeAccountId(raw) {
  const text = String(raw || '').trim();
  return text || 'default';
}

function getSelectedAccountForLogs() {
  const scope = els.logScope.value;
  if (scope === 'all') return 'all';
  return normalizeAccountId(state.selectedAccountId);
}

function getActiveLogFilters() {
  return {
    accountId: getSelectedAccountForLogs(),
    level: els.logLevel.value || 'all',
    tag: els.logTag.value.trim(),
    keyword: els.logKeyword.value.trim(),
    action: els.logAction.value.trim(),
    limit: LOG_QUERY_LIMIT,
  };
}

function createEmptySession(accountId) {
  return {
    accountId,
    session: {
      status: 'idle',
      mode: 'run',
      pid: null,
      startedAt: 0,
      stoppedAt: 0,
      lastError: '',
    },
    status: {
      platform: 'qq',
      name: '',
      level: 0,
      gold: 0,
      exp: 0,
    },
    qr: {
      phase: '',
      qrUrl: '',
      message: '',
    },
    bestCrop: null,
    logs: [],
  };
}

function ensureSession(accountId) {
  const id = normalizeAccountId(accountId);
  if (!state.sessions[id]) {
    state.sessions[id] = createEmptySession(id);
  }
  return state.sessions[id];
}

function getCurrentSession() {
  return ensureSession(state.selectedAccountId);
}

function getSortedAccountIds() {
  return Object.keys(state.sessions).sort((a, b) => {
    if (a === state.selectedAccountId) return -1;
    if (b === state.selectedAccountId) return 1;
    return a.localeCompare(b);
  });
}

function applyModeVisibility() {
  const mode = els.mode.value;
  els.runFields.classList.toggle('hidden', mode !== 'run');
  els.decodeFields.classList.toggle('hidden', mode !== 'decode');
}

function renderSessionList() {
  const ids = getSortedAccountIds();
  if (ids.length === 0) {
    els.sessionList.innerHTML = '';
    return;
  }

  const html = ids.map((accountId) => {
    const item = ensureSession(accountId);
    const s = item.session || {};
    const st = item.status || {};
    const active = accountId === state.selectedAccountId ? ' active' : '';
    const desc = `${s.status || 'idle'} | ${st.platform || '-'} | ${st.name || '-'} | Lv${st.level ?? 0}`;
    return `
      <div class="session-item${active}">
        <div class="session-meta">
          <div class="session-id">${escapeHtml(accountId)}</div>
          <div class="session-desc">${escapeHtml(desc)}</div>
        </div>
        <div class="session-actions">
          <button class="btn" data-action="select" data-account-id="${escapeHtml(accountId)}">查看</button>
          <button class="btn btn-danger" data-action="stop" data-account-id="${escapeHtml(accountId)}">停止</button>
        </div>
      </div>
    `;
  }).join('');

  els.sessionList.innerHTML = html;
}

function renderSession() {
  const current = getCurrentSession();
  const s = current.session || {};
  setText(els.sessionStatus, `当前账号：${state.selectedAccountId} | 状态：${s.status || 'idle'} | PID: ${s.pid || '-'} | 模式: ${s.mode || '-'}`);
}

function renderStatus() {
  const current = getCurrentSession();
  const s = current.status || {};
  setText(els.metricPlatform, `平台：${s.platform || '-'}`);
  setText(els.metricName, `昵称：${s.name || '-'}`);
  setText(els.metricLevel, `等级：${s.level ?? '-'}`);
  if (Number.isFinite(s.expCurrent) && Number.isFinite(s.expNeeded) && s.expNeeded > 0) {
    setText(els.metricExp, `经验：${s.expCurrent}/${s.expNeeded}`);
    setText(els.metricExpToNext, `升级还差：${Math.max(0, s.expToNext || 0)}`);
  } else {
    setText(els.metricExp, `经验：${s.exp ?? '-'}`);
    setText(els.metricExpToNext, '升级还差：-');
  }
  setText(els.metricGold, `金币：${s.gold ?? '-'}`);
}

function renderBestCrop() {
  const current = getCurrentSession();
  const c = current.bestCrop;
  if (!c) {
    setText(els.bestCropName, '当前选种：-');
    setText(els.bestCropCurrent, '当前等级最优：-');
    setText(els.bestCropNext, '下一级最优：-');
    setText(els.bestCropExp, '当前等级最优效率：-');
    setText(els.bestCropSource, '来源：-');
    return;
  }
  const currentBest = c.currentLevelBest || null;
  const nextBest = c.nextLevelBest || null;

  setText(
    els.bestCropName,
    `当前选种：${c.seedName ? `${c.seedName} (seed=${c.seedId || '-'})` : '-'}`,
  );
  setText(
    els.bestCropCurrent,
    currentBest
      ? `当前等级最优：Lv${currentBest.level} ${currentBest.seedName} (seed=${currentBest.seedId})`
      : '当前等级最优：-',
  );
  setText(
    els.bestCropNext,
    nextBest
      ? `下一级最优：Lv${nextBest.level} ${nextBest.seedName} (seed=${nextBest.seedId})`
      : '下一级最优：-',
  );
  setText(
    els.bestCropExp,
    `当前等级最优效率：${currentBest && currentBest.expPerHour != null ? `${currentBest.expPerHour} exp/h` : '-'}`,
  );
  setText(els.bestCropSource, `来源：${c.source || '-'}`);
}

function renderQr() {
  const current = getCurrentSession();
  const q = current.qr || {};
  setText(els.qrPhase, `状态：${q.phase || '-'}`);
  setText(els.qrMessage, q.message || '');
  if (q.qrUrl) {
    els.qrImage.classList.remove('hidden');
    els.qrImage.src = `/api/qr.svg?text=${encodeURIComponent(q.qrUrl)}&t=${Date.now()}`;
    els.qrLink.classList.remove('hidden');
    els.qrLink.href = q.qrUrl;
    els.qrLink.textContent = '打开扫码链接';
  } else {
    els.qrImage.classList.add('hidden');
    els.qrLink.classList.add('hidden');
  }
}

function formatLogLine(item) {
  const accountPrefix = item.accountId ? `[${item.accountId}] ` : '';
  const text = item.text || item.message || '';
  return `${accountPrefix}${text}`;
}

function renderLogs() {
  const lines = (state.logView.items || []).slice(0, MAX_LOG_LINES).map((item) => formatLogLine(item));
  els.logs.textContent = lines.join('\n');
  els.logs.scrollTop = els.logs.scrollHeight;
}

function renderLogsStatus() {
  const total = (state.logView.items || []).length;
  const cursorText = state.logView.cursor ? '可继续加载历史' : '已到最早日志';
  setText(els.logsStatus, `当前显示 ${total} 条，${cursorText}`);
  els.loadMoreLogsBtn.disabled = !state.logView.cursor || state.logView.loading;
}

function renderUiSettings() {
  const friendOps = (state.ui && state.ui.friendOps) || {};
  els.allowBadOps.checked = Boolean(friendOps.allowBadOps);
  els.confirmDangerous.checked = Boolean(friendOps.confirmDangerous);
}

function renderFriendList() {
  const accountId = normalizeAccountId(state.selectedAccountId);
  const friends = state.friends[accountId] || [];
  if (!friends.length) {
    els.friendList.innerHTML = '<p class="friend-empty">暂无好友数据，点击“刷新好友列表”加载</p>';
    return;
  }

  const allowBadOps = Boolean(state.ui && state.ui.friendOps && state.ui.friendOps.allowBadOps);
  const html = friends.map((f) => {
    const preview = f.preview || {};
    const disabledBad = allowBadOps ? '' : ' disabled';
    return `
      <article class="friend-item">
        <div class="friend-head">
          <div class="friend-name">${escapeHtml(f.name || f.gid)}</div>
          <div class="friend-meta">GID:${escapeHtml(f.gid)} | Lv${Number.isFinite(f.level) ? f.level : '-'}</div>
          <div class="friend-preview">偷:${preview.steal || 0} 水:${preview.dry || 0} 草:${preview.weed || 0} 虫:${preview.insect || 0}</div>
        </div>
        <div class="friend-actions">
          <button class="btn" data-friend-action="steal" data-gid="${escapeHtml(f.gid)}">偷</button>
          <button class="btn" data-friend-action="water" data-gid="${escapeHtml(f.gid)}">浇水</button>
          <button class="btn" data-friend-action="weed" data-gid="${escapeHtml(f.gid)}">除草</button>
          <button class="btn" data-friend-action="insecticide" data-gid="${escapeHtml(f.gid)}">除虫</button>
          <button class="btn btn-danger" data-friend-action="putBug" data-gid="${escapeHtml(f.gid)}"${disabledBad}>放虫</button>
          <button class="btn btn-danger" data-friend-action="putWeed" data-gid="${escapeHtml(f.gid)}"${disabledBad}>放草</button>
          <button class="btn btn-danger" data-friend-action="bad" data-gid="${escapeHtml(f.gid)}"${disabledBad}>捣乱</button>
        </div>
      </article>
    `;
  }).join('');
  els.friendList.innerHTML = html;
}

function renderBarkSettings() {
  const bark = state.bark;
  if (!bark) return;
  els.barkEnabled.checked = Boolean(bark.enabled);
  els.barkPushUrl.value = bark.pushUrl || '';
  els.barkGroup.value = bark.group || '';
  els.barkDedupSeconds.value = bark.dedupSeconds ?? 60;
  els.catFatal.checked = Boolean(bark.categories && bark.categories.fatal);
  els.catNetwork.checked = Boolean(bark.categories && bark.categories.network);
  els.catBusiness.checked = Boolean(bark.categories && bark.categories.business);
}

function refreshPanels() {
  renderSessionList();
  renderSession();
  renderStatus();
  renderBestCrop();
  renderQr();
  renderUiSettings();
  renderFriendList();
  renderLogs();
  renderLogsStatus();
}

function appendLog(accountId, entry) {
  const session = ensureSession(accountId);
  const log = {
    seq: entry.seq || 0,
    ts: entry.ts || Date.now(),
    level: entry.level || 'info',
    tag: entry.tag || '',
    action: entry.action || '',
    text: entry.text || entry.message || JSON.stringify(entry),
    message: entry.message || '',
    accountId,
  };
  session.logs.push(log);
  if (session.logs.length > MAX_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
  }
}

function matchLogFilter(accountId, item, filters) {
  if (!item) return false;
  if (filters.accountId !== 'all' && filters.accountId !== accountId) return false;
  if (filters.level !== 'all' && item.level !== filters.level) return false;
  if (filters.tag && item.tag !== filters.tag) return false;
  if (filters.action && item.action !== filters.action) return false;
  if (filters.keyword) {
    const haystack = `${item.tag || ''} ${item.message || ''} ${item.text || ''}`.toLowerCase();
    if (!haystack.includes(filters.keyword.toLowerCase())) return false;
  }
  return true;
}

function mergeFetchedLogs(items, append) {
  const existing = append ? [...state.logView.items] : [];
  const merged = append ? [...existing, ...items] : [...items];
  const uniq = [];
  const seen = new Set();
  for (const item of merged) {
    const key = `${item.accountId || ''}:${item.seq || ''}:${item.ts || ''}:${item.text || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(item);
  }
  uniq.sort((a, b) => {
    const ta = Number(a.ts || 0);
    const tb = Number(b.ts || 0);
    if (ta !== tb) return tb - ta;
    return Number(b.seq || 0) - Number(a.seq || 0);
  });
  state.logView.items = uniq.slice(0, MAX_LOG_LINES);
}

async function queryLogsFromApi({ append = false } = {}) {
  if (state.logView.loading) return;
  state.logView.loading = true;
  renderLogsStatus();
  try {
    const filters = getActiveLogFilters();
    const qs = new URLSearchParams();
    qs.set('accountId', filters.accountId);
    qs.set('level', filters.level);
    qs.set('tag', filters.tag);
    qs.set('keyword', filters.keyword);
    qs.set('action', filters.action);
    qs.set('limit', String(filters.limit));
    if (append && state.logView.cursor) {
      qs.set('beforeTs', String(state.logView.cursor.beforeTs));
      qs.set('beforeSeq', String(state.logView.cursor.beforeSeq));
    }
    const ret = await fetchJson(`/api/logs/query?${qs.toString()}`);
    const payload = ret.data || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    mergeFetchedLogs(items, append);
    state.logView.cursor = payload.nextCursor || null;
    state.logView.hasLoaded = true;
    renderLogs();
    renderLogsStatus();
  } catch (e) {
    setText(els.logsStatus, `日志查询失败：${e.message}`);
  } finally {
    state.logView.loading = false;
    renderLogsStatus();
  }
}

function resetLogView() {
  state.logView.items = [];
  state.logView.cursor = null;
  state.logView.hasLoaded = false;
}

function collectStartPayload() {
  const accountId = normalizeAccountId(els.accountId.value);
  const mode = els.mode.value;
  if (mode === 'verify') return { accountId, mode };
  if (mode === 'decode') {
    return {
      accountId,
      mode,
      decodeData: els.decodeData.value.trim(),
      decodeHex: els.decodeHex.checked,
      decodeGate: els.decodeGate.checked,
      decodeType: els.decodeType.value.trim(),
    };
  }
  return {
    accountId,
    mode: 'run',
    platform: els.platform.value,
    code: els.code.value.trim(),
    useQr: els.useQr.checked,
    interval: els.interval.value.trim(),
    friendInterval: els.friendInterval.value.trim(),
  };
}

function collectBarkPayload() {
  return {
    enabled: els.barkEnabled.checked,
    pushUrl: els.barkPushUrl.value.trim(),
    group: els.barkGroup.value.trim(),
    dedupSeconds: Number.parseInt(els.barkDedupSeconds.value, 10),
    categories: {
      fatal: els.catFatal.checked,
      network: els.catNetwork.checked,
      business: els.catBusiness.checked,
    },
  };
}

async function fetchJson(url, options = {}) {
  const { skipAuthGuard = false, ...fetchOptions } = options;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...fetchOptions,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !skipAuthGuard) {
      applyAuthState({
        enabled: true,
        authenticated: false,
        username: '',
      });
    }
    const msg = data.error || (data.errors && data.errors.join('; ')) || `请求失败(${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function loadAuthStatus() {
  const ret = await fetchJson('/api/auth/status', { skipAuthGuard: true });
  applyAuthState(ret.auth || { enabled: false, authenticated: true, username: '' });
  return state.auth;
}

async function onLogin() {
  try {
    els.loginBtn.disabled = true;
    const username = String(els.authUsername.value || '').trim();
    const password = String(els.authPassword.value || '');
    const ret = await fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuthGuard: true,
    });
    applyAuthState(ret.auth || { enabled: true, authenticated: false, username: '' });
    if (state.auth.authenticated) {
      window.location.reload();
      return;
    }
    setText(els.authStatus, '登录失败');
  } catch (e) {
    setText(els.authStatus, `登录失败：${e.message}`);
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function onLogout() {
  try {
    await fetchJson('/api/auth/logout', {
      method: 'POST',
      body: '{}',
      skipAuthGuard: true,
    });
  } catch (e) {
  }
  window.location.reload();
}

async function bootstrap() {
  const initial = await fetchJson('/api/state');
  const sessions = (initial.state && initial.state.sessions) || {};
  state.sessions = sessions;

  const ids = Object.keys(state.sessions);
  if (ids.length === 0) {
    ensureSession('default');
  }

  const running = Object.keys(state.sessions).find((id) => {
    const s = state.sessions[id].session || {};
    return ['starting', 'running', 'stopping'].includes(s.status);
  });
  state.selectedAccountId = running || Object.keys(state.sessions)[0] || 'default';
  els.accountId.value = state.selectedAccountId;

  state.bark = initial.settings && initial.settings.bark ? initial.settings.bark : null;
  state.ui = initial.settings && initial.settings.ui
    ? initial.settings.ui
    : state.ui;
  renderBarkSettings();
  renderUiSettings();
  refreshPanels();
  resetLogView();
  await queryLogsFromApi({ append: false });
  await loadFriends();

  setText(els.serverMeta, `服务监听：${initial.meta.host}:${initial.meta.port}`);
}

function connectEvents() {
  if (eventStream) return;
  const es = new EventSource('/api/events');
  eventStream = es;
  es.onmessage = (event) => {
    if (!event.data) return;
    try {
      const frame = JSON.parse(event.data);
      const type = frame.type;
      const payload = frame.payload || {};
      const accountId = normalizeAccountId(frame.accountId || state.selectedAccountId || 'default');

      if (type === 'log') {
        appendLog(accountId, payload);
        const filters = getActiveLogFilters();
        const liveItem = {
          accountId,
          seq: payload.seq || 0,
          ts: payload.ts || Date.now(),
          level: payload.level || 'info',
          tag: payload.tag || '',
          action: payload.action || '',
          text: payload.text || payload.message || '',
          message: payload.message || '',
        };
        if (matchLogFilter(accountId, liveItem, filters)) {
          mergeFetchedLogs([liveItem], true);
          renderLogs();
          renderLogsStatus();
        }
        if (!state.selectedAccountId) {
          state.selectedAccountId = accountId;
          els.accountId.value = accountId;
        }
        renderSessionList();
        return;
      }

      if (type === 'process') {
        const session = ensureSession(accountId);
        session.session = { ...(session.session || {}), ...payload };
        if (!state.selectedAccountId) {
          state.selectedAccountId = accountId;
          els.accountId.value = accountId;
        }
        refreshPanels();
        return;
      }

      if (type === 'status') {
        const session = ensureSession(accountId);
        session.status = { ...(session.status || {}), ...payload };
        renderSessionList();
        if (accountId === state.selectedAccountId) {
          renderStatus();
        }
        return;
      }

      if (type === 'bestCrop') {
        const session = ensureSession(accountId);
        session.bestCrop = payload;
        renderSessionList();
        if (accountId === state.selectedAccountId) {
          renderBestCrop();
        }
        return;
      }

      if (type === 'qr') {
        const session = ensureSession(accountId);
        session.qr = { ...(session.qr || {}), ...payload };
        renderSessionList();
        if (accountId === state.selectedAccountId) {
          renderQr();
        }
        return;
      }

      if (type === 'settings' && payload.scope === 'bark' && payload.bark) {
        state.bark = payload.bark;
        renderBarkSettings();
        return;
      }

      if (type === 'settings' && payload.scope === 'ui' && payload.ui) {
        state.ui = payload.ui;
        renderUiSettings();
        renderFriendList();
        return;
      }

      if (type === 'logsCleared') {
        if (frame.accountId) {
          ensureSession(accountId).logs = [];
        } else {
          for (const id of Object.keys(state.sessions)) {
            state.sessions[id].logs = [];
          }
        }
        resetLogView();
        queryLogsFromApi({ append: false });
        return;
      }
    } catch (e) {
      appendLog(state.selectedAccountId || 'default', { text: `[WebUI] 事件解析失败: ${e.message}` });
      renderLogs();
    }
  };

  es.onerror = async () => {
    if (eventStream === es) {
      eventStream = null;
    }
    es.close();
    try {
      const auth = await loadAuthStatus();
      if (!auth.enabled || auth.authenticated) {
        setTimeout(connectEvents, 1500);
      }
    } catch (e) {
      setTimeout(connectEvents, 1500);
    }
  };
}

async function onStart() {
  try {
    els.startBtn.disabled = true;
    const payload = collectStartPayload();
    state.selectedAccountId = payload.accountId;
    ensureSession(payload.accountId);
    els.accountId.value = payload.accountId;
    await fetchJson('/api/session/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setText(els.sessionStatus, `当前账号：${payload.accountId} | 状态：starting`);
    renderSessionList();
    resetLogView();
    await queryLogsFromApi({ append: false });
  } catch (e) {
    appendLog(state.selectedAccountId || 'default', { text: `[WebUI] 启动失败: ${e.message}` });
    renderLogs();
  } finally {
    els.startBtn.disabled = false;
  }
}

async function stopByAccount(accountId) {
  await fetchJson('/api/session/stop', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

async function onStop() {
  const accountId = normalizeAccountId(els.accountId.value || state.selectedAccountId);
  try {
    await stopByAccount(accountId);
  } catch (e) {
    appendLog(accountId, { text: `[WebUI] 停止失败: ${e.message}` });
    renderLogs();
  }
}

async function onClearLogs() {
  try {
    const body = els.logScope.value === 'all'
      ? {}
      : { accountId: normalizeAccountId(state.selectedAccountId) };

    await fetchJson('/api/logs/clear', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    resetLogView();
    await queryLogsFromApi({ append: false });
  } catch (e) {
    appendLog(state.selectedAccountId || 'default', { text: `[WebUI] 清空日志失败: ${e.message}` });
    renderLogs();
  }
}

async function loadFriends() {
  const accountId = normalizeAccountId(state.selectedAccountId);
  try {
    els.refreshFriendsBtn.disabled = true;
    const ret = await fetchJson(`/api/friends?accountId=${encodeURIComponent(accountId)}`);
    state.friends[accountId] = Array.isArray(ret.data) ? ret.data : [];
    renderFriendList();
    setText(els.friendUiStatus, `已加载 ${state.friends[accountId].length} 位好友`);
  } catch (e) {
    setText(els.friendUiStatus, `加载好友失败：${e.message}`);
    renderFriendList();
  } finally {
    els.refreshFriendsBtn.disabled = false;
  }
}

async function runFriendAction(gid, action) {
  const accountId = normalizeAccountId(state.selectedAccountId);
  const allowBadOps = Boolean(state.ui && state.ui.friendOps && state.ui.friendOps.allowBadOps);
  if (FRIEND_DANGEROUS_ACTIONS.has(action) && !allowBadOps) {
    setText(els.friendUiStatus, '当前已禁用高风险操作');
    return;
  }
  const needConfirm = Boolean(state.ui && state.ui.friendOps && state.ui.friendOps.confirmDangerous);
  if (needConfirm && FRIEND_DANGEROUS_ACTIONS.has(action)) {
    const ok = window.confirm(`确认对 GID:${gid} 执行 ${action} 吗？`);
    if (!ok) return;
  }

  try {
    setText(els.friendUiStatus, `执行中：${action} @ ${gid} ...`);
    const ret = await fetchJson('/api/friends/op', {
      method: 'POST',
      body: JSON.stringify({ accountId, gid, action }),
    });
    const data = ret.data || {};
    const summary = data.message || '完成';
    setText(els.friendUiStatus, `执行成功：${summary}`);
    await loadFriends();
  } catch (e) {
    setText(els.friendUiStatus, `执行失败：${e.message}`);
  }
}

async function onSaveFriendUi() {
  try {
    const payload = {
      friendOps: {
        allowBadOps: els.allowBadOps.checked,
        confirmDangerous: els.confirmDangerous.checked,
      },
    };
    const ret = await fetchJson('/api/settings/ui', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    state.ui = ret.ui || state.ui;
    renderUiSettings();
    renderFriendList();
    setText(els.friendUiStatus, '好友设置已保存');
  } catch (e) {
    setText(els.friendUiStatus, `保存失败：${e.message}`);
  }
}

async function onSaveBark() {
  try {
    const bark = collectBarkPayload();
    const ret = await fetchJson('/api/settings/bark', {
      method: 'PUT',
      body: JSON.stringify(bark),
    });
    state.bark = ret.bark;
    renderBarkSettings();
    setText(els.barkStatus, 'Bark 设置已保存并立即生效');
  } catch (e) {
    setText(els.barkStatus, `保存失败：${e.message}`);
  }
}

async function onTestBark() {
  try {
    const ret = await fetchJson('/api/settings/bark/test', {
      method: 'POST',
      body: JSON.stringify({
        title: 'QQ农场 Bark 测试',
        message: '这是一条测试通知',
      }),
    });
    setText(els.barkStatus, ret.sent ? '测试推送已发送' : '测试请求完成（未发送，可能被设置过滤）');
  } catch (e) {
    setText(els.barkStatus, `测试失败：${e.message}`);
  }
}

function onSessionListClick(event) {
  const btn = event.target.closest('button[data-action][data-account-id]');
  if (!btn) return;

  const action = btn.dataset.action;
  const accountId = normalizeAccountId(btn.dataset.accountId);
  if (action === 'select') {
    state.selectedAccountId = accountId;
    els.accountId.value = accountId;
    refreshPanels();
    resetLogView();
    queryLogsFromApi({ append: false });
    loadFriends();
    return;
  }

  if (action === 'stop') {
    stopByAccount(accountId).catch((e) => {
      appendLog(accountId, { text: `[WebUI] 停止失败: ${e.message}` });
      renderLogs();
    });
  }
}

async function onApplyLogFilters() {
  resetLogView();
  await queryLogsFromApi({ append: false });
}

async function onLoadMoreLogs() {
  if (!state.logView.cursor) {
    setText(els.logsStatus, '已到最早日志');
    return;
  }
  await queryLogsFromApi({ append: true });
}

function onFriendListClick(event) {
  const btn = event.target.closest('button[data-friend-action][data-gid]');
  if (!btn) return;
  const action = String(btn.dataset.friendAction || '');
  const gid = String(btn.dataset.gid || '');
  if (!action || !gid) return;
  runFriendAction(gid, action);
}

function bindEvents() {
  els.mode.addEventListener('change', applyModeVisibility);
  els.loginBtn.addEventListener('click', onLogin);
  els.logoutBtn.addEventListener('click', onLogout);
  els.authPassword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onLogin();
    }
  });
  els.startBtn.addEventListener('click', onStart);
  els.stopBtn.addEventListener('click', onStop);
  els.clearLogsBtn.addEventListener('click', onClearLogs);
  els.saveBarkBtn.addEventListener('click', onSaveBark);
  els.testBarkBtn.addEventListener('click', onTestBark);
  els.saveFriendUiBtn.addEventListener('click', onSaveFriendUi);
  els.refreshFriendsBtn.addEventListener('click', loadFriends);
  els.applyLogFiltersBtn.addEventListener('click', onApplyLogFilters);
  els.loadMoreLogsBtn.addEventListener('click', onLoadMoreLogs);
  els.friendList.addEventListener('click', onFriendListClick);
  els.logLevel.addEventListener('change', onApplyLogFilters);
  els.logAction.addEventListener('change', onApplyLogFilters);
  els.accountId.addEventListener('change', () => {
    const next = normalizeAccountId(els.accountId.value);
    state.selectedAccountId = next;
    ensureSession(next);
    refreshPanels();
    resetLogView();
    queryLogsFromApi({ append: false });
    loadFriends();
  });
  els.logScope.addEventListener('change', () => {
    resetLogView();
    queryLogsFromApi({ append: false });
  });
  els.logTag.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onApplyLogFilters();
    }
  });
  els.logKeyword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onApplyLogFilters();
    }
  });
  els.sessionList.addEventListener('click', onSessionListClick);
}

async function main() {
  applyModeVisibility();
  bindEvents();
  const auth = await loadAuthStatus();
  if (auth.enabled && !auth.authenticated) {
    return;
  }
  await bootstrap();
  connectEvents();
}

main().catch((err) => {
  appendLog(state.selectedAccountId || 'default', { text: `[WebUI] 初始化失败: ${err.message}` });
  renderLogs();
});
