const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../src/task');

test('runManualDailyGiftAction should dispatch to target action and return refreshed overview', async () => {
    const calls = [];
    const ret = await __private.runManualDailyGiftAction('vip_daily_gift', {
        taskInfo: { tasks: [], actives: [] },
        bagItems: [],
        settings: {
            taskEnabled: true,
            taskActiveEnabled: true,
            giftEnabled: true,
            vipGiftEnabled: true,
            monthCardEnabled: true,
            openServerGiftEnabled: true,
        },
        claimTasksFromList: async (tasks) => { calls.push(['task_claim', tasks.length]); },
        claimActiveRewards: async () => { calls.push(['task_active']); },
        openGiftPacks: async () => { calls.push(['bag_gifts']); },
        performDailyVipGift: async (force) => { calls.push(['vip_daily_gift', force]); return true; },
        performDailyMonthCardGift: async (force) => { calls.push(['month_card_gift', force]); return true; },
        performDailyOpenServerGift: async (force) => { calls.push(['open_server_gift', force]); return true; },
        buildOverview: async () => ({ ts: 1, gifts: [{ key: 'vip_daily_gift', canClaim: false }] }),
    });

    assert.deepEqual(calls, [['vip_daily_gift', true]]);
    assert.equal(ret.ok, true);
    assert.equal(ret.key, 'vip_daily_gift');
    assert.equal(Array.isArray(ret.overview.gifts), true);
});


test('runManualDailyGiftAction should support all and execute enabled gift actions in order', async () => {
    const calls = [];
    const ret = await __private.runManualDailyGiftAction('all', {
        taskInfo: {
            tasks: [{ id: 1, progress: 1, total_progress: 1, is_claimed: false, is_unlocked: true, desc: '每日任务' }],
            actives: [{ id: 10, status: 1 }],
        },
        bagItems: [{ id: 999, count: 2, name: '礼包宝箱' }],
        settings: {
            taskEnabled: true,
            taskActiveEnabled: true,
            giftEnabled: true,
            vipGiftEnabled: true,
            monthCardEnabled: false,
            openServerGiftEnabled: true,
        },
        claimTasksFromList: async (tasks) => { calls.push(['task_claim', tasks.length]); },
        claimActiveRewards: async () => { calls.push(['task_active']); },
        openGiftPacks: async () => { calls.push(['bag_gifts']); },
        performDailyVipGift: async (force) => { calls.push(['vip_daily_gift', force]); return true; },
        performDailyMonthCardGift: async (force) => { calls.push(['month_card_gift', force]); return true; },
        performDailyOpenServerGift: async (force) => { calls.push(['open_server_gift', force]); return true; },
        buildOverview: async () => ({ ts: 2, gifts: [{ key: 'all' }] }),
    });

    assert.deepEqual(calls, [
        ['task_claim', 1],
        ['task_active'],
        ['bag_gifts'],
        ['vip_daily_gift', true],
        ['open_server_gift', true],
    ]);
    assert.equal(ret.ok, true);
    assert.equal(ret.key, 'all');
    assert.equal(Array.isArray(ret.overview.gifts), true);
});
