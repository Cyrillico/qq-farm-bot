const test = require('node:test');
const assert = require('node:assert/strict');

const {
    shouldAttemptAutoReconnectForKickout,
    shouldMarkLoginInvalidForWsError,
} = require('../src/reconnectPolicy');

test('kickout reason with inactivity should only allow QQ qr relogin', () => {
    assert.equal(shouldAttemptAutoReconnectForKickout('长时间未操作，请重新登录', { platform: 'qq' }), true);
    assert.equal(shouldAttemptAutoReconnectForKickout('因未操作时间过长而下线', { platform: 'qq' }), true);
    assert.equal(shouldAttemptAutoReconnectForKickout('长时间未操作，请重新登录', { platform: 'wx' }), false);
});

test('kickout reason with other terminal login should stay fatal', () => {
    assert.equal(shouldAttemptAutoReconnectForKickout('已在其他终端登录', { platform: 'qq' }), false);
    assert.equal(shouldAttemptAutoReconnectForKickout('异地登录', { platform: 'qq' }), false);
    assert.equal(shouldAttemptAutoReconnectForKickout('', { platform: 'qq' }), false);
});

test('wsError 400 or login-invalid message should mark code invalid', () => {
    assert.equal(shouldMarkLoginInvalidForWsError({ code: 400, message: 'Unexpected server response: 400' }), true);
    assert.equal(shouldMarkLoginInvalidForWsError({ message: '登录失效，请更新 Code' }), true);
    assert.equal(shouldMarkLoginInvalidForWsError({ message: 'invalid login code' }), true);
});

test('other wsError messages should not mark code invalid', () => {
    assert.equal(shouldMarkLoginInvalidForWsError({ code: 502, message: 'Unexpected server response: 502' }), false);
    assert.equal(shouldMarkLoginInvalidForWsError({ message: 'socket hang up' }), false);
    assert.equal(shouldMarkLoginInvalidForWsError({}), false);
});
