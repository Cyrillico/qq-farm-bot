const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    getDefaultSettings,
    validateBarkSettings,
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
