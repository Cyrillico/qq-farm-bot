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
        { id: 104, count: 1, name: '每日福袋' },
    ]);

    assert.deepEqual(picked.map((x) => x.id), [101, 103, 104]);
});

test('task helpers should treat sign-in style tasks as claimable when unlocked and unclaimed', () => {
    assert.ok(task.__private && typeof task.__private.analyzeTaskList === 'function');

    const claimable = task.__private.analyzeTaskList([
        {
            id: 201,
            is_unlocked: true,
            is_claimed: false,
            progress: 0,
            total_progress: 0,
            desc: '每日签到',
            share_multiple: 1,
            rewards: [],
        },
        {
            id: 202,
            is_unlocked: true,
            is_claimed: false,
            progress: 0,
            total_progress: 5,
            desc: '浇水5次',
            share_multiple: 1,
            rewards: [],
        },
    ]);

    assert.deepEqual(claimable.map((x) => x.id), [201]);
});
