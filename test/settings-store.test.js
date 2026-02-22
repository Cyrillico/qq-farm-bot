const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    getDefaultSettings,
    defaultAccountFeatureSettings,
    getAccountFeatureSettings,
    validateBarkSettings,
    validateUiSettings,
    validateAccountFeatureSettings,
    loadSettings,
    saveSettings,
} = require('../web/settings-store');

test('validateBarkSettings accepts complete valid bark config', () => {
    const valid = {
        enabled: true,
        pushUrl: 'https://api.day.app/abc123/',
        group: 'qq-farm-bot',
        dedupSeconds: 60,
        categories: {
            fatal: true,
            network: true,
            business: true,
        },
    };

    const { ok, errors } = validateBarkSettings(valid);
    assert.equal(ok, true);
    assert.deepEqual(errors, []);
});

test('validateBarkSettings rejects invalid push url and missing categories', () => {
    const invalid = {
        enabled: true,
        pushUrl: 'http://example.com/nope',
        group: '',
        dedupSeconds: 99999,
        categories: {
            fatal: true,
            network: true,
        },
    };

    const { ok, errors } = validateBarkSettings(invalid);
    assert.equal(ok, false);
    assert.ok(errors.some(e => e.includes('pushUrl')));
    assert.ok(errors.some(e => e.includes('group')));
    assert.ok(errors.some(e => e.includes('dedupSeconds')));
    assert.ok(errors.some(e => e.includes('categories.business')));
});

test('loadSettings returns defaults when file does not exist', () => {
    const tempFile = path.join(os.tmpdir(), `qq-farm-ui-settings-${Date.now()}-missing.json`);
    const loaded = loadSettings(tempFile);
    const defaults = getDefaultSettings();
    assert.deepEqual(loaded.bark, defaults.bark);
});

test('saveSettings and loadSettings roundtrip bark config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-ui-settings-'));
    const tempFile = path.join(tempDir, 'settings.json');
    const defaults = getDefaultSettings();
    const next = {
        ...defaults,
        bark: {
            ...defaults.bark,
            enabled: false,
            group: 'new-group',
            dedupSeconds: 15,
        },
    };

    saveSettings(tempFile, next);
    const loaded = loadSettings(tempFile);
    assert.deepEqual(loaded.bark.enabled, false);
    assert.deepEqual(loaded.bark.group, 'new-group');
    assert.deepEqual(loaded.bark.dedupSeconds, 15);
});

test('default settings should include ui friendOps switches', () => {
    const defaults = getDefaultSettings();
    assert.equal(defaults.ui.friendOps.allowBadOps, true);
    assert.equal(defaults.ui.friendOps.confirmDangerous, true);
});

test('saveSettings and loadSettings roundtrip ui friendOps switches', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-ui-settings-ui-'));
    const tempFile = path.join(tempDir, 'settings.json');
    const defaults = getDefaultSettings();
    const next = {
        ...defaults,
        ui: {
            ...defaults.ui,
            friendOps: {
                allowBadOps: false,
                confirmDangerous: false,
            },
        },
    };

    saveSettings(tempFile, next);
    const loaded = loadSettings(tempFile);
    assert.equal(loaded.ui.friendOps.allowBadOps, false);
    assert.equal(loaded.ui.friendOps.confirmDangerous, false);
});

test('validateUiSettings rejects invalid friendOps switches', () => {
    const bad = validateUiSettings({
        friendOps: {
            allowBadOps: 'yes',
            confirmDangerous: 1,
        },
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.includes('allowBadOps')));
    assert.ok(bad.errors.some((e) => e.includes('confirmDangerous')));

    const good = validateUiSettings({
        friendOps: {
            allowBadOps: true,
            confirmDangerous: false,
        },
    });
    assert.equal(good.ok, true);
});

test('default settings should include account feature map and defaults', () => {
    const defaults = getDefaultSettings();
    assert.deepEqual(defaults.accountFeatures, {});
    const accountDefaults = defaultAccountFeatureSettings();
    assert.equal(accountDefaults.farmEnabled, true);
    assert.equal(accountDefaults.forceLowestLevelCrop, false);
});

test('getAccountFeatureSettings merges defaults and persisted account values', () => {
    const defaults = getDefaultSettings();
    defaults.accountFeatures['qq-main'] = {
        farmEnabled: false,
        sellEnabled: false,
    };
    const merged = getAccountFeatureSettings(defaults, 'qq-main');
    assert.equal(merged.farmEnabled, false);
    assert.equal(merged.sellEnabled, false);
    assert.equal(merged.friendEnabled, true);
});

test('validateAccountFeatureSettings supports full and partial checks', () => {
    const badPartial = validateAccountFeatureSettings({ farmEnabled: 'x' }, { allowPartial: true });
    assert.equal(badPartial.ok, false);

    const goodPartial = validateAccountFeatureSettings({ farmEnabled: false }, { allowPartial: true });
    assert.equal(goodPartial.ok, true);

    const goodFull = validateAccountFeatureSettings({
        farmEnabled: true,
        friendEnabled: true,
        taskEnabled: true,
        sellEnabled: true,
        forceLowestLevelCrop: false,
        helpOnlyWithExp: true,
        enablePutBadThings: false,
        autoUnlockLands: true,
        autoUpgradeLands: true,
        autoFertilize: true,
        autoBuyFertilizer: true,
        taskActiveEnabled: true,
        giftEnabled: true,
    });
    assert.equal(goodFull.ok, true);
});
