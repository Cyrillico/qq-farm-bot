/**
 * Bark 推送工具
 * - 通过 Bark API 发送异常通知
 * - 对同类错误做时间窗口去重，避免刷屏
 */

const axios = require('axios');
const { getRuntimeSettings } = require('./runtimeSettings');
const { emitUiEvent } = require('./uiEvents');

const dedupeCache = new Map();
let barkSendErrorLogged = false;
let lastPushResult = {
    sent: false,
    reason: 'init',
    detail: '',
    at: 0,
};

function setLastPushResult(sent, reason, detail = '', meta = {}) {
    lastPushResult = {
        sent: Boolean(sent),
        reason: String(reason || '').trim(),
        detail: String(detail || '').trim(),
        at: Date.now(),
    };
    emitUiEvent('bark', {
        sent: Boolean(sent),
        reason: String(reason || '').trim(),
        detail: String(detail || '').trim(),
        category: String((meta && meta.category) || '').trim(),
        force: Boolean(meta && meta.force),
        ts: Date.now(),
    });
}

function normalizeSummary(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[0-9]+/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePushBaseUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    return raw.endsWith('/') ? raw : `${raw}/`;
}

function getDedupeKey(title, body, dedupeKey) {
    const raw = dedupeKey || `${title}|${body}`;
    return normalizeSummary(raw);
}

function pruneDedupeCache(ttlMs, now) {
    for (const [key, ts] of dedupeCache) {
        if (now - ts >= ttlMs) dedupeCache.delete(key);
    }
}

async function pushBarkDetailed(title, body, dedupeKey, opts = {}) {
    const category = String(opts.category || 'business');
    const force = Boolean(opts.force);
    const barkSettings = opts.settings || getRuntimeSettings().bark;
    if (!barkSettings) {
        setLastPushResult(false, 'missing_settings', '', { category, force });
        return { sent: false, reason: 'missing_settings', detail: '' };
    }

    if (!force) {
        if (!barkSettings.enabled) {
            setLastPushResult(false, 'disabled', '', { category, force });
            return { sent: false, reason: 'disabled', detail: '' };
        }
        if (barkSettings.categories && barkSettings.categories[category] === false) {
            setLastPushResult(false, 'category_filtered', category, { category, force });
            return { sent: false, reason: 'category_filtered', detail: category };
        }
    }

    const baseUrl = normalizePushBaseUrl(barkSettings.pushUrl);
    if (!baseUrl) {
        setLastPushResult(false, 'missing_push_url', '', { category, force });
        return { sent: false, reason: 'missing_push_url', detail: '' };
    }

    const safeTitle = String(title || 'QQ农场通知').trim().slice(0, 200);
    const safeBody = String(body || '').trim().slice(0, 1000) || '无详情';
    const ttlSec = Number(barkSettings.dedupSeconds) >= 0 ? Number(barkSettings.dedupSeconds) : 60;
    const ttlMs = ttlSec * 1000;

    const now = Date.now();
    pruneDedupeCache(ttlMs, now);

    const key = getDedupeKey(safeTitle, safeBody, dedupeKey);
    const lastTs = dedupeCache.get(key) || 0;
    if (now - lastTs < ttlMs) {
        setLastPushResult(false, 'deduped', key, { category, force });
        return { sent: false, reason: 'deduped', detail: key };
    }
    dedupeCache.set(key, now);

    const pushUrl = `${baseUrl}${encodeURIComponent(safeTitle)}/${encodeURIComponent(safeBody)}`;
    const actionUrl = String(opts.actionUrl || '').trim();
    const params = { group: barkSettings.group || 'qq-farm-bot' };
    if (actionUrl) {
        params.url = actionUrl;
    }
    try {
        await axios.get(pushUrl, {
            params,
            timeout: 6000,
        });
        setLastPushResult(true, 'ok', '', { category, force });
        return { sent: true, reason: 'ok', detail: '' };
    } catch (e) {
        const message = e && e.message ? e.message : String(e);
        setLastPushResult(false, 'request_failed', message, { category, force });
        if (!barkSendErrorLogged) {
            barkSendErrorLogged = true;
            console.warn(`[Bark] 推送失败: ${message}`);
        }
        return { sent: false, reason: 'request_failed', detail: message };
    }
}

async function pushBark(title, body, dedupeKey, opts = {}) {
    const result = await pushBarkDetailed(title, body, dedupeKey, opts);
    return Boolean(result.sent);
}

function pushWarn(tag, msg, opts = {}) {
    const safeTag = String(tag || '系统').trim() || '系统';
    const safeMsg = String(msg || '').trim() || '未知异常';
    return pushBark(`QQ农场异常: ${safeTag}`, safeMsg, `${safeTag}|${safeMsg}`, {
        category: opts.category || 'business',
    });
}

module.exports = {
    pushBark,
    pushBarkDetailed,
    pushWarn,
    getLastPushResult: () => ({ ...lastPushResult }),
};
