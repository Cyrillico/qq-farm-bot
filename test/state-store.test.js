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
