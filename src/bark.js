/**
 * Bark 推送工具
 * - 通过 Bark API 发送异常通知
 * - 对同类错误做时间窗口去重，避免刷屏
 */

const axios = require('axios');
const { getRuntimeSettings } = require('./runtimeSettings');

const dedupeCache = new Map();
let barkSendErrorLogged = false;

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

async function pushBark(title, body, dedupeKey, opts = {}) {
    const category = String(opts.category || 'business');
    const force = Boolean(opts.force);
    const barkSettings = opts.settings || getRuntimeSettings().bark;
    if (!barkSettings) return false;

    if (!force) {
        if (!barkSettings.enabled) return false;
        if (barkSettings.categories && barkSettings.categories[category] === false) return false;
    }

    const baseUrl = normalizePushBaseUrl(barkSettings.pushUrl);
    if (!baseUrl) return false;

    const safeTitle = String(title || 'QQ农场通知').trim().slice(0, 200);
    const safeBody = String(body || '').trim().slice(0, 1000) || '无详情';
    const ttlSec = Number(barkSettings.dedupSeconds) >= 0 ? Number(barkSettings.dedupSeconds) : 60;
    const ttlMs = ttlSec * 1000;

    const now = Date.now();
    pruneDedupeCache(ttlMs, now);

    const key = getDedupeKey(safeTitle, safeBody, dedupeKey);
    const lastTs = dedupeCache.get(key) || 0;
    if (now - lastTs < ttlMs) {
        return false;
    }
    dedupeCache.set(key, now);

    const pushUrl = `${baseUrl}${encodeURIComponent(safeTitle)}/${encodeURIComponent(safeBody)}`;
    try {
        await axios.get(pushUrl, {
            params: { group: barkSettings.group || 'qq-farm-bot' },
            timeout: 6000,
        });
        return true;
    } catch (e) {
        if (!barkSendErrorLogged) {
            barkSendErrorLogged = true;
            console.warn(`[Bark] 推送失败: ${e && e.message ? e.message : String(e)}`);
        }
        return false;
    }
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
    pushWarn,
};
