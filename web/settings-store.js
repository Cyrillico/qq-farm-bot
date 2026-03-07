const fs = require('node:fs');
const path = require('node:path');
const { defaultBarkSettings } = require('../src/runtimeSettings');

const DEFAULT_SETTINGS_PATH = path.join(__dirname, '..', '.qq-farm-ui-settings.json');

function defaultAccountFeatureSettings() {
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

function normalizeAccountIdKey(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const normalized = text.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
    return normalized || '';
}

function mergeAccountFeatureSettings(base, patch = {}) {
    const defaults = defaultAccountFeatureSettings();
    const next = {
        ...defaults,
        ...(base || {}),
        ...(patch || {}),
    };
    const boolKeys = [
        'farmEnabled', 'friendEnabled', 'taskEnabled', 'sellEnabled',
        'forceLowestLevelCrop', 'helpOnlyWithExp', 'enablePutBadThings',
        'autoUnlockLands', 'autoUpgradeLands', 'autoFertilize', 'autoBuyFertilizer',
        'taskActiveEnabled', 'giftEnabled', 'friendStealEnabled', 'friendHelpEnabled',
        'vipGiftEnabled', 'monthCardEnabled', 'openServerGiftEnabled',
    ];
    for (const key of boolKeys) {
        next[key] = Boolean(next[key]);
    }
    const allowedStrategies = new Set(['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit']);
    next.plantingStrategy = allowedStrategies.has(String(next.plantingStrategy || '').trim())
        ? String(next.plantingStrategy).trim()
        : defaults.plantingStrategy;
    const preferredSeedId = Number.parseInt(next.preferredSeedId, 10);
    next.preferredSeedId = Number.isFinite(preferredSeedId) && preferredSeedId >= 0 ? preferredSeedId : defaults.preferredSeedId;
    return next;
}

function normalizeAccountFeaturesMap(rawMap = {}) {
    const next = {};
    if (!rawMap || typeof rawMap !== 'object') return next;
    for (const [rawAccountId, value] of Object.entries(rawMap)) {
        const accountId = normalizeAccountIdKey(rawAccountId);
        if (!accountId || !value || typeof value !== 'object') continue;
        next[accountId] = mergeAccountFeatureSettings(next[accountId], value);
    }
    return next;
}

function defaultPersistedAccountSettings() {
    return {
        mode: 'run',
        platform: 'qq',
        code: '',
        useQr: true,
        interval: '',
        friendInterval: '',
        autoStart: true,
    };
}

function normalizePersistedAccountSettings(raw = {}) {
    const defaults = defaultPersistedAccountSettings();
    const platform = String(raw && raw.platform || defaults.platform).trim().toLowerCase() === 'wx' ? 'wx' : 'qq';
    const mode = 'run';
    const code = String(raw && raw.code || '').trim();
    const interval = String(raw && raw.interval || '').trim();
    const friendInterval = String(raw && raw.friendInterval || '').trim();
    return {
        mode,
        platform,
        code,
        useQr: platform === 'wx' ? false : Boolean(raw && raw.useQr),
        interval,
        friendInterval,
        autoStart: raw && Object.prototype.hasOwnProperty.call(raw, 'autoStart')
            ? Boolean(raw.autoStart)
            : defaults.autoStart,
    };
}

function normalizePersistedAccountsMap(rawMap = {}) {
    const next = {};
    if (!rawMap || typeof rawMap !== 'object') return next;
    for (const [rawAccountId, value] of Object.entries(rawMap)) {
        const accountId = normalizeAccountIdKey(rawAccountId);
        if (!accountId || !value || typeof value !== 'object') continue;
        next[accountId] = normalizePersistedAccountSettings(value);
    }
    return next;
}

function defaultQrLoginSettings() {
    return {
        apiDomain: 'q.qq.com',
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

function normalizeQrLoginSettings(raw = {}) {
    return {
        apiDomain: normalizeApiDomain(raw && raw.apiDomain, defaultQrLoginSettings().apiDomain),
    };
}

function validateQrLoginSettings(qrLogin = {}) {
    const errors = [];
    if (!qrLogin || typeof qrLogin !== 'object') {
        return { ok: false, errors: ['qrLogin must be object'] };
    }
    const apiDomain = String(qrLogin.apiDomain || '').trim();
    if (!apiDomain) {
        errors.push('apiDomain must be non-empty');
    }
    return { ok: errors.length === 0, errors };
}

function getDefaultSettings() {
    return {
        bark: defaultBarkSettings(),
        ui: {
            friendOps: {
                allowBadOps: true,
                confirmDangerous: true,
            },
        },
        accountFeatures: {},
        accounts: {},
        qrLogin: defaultQrLoginSettings(),
    };
}

function validateBarkSettings(bark = {}) {
    const errors = [];

    if (typeof bark.enabled !== 'boolean') {
        errors.push('enabled must be boolean');
    }

    const pushUrl = String(bark.pushUrl || '').trim();
    if (!pushUrl.startsWith('https://api.day.app/')) {
        errors.push('pushUrl must start with https://api.day.app/');
    }

    const group = String(bark.group || '').trim();
    if (!group || group.length > 100) {
        errors.push('group must be 1-100 chars');
    }

    const dedupSeconds = Number.parseInt(bark.dedupSeconds, 10);
    if (!Number.isFinite(dedupSeconds) || dedupSeconds < 0 || dedupSeconds > 3600) {
        errors.push('dedupSeconds must be integer within 0-3600');
    }

    if (!bark.categories || typeof bark.categories !== 'object') {
        errors.push('categories must be object');
    } else {
        for (const key of ['fatal', 'network', 'business']) {
            if (typeof bark.categories[key] !== 'boolean') {
                errors.push(`categories.${key} must be boolean`);
            }
        }
    }

    return {
        ok: errors.length === 0,
        errors,
    };
}

function mergeSettings(base, patch = {}) {
    const baseUi = base.ui || {};
    const baseFriendOps = baseUi.friendOps || {};
    const baseAccountFeatures = normalizeAccountFeaturesMap(base.accountFeatures || {});
    const patchAccountFeatures = normalizeAccountFeaturesMap(patch.accountFeatures || {});
    const mergedAccountFeatures = { ...baseAccountFeatures };
    for (const [accountId, accountSettings] of Object.entries(patchAccountFeatures)) {
        mergedAccountFeatures[accountId] = mergeAccountFeatureSettings(
            baseAccountFeatures[accountId],
            accountSettings
        );
    }
    const baseAccounts = normalizePersistedAccountsMap(base.accounts || {});
    const patchAccounts = normalizePersistedAccountsMap(patch.accounts || {});
    const mergedAccounts = { ...baseAccounts };
    for (const [accountId, accountSettings] of Object.entries(patchAccounts)) {
        mergedAccounts[accountId] = normalizePersistedAccountSettings({
            ...(baseAccounts[accountId] || {}),
            ...accountSettings,
        });
    }
    const merged = {
        ...base,
        ...patch,
        bark: {
            ...base.bark,
            ...(patch.bark || {}),
            categories: {
                ...base.bark.categories,
                ...((patch.bark && patch.bark.categories) || {}),
            },
        },
        ui: {
            ...baseUi,
            ...(patch.ui || {}),
            friendOps: {
                ...baseFriendOps,
                ...((patch.ui && patch.ui.friendOps) || {}),
            },
        },
        qrLogin: normalizeQrLoginSettings({
            ...((base && base.qrLogin) || {}),
            ...((patch && patch.qrLogin) || {}),
        }),
        accountFeatures: mergedAccountFeatures,
        accounts: mergedAccounts,
    };
    return merged;
}

function validateUiSettings(ui = {}) {
    const errors = [];
    if (!ui || typeof ui !== 'object') {
        return {
            ok: false,
            errors: ['ui must be object'],
        };
    }

    if (!ui.friendOps || typeof ui.friendOps !== 'object') {
        errors.push('friendOps must be object');
    } else {
        if (typeof ui.friendOps.allowBadOps !== 'boolean') {
            errors.push('friendOps.allowBadOps must be boolean');
        }
        if (typeof ui.friendOps.confirmDangerous !== 'boolean') {
            errors.push('friendOps.confirmDangerous must be boolean');
        }
    }

    return {
        ok: errors.length === 0,
        errors,
    };
}

function validateAccountFeatureSettings(account = {}, options = {}) {
    const errors = [];
    const allowPartial = Boolean(options.allowPartial);
    if (!account || typeof account !== 'object') {
        return {
            ok: false,
            errors: ['account settings must be object'],
        };
    }

    const requiredBoolKeys = [
        'farmEnabled',
        'friendEnabled',
        'taskEnabled',
        'sellEnabled',
        'forceLowestLevelCrop',
        'helpOnlyWithExp',
        'enablePutBadThings',
        'autoUnlockLands',
        'autoUpgradeLands',
        'autoFertilize',
        'autoBuyFertilizer',
        'taskActiveEnabled',
        'giftEnabled',
    ];
    const optionalBoolKeys = [
        'friendStealEnabled',
        'friendHelpEnabled',
        'vipGiftEnabled',
        'monthCardEnabled',
        'openServerGiftEnabled',
    ];

    for (const key of requiredBoolKeys) {
        if (!allowPartial && typeof account[key] !== 'boolean') {
            errors.push(`${key} must be boolean`);
            continue;
        }
        if (allowPartial && key in account && typeof account[key] !== 'boolean') {
            errors.push(`${key} must be boolean`);
        }
    }

    for (const key of optionalBoolKeys) {
        if (key in account && typeof account[key] !== 'boolean') {
            errors.push(`${key} must be boolean`);
        }
    }

    const allowedStrategies = new Set(['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit']);
    if (Object.prototype.hasOwnProperty.call(account, 'plantingStrategy')) {
        if (!allowedStrategies.has(String(account.plantingStrategy || '').trim())) {
            errors.push('plantingStrategy must be a supported strategy');
        }
    }
    if (Object.prototype.hasOwnProperty.call(account, 'preferredSeedId')) {
        const preferredSeedId = Number.parseInt(account.preferredSeedId, 10);
        if (!Number.isFinite(preferredSeedId) || preferredSeedId < 0) {
            errors.push('preferredSeedId must be integer >= 0');
        }
    }

    return {
        ok: errors.length === 0,
        errors,
    };
}

function normalizeSettings(input = {}) {
    const defaults = getDefaultSettings();
    const merged = mergeSettings(defaults, input);
    const normalized = mergeSettings(defaults, merged);
    normalized.accountFeatures = normalizeAccountFeaturesMap(normalized.accountFeatures || {});
    normalized.accounts = normalizePersistedAccountsMap(normalized.accounts || {});
    normalized.qrLogin = normalizeQrLoginSettings(normalized.qrLogin || {});
    return normalized;
}

function getAccountFeatureSettings(settings = {}, accountId) {
    const defaults = defaultAccountFeatureSettings();
    const normalizedId = normalizeAccountIdKey(accountId);
    if (!normalizedId) return { ...defaults };
    const map = normalizeAccountFeaturesMap(settings.accountFeatures || {});
    return mergeAccountFeatureSettings(defaults, map[normalizedId] || {});
}


function getPersistedAccounts(settings = {}) {
    return normalizePersistedAccountsMap(settings.accounts || {});
}

function loadSettings(filePath = DEFAULT_SETTINGS_PATH) {
    const defaults = getDefaultSettings();
    if (!fs.existsSync(filePath)) {
        return defaults;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeSettings(parsed);
    } catch (e) {
        return defaults;
    }
}

function saveSettings(filePath = DEFAULT_SETTINGS_PATH, nextSettings = {}) {
    const normalized = normalizeSettings(nextSettings);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

module.exports = {
    DEFAULT_SETTINGS_PATH,
    getDefaultSettings,
    defaultAccountFeatureSettings,
    defaultPersistedAccountSettings,
    defaultQrLoginSettings,
    getAccountFeatureSettings,
    getPersistedAccounts,
    validateBarkSettings,
    validateUiSettings,
    validateAccountFeatureSettings,
    validateQrLoginSettings,
    normalizeAccountIdKey,
    normalizeQrLoginSettings,
    mergeSettings,
    normalizeSettings,
    loadSettings,
    saveSettings,
};
