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

test('state store aggregates account stats from status, session and logs', () => {
    const store = createStateStore({ maxLogs: 20 });

    store.setSession('wx-main', {
        status: 'running',
        startedAt: 1000,
    }, { now: 1000 });
    store.setStatus('wx-main', {
        platform: 'wx',
        name: '测试号',
        level: 10,
        exp: 1000,
        gold: 5000,
    }, { now: 2000 });
    store.setStatus('wx-main', {
        exp: 1120,
        gold: 5300,
        level: 10,
    }, { now: 3000 });

    store.addLog('wx-main', {
        ts: 4000,
        level: 'warn',
        tag: '推送',
        text: '[推送] 被踢下线! gatepb.KickoutNotify',
    });
    store.addLog('wx-main', {
        ts: 5000,
        level: 'warn',
        tag: 'WS',
        text: '[WS] ⚠ 连接关闭 (code=1006)',
    });
    store.addLog('wx-main', {
        ts: 6000,
        level: 'info',
        tag: '农场',
        text: '[农场] [收:7 长:0] → 收获7/种植7',
    });
    store.addLog('wx-main', {
        ts: 7000,
        level: 'warn',
        tag: '好友',
        action: 'friend_manual',
        text: '[好友] ⚠ 手动操作 KFC9999: steal -> 偷取完成',
    });

    store.setSession('wx-main', {
        status: 'stopped',
        stoppedAt: 9000,
    }, { now: 9000 });

    const statsResp = store.getStatsSnapshot({ now: 10000 });
    const acc = statsResp.accounts['wx-main'];
    assert.ok(acc);
    assert.equal(acc.current.platform, 'wx');
    assert.equal(acc.current.name, '测试号');
    assert.equal(acc.current.level, 10);
    assert.equal(acc.current.exp, 1120);
    assert.equal(acc.current.gold, 5300);
    assert.equal(acc.today.expDelta, 120);
    assert.equal(acc.today.goldDelta, 300);
    assert.equal(acc.counts.kickout, 1);
    assert.equal(acc.counts.wsClose, 1);
    assert.equal(acc.counts.harvest, 7);
    assert.equal(acc.counts.plant, 7);
    assert.equal(acc.counts.friendManual, 1);
    assert.ok(acc.runtime.runningMsToday >= 8000);
    assert.ok(Array.isArray(acc.trends.exp) && acc.trends.exp.length >= 2);
    assert.ok(Array.isArray(acc.trends.gold) && acc.trends.gold.length >= 2);
    assert.equal(statsResp.summary.totalAccounts >= 1, true);
    assert.equal(statsResp.summary.runningAccounts >= 0, true);
});

test('state store aggregates bark metric events precisely', () => {
    const store = createStateStore({ maxLogs: 10 });

    store.recordMetricEvent('qq-main', { type: 'bark', sent: true, reason: 'ok', category: 'network' }, { now: 1000 });
    store.recordMetricEvent('qq-main', { type: 'bark', sent: false, reason: 'deduped', category: 'network' }, { now: 1100 });
    store.recordMetricEvent('qq-main', { type: 'bark', sent: false, reason: 'request_failed', category: 'fatal' }, { now: 1200 });

    const stats = store.getStatsSnapshot({ now: 1300 });
    const acc = stats.accounts['qq-main'];
    assert.ok(acc);
    assert.equal(acc.counts.barkSuccess, 1);
    assert.equal(acc.counts.barkDeduped, 1);
    assert.equal(acc.counts.barkFailed, 1);
    assert.equal(acc.counts.barkByCategory.fatal, 1);
    assert.equal(acc.counts.barkByCategory.network, 2);
    assert.equal(stats.summary.counts.barkSuccess, 1);
    assert.equal(stats.summary.counts.barkDeduped, 1);
    assert.equal(stats.summary.counts.barkFailed, 1);
});

test('state store can export and import stats state for persistence', () => {
    const a = createStateStore({ maxLogs: 10 });
    a.setStatus('wx-main', { platform: 'wx', name: 'A', exp: 500, gold: 1000 }, { now: 1000 });
    a.setStatus('wx-main', { exp: 620, gold: 1300 }, { now: 2000 });
    a.recordMetricEvent('wx-main', { type: 'bark', sent: false, reason: 'deduped', category: 'business' }, { now: 3000 });

    const exported = a.exportStatsState();
    const b = createStateStore({ maxLogs: 10 });
    const ret = b.importStatsState(exported);
    assert.equal(ret.ok, true);

    const snapshot = b.getStatsSnapshot({ now: 4000 });
    const acc = snapshot.accounts['wx-main'];
    assert.ok(acc);
    assert.equal(acc.today.expDelta, 120);
    assert.equal(acc.today.goldDelta, 300);
    assert.equal(acc.counts.barkDeduped, 1);
});
