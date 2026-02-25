function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function createLoginRateLimiter(options = {}) {
    const maxAttempts = clampInt(options.maxAttempts, 10, 1, 1000);
    const windowMs = clampInt(options.windowMs, 10 * 60 * 1000, 1000, 24 * 3600 * 1000);
    const buckets = new Map();

    function prune(now) {
        for (const [key, item] of buckets) {
            if (!item || now >= item.resetAt) {
                buckets.delete(key);
            }
        }
    }

    function ensureBucket(key, now) {
        const safeKey = String(key || '').trim() || 'unknown';
        let item = buckets.get(safeKey);
        if (!item || now >= item.resetAt) {
            item = { count: 0, resetAt: now + windowMs };
            buckets.set(safeKey, item);
        }
        return { key: safeKey, item };
    }

    function check(key, now = Date.now()) {
        const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
        prune(ts);
        const { item } = ensureBucket(key, ts);
        const allowed = item.count < maxAttempts;
        return {
            allowed,
            count: item.count,
            remaining: Math.max(0, maxAttempts - item.count),
            retryAfterMs: allowed ? 0 : Math.max(0, item.resetAt - ts),
            resetAt: item.resetAt,
        };
    }

    function recordFailure(key, now = Date.now()) {
        const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
        prune(ts);
        const { item } = ensureBucket(key, ts);
        item.count += 1;
        return {
            count: item.count,
            resetAt: item.resetAt,
        };
    }

    function reset(key) {
        const safeKey = String(key || '').trim() || 'unknown';
        buckets.delete(safeKey);
    }

    return {
        maxAttempts,
        windowMs,
        check,
        recordFailure,
        reset,
    };
}

function normalizeIp(ip) {
    const raw = String(ip || '').trim();
    if (!raw) return '';
    if (raw.startsWith('::ffff:')) return raw.slice(7);
    if (raw === '::1') return '127.0.0.1';
    return raw;
}

function ipv4ToInt(ip) {
    const text = normalizeIp(ip);
    const parts = text.split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (const part of parts) {
        const n = Number.parseInt(part, 10);
        if (!Number.isFinite(n) || n < 0 || n > 255) return null;
        out = (out << 8) | n;
    }
    return out >>> 0;
}

function parseCidrRule(rule) {
    const text = String(rule || '').trim();
    const idx = text.indexOf('/');
    if (idx <= 0) return null;
    const ip = text.slice(0, idx).trim();
    const bits = Number.parseInt(text.slice(idx + 1).trim(), 10);
    const ipInt = ipv4ToInt(ip);
    if (ipInt == null || !Number.isFinite(bits) || bits < 0 || bits > 32) return null;
    const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
    return {
        kind: 'cidr',
        raw: text,
        base: (ipInt & mask) >>> 0,
        mask,
    };
}

function parseIpWhitelist(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    const items = text.split(',').map((s) => s.trim()).filter(Boolean);
    const rules = [];
    for (const item of items) {
        if (item === '*') {
            rules.push({ kind: 'any', raw: '*' });
            continue;
        }
        const cidr = parseCidrRule(item);
        if (cidr) {
            rules.push(cidr);
            continue;
        }
        rules.push({ kind: 'exact', raw: normalizeIp(item) });
    }
    return rules;
}

function isIpAllowed(ip, rules) {
    const list = Array.isArray(rules) ? rules : [];
    if (!list.length) return true;
    const safeIp = normalizeIp(ip);
    if (!safeIp) return false;
    const ipInt = ipv4ToInt(safeIp);
    for (const rule of list) {
        if (!rule) continue;
        if (rule.kind === 'any') return true;
        if (rule.kind === 'exact' && safeIp === normalizeIp(rule.raw)) return true;
        if (rule.kind === 'cidr' && ipInt != null && ((ipInt & rule.mask) >>> 0) === rule.base) return true;
    }
    return false;
}

function maskBarkPushUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw);
        const parts = u.pathname.split('/').filter(Boolean);
        if (!parts.length) return raw;
        const key = parts[0];
        if (key.length <= 8) {
            parts[0] = `${key.slice(0, 2)}***`;
        } else {
            parts[0] = `${key.slice(0, 4)}***${key.slice(-5)}`;
        }
        u.pathname = `/${parts.join('/')}${raw.endsWith('/') ? '/' : ''}`;
        return u.toString();
    } catch (e) {
        if (raw.length <= 10) return `${raw.slice(0, 2)}***`;
        return `${raw.slice(0, 4)}***${raw.slice(-5)}`;
    }
}

function maskBarkSettings(bark = {}) {
    if (!bark || typeof bark !== 'object') return null;
    return {
        ...bark,
        pushUrl: maskBarkPushUrl(bark.pushUrl),
        hasPushUrl: Boolean(String(bark.pushUrl || '').trim()),
    };
}

module.exports = {
    createLoginRateLimiter,
    parseIpWhitelist,
    isIpAllowed,
    normalizeIp,
    maskBarkPushUrl,
    maskBarkSettings,
};
