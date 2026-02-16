const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { SessionRunner } = require('../web/session-runner');

function createFakeChild() {
    const child = new EventEmitter();
    child.connected = true;
    child.sent = [];
    child.send = (msg) => {
        child.sent.push(msg);
        return true;
    };
    return child;
}

test('session runner callRpc sends request and resolves with rpc response', async () => {
    const runner = new SessionRunner({ rootDir: process.cwd() });
    const child = createFakeChild();
    runner.child = child;

    const pending = runner.callRpc('friends.list', {}, 200);
    const req = child.sent[0];
    assert.equal(req.type, 'rpc:req');
    assert.equal(req.method, 'friends.list');

    child.emit('message', {
        type: 'rpc:res',
        requestId: req.requestId,
        ok: true,
        payload: [{ gid: '1', name: 'A' }],
    });

    const ret = await pending;
    assert.equal(Array.isArray(ret), true);
    assert.equal(ret[0].name, 'A');
});

test('session runner callRpc rejects when rpc response returns error', async () => {
    const runner = new SessionRunner({ rootDir: process.cwd() });
    const child = createFakeChild();
    runner.child = child;

    const pending = runner.callRpc('friends.op', { gid: '1', action: 'bad' }, 200);
    const req = child.sent[0];

    child.emit('message', {
        type: 'rpc:res',
        requestId: req.requestId,
        ok: false,
        error: 'not allowed',
    });

    await assert.rejects(() => pending, /not allowed/);
});
