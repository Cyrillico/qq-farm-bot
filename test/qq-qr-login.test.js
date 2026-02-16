const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveQrUrls } = require('../src/qqQrLogin');

test('resolveQrUrls should prefer legacy h5 fallback url and keep API urls in backups', () => {
    const ret = resolveQrUrls(
        {
            url: 'https://q.qq.com/ide/real-scan-url',
            qr_url: 'https://q.qq.com/ide/alt-scan-url',
        },
        'abc123'
    );

    assert.equal(ret.primaryUrl, 'https://h5.qzone.qq.com/qqq/code/abc123?_proxy=1&from=ide');
    assert.ok(Array.isArray(ret.backupUrls));
    assert.ok(ret.backupUrls.includes('https://q.qq.com/qqq/code/abc123?_proxy=1&from=ide'));
    assert.ok(ret.backupUrls.includes('https://q.qq.com/ide/real-scan-url'));
    assert.ok(ret.backupUrls.includes('https://q.qq.com/ide/alt-scan-url'));
});

test('resolveQrUrls should fallback to built urls when API does not return url', () => {
    const ret = resolveQrUrls({}, 'abc123');
    assert.equal(ret.primaryUrl, 'https://h5.qzone.qq.com/qqq/code/abc123?_proxy=1&from=ide');
    assert.ok(ret.backupUrls.includes('https://q.qq.com/qqq/code/abc123?_proxy=1&from=ide'));
});
