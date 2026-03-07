const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const qrcodeTerminal = require('qrcode-terminal');

const { resolveQrUrls, waitForLoginCodeResult, getQQFarmCodeByScan, getAuthCode } = require('../src/qqQrLogin');

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


test('waitForLoginCodeResult should resolve auth code after scan confirmation', async () => {
    const frames = [];
    let callCount = 0;

    const authCode = await waitForLoginCodeResult({
        loginCode: 'abc123',
        url: 'https://example.test/qr',
        backupUrls: ['https://example.test/alt'],
        pollIntervalMs: 0,
        timeoutMs: 1000,
        waitingNoticeIntervalMs: 0,
        queryStatus: async () => {
            callCount += 1;
            if (callCount === 1) return { status: 'Wait' };
            return { status: 'OK', ticket: 'ticket-1' };
        },
        exchangeTicket: async (ticket) => {
            assert.equal(ticket, 'ticket-1');
            return 'auth-code-1';
        },
        emitQrEvent: (type, payload) => {
            frames.push({ type, ...(payload || {}) });
        },
        sleep: async () => {},
    });

    assert.equal(authCode, 'auth-code-1');
    assert.equal(frames[0].type, 'qr');
    assert.equal(frames[0].phase, 'waiting');
    assert.equal(frames.at(-1).phase, 'confirmed');
    assert.equal(frames.at(-1).qrUrl, 'https://example.test/qr');
});

test('waitForLoginCodeResult should keep retrying confirmed ticket when auth code exchange is transiently invalid', async () => {
    const frames = [];
    let queryCount = 0;
    let exchangeCount = 0;

    const authCode = await waitForLoginCodeResult({
        loginCode: 'abc123',
        url: 'https://example.test/qr',
        backupUrls: ['https://example.test/alt'],
        pollIntervalMs: 0,
        timeoutMs: 1000,
        waitingNoticeIntervalMs: 0,
        queryStatus: async () => {
            queryCount += 1;
            return { status: 'OK', ticket: 'ticket-keep' };
        },
        exchangeTicket: async (ticket) => {
            exchangeCount += 1;
            assert.equal(ticket, 'ticket-keep');
            if (exchangeCount < 3) {
                throw new Error('获取农场登录 code 失败: code=-3000 校验失败');
            }
            return 'auth-code-final';
        },
        emitQrEvent: (type, payload) => {
            frames.push({ type, ...(payload || {}) });
        },
        sleep: async () => {},
    });

    assert.equal(authCode, 'auth-code-final');
    assert.equal(queryCount, 1);
    assert.equal(exchangeCount, 3);
    assert.equal(frames.at(-1).phase, 'confirmed');
});

test('waitForLoginCodeResult should still fail fast for non-transient auth code exchange errors', async () => {
    let queryCount = 0;
    let exchangeCount = 0;

    await assert.rejects(() => waitForLoginCodeResult({
        loginCode: 'abc123',
        url: 'https://example.test/qr',
        backupUrls: [],
        pollIntervalMs: 0,
        timeoutMs: 1000,
        waitingNoticeIntervalMs: 0,
        queryStatus: async () => {
            queryCount += 1;
            return { status: 'OK', ticket: 'ticket-hard-fail' };
        },
        exchangeTicket: async () => {
            exchangeCount += 1;
            throw new Error('获取农场登录 code 失败: code=401 ticket invalid');
        },
        emitQrEvent: () => {},
        sleep: async () => {},
    }), /ticket invalid/);

    assert.equal(queryCount, 1);
    assert.equal(exchangeCount, 1);
});

test('waitForLoginCodeResult should throw when relogin qr is expired', async () => {
    const frames = [];

    await assert.rejects(() => waitForLoginCodeResult({
        loginCode: 'abc123',
        url: 'https://example.test/qr',
        backupUrls: [],
        pollIntervalMs: 0,
        timeoutMs: 1000,
        queryStatus: async () => ({ status: 'Used' }),
        exchangeTicket: async () => 'should-not-be-used',
        emitQrEvent: (type, payload) => {
            frames.push({ type, ...(payload || {}) });
        },
        sleep: async () => {},
    }), /二维码已失效/);

    assert.equal(frames.at(-1).phase, 'expired');
    assert.equal(frames.at(-1).message, '二维码已失效，请重试');
});

test('getQQFarmCodeByScan should call onCodeReady before polling', async (t) => {
    let readyPayload = null;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalLog = console.log;
    const originalGenerate = qrcodeTerminal.generate;

    axios.get = async (url) => {
        if (String(url).includes('GetLoginCode')) {
            return {
                status: 200,
                data: {
                    code: 0,
                    data: {
                        code: 'abc123',
                        url: 'https://example.test/qr',
                        qr_url: 'https://example.test/alt',
                    },
                },
            };
        }
        if (String(url).includes('syncScanSateGetTicket')) {
            return {
                status: 200,
                data: {
                    code: 0,
                    data: { ok: 1, ticket: 'ticket-1' },
                },
            };
        }
        throw new Error(`unexpected axios.get url: ${url}`);
    };
    axios.post = async (url, body) => {
        assert.match(String(url), /\/ide\/login$/);
        assert.equal(body.ticket, 'ticket-1');
        return { status: 200, data: { code: 'auth-code-1' } };
    };
    console.log = () => {};
    qrcodeTerminal.generate = () => {};

    t.after(() => {
        axios.get = originalGet;
        axios.post = originalPost;
        console.log = originalLog;
        qrcodeTerminal.generate = originalGenerate;
    });

    const authCode = await getQQFarmCodeByScan({
        relogin: true,
        emitQrEvent: () => {},
        sleep: async () => {},
        onCodeReady: async (payload) => {
            readyPayload = payload;
        },
    });

    assert.equal(authCode, 'auth-code-1');
    assert.deepEqual(readyPayload, {
        loginCode: 'abc123',
        url: 'https://h5.qzone.qq.com/qqq/code/abc123?_proxy=1&from=ide',
        backupUrls: [
            'https://q.qq.com/qqq/code/abc123?_proxy=1&from=ide',
            'https://q.qq.com/qqq/code/abc123?from=ide',
            'https://example.test/qr',
            'https://example.test/alt',
        ],
        relogin: true,
    });
});


test('getAuthCode should prefer nested data.code when top-level code is status field', async (t) => {
    const originalPost = axios.post;

    axios.post = async () => ({
        status: 200,
        data: {
            code: 0,
            data: {
                code: 'auth-code-1',
            },
        },
    });

    t.after(() => {
        axios.post = originalPost;
    });

    const authCode = await getAuthCode('ticket-1');
    assert.equal(authCode, 'auth-code-1');
});

test('getAuthCode should retry transient negative response before treating it as login code', async (t) => {
    const originalPost = axios.post;
    let attempts = 0;

    axios.post = async () => {
        attempts += 1;
        if (attempts === 1) {
            return {
                status: 200,
                data: {
                    code: -3000,
                    msg: 'busy',
                },
            };
        }
        return {
            status: 200,
            data: {
                code: 'auth-code-2',
            },
        };
    };

    t.after(() => {
        axios.post = originalPost;
    });

    const authCode = await getAuthCode('ticket-1', {
        maxRetries: 1,
        retryDelayMs: 0,
        sleep: async () => {},
    });
    assert.equal(authCode, 'auth-code-2');
    assert.equal(attempts, 2);
});
