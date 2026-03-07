const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { pushBarkDetailed } = require('../src/bark');

test('pushBarkDetailed should pass actionUrl via Bark params', async (t) => {
    const originalGet = axios.get;
    const calls = [];
    axios.get = async (url, options = {}) => {
        calls.push({ url, options });
        return { status: 200, data: { code: 200 } };
    };
    t.after(() => {
        axios.get = originalGet;
    });

    const result = await pushBarkDetailed(
        'QQ农场离线提醒',
        '账号已下线，请点击通知重新登录',
        'offline:test',
        {
            category: 'network',
            actionUrl: 'https://example.test/relogin',
            settings: {
                enabled: true,
                pushUrl: 'https://api.day.app/test-key/',
                group: 'qq-farm-bot',
                dedupSeconds: 0,
                categories: { fatal: true, network: true, business: true },
            },
        }
    );

    assert.equal(result.sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.params.group, 'qq-farm-bot');
    assert.equal(calls[0].options.params.url, 'https://example.test/relogin');
});
