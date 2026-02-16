const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildAuthConfig,
    isAuthEnabled,
    signSessionToken,
    verifySessionToken,
    parseCookieHeader,
} = require('../web/auth');

test('auth config enabled only when username and password both provided', () => {
    const disabled = buildAuthConfig({
        WEB_UI_AUTH_USERNAME: 'admin',
        WEB_UI_AUTH_PASSWORD: '',
        WEB_UI_AUTH_SECRET: 's',
    });
    assert.equal(isAuthEnabled(disabled), false);

    const enabled = buildAuthConfig({
        WEB_UI_AUTH_USERNAME: 'admin',
        WEB_UI_AUTH_PASSWORD: 'pass',
        WEB_UI_AUTH_SECRET: 's',
    });
    assert.equal(isAuthEnabled(enabled), true);
    assert.equal(enabled.username, 'admin');
});

test('session token sign and verify roundtrip', () => {
    const cfg = buildAuthConfig({
        WEB_UI_AUTH_USERNAME: 'admin',
        WEB_UI_AUTH_PASSWORD: 'pass',
        WEB_UI_AUTH_SECRET: 'test-secret',
    });

    const token = signSessionToken('admin', cfg.secret, 1700000000000);
    const verified = verifySessionToken(token, cfg.secret, 1700000000000 + 1000, 24 * 3600 * 1000);
    assert.equal(verified.ok, true);
    assert.equal(verified.username, 'admin');
});

test('session token verify fails for tampered token or expired token', () => {
    const cfg = buildAuthConfig({
        WEB_UI_AUTH_USERNAME: 'admin',
        WEB_UI_AUTH_PASSWORD: 'pass',
        WEB_UI_AUTH_SECRET: 'test-secret',
    });

    const token = signSessionToken('admin', cfg.secret, 1700000000000);
    const tampered = `${token}x`;
    const bad = verifySessionToken(tampered, cfg.secret, 1700000000000 + 1000, 24 * 3600 * 1000);
    assert.equal(bad.ok, false);

    const expired = verifySessionToken(token, cfg.secret, 1700000000000 + 25 * 3600 * 1000, 24 * 3600 * 1000);
    assert.equal(expired.ok, false);
});

test('parseCookieHeader parses key value pairs', () => {
    const cookies = parseCookieHeader('a=1; b=hello%20world; c=3');
    assert.equal(cookies.a, '1');
    assert.equal(cookies.b, 'hello world');
    assert.equal(cookies.c, '3');
});
