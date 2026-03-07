const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const { createStateStore } = require('./state-store');
const { SessionManager, normalizeAccountId } = require('./session-manager');
const {
    DEFAULT_SETTINGS_PATH,
    loadSettings,
    saveSettings,
    validateBarkSettings,
    validateUiSettings,
    validateAccountFeatureSettings,
    validateQrLoginSettings,
    getAccountFeatureSettings,
    getPersistedAccounts,
    mergeSettings,
} = require('./settings-store');
const {
    AUTH_COOKIE_NAME,
    AUTH_CSRF_HEADER_NAME,
    AUTH_MAX_AGE_MS,
    buildAuthConfig,
    isAuthEnabled,
    signSessionToken,
    verifySessionToken,
    parseCookieHeader,
    verifyCredentials,
    buildCsrfToken,
    verifyCsrfToken,
    buildAuthCookie,
    buildClearAuthCookie,
} = require('./auth');
const {
    createLoginRateLimiter,
    parseIpWhitelist,
    isIpAllowed,
    normalizeIp,
    maskBarkSettings,
} = require('./security');
const { updateRuntimeBarkSettings, updateRuntimeQrLoginSettings } = require('../src/runtimeSettings');
const { getPlantRankings } = require('../src/analytics');
const { getSeedOptions } = require('../src/seedsCatalog');
const { pushBarkDetailed } = require('../src/bark');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_STATS_PATH = path.join(__dirname, '..', '.qq-farm-ui-stats.json');
const SESSION_LIFECYCLE_STATUSES = new Set([
    'idle',
    'starting',
    'running',
    'stopping',
    'stopped',
    'error',
]);

function normalizeSessionLifecycleStatus(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!SESSION_LIFECYCLE_STATUSES.has(text)) return '';
    return text;
}

function isSafeMethod(method) {
    const m = String(method || '').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function getClientIp(req) {
    const xff = String(req.headers['x-forwarded-for'] || '').trim();
    if (xff) {
        const first = xff.split(',')[0].trim();
        if (first) return normalizeIp(first);
    }
    return normalizeIp((req.socket && req.socket.remoteAddress) || '');
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 2 * 1024 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(new Error('invalid json body'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, code, data, extraHeaders = {}) {
    const body = JSON.stringify(data);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
    res.writeHead(code, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
    });
    res.end(text);
}

function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
}

function parseBoundedInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.js') return 'text/javascript; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
    if (ext === '.json') return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

function normalizePublicPath(urlPath) {
    const rawPath = urlPath && urlPath !== '/' ? urlPath : '/index.html';
    let decoded = rawPath;
    try {
        decoded = decodeURIComponent(rawPath);
    } catch (e) {
        return null;
    }

    const normalized = path.posix.normalize(decoded);
    const relativePath = normalized.replace(/^\/+/, '') || 'index.html';
    const segments = relativePath.split('/');
    if (segments.includes('..')) {
        return null;
    }
    return relativePath;
}

function generateQrSvg(text) {
    const qr = new QRCode(-1, QRErrorCorrectLevel.M);
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const modules = qr.modules;
    const scale = 6;
    const border = 2;
    const size = (count + border * 2) * scale;

    const rects = [];
    for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
            if (!modules[y][x]) continue;
            rects.push(
                `<rect x="${(x + border) * scale}" y="${(y + border) * scale}" width="${scale}" height="${scale}"/>`
            );
        }
    }

    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
        `<rect width="100%" height="100%" fill="#ffffff"/>`,
        `<g fill="#111111">`,
        rects.join(''),
        `</g>`,
        `</svg>`,
    ].join('');
}

