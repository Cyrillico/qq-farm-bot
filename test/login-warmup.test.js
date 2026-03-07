const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildLoginStartupPlan,
    LOGIN_STARTUP_DELAY_MS,
} = require('../src/loginWarmup');

test('冷启动时应按分阶段计划拉起子系统，避免登录后请求突刺', () => {
    assert.deepEqual(buildLoginStartupPlan({
        farmEnabled: true,
        friendEnabled: true,
        taskEnabled: true,
        sellEnabled: true,
    }), [
        { key: 'farm', delayMs: 0 },
        { key: 'friend', delayMs: LOGIN_STARTUP_DELAY_MS.friend },
        { key: 'task', delayMs: LOGIN_STARTUP_DELAY_MS.task },
        { key: 'sell', delayMs: LOGIN_STARTUP_DELAY_MS.sell },
        { key: 'sellDebug', delayMs: LOGIN_STARTUP_DELAY_MS.sellDebug },
    ]);
});

test('禁用的子系统不应出现在登录预热计划里', () => {
    assert.deepEqual(buildLoginStartupPlan({
        farmEnabled: true,
        friendEnabled: false,
        taskEnabled: false,
        sellEnabled: false,
    }), [
        { key: 'farm', delayMs: 0 },
    ]);
});
