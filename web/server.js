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
    mergeSettings,
} = require('./settings-store');
const {
    AUTH_COOKIE_NAME,
    AUTH_MAX_AGE_MS,
    buildAuthConfig,
    isAuthEnabled,
    signSessionToken,
    verifySessionToken,
    parseCookieHeader,
    verifyCredentials,
    buildAuthCookie,
    buildClearAuthCookie,
} = require('./auth');
const { updateRuntimeBarkSettings } = require('../src/runtimeSettings');
const { pushBark } = require('../src/bark');

const PUBLIC_DIR = path.join(__dirname, 'public');

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
    const port = Number.parseInt(options.port || process.env.WEB_UI_PORT || '3210', 10);
    const settingsPath = options.settingsPath || DEFAULT_SETTINGS_PATH;
    const authConfig = buildAuthConfig(options.env || process.env);
    const stateStore = createStateStore({ maxLogs: 5000 });
    const sessionManager = new SessionManager({ rootDir: path.join(__dirname, '..') });
    let settings = loadSettings(settingsPath);
    if (!fs.existsSync(settingsPath)) {
        settings = saveSettings(settingsPath, settings);
    }
    updateRuntimeBarkSettings(settings.bark);

    const sseClients = new Set();

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
        sessionManager.applyBarkSettings(accountId, settings.bark);
        appendLog(accountId, {
            level: 'info',
            tag: 'WebUI',
            message: `子进程已启动 pid=${pid}`,
            text: `[WebUI] 子进程已启动 pid=${pid} args=${args.join(' ')}`,
            stream: 'server',
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
        });
    });

    sessionManager.on('ui-event', ({ accountId, ...frame }) => {
        if (!frame || typeof frame !== 'object') return;
        const { type, payload } = frame;
        if (type === 'status') {
            stateStore.setStatus(accountId, payload || {});
            publish('status', stateStore.getAccountSnapshot(accountId).status, accountId);
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
            if (p.state) next.status = p.state;
            if (typeof p.message === 'string') next.lastError = p.message;
            stateStore.setSession(accountId, next);
            publish('process', stateStore.getAccountSnapshot(accountId).session, accountId);
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
                stream: 'ui',
            });
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
        appendLog(accountId, {
            level: isError ? 'error' : 'info',
            tag: 'WebUI',
            message: isError ? '子进程异常退出' : '子进程已停止',
            text: `[WebUI] 子进程退出 code=${code} signal=${signal}`,
            stream: 'server',
        });
    });

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
            };
        }
        if (authConfig.username && verified.username !== authConfig.username) {
            return {
                enabled: true,
                authenticated: false,
                username: '',
            };
        }
        return {
            enabled: true,
            authenticated: true,
            username: verified.username,
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

    const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = reqUrl.pathname;

        if (req.method === 'GET' && pathname === '/api/auth/status') {
            const auth = getAuthState(req);
            return sendJson(res, 200, { ok: true, auth });
        }

        if (req.method === 'POST' && pathname === '/api/auth/login') {
            try {
                const body = await readJsonBody(req);
                if (!isAuthEnabled(authConfig)) {
                    return sendJson(res, 200, {
                        ok: true,
                        auth: { enabled: false, authenticated: true, username: '' },
                    });
                }
                const username = String(body.username || '').trim();
                const password = String(body.password || '');
                if (!verifyCredentials(authConfig, username, password)) {
                    return sendJson(res, 401, {
                        ok: false,
                        error: '账号或密码错误',
                        auth: { enabled: true, authenticated: false, username: '' },
                    });
                }

                const token = signSessionToken(authConfig.username, authConfig.secret, Date.now());
                const setCookie = buildAuthCookie(token, isSecureRequest(req));
                return sendJson(
                    res,
                    200,
                    {
                        ok: true,
                        auth: {
                            enabled: true,
                            authenticated: true,
                            username: authConfig.username,
                        },
                    },
                    { 'Set-Cookie': setCookie }
                );
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: e.message });
            }
        }

        if (req.method === 'POST' && pathname === '/api/auth/logout') {
            const clearCookie = buildClearAuthCookie(isSecureRequest(req));
            return sendJson(
                res,
                200,
                {
                    ok: true,
                    auth: { enabled: isAuthEnabled(authConfig), authenticated: false, username: '' },
                },
                { 'Set-Cookie': clearCookie }
            );
        }

        if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
            const auth = ensureAuthed(req, res);
            if (!auth) return;
        }

        if (req.method === 'GET' && pathname === '/api/state') {
            return sendJson(res, 200, {
                state: stateStore.getSnapshot(),
                settings: { bark: settings.bark },
                meta: { host, port },
            });
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
                    return sendJson(res, 200, { ok: true, accountId, stopped });
                }
                const result = await sessionManager.stopAll();
                return sendJson(res, 200, { ok: true, ...result });
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: e.message });
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

        if (req.method === 'POST' && pathname === '/api/settings/bark/test') {
            try {
                const body = await readJsonBody(req);
                const title = String(body.title || 'QQ农场 Bark 测试').trim();
                const message = String(body.message || '这是一条来自 Web 控制台的测试通知').trim();
                const sent = await pushBark(title, message, `test:${Date.now()}:${Math.random()}`, {
                    settings: settings.bark,
                    category: 'fatal',
                    force: true,
                });
                return sendJson(res, 200, { ok: true, sent });
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