function startServer(options = {}) {
    const host = options.host || process.env.WEB_UI_HOST || '0.0.0.0';
    const rawPort = options.port ?? process.env.WEB_UI_PORT ?? '3210';
    const port = Number.parseInt(rawPort, 10);
    const settingsPath = options.settingsPath || DEFAULT_SETTINGS_PATH;
    const statsPath = options.statsPath || process.env.QQ_FARM_UI_STATS_PATH || DEFAULT_STATS_PATH;
    const authConfig = buildAuthConfig(options.env || process.env);
    const env = options.env || process.env;
    const ipWhitelistRules = parseIpWhitelist(env.WEB_UI_ALLOW_IPS || '');
    const loginRateLimiter = createLoginRateLimiter({
        maxAttempts: env.WEB_UI_LOGIN_RATE_LIMIT_MAX,
        windowMs: env.WEB_UI_LOGIN_RATE_LIMIT_WINDOW_MS,
    });
    const stateStore = createStateStore({ maxLogs: 5000 });
    const sessionManager = typeof options.createSessionManager === 'function'
        ? options.createSessionManager()
        : new SessionManager({ rootDir: path.join(__dirname, '..') });
    let settings = loadSettings(settingsPath);
    if (!fs.existsSync(settingsPath)) {
        settings = saveSettings(settingsPath, settings);
    }
    updateRuntimeBarkSettings(settings.bark);
    updateRuntimeQrLoginSettings(settings.qrLogin);
    let statsPersistTimer = null;

    function loadPersistedStats() {
        try {
            if (!statsPath || !fs.existsSync(statsPath)) {
                return { ok: true, loaded: false, restored: 0, reason: 'not_found' };
            }
            const raw = fs.readFileSync(statsPath, 'utf8');
            const parsed = JSON.parse(raw);
            const ret = stateStore.importStatsState(parsed);
            return {
                ok: true,
                loaded: true,
                restored: ret && ret.restored ? ret.restored : 0,
                reason: '',
            };
        } catch (e) {
            return {
                ok: false,
                loaded: false,
                restored: 0,
                reason: e && e.message ? e.message : String(e),
            };
        }
    }

    function savePersistedStatsNow() {
        if (!statsPath) return;
        fs.mkdirSync(path.dirname(statsPath), { recursive: true });
        const payload = stateStore.exportStatsState();
        fs.writeFileSync(statsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }

    function scheduleStatsPersist() {
        if (!statsPath) return;
        if (statsPersistTimer) clearTimeout(statsPersistTimer);
        statsPersistTimer = setTimeout(() => {
            statsPersistTimer = null;
            try {
                savePersistedStatsNow();
            } catch (e) {
                // 持久化失败不影响主流程
            }
        }, 800);
    }

    const persistedStatsRet = loadPersistedStats();

    const sseClients = new Set();

    function getPersistedAccountsSnapshot() {
        return getPersistedAccounts(settings);
    }

    function publishPersistedAccounts() {
        publish('settings', { scope: 'accounts', accounts: getPersistedAccountsSnapshot() });
    }

    function persistRunAccount(accountId, payload = {}, options = {}) {
        const id = normalizeAccountId(accountId);
        if (!id) return null;
        const currentAccounts = getPersistedAccountsSnapshot();
        const current = currentAccounts[id] || null;
        const next = {
            ...(current || {}),
            mode: 'run',
            platform: payload.platform,
            code: payload.code,
            useQr: payload.useQr,
            interval: payload.interval,
            friendInterval: payload.friendInterval,
            autoStart: Object.prototype.hasOwnProperty.call(options, 'autoStart')
                ? Boolean(options.autoStart)
                : (current ? Boolean(current.autoStart) : true),
        };
        settings = saveSettings(settingsPath, mergeSettings(settings, {
            accounts: {
                [id]: next,
            },
        }));
        return getPersistedAccountsSnapshot()[id] || null;
    }

    function updatePersistedAccountAutoStart(accountId, autoStart) {
        const id = normalizeAccountId(accountId);
        if (!id) return null;
        const currentAccounts = getPersistedAccountsSnapshot();
        if (!currentAccounts[id]) return null;
        settings = saveSettings(settingsPath, mergeSettings(settings, {
            accounts: {
                [id]: {
                    ...currentAccounts[id],
                    autoStart: Boolean(autoStart),
                },
            },
        }));
        return getPersistedAccountsSnapshot()[id] || null;
    }

    function deletePersistedAccount(accountId) {
        const id = normalizeAccountId(accountId);
        if (!id) return false;
        const currentAccounts = getPersistedAccountsSnapshot();
        const nextAccounts = { ...currentAccounts };
        const hadAccount = Boolean(nextAccounts[id]);
        delete nextAccounts[id];

        const nextAccountFeatures = { ...((settings && settings.accountFeatures) || {}) };
        delete nextAccountFeatures[id];

        settings = saveSettings(settingsPath, {
            ...settings,
            accounts: nextAccounts,
            accountFeatures: nextAccountFeatures,
        });
        return hadAccount;
    }

    function restorePersistedAccounts() {
        const persistedAccounts = getPersistedAccountsSnapshot();
        for (const accountId of Object.keys(persistedAccounts)) {
            stateStore.ensureAccount(accountId);
        }
        for (const [accountId, payload] of Object.entries(persistedAccounts)) {
            if (!payload || !payload.autoStart) continue;
            try {
                sessionManager.start(accountId, {
                    accountId,
                    mode: 'run',
                    platform: payload.platform,
                    code: payload.code,
                    useQr: payload.useQr,
                    interval: payload.interval,
                    friendInterval: payload.friendInterval,
                });
            } catch (e) {
                stateStore.setSession(accountId, {
                    status: 'error',
                    pid: null,
                    stoppedAt: Date.now(),
                    lastError: e && e.message ? e.message : String(e),
                });
            }
        }
    }

    function publish(type, payload, accountId) {
        const frame = {
            type,
            ts: Date.now(),
            payload: payload || {},
        };
        if (accountId) {
            frame.accountId = accountId;
        }
        const line = `data: ${JSON.stringify(frame)}\n\n`;
        for (const client of sseClients) {
            try {
                client.write(line);
            } catch (e) {
                sseClients.delete(client);
            }
        }
    }

    function appendLog(accountId, log) {
        const entry = stateStore.addLog(accountId, log);
        publish('log', entry, accountId);
        publishStats(accountId);
    }

    function publishStats(accountId) {
        try {
            const snapshot = stateStore.getStatsSnapshot();
            const payload = {
                summary: snapshot.summary,
                ts: snapshot.ts,
            };
            if (accountId) {
                payload.accountStats = snapshot.accounts[accountId] || null;
            } else {
                payload.accounts = snapshot.accounts;
            }
            publish('stats', payload, accountId || undefined);
            scheduleStatsPersist();
        } catch (e) {
            // stats 计算失败不影响主流程
        }
    }

    sessionManager.on('spawn', ({ accountId, pid, mode, args }) => {
        stateStore.setSession(accountId, {
            status: 'starting',
            mode,
            pid,
            startedAt: Date.now(),
            stoppedAt: 0,
            lastError: '',
        });
        publish('process', stateStore.getAccountSnapshot(accountId).session, accountId);
        publishStats(accountId);
        sessionManager.applyBarkSettings(accountId, settings.bark);
        sessionManager.applyQrLoginSettings(accountId, settings.qrLogin);
        sessionManager.applyAccountSettings(accountId, getAccountFeatureSettings(settings, accountId));
        appendLog(accountId, {
            level: 'info',
            tag: 'WebUI',
            message: `子进程已启动 pid=${pid}`,
            text: `[WebUI] 子进程已启动 pid=${pid} args=${args.join(' ')}`,
            stream: 'server',
            action: '',
        });
    });

    sessionManager.on('line', ({ accountId, stream, text }) => {
        if (!text) return;
        appendLog(accountId, {
            level: stream === 'stderr' ? 'error' : 'info',
            tag: '',
            message: text,
            text,
            stream,
            action: '',
        });
    });

    sessionManager.on('ui-event', ({ accountId, ...frame }) => {
        if (!frame || typeof frame !== 'object') return;
        const { type, payload } = frame;
        if (type === 'status') {
            stateStore.setStatus(accountId, payload || {});
            publish('status', stateStore.getAccountSnapshot(accountId).status, accountId);
            publishStats(accountId);
            return;
        }
        if (type === 'bestCrop') {
            stateStore.setBestCrop(accountId, payload || null);
            publish('bestCrop', stateStore.getAccountSnapshot(accountId).bestCrop, accountId);
            return;
        }
        if (type === 'qr') {
            stateStore.setQr(accountId, payload || {});
            publish('qr', stateStore.getAccountSnapshot(accountId).qr, accountId);
            return;
        }
        if (type === 'process') {
            const p = payload || {};
            const next = {};
            const normalizedState = normalizeSessionLifecycleStatus(p.state);
            if (normalizedState) next.status = normalizedState;
            if (typeof p.message === 'string' && normalizedState === 'error') {
                next.lastError = p.message;
            }
            if (Object.keys(next).length === 0) return;
            stateStore.setSession(accountId, next);
            publish('process', stateStore.getAccountSnapshot(accountId).session, accountId);
            publishStats(accountId);
            return;
        }
        if (type === 'log') {
            const p = payload || {};
            appendLog(accountId, {
                level: p.level || 'info',
                tag: p.tag || '',
                message: p.message || '',
                text: p.text || p.message || '',
                category: p.category || '',
                action: p.action || '',
                stream: 'ui',
            });
            return;
        }
        if (type === 'bark') {
            const p = payload || {};
            stateStore.recordMetricEvent(accountId, {
                type: 'bark',
                sent: Boolean(p.sent),
                reason: p.reason || '',
                category: p.category || '',
            }, {
                now: Number.isFinite(Number(p.ts)) ? Number(p.ts) : Date.now(),
            });
            publish('bark', p, accountId);
            publishStats(accountId);
            return;
        }
        publish(type, payload || {}, accountId);
    });

    sessionManager.on('exit', ({ accountId, code, signal, stopRequested }) => {
        const isError = !stopRequested && code !== 0;
        stateStore.setSession(accountId, {
            status: isError ? 'error' : 'stopped',
            pid: null,
            stoppedAt: Date.now(),
            lastError: isError ? `exit code=${code} signal=${signal}` : '',
        });
        publish('process', stateStore.getAccountSnapshot(accountId).session, accountId);
        publishStats(accountId);
        appendLog(accountId, {
            level: isError ? 'error' : 'info',
            tag: 'WebUI',
            message: isError ? '子进程异常退出' : '子进程已停止',
            text: `[WebUI] 子进程退出 code=${code} signal=${signal}`,
            stream: 'server',
            action: '',
        });
    });

    restorePersistedAccounts();

    function isSecureRequest(req) {
        if (req.socket && req.socket.encrypted) return true;
        const xfp = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
        return xfp.includes('https');
    }

    function getAuthState(req) {
        if (!isAuthEnabled(authConfig)) {
            return {
                enabled: false,
                authenticated: true,
                username: '',
                csrfToken: '',
            };
        }

        const cookies = parseCookieHeader(req.headers.cookie || '');
        const token = cookies[AUTH_COOKIE_NAME] || '';
        const verified = verifySessionToken(token, authConfig.secret, Date.now(), AUTH_MAX_AGE_MS);
        if (!verified.ok) {
            return {
                enabled: true,
                authenticated: false,
                username: '',
                csrfToken: '',
            };
        }
        if (authConfig.username && verified.username !== authConfig.username) {
            return {
                enabled: true,
                authenticated: false,
                username: '',
                csrfToken: '',
            };
        }
        const csrfToken = buildCsrfToken(token, authConfig.secret);
        return {
            enabled: true,
            authenticated: true,
            username: verified.username,
            csrfToken,
        };
    }

    function ensureAuthed(req, res) {
        const auth = getAuthState(req);
        if (!auth.enabled || auth.authenticated) {
            return auth;
        }
        sendJson(res, 401, { ok: false, error: 'unauthorized', auth });
        return null;
    }

    function ensureIpAllowed(req, res, pathname) {
        if (!ipWhitelistRules.length) return true;
        const clientIp = getClientIp(req);
        if (isIpAllowed(clientIp, ipWhitelistRules)) return true;
        if (String(pathname || '').startsWith('/api/')) {
            sendJson(res, 403, { ok: false, error: 'ip_not_allowed' });
            return false;
        }
        sendText(res, 403, 'Forbidden');
        return false;
    }

    function ensureCsrf(req, res, authState) {
        if (isSafeMethod(req.method)) return true;
        const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
        if (pathname === '/api/auth/login') return true;
        if (!String(pathname).startsWith('/api/')) return true;

        const auth = authState || getAuthState(req);
        if (!auth || !auth.enabled || !auth.authenticated) {
            return true;
        }

        const cookies = parseCookieHeader(req.headers.cookie || '');
        const authToken = cookies[AUTH_COOKIE_NAME] || '';
        const headerToken = String(req.headers[AUTH_CSRF_HEADER_NAME] || '').trim();
        const verified = verifyCsrfToken(headerToken, authToken, authConfig.secret);
        if (verified.ok) return true;
        sendJson(res, 403, { ok: false, error: 'csrf_invalid' });
        return false;
    }

    const server = http.createServer(async (req, res) => {
        setSecurityHeaders(res);
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = reqUrl.pathname;
        if (!ensureIpAllowed(req, res, pathname)) return;

        if (req.method === 'GET' && pathname === '/api/auth/status') {
            const auth = getAuthState(req);
            return sendJson(res, 200, { ok: true, auth });
        }

        if (req.method === 'POST' && pathname === '/api/auth/login') {
            try {
                const clientIp = getClientIp(req) || 'unknown';
                const rateCheck = loginRateLimiter.check(clientIp);
                if (!rateCheck.allowed) {
                    const retryAfterSec = Math.max(1, Math.ceil(rateCheck.retryAfterMs / 1000));
                    return sendJson(res, 429, {
                        ok: false,
                        error: `登录尝试过于频繁，请 ${retryAfterSec}s 后重试`,
                    }, {
                        'Retry-After': String(retryAfterSec),
                    });
                }
                const body = await readJsonBody(req);
                if (!isAuthEnabled(authConfig)) {
                    return sendJson(res, 200, {
                        ok: true,
                        auth: { enabled: false, authenticated: true, username: '', csrfToken: '' },
                    });
                }
                const username = String(body.username || '').trim();
                const password = String(body.password || '');
                if (!verifyCredentials(authConfig, username, password)) {
                    loginRateLimiter.recordFailure(clientIp);
                    return sendJson(res, 401, {
                        ok: false,
                        error: '账号或密码错误',
                        auth: { enabled: true, authenticated: false, username: '', csrfToken: '' },
                    });
                }

                const token = signSessionToken(authConfig.username, authConfig.secret, Date.now());
                loginRateLimiter.reset(clientIp);
                const setCookie = buildAuthCookie(token, isSecureRequest(req));
                const auth = {
                    enabled: true,
                    authenticated: true,
                    username: authConfig.username,
                    csrfToken: buildCsrfToken(token, authConfig.secret),
                };
                return sendJson(
                    res,
                    200,
                    {
                        ok: true,
                        auth,
                    },
                    { 'Set-Cookie': setCookie }
                );
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/auth/logout') {
            const auth = getAuthState(req);
            if (auth.enabled && auth.authenticated && !ensureCsrf(req, res, auth)) {
                return;
            }
            const clearCookie = buildClearAuthCookie(isSecureRequest(req));
            return sendJson(
                res,
                200,
                {
                    ok: true,
                    auth: { enabled: isAuthEnabled(authConfig), authenticated: false, username: '', csrfToken: '' },
                },
                { 'Set-Cookie': clearCookie }
            );
        }

        if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
            const auth = ensureAuthed(req, res);
            if (!auth) return;
            if (!ensureCsrf(req, res, auth)) return;
        }

        if (req.method === 'GET' && pathname === '/api/state') {
            return sendJson(res, 200, {
                state: stateStore.getSnapshot(),
                stats: stateStore.getStatsSnapshot(),
                settings: {
                    bark: maskBarkSettings(settings.bark),
                    ui: settings.ui,
                    accounts: getPersistedAccountsSnapshot(),
                    qrLogin: settings.qrLogin,
                },
                meta: { host, port },
                persistedStats: persistedStatsRet,
            });
        }

        if (req.method === 'GET' && pathname === '/api/stats') {
            try {
                const rawAccountId = String(reqUrl.searchParams.get('accountId') || 'all').trim() || 'all';
                const accountId = rawAccountId === 'all' ? 'all' : normalizeAccountId(rawAccountId);
                const snapshot = stateStore.getStatsSnapshot();
                const data = accountId === 'all'
                    ? snapshot
                    : {
                        ts: snapshot.ts,
                        summary: snapshot.summary,
                        accounts: snapshot.accounts[accountId] ? { [accountId]: snapshot.accounts[accountId] } : {},
                    };
                return sendJson(res, 200, { ok: true, data, accountId });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.write('retry: 1000\n\n');
            sseClients.add(res);
            req.on('close', () => {
                sseClients.delete(res);
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/api/session/start') {
            try {
                const body = await readJsonBody(req);
                const accountId = normalizeAccountId(body.accountId || 'default');
                stateStore.ensureAccount(accountId);
                const started = sessionManager.start(accountId, body || {});
                if (String((body && body.mode) || 'run').trim() === 'run') {
                    persistRunAccount(accountId, body || {}, { autoStart: true });
                    publishPersistedAccounts();
                }
                return sendJson(res, 200, { ok: true, accountId, session: started });
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/session/stop') {
            try {
                const body = await readJsonBody(req);
                const accountId = body.accountId ? normalizeAccountId(body.accountId) : '';
                if (accountId) {
                    const stopped = await sessionManager.stop(accountId);
                    if (updatePersistedAccountAutoStart(accountId, false)) {
                        publishPersistedAccounts();
                    }
                    return sendJson(res, 200, { ok: true, accountId, stopped });
                }
                const result = await sessionManager.stopAll();
                return sendJson(res, 200, { ok: true, ...result });
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/session/delete') {
            try {
                const body = await readJsonBody(req);
                const rawId = String((body && body.accountId) || '').trim();
                if (!rawId) {
                    return sendJson(res, 400, { ok: false, error: 'accountId is required' });
                }
                const accountId = normalizeAccountId(rawId);
                await sessionManager.deleteAccount(accountId);
                const removed = stateStore.deleteAccount(accountId);
                deletePersistedAccount(accountId);
                if (removed) {
                    publish('accountDeleted', { accountId }, accountId);
                    publishStats();
                }
                publishPersistedAccounts();
                return sendJson(res, 200, { ok: true, accountId, removed });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/logs/clear') {
            try {
                const body = await readJsonBody(req);
                const accountId = body.accountId ? normalizeAccountId(body.accountId) : '';
                if (accountId) {
                    stateStore.clearLogs(accountId);
                    publish('logsCleared', {}, accountId);
                    return sendJson(res, 200, { ok: true, accountId });
                }
                stateStore.clearLogs();
                publish('logsCleared', {});
                return sendJson(res, 200, { ok: true });
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/logs/query') {
            try {
                const filters = {
                    accountId: String(reqUrl.searchParams.get('accountId') || 'all').trim() || 'all',
                    level: String(reqUrl.searchParams.get('level') || 'all').trim() || 'all',
                    tag: String(reqUrl.searchParams.get('tag') || '').trim(),
                    keyword: String(reqUrl.searchParams.get('keyword') || '').trim(),
                    action: String(reqUrl.searchParams.get('action') || '').trim(),
                    limit: parseBoundedInt(reqUrl.searchParams.get('limit'), 200, 1, 500),
                    beforeTs: reqUrl.searchParams.get('beforeTs') || '',
                    beforeSeq: reqUrl.searchParams.get('beforeSeq') || '',
                };
                const data = stateStore.queryLogs(filters);
                return sendJson(res, 200, { ok: true, data });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/friends') {
            const rawAccountId = String(reqUrl.searchParams.get('accountId') || '').trim();
            if (!rawAccountId) {
                return sendJson(res, 400, { ok: false, error: 'accountId is required' });
            }
            const accountId = normalizeAccountId(rawAccountId);
            try {
                const data = await sessionManager.listFriends(accountId);
                return sendJson(res, 200, { ok: true, data, accountId });
            } catch (e) {
                if (/session not running|runner rpc unavailable/i.test(String(e.message || ''))) {
                    return sendJson(res, 409, { ok: false, error: e.message });
                }
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/lands') {
            const rawAccountId = String(reqUrl.searchParams.get('accountId') || '').trim();
            if (!rawAccountId) {
                return sendJson(res, 400, { ok: false, error: 'accountId is required' });
            }
            const accountId = normalizeAccountId(rawAccountId);
            try {
                const data = await sessionManager.listLands(accountId);
                return sendJson(res, 200, { ok: true, data, accountId });
            } catch (e) {
                if (/session not running|runner rpc unavailable/i.test(String(e.message || ''))) {
                    return sendJson(res, 409, { ok: false, error: e.message });
                }
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/friends/op') {
            try {
                const body = await readJsonBody(req);
                const rawAccountId = String(body.accountId || '').trim();
                const gid = String(body.gid || '').trim();
                const action = String(body.action || '').trim();
                const allowedActions = new Set(['steal', 'water', 'weed', 'insecticide', 'putBug', 'putWeed', 'bad']);
                if (!rawAccountId || !gid || !action) {
                    return sendJson(res, 400, { ok: false, error: 'accountId/gid/action is required' });
                }
                const accountId = normalizeAccountId(rawAccountId);
                if (!allowedActions.has(action)) {
                    return sendJson(res, 400, { ok: false, error: 'invalid action' });
                }
                const isDangerous = action === 'putBug' || action === 'putWeed' || action === 'bad';
                if (isDangerous && settings.ui && settings.ui.friendOps && settings.ui.friendOps.allowBadOps === false) {
                    return sendJson(res, 400, { ok: false, error: 'dangerous friend ops disabled by settings' });
                }

                const opRet = await sessionManager.runFriendOp(accountId, { gid, action });
                return sendJson(res, 200, {
                    ok: true,
                    data: {
                        accountId,
                        ...(opRet || {}),
                    },
                });
            } catch (e) {
                if (/session not running|runner rpc unavailable/i.test(String(e.message || ''))) {
                    return sendJson(res, 409, { ok: false, error: e.message });
                }
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/bag') {
            const rawAccountId = String(reqUrl.searchParams.get('accountId') || '').trim();
            if (!rawAccountId) {
                return sendJson(res, 400, { ok: false, error: 'accountId is required' });
            }
            const accountId = normalizeAccountId(rawAccountId);
            try {
                const data = await sessionManager.getBag(accountId);
                return sendJson(res, 200, { ok: true, data, accountId });
            } catch (e) {
                if (/session not running|runner rpc unavailable/i.test(String(e.message || ''))) {
                    return sendJson(res, 409, { ok: false, error: e.message });
                }
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/daily-gifts') {
            const rawAccountId = String(reqUrl.searchParams.get('accountId') || '').trim();
            if (!rawAccountId) {
                return sendJson(res, 400, { ok: false, error: 'accountId is required' });
            }
            const accountId = normalizeAccountId(rawAccountId);
            try {
                const data = await sessionManager.getDailyGifts(accountId);
                return sendJson(res, 200, { ok: true, data, accountId });
            } catch (e) {
                if (/session not running|runner rpc unavailable/i.test(String(e.message || ''))) {
                    return sendJson(res, 409, { ok: false, error: e.message });
                }
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/analytics') {
            try {
                const sortBy = String(reqUrl.searchParams.get('sort') || 'exp').trim() || 'exp';
                const data = getPlantRankings(sortBy);
                return sendJson(res, 200, { ok: true, data, sortBy });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/seeds') {
            try {
                return sendJson(res, 200, { ok: true, data: getSeedOptions() });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/daily-gifts/claim') {
            try {
                const body = await readJsonBody(req);
                const rawAccountId = String(body.accountId || '').trim();
                const key = String(body.key || '').trim();
                if (!rawAccountId || !key) {
                    return sendJson(res, 400, { ok: false, error: 'accountId and key are required' });
                }
                const accountId = normalizeAccountId(rawAccountId);
                const data = await sessionManager.claimDailyGift(accountId, { key });
                return sendJson(res, 200, { ok: true, data, accountId });
            } catch (e) {
                if (/session not running|runner rpc unavailable/i.test(String(e.message || ''))) {
                    return sendJson(res, 409, { ok: false, error: e.message });
                }
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/settings/bark') {
            return sendJson(res, 200, { bark: settings.bark });
        }

        if (req.method === 'PUT' && pathname === '/api/settings/bark') {
            try {
                const body = await readJsonBody(req);
                const merged = mergeSettings(settings, { bark: body || {} });
                const check = validateBarkSettings(merged.bark);
                if (!check.ok) {
                    return sendJson(res, 400, { ok: false, errors: check.errors });
                }

                settings = saveSettings(settingsPath, merged);
                updateRuntimeBarkSettings(settings.bark);
                sessionManager.applyBarkSettingsToAll(settings.bark);
                publish('settings', { scope: 'bark', bark: settings.bark });
                return sendJson(res, 200, { ok: true, bark: settings.bark });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/settings/ui') {
            return sendJson(res, 200, { ui: settings.ui });
        }

        if (req.method === 'PUT' && pathname === '/api/settings/ui') {
            try {
                const body = await readJsonBody(req);
                const merged = mergeSettings(settings, { ui: body || {} });
                const check = validateUiSettings(merged.ui);
                if (!check.ok) {
                    return sendJson(res, 400, { ok: false, errors: check.errors });
                }

                settings = saveSettings(settingsPath, merged);
                publish('settings', { scope: 'ui', ui: settings.ui });
                return sendJson(res, 200, { ok: true, ui: settings.ui });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/settings/bark/test') {
            try {
                const body = await readJsonBody(req);
                const title = String(body.title || 'QQ农场 Bark 测试').trim();
                const message = String(body.message || '这是一条来自 Web 控制台的测试通知').trim();
                const result = await pushBarkDetailed(title, message, `test:${Date.now()}:${Math.random()}`, {
                    settings: settings.bark,
                    category: 'fatal',
                    force: true,
                });
                return sendJson(res, 200, {
                    ok: true,
                    sent: Boolean(result && result.sent),
                    reason: result && result.reason ? result.reason : '',
                    detail: result && result.detail ? result.detail : '',
                });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/settings/qr-login') {
            return sendJson(res, 200, { ok: true, qrLogin: settings.qrLogin });
        }

        if (req.method === 'PUT' && pathname === '/api/settings/qr-login') {
            try {
                const body = await readJsonBody(req);
                const merged = mergeSettings(settings, { qrLogin: body || {} });
                const check = validateQrLoginSettings(merged.qrLogin);
                if (!check.ok) {
                    return sendJson(res, 400, { ok: false, errors: check.errors });
                }
                settings = saveSettings(settingsPath, merged);
                updateRuntimeQrLoginSettings(settings.qrLogin);
                sessionManager.applyQrLoginSettingsToAll(settings.qrLogin);
                publish('settings', { scope: 'qrLogin', qrLogin: settings.qrLogin });
                return sendJson(res, 200, { ok: true, qrLogin: settings.qrLogin });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/settings/account') {
            const rawAccountId = String(reqUrl.searchParams.get('accountId') || '').trim();
            if (!rawAccountId) {
                return sendJson(res, 400, { ok: false, error: 'accountId is required' });
            }
            const accountId = normalizeAccountId(rawAccountId);
            const accountSettings = getAccountFeatureSettings(settings, accountId);
            return sendJson(res, 200, { ok: true, accountId, accountSettings });
        }

        if (req.method === 'PUT' && pathname === '/api/settings/account') {
            try {
                const rawAccountId = String(reqUrl.searchParams.get('accountId') || '').trim();
                if (!rawAccountId) {
                    return sendJson(res, 400, { ok: false, error: 'accountId is required' });
                }
                const accountId = normalizeAccountId(rawAccountId);
                const body = await readJsonBody(req);
                const incoming = body && typeof body === 'object' ? body : {};
                const partialCheck = validateAccountFeatureSettings(incoming, { allowPartial: true });
                if (!partialCheck.ok) {
                    return sendJson(res, 400, { ok: false, errors: partialCheck.errors });
                }
                const current = getAccountFeatureSettings(settings, accountId);
                const nextAccountSettings = {
                    ...current,
                    ...incoming,
                };
                const finalCheck = validateAccountFeatureSettings(nextAccountSettings);
                if (!finalCheck.ok) {
                    return sendJson(res, 400, { ok: false, errors: finalCheck.errors });
                }

                settings = saveSettings(settingsPath, mergeSettings(settings, {
                    accountFeatures: {
                        [accountId]: nextAccountSettings,
                    },
                }));
                sessionManager.applyAccountSettings(accountId, nextAccountSettings);
                publish('settings', { scope: 'account', accountId, accountSettings: nextAccountSettings }, accountId);
                return sendJson(res, 200, { ok: true, accountId, accountSettings: nextAccountSettings });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET' && pathname === '/api/qr.svg') {
            const text = String(reqUrl.searchParams.get('text') || '').trim();
            if (!text) return sendJson(res, 400, { ok: false, error: 'text is required' });
            if (text.length > 2048) return sendJson(res, 400, { ok: false, error: 'text too long' });
            try {
                const svg = generateQrSvg(text);
                return sendText(res, 200, svg, 'image/svg+xml; charset=utf-8');
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: e.message });
            }
        }

        if (req.method === 'GET') {
            const safePath = normalizePublicPath(pathname);
            if (!safePath) {
                return sendText(res, 403, 'Forbidden');
            }
            const absPath = path.resolve(PUBLIC_DIR, safePath);
            const publicRoot = path.resolve(PUBLIC_DIR);
            if (absPath !== publicRoot && !absPath.startsWith(`${publicRoot}${path.sep}`)) {
                return sendText(res, 403, 'Forbidden');
            }
            if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
                return sendText(res, 404, 'Not Found');
            }
            const content = fs.readFileSync(absPath);
            res.writeHead(200, {
                'Content-Type': getMimeType(absPath),
                'Content-Length': content.length,
            });
            return res.end(content);
        }

        return sendText(res, 405, 'Method Not Allowed');
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => {
            resolve({
                server,
                host,
                port,
                close: () => new Promise((resolveClose) => {
                    for (const res of sseClients) {
                        try { res.end(); } catch (e) { }
                    }
                    sseClients.clear();
                    if (statsPersistTimer) {
                        clearTimeout(statsPersistTimer);
                        statsPersistTimer = null;
                    }
                    try {
                        savePersistedStatsNow();
                    } catch (e) {
                        // ignore close-time persist errors
                    }
                    server.close(() => resolveClose());
                }),
            });
        });
    });
}

module.exports = {
    startServer,
    generateQrSvg,
};
