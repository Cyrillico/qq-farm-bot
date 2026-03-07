const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/config');
const task = require('../src/task');

test('默认农场巡查间隔应保持保守值，避免登录后瞬时高频请求', () => {
    assert.equal(CONFIG.farmCheckInterval, 2000);
});

test('任务系统应给登录稳定期后再执行首次自动检查', () => {
    assert.equal(typeof task.__private.getInitialTaskStartupDelayMs, 'function');
    assert.equal(task.__private.getInitialTaskStartupDelayMs(), 8000);
});
