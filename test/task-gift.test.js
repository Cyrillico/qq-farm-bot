const test = require('node:test');
const assert = require('node:assert/strict');

const task = require('../src/task');

test('task helpers should pick claimable actives by status', () => {
    assert.ok(task.__private && typeof task.__private.pickClaimableActives === 'function');

    const picked = task.__private.pickClaimableActives([
        { id: 1, status: 0 },
        { id: 2, status: 1 },
        { id: 3, status: 2 },
    ]);

    assert.deepEqual(picked, [2]);
});

test('task helpers should find gift-like items conservatively', () => {
    assert.ok(task.__private && typeof task.__private.pickGiftItems === 'function');

    const picked = task.__private.pickGiftItems([
        { id: 101, count: 2, name: '新手礼包' },
        { id: 102, count: 5, name: '白萝卜种子' },
        { id: 103, count: 1, name: '惊喜宝箱' },
    ]);

    assert.deepEqual(picked.map((x) => x.id), [101, 103]);
});
