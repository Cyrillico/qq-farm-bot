const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resetRuntimeSettingsForTest,
    getRuntimeSettings,
    updateRuntimeBarkSettings,
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
