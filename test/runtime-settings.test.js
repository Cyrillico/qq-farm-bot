const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    resetRuntimeSettingsForTest,
    getRuntimeSettings,
    updateRuntimeBarkSettings,
    updateRuntimeAccountSettings,
    updateRuntimeQrLoginSettings,
    loadRuntimeSettingsFromLocalFile,
} = require('../src/runtimeSettings');

test('runtime bark settings can be updated partially', () => {
    resetRuntimeSettingsForTest();
    const before = getRuntimeSettings();
    assert.equal(typeof before.bark.enabled, 'boolean');

    updateRuntimeBarkSettings({
        enabled: false,
        categories: {
            business: false,
        },
    });

    const after = getRuntimeSettings();
    assert.equal(after.bark.enabled, false);
    assert.equal(after.bark.categories.business, false);
    assert.equal(after.bark.categories.fatal, true);
    assert.equal(after.bark.categories.network, true);
});

test('runtime bark settings keeps valid bounds for dedupSeconds', () => {
    resetRuntimeSettingsForTest();
    updateRuntimeBarkSettings({ dedupSeconds: -1 });
    assert.equal(getRuntimeSettings().bark.dedupSeconds, 0);

    updateRuntimeBarkSettings({ dedupSeconds: 99999 });
    assert.equal(getRuntimeSettings().bark.dedupSeconds, 3600);
});

test('default bark pushUrl should be empty to avoid secret in repository', () => {
    resetRuntimeSettingsForTest();
    const current = getRuntimeSettings();
    assert.equal(current.bark.pushUrl, '');
});

test('runtime settings can load bark from local settings file', () => {
    resetRuntimeSettingsForTest();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-runtime-'));
    const settingsPath = path.join(dir, '.qq-farm-ui-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
        bark: {
            enabled: true,
            pushUrl: 'https://api.day.app/test-key/',
            group: 'test-group',
            dedupSeconds: 123,
            categories: {
                fatal: true,
                network: false,
                business: true,
            },
        },
    }), 'utf8');

    const loaded = loadRuntimeSettingsFromLocalFile(settingsPath);
    assert.equal(loaded.loaded, true);
    assert.equal(loaded.barkApplied, true);
    assert.equal(loaded.accountApplied, false);

    const current = getRuntimeSettings();
    assert.equal(current.bark.pushUrl, 'https://api.day.app/test-key/');
    assert.equal(current.bark.group, 'test-group');
    assert.equal(current.bark.dedupSeconds, 123);
    assert.equal(current.bark.categories.fatal, true);
    assert.equal(current.bark.categories.network, false);
    assert.equal(current.bark.categories.business, true);
});

test('loading invalid local runtime settings should not throw', () => {
    resetRuntimeSettingsForTest();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-runtime-bad-'));
    const settingsPath = path.join(dir, '.qq-farm-ui-settings.json');
    fs.writeFileSync(settingsPath, '{bad-json', 'utf8');

    const loaded = loadRuntimeSettingsFromLocalFile(settingsPath);
    assert.equal(loaded.loaded, false);
    assert.ok(loaded.reason);
    assert.equal(getRuntimeSettings().bark.pushUrl, '');
});

test('runtime account settings can be updated partially', () => {
    resetRuntimeSettingsForTest();
    updateRuntimeAccountSettings({
        farmEnabled: false,
        forceLowestLevelCrop: true,
        autoUnlockLands: false,
        giftEnabled: false,
    });
    const current = getRuntimeSettings();
    assert.equal(current.account.farmEnabled, false);
    assert.equal(current.account.forceLowestLevelCrop, true);
    assert.equal(current.account.autoUnlockLands, false);
    assert.equal(current.account.giftEnabled, false);
    assert.equal(current.account.friendEnabled, true);
    assert.equal(current.account.autoUpgradeLands, true);
    assert.equal(current.account.autoFertilize, true);
    assert.equal(current.account.autoBuyFertilizer, true);
    assert.equal(current.account.taskActiveEnabled, true);
});

test('runtime qr login settings can be updated and loaded', () => {
    resetRuntimeSettingsForTest();
    updateRuntimeQrLoginSettings({ apiDomain: 'q.qq.com' });
    assert.equal(getRuntimeSettings().qrLogin.apiDomain, 'q.qq.com');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-runtime-qr-'));
    const settingsPath = path.join(dir, '.qq-farm-ui-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
        qrLogin: { apiDomain: 'q.qq.com' },
    }), 'utf8');

    const loaded = loadRuntimeSettingsFromLocalFile(settingsPath);
    assert.equal(loaded.loaded, true);
    assert.equal(getRuntimeSettings().qrLogin.apiDomain, 'q.qq.com');
});

