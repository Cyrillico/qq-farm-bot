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

function defaultAccountRuntimeSettings() {
    return {
        farmEnabled: true,
        friendEnabled: true,
        taskEnabled: true,
        sellEnabled: true,
        forceLowestLevelCrop: false,
        helpOnlyWithExp: true,
        enablePutBadThings: false,
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

function mergeAccountRuntimeSettings(base, patch = {}) {
    const next = {
        ...base,
        ...patch,
    };
    next.farmEnabled = Boolean(next.farmEnabled);
    next.friendEnabled = Boolean(next.friendEnabled);
    next.taskEnabled = Boolean(next.taskEnabled);
    next.sellEnabled = Boolean(next.sellEnabled);
    next.forceLowestLevelCrop = Boolean(next.forceLowestLevelCrop);
    next.helpOnlyWithExp = Boolean(next.helpOnlyWithExp);
    next.enablePutBadThings = Boolean(next.enablePutBadThings);
    return next;
}

function buildDefaultRuntimeSettings() {
    return {
        bark: defaultBarkSettings(),
        account: defaultAccountRuntimeSettings(),
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

function updateRuntimeAccountSettings(patch = {}) {
    runtimeSettings.account = mergeAccountRuntimeSettings(runtimeSettings.account, patch);
    return getRuntimeSettings();
}

function setRuntimeSettings(next = {}) {
    runtimeSettings = buildDefaultRuntimeSettings();
    if (next.bark) {
        runtimeSettings.bark = mergeBarkSettings(runtimeSettings.bark, next.bark);
    }
    if (next.account) {
        runtimeSettings.account = mergeAccountRuntimeSettings(runtimeSettings.account, next.account);
    }
    return getRuntimeSettings();
}

function resetRuntimeSettingsForTest() {
    runtimeSettings = buildDefaultRuntimeSettings();
}

module.exports = {
    defaultBarkSettings,
    defaultAccountRuntimeSettings,
    getRuntimeSettings,
    updateRuntimeBarkSettings,
    updateRuntimeAccountSettings,
    setRuntimeSettings,
    resetRuntimeSettingsForTest,
};
