/**
 * 运行时设置（进程内可热更新）
 * 当前仅承载 Bark 相关配置，优先于静态 CONFIG。
 */

const { CONFIG } = require('./config');

function clampInt(val, min, max, fallback) {
    const n = Number.parseInt(val, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function defaultBarkSettings() {
    return {
        enabled: true,
        pushUrl: CONFIG.barkPushUrl || '',
        group: CONFIG.barkGroup || 'qq-farm-bot',
        dedupSeconds: clampInt(CONFIG.barkDedupSeconds, 0, 3600, 60),
        categories: {
            fatal: true,
            network: true,
            business: true,
        },
    };
}

function mergeBarkSettings(base, patch = {}) {
    const next = {
        ...base,
        ...patch,
        categories: {
            ...base.categories,
            ...(patch.categories || {}),
        },
    };
    next.enabled = Boolean(next.enabled);
    next.pushUrl = String(next.pushUrl || '').trim();
    next.group = String(next.group || 'qq-farm-bot').trim() || 'qq-farm-bot';
    next.dedupSeconds = clampInt(next.dedupSeconds, 0, 3600, base.dedupSeconds);
    next.categories.fatal = Boolean(next.categories.fatal);
    next.categories.network = Boolean(next.categories.network);
    next.categories.business = Boolean(next.categories.business);
    return next;
}

function buildDefaultRuntimeSettings() {
    return {
        bark: defaultBarkSettings(),
    };
}

let runtimeSettings = buildDefaultRuntimeSettings();

function getRuntimeSettings() {
    return JSON.parse(JSON.stringify(runtimeSettings));
}

function updateRuntimeBarkSettings(patch = {}) {
    runtimeSettings.bark = mergeBarkSettings(runtimeSettings.bark, patch);
    return getRuntimeSettings();
}

function setRuntimeSettings(next = {}) {
    runtimeSettings = buildDefaultRuntimeSettings();
    if (next.bark) {
        runtimeSettings.bark = mergeBarkSettings(runtimeSettings.bark, next.bark);
    }
    return getRuntimeSettings();
}

function resetRuntimeSettingsForTest() {
    runtimeSettings = buildDefaultRuntimeSettings();
}

module.exports = {
    defaultBarkSettings,
    getRuntimeSettings,
    updateRuntimeBarkSettings,
    setRuntimeSettings,
    resetRuntimeSettingsForTest,
};
