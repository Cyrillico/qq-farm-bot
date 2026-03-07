/**
 * 运行时设置（进程内可热更新）
 * 当前承载 Bark / 账号 / 扫码接口相关配置，优先于静态 CONFIG。
 */

const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config');

const DEFAULT_LOCAL_SETTINGS_PATH = path.join(__dirname, '..', '.qq-farm-ui-settings.json');

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

function normalizeApiDomain(input, fallback = 'q.qq.com') {
    const raw = String(input || '').trim();
    if (!raw) return fallback;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withScheme);
        return String(parsed.host || '').trim() || fallback;
    } catch (e) {
        return fallback;
    }
}

function defaultQrLoginSettings() {
    return {
        apiDomain: 'q.qq.com',
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
        enablePutBadThings: true,
        autoUnlockLands: true,
        autoUpgradeLands: true,
        autoFertilize: true,
        autoBuyFertilizer: true,
        taskActiveEnabled: true,
        giftEnabled: true,
        friendStealEnabled: true,
        friendHelpEnabled: true,
        vipGiftEnabled: true,
        monthCardEnabled: true,
        openServerGiftEnabled: true,
        plantingStrategy: 'preferred',
        preferredSeedId: 0,
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

function mergeQrLoginSettings(base, patch = {}) {
    return {
        ...base,
        ...patch,
        apiDomain: normalizeApiDomain((patch && patch.apiDomain) || (base && base.apiDomain), (base && base.apiDomain) || 'q.qq.com'),
    };
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
    next.autoUnlockLands = Boolean(next.autoUnlockLands);
    next.autoUpgradeLands = Boolean(next.autoUpgradeLands);
    next.autoFertilize = Boolean(next.autoFertilize);
    next.autoBuyFertilizer = Boolean(next.autoBuyFertilizer);
    next.taskActiveEnabled = Boolean(next.taskActiveEnabled);
    next.giftEnabled = Boolean(next.giftEnabled);
    next.friendStealEnabled = Boolean(next.friendStealEnabled);
    next.friendHelpEnabled = Boolean(next.friendHelpEnabled);
    next.vipGiftEnabled = Boolean(next.vipGiftEnabled);
    next.monthCardEnabled = Boolean(next.monthCardEnabled);
    next.openServerGiftEnabled = Boolean(next.openServerGiftEnabled);
    next.plantingStrategy = String(next.plantingStrategy || 'preferred').trim() || 'preferred';
    next.preferredSeedId = Math.max(0, clampInt(next.preferredSeedId, 0, 9999999, 0));
    return next;
}

function buildDefaultRuntimeSettings() {
    return {
        bark: defaultBarkSettings(),
        account: defaultAccountRuntimeSettings(),
        qrLogin: defaultQrLoginSettings(),
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

function updateRuntimeQrLoginSettings(patch = {}) {
    runtimeSettings.qrLogin = mergeQrLoginSettings(runtimeSettings.qrLogin, patch);
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
    if (next.qrLogin) {
        runtimeSettings.qrLogin = mergeQrLoginSettings(runtimeSettings.qrLogin, next.qrLogin);
    }
    return getRuntimeSettings();
}

function resetRuntimeSettingsForTest() {
    runtimeSettings = buildDefaultRuntimeSettings();
}

function loadRuntimeSettingsFromLocalFile(filePath = '') {
    const pickedPath = String(filePath || process.env.QQ_FARM_UI_SETTINGS_PATH || DEFAULT_LOCAL_SETTINGS_PATH).trim();
    if (!pickedPath || !fs.existsSync(pickedPath)) {
        return {
            loaded: false,
            filePath: pickedPath,
            barkApplied: false,
            accountApplied: false,
            qrLoginApplied: false,
            reason: 'not_found',
        };
    }

    try {
        const raw = fs.readFileSync(pickedPath, 'utf8');
        const parsed = JSON.parse(raw);
        let barkApplied = false;
        let accountApplied = false;
        let qrLoginApplied = false;

        if (parsed && typeof parsed === 'object') {
            if (parsed.bark && typeof parsed.bark === 'object') {
                runtimeSettings.bark = mergeBarkSettings(runtimeSettings.bark, parsed.bark);
                barkApplied = true;
            }
            if (parsed.account && typeof parsed.account === 'object') {
                runtimeSettings.account = mergeAccountRuntimeSettings(runtimeSettings.account, parsed.account);
                accountApplied = true;
            }
            if (parsed.qrLogin && typeof parsed.qrLogin === 'object') {
                runtimeSettings.qrLogin = mergeQrLoginSettings(runtimeSettings.qrLogin, parsed.qrLogin);
                qrLoginApplied = true;
            }
        }

        return {
            loaded: true,
            filePath: pickedPath,
            barkApplied,
            accountApplied,
            qrLoginApplied,
            reason: '',
        };
    } catch (e) {
        return {
            loaded: false,
            filePath: pickedPath,
            barkApplied: false,
            accountApplied: false,
            qrLoginApplied: false,
            reason: e && e.message ? e.message : String(e),
        };
    }
}

module.exports = {
    defaultBarkSettings,
    defaultAccountRuntimeSettings,
    defaultQrLoginSettings,
    getRuntimeSettings,
    updateRuntimeBarkSettings,
    updateRuntimeAccountSettings,
    updateRuntimeQrLoginSettings,
    setRuntimeSettings,
    resetRuntimeSettingsForTest,
    loadRuntimeSettingsFromLocalFile,
};
