const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createLoginRateLimiter,
    parseIpWhitelist,
    isIpAllowed,
    maskBarkPushUrl,
    maskBarkSettings,
} = require('../web/security');

test('login rate limiter blocks after max failures within window and resets after window', () => {
    const limiter = createLoginRateLimiter({ maxAttempts: 3, windowMs: 1000 });
    const key = '127.0.0.1';

    let ret = limiter.check(key, 0);
    assert.equal(ret.allowed, true);

    limiter.recordFailure(key, 10);
    limiter.recordFailure(key, 20);
    limiter.recordFailure(key, 30);

    ret = limiter.check(key, 40);
    assert.equal(ret.allowed, false);
    assert.ok(ret.retryAfterMs > 0);

    ret = limiter.check(key, 1101);
    assert.equal(ret.allowed, true);
});

test('IP whitelist supports exact ip and IPv4 CIDR', () => {
    const rules = parseIpWhitelist('127.0.0.1, 192.168.1.0/24,10.0.0.5');
    assert.equal(isIpAllowed('127.0.0.1', rules), true);
    assert.equal(isIpAllowed('192.168.1.23', rules), true);
    assert.equal(isIpAllowed('10.0.0.5', rules), true);
    assert.equal(isIpAllowed('192.168.2.1', rules), false);
    assert.equal(isIpAllowed('10.0.0.6', rules), false);
});

test('maskBarkPushUrl masks bark key and preserves shape', () => {
    const raw = 'https://api.day.app/zu5iBDxxzi8GPnjXaBsMKV/';
    const masked = maskBarkPushUrl(raw);
    assert.equal(masked.startsWith('https://api.day.app/'), true);
    assert.equal(masked.includes('zu5i'), true);
    assert.equal(masked.includes('***'), true);
    assert.equal(masked.includes('BsMKV'), true);
    assert.equal(masked.includes('zu5iBDxxzi8GPnjXaBsMKV'), false);
});

test('maskBarkSettings masks pushUrl but keeps config shape', () => {
    const masked = maskBarkSettings({
        enabled: true,
        pushUrl: 'https://api.day.app/abcdefg1234567/',
        group: 'qq-farm-bot',
        dedupSeconds: 60,
        categories: { fatal: true, network: false, business: true },
    });
    assert.equal(masked.enabled, true);
    assert.equal(masked.group, 'qq-farm-bot');
    assert.equal(masked.categories.network, false);
    assert.equal(masked.pushUrl.includes('***'), true);
});

