const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStatusUiPayload } = require('../src/status');

test('buildStatusUiPayload should include exp progress fields for next level', () => {
    const payload = buildStatusUiPayload({
        platform: 'qq',
        name: 'tester',
        level: 10,
        gold: 100,
        exp: 5000,
    });

    assert.equal(typeof payload.expCurrent, 'number');
    assert.equal(typeof payload.expNeeded, 'number');
    assert.equal(typeof payload.expToNext, 'number');
    assert.ok(payload.expNeeded >= payload.expCurrent);
    assert.equal(payload.expToNext, payload.expNeeded - payload.expCurrent);
});
