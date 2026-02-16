const test = require('node:test');
const assert = require('node:assert/strict');

const { createStateStore } = require('../web/state-store');

test('state store keeps per-account state isolated and trims logs per account', () => {
    const store = createStateStore({ maxLogs: 3 });

    store.setStatus('qq-main', { platform: 'qq', name: 'QQ号' });
    store.setStatus('wx-main', { platform: 'wx', name: '微信号' });

    store.addLog('qq-main', { text: '1' });
    store.addLog('qq-main', { text: '2' });
    store.addLog('qq-main', { text: '3' });
    store.addLog('qq-main', { text: '4' });

    store.addLog('wx-main', { text: 'a' });
    store.addLog('wx-main', { text: 'b' });

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.sessions['qq-main'].logs.length, 3);
    assert.equal(snapshot.sessions['qq-main'].logs[0].text, '2');
    assert.equal(snapshot.sessions['wx-main'].logs.length, 2);
    assert.equal(snapshot.sessions['qq-main'].status.platform, 'qq');
    assert.equal(snapshot.sessions['wx-main'].status.platform, 'wx');
});

test('state store can clear logs for one account or all accounts', () => {
    const store = createStateStore({ maxLogs: 5 });
    store.addLog('qq-main', { text: 'q1' });
    store.addLog('wx-main', { text: 'w1' });

    store.clearLogs('qq-main');
    let snapshot = store.getSnapshot();
    assert.equal(snapshot.sessions['qq-main'].logs.length, 0);
    assert.equal(snapshot.sessions['wx-main'].logs.length, 1);

    store.clearLogs();
    snapshot = store.getSnapshot();
    assert.equal(snapshot.sessions['qq-main'].logs.length, 0);
    assert.equal(snapshot.sessions['wx-main'].logs.length, 0);
});

test('state store queryLogs supports filters and cursor pagination', () => {
    const store = createStateStore({ maxLogs: 10 });

    const a = store.addLog('qq-main', {
        ts: 1000,
        level: 'info',
        tag: '好友',
        text: '[好友] 巡查',
        action: '',
    });
    const b = store.addLog('qq-main', {
        ts: 1001,
        level: 'warn',
        tag: '好友',
        text: '[好友] 手动操作 steal',
        action: 'friend_manual',
    });
    const c = store.addLog('wx-main', {
        ts: 1002,
        level: 'error',
        tag: 'WS',
        text: '[WS] 错误',
        action: '',
    });

    assert.ok(a.seq < b.seq);
    assert.ok(b.seq < c.seq);

    const page1 = store.queryLogs({
        accountId: 'qq-main',
        level: 'warn',
        tag: '好友',
        keyword: 'steal',
        action: 'friend_manual',
        limit: 1,
    });
    assert.equal(page1.items.length, 1);
    assert.equal(page1.items[0].text, '[好友] 手动操作 steal');
    assert.ok(page1.nextCursor.beforeTs > 0);
    assert.ok(page1.nextCursor.beforeSeq > 0);

    const page2 = store.queryLogs({
        accountId: 'all',
        level: 'all',
        tag: '',
        keyword: '',
        action: '',
        limit: 2,
        beforeTs: page1.nextCursor.beforeTs,
        beforeSeq: page1.nextCursor.beforeSeq,
    });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.items[0].text, '[好友] 巡查');
});

test('state store can delete account snapshot completely', () => {
    const store = createStateStore({ maxLogs: 10 });
    store.setStatus('qq-main', { platform: 'qq', name: 'QQ号' });
    store.setStatus('wx-main', { platform: 'wx', name: '微信号' });
    store.addLog('qq-main', { text: 'q1' });
    store.addLog('wx-main', { text: 'w1' });

    const removed = store.deleteAccount('qq-main');
    assert.equal(removed, true);
    const snapshot = store.getSnapshot();
    assert.equal(Boolean(snapshot.sessions['qq-main']), false);
    assert.equal(Boolean(snapshot.sessions['wx-main']), true);

    const missing = store.deleteAccount('not-exists');
    assert.equal(missing, false);
});
