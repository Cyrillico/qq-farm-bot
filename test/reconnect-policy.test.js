const test = require('node:test');
const assert = require('node:assert/strict');

const {
    shouldAttemptAutoReconnectForKickout,
    shouldAttemptAutoReloginForWsError,
} = require('../src/reconnectPolicy');

test('kickout reason with inactivity should allow auto reconnect', () => {
    assert.equal(shouldAttemptAutoReconnectForKickout('长时间未操作，请重新登录'), true);
    assert.equal(shouldAttemptAutoReconnectForKickout('因未操作时间过长而下线'), true);
});

test('kickout reason with other terminal login should stay fatal', () => {
    assert.equal(shouldAttemptAutoReconnectForKickout('已在其他终端登录'), false);
    assert.equal(shouldAttemptAutoReconnectForKickout('异地登录'), false);
    assert.equal(shouldAttemptAutoReconnectForKickout(''), false);
});

test('wsError 400 or login-invalid message should trigger relogin', () => {
    assert.equal(shouldAttemptAutoReloginForWsError({ code: 400, message: 'Unexpected server response: 400' }), true);
    assert.equal(shouldAttemptAutoReloginForWsError({ message: '登录失效，请更新 Code' }), true);
    assert.equal(shouldAttemptAutoReloginForWsError({ message: 'invalid login code' }), true);
});

test('other wsError messages should not trigger relogin', () => {
    assert.equal(shouldAttemptAutoReloginForWsError({ code: 502, message: 'Unexpected server response: 502' }), false);
    assert.equal(shouldAttemptAutoReloginForWsError({ message: 'socket hang up' }), false);
    assert.equal(shouldAttemptAutoReloginForWsError({}), false);
});
