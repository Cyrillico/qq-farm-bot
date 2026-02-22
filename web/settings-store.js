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
    return {
        ...defaults,
        ...(base || {}),
        ...(patch || {}),
    };
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
        accountFeatures: mergedAccountFeatures,
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

    const keys = [
        'farmEnabled',
        'friendEnabled',
        'taskEnabled',
        'sellEnabled',
        'forceLowestLevelCrop',
        'helpOnlyWithExp',
        'enablePutBadThings',
    ];

    for (const key of keys) {
        if (!allowPartial && typeof account[key] !== 'boolean') {
            errors.push(`${key} must be boolean`);
            continue;
        }
        if (allowPartial && key in account && typeof account[key] !== 'boolean') {
            errors.push(`${key} must be boolean`);
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
    return normalized;
}

function getAccountFeatureSettings(settings = {}, accountId) {
    const defaults = defaultAccountFeatureSettings();
    const normalizedId = normalizeAccountIdKey(accountId);
    if (!normalizedId) return { ...defaults };
    const map = normalizeAccountFeaturesMap(settings.accountFeatures || {});
    return mergeAccountFeatureSettings(defaults, map[normalizedId] || {});
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
    getAccountFeatureSettings,
    validateBarkSettings,
    validateUiSettings,
    validateAccountFeatureSettings,
    normalizeAccountIdKey,
    mergeSettings,
    normalizeSettings,
    loadSettings,
    saveSettings,
};
