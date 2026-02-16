const fs = require('node:fs');
const path = require('node:path');
const { defaultBarkSettings } = require('../src/runtimeSettings');

const DEFAULT_SETTINGS_PATH = path.join(__dirname, '..', '.qq-farm-ui-settings.json');

function getDefaultSettings() {
    return {
        bark: defaultBarkSettings(),
        ui: {
            friendOps: {
                allowBadOps: true,
                confirmDangerous: true,
            },
        },
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

function normalizeSettings(input = {}) {
    const defaults = getDefaultSettings();
    const merged = mergeSettings(defaults, input);
    return mergeSettings(defaults, merged);
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
    validateBarkSettings,
    validateUiSettings,
    mergeSettings,
    normalizeSettings,
    loadSettings,
    saveSettings,
};
