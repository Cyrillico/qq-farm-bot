const MAX_LOG_LINES = 5000;

const state = {
  sessions: {},
  selectedAccountId: 'default',
  bark: null,
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

function renderLogs() {
  const scope = els.logScope.value;
  let lines = [];

  if (scope === 'all') {
    const merged = [];
    for (const accountId of Object.keys(state.sessions)) {
      const logs = state.sessions[accountId].logs || [];
      for (const item of logs) {
        merged.push({
          ts: item.ts || 0,
          accountId,
          text: item.text || item.message || '',
        });
      }
    }
    merged.sort((a, b) => a.ts - b.ts);
    lines = merged.slice(-MAX_LOG_LINES).map((item) => `[${item.accountId}] ${item.text}`);
  } else {
    const current = getCurrentSession();
    lines = (current.logs || []).slice(-MAX_LOG_LINES).map((item) => item.text || item.message || '');
  }

  els.logs.textContent = lines.join('\n');
  els.logs.scrollTop = els.logs.scrollHeight;
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
  renderLogs();
}

function appendLog(accountId, entry) {
  const session = ensureSession(accountId);
  const log = {
    ts: entry.ts || Date.now(),
    text: entry.text || entry.message || JSON.stringify(entry),
    message: entry.message || '',
  };
  session.logs.push(log);
  if (session.logs.length > MAX_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
  }
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
  renderBarkSettings();
  refreshPanels();

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
        if (!state.selectedAccountId) {
          state.selectedAccountId = accountId;
          els.accountId.value = accountId;
        }
        renderSessionList();
        renderLogs();
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

      if (type === 'logsCleared') {
        if (frame.accountId) {
          ensureSession(accountId).logs = [];
        } else {
          for (const id of Object.keys(state.sessions)) {
            state.sessions[id].logs = [];
          }
        }
        renderLogs();
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
  } catch (e) {
    appendLog(state.selectedAccountId || 'default', { text: `[WebUI] 清空日志失败: ${e.message}` });
    renderLogs();
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
    return;
  }

  if (action === 'stop') {
    stopByAccount(accountId).catch((e) => {
      appendLog(accountId, { text: `[WebUI] 停止失败: ${e.message}` });
      renderLogs();
    });
  }
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
  els.accountId.addEventListener('change', () => {
    const next = normalizeAccountId(els.accountId.value);
    state.selectedAccountId = next;
    ensureSession(next);
    refreshPanels();
  });
  els.logScope.addEventListener('change', renderLogs);
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
