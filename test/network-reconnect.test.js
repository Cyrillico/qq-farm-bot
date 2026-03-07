const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

function loadNetworkWithMocks() {
    const modulePath = require.resolve('../src/network');
    delete require.cache[modulePath];

    const scheduled = [];
    const sockets = [];

    class FakeWebSocket extends EventEmitter {
        constructor(url, options) {
            super();
            this.url = url;
            this.options = options;
            this.readyState = FakeWebSocket.CONNECTING;
            this.sent = [];
            sockets.push(this);
        }

        send(payload) {
            this.sent.push(payload);
        }

        close() {
            this.readyState = FakeWebSocket.CLOSED;
        }
    }

    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSED = 3;

    const fakeTypes = {
        GateMessage: {
            create(value) {
                return value;
            },
            encode(value) {
                return {
                    finish() {
                        return Buffer.from(JSON.stringify(value));
                    },
                };
            },
        },
        LoginRequest: {
            create(value) {
                return value;
            },
            encode(value) {
                return {
                    finish() {
                        return Buffer.from(JSON.stringify(value));
                    },
                };
            },
        },
    };

    const mocks = new Map([
        ['ws', FakeWebSocket],
        ['./config', {
            CONFIG: {
                serverUrl: 'wss://example.test/ws',
                platform: 'qq',
                os: 'iOS',
                clientVersion: '1.6.0.14_20251224',
                heartbeatInterval: 25000,
                device_info: {
                    client_version: '1.6.0.14_20251224',
                    sys_software: 'iOS 26.2.1',
                    network: 'wifi',
                    memory: '7672',
                    device_id: 'iPhone X<iPhone18,3>',
                },
            },
        }],
        ['./proto', { types: fakeTypes }],
        ['./utils', {
            toLong(value) {
                return value;
            },
            toNum(value) {
                return Number(value || 0);
            },
            syncServerTime() {},
            log() {},
            logWarn() {},
        }],
        ['./status', {
            updateStatusFromLogin() {},
            updateStatusGold() {},
            updateStatusLevel() {},
        }],
    ]);

    const originalLoad = Module._load;
    const originalSetTimeout = global.setTimeout;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (mocks.has(request)) {
            return mocks.get(request);
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    global.setTimeout = (fn, delay, ...args) => {
        const handle = { fn, delay, args };
        scheduled.push(handle);
        return handle;
    };

    const network = require('../src/network');

    return {
        network,
        scheduled,
        sockets,
        restore() {
            Module._load = originalLoad;
            global.setTimeout = originalSetTimeout;
            delete require.cache[modulePath];
        },
    };
}

test('network reconnects automatically after unexpected close', () => {
    const fixture = loadNetworkWithMocks();
    try {
        fixture.network.connect('login-code', () => {});
        assert.equal(fixture.sockets.length, 1);

        fixture.sockets[0].emit('close', 1006, Buffer.from('unexpected'));

        assert.equal(fixture.scheduled.length, 1);
        fixture.scheduled[0].fn(...fixture.scheduled[0].args);
        assert.equal(fixture.sockets.length, 2);
    } finally {
        fixture.restore();
    }
});

test('network connect should encode login code in websocket url query', () => {
    const fixture = loadNetworkWithMocks();
    try {
        fixture.network.connect('a+/=?&b', () => {});
        assert.equal(fixture.sockets.length, 1);
        const socketUrl = fixture.sockets[0].url;
        assert.match(socketUrl, /code=a%2B%2F%3D%3F%26b/);
        assert.doesNotMatch(socketUrl, /code=a\+\/=\?&b/);
    } finally {
        fixture.restore();
    }
});

test('network should parse unexpected server response status into wsError event', () => {
    const fixture = loadNetworkWithMocks();
    try {
        fixture.network.connect('login-code', () => {});
        const events = [];
        fixture.network.networkEvents.on('wsError', (payload) => {
            events.push(payload);
        });

        fixture.sockets[0].emit('error', new Error('Unexpected server response: 400'));

        assert.equal(events.length, 1);
        assert.equal(events[0].code, 400);
        assert.equal(events[0].message, 'Unexpected server response: 400');
    } finally {
        fixture.restore();
    }
});
