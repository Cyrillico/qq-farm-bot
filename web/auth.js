const crypto = require('node:crypto');

const AUTH_COOKIE_NAME = 'qq_farm_ui_auth';
const AUTH_MAX_AGE_MS = 24 * 3600 * 1000;

function toBase64Url(input) {
    return Buffer.from(String(input), 'utf8').toString('base64url');
}

function fromBase64Url(input) {
    return Buffer.from(String(input), 'base64url').toString('utf8');
}

function signValue(secret, value) {
    return crypto.createHmac('sha256', String(secret || '')).update(String(value)).digest('base64url');
}

function safeEqual(a, b) {
    const sa = Buffer.from(String(a || ''), 'utf8');
    const sb = Buffer.from(String(b || ''), 'utf8');
    if (sa.length !== sb.length) return false;
    return crypto.timingSafeEqual(sa, sb);
}

function buildAuthConfig(env = process.env) {
    const username = String(env.WEB_UI_AUTH_USERNAME || '').trim();
    const password = String(env.WEB_UI_AUTH_PASSWORD || '');
    const explicitSecret = String(env.WEB_UI_AUTH_SECRET || env.WEB_UI_SESSION_SECRET || '').trim();
    const secret = explicitSecret
        || crypto.createHash('sha256')
            .update(`${username}|${password}|qq-farm-ui-auth`)
            .digest('hex');
    return {
        username,
        password,
        secret,
    };
}

function isAuthEnabled(authConfig) {
    return Boolean(authConfig && authConfig.username && authConfig.password);
}

function signSessionToken(username, secret, ts = Date.now()) {
    const safeTs = Number.parseInt(ts, 10);
    const payload = `${username}|${safeTs}`;
    const sig = signValue(secret, payload);
    return `${toBase64Url(username)}.${safeTs}.${sig}`;
}

function verifySessionToken(token, secret, now = Date.now(), maxAgeMs = AUTH_MAX_AGE_MS) {
    const raw = String(token || '');
    const parts = raw.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'invalid_format' };

    let username = '';
    try {
        username = fromBase64Url(parts[0]);
    } catch (e) {
        return { ok: false, reason: 'invalid_username' };
    }

    const ts = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'invalid_ts' };
    if (Number(now) - ts > Number(maxAgeMs)) return { ok: false, reason: 'expired' };

    const expected = signValue(secret, `${username}|${ts}`);
    if (!safeEqual(parts[2], expected)) return { ok: false, reason: 'invalid_sig' };
    return {
        ok: true,
        username,
        ts,
    };
}

function parseCookieHeader(cookieHeader) {
    const raw = String(cookieHeader || '').trim();
    if (!raw) return {};

    const result = {};
    const pairs = raw.split(';');
    for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx <= 0) continue;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (!key) continue;
        try {
            result[key] = decodeURIComponent(val);
        } catch (e) {
            result[key] = val;
        }
    }
    return result;
}

function verifyCredentials(authConfig, username, password) {
    if (!isAuthEnabled(authConfig)) return true;
    const userOk = safeEqual(authConfig.username, String(username || '').trim());
    const passOk = safeEqual(authConfig.password, String(password || ''));
    return userOk && passOk;
}

function buildAuthCookie(token, secure = false) {
    const attrs = [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(AUTH_MAX_AGE_MS / 1000)}`,
    ];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}

function buildClearAuthCookie(secure = false) {
    const attrs = [
        `${AUTH_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0',
    ];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}

module.exports = {
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
};
