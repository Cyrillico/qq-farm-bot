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
        if (method === 'farm.lands') {
            return Promise.resolve({ lands: [{ id: 1, phaseName: '成熟' }] });
        }
        if (method === 'bag.items') {
            return Promise.resolve({ items: [{ id: 1001, name: '金币', count: 10 }] });
        }
        if (method === 'task.dailyGifts') {
            return Promise.resolve({ gifts: [{ key: 'vip_daily_gift', doneToday: false }] });
        }
        if (method === 'task.dailyGifts.claim') {
            return Promise.resolve({ ok: true, key: payload.key, overview: { gifts: [{ key: payload.key }] } });
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

    const lands = await manager.listLands('qq-main');
    assert.equal(Array.isArray(lands.lands), true);
    assert.equal(lands.lands[0].id, 1);

    const bag = await manager.getBag('qq-main');
    assert.equal(Array.isArray(bag.items), true);
    assert.equal(bag.items[0].id, 1001);

    const gifts = await manager.getDailyGifts('qq-main');
    assert.equal(Array.isArray(gifts.gifts), true);
    assert.equal(gifts.gifts[0].key, 'vip_daily_gift');

    const claim = await manager.claimDailyGift('qq-main', { key: 'vip_daily_gift' });
    assert.equal(claim.ok, true);
    assert.equal(claim.key, 'vip_daily_gift');
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
