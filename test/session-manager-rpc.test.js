const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { SessionManager } = require('../web/session-manager');

class RpcRunner extends EventEmitter {
    constructor() {
        super();
        this.running = true;
        this.calls = [];
    }

    isRunning() {
        return this.running;
    }

    start() {
        return { pid: 1000, mode: 'run', args: [] };
    }

    stop() {
        this.running = false;
        return Promise.resolve(true);
    }

    applyBarkSettings() {
        return true;
    }

    callRpc(method, payload) {
        this.calls.push({ method, payload });
        if (method === 'friends.list') {
            return Promise.resolve([{ gid: '1', name: 'A' }]);
        }
        if (method === 'friends.op') {
            return Promise.resolve({ ok: true, action: payload.action });
        }
        return Promise.reject(new Error('unsupported'));
    }
}

test('session manager forwards friends.list and friends.op to runner rpc', async () => {
    const manager = new SessionManager({
        createRunner: () => new RpcRunner(),
    });
    manager.start('qq-main', { mode: 'run', platform: 'qq', code: 'x' });

    const friends = await manager.listFriends('qq-main');
    assert.equal(Array.isArray(friends), true);
    assert.equal(friends[0].name, 'A');

    const ret = await manager.runFriendOp('qq-main', { gid: '1', action: 'steal' });
    assert.equal(ret.ok, true);
    assert.equal(ret.action, 'steal');
});

test('session manager friend rpc throws when session is not running', async () => {
    const manager = new SessionManager({
        createRunner: () => new RpcRunner(),
    });
    manager.start('qq-main', { mode: 'run', platform: 'qq', code: 'x' });
    await manager.stop('qq-main');

    await assert.rejects(() => manager.listFriends('qq-main'), /session not running/i);
    await assert.rejects(() => manager.runFriendOp('qq-main', { gid: '1', action: 'steal' }), /session not running/i);
});
