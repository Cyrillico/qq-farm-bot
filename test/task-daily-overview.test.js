const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../src/task');

test('buildDailyGiftOverview should include task bag and daily gift entries', () => {
    const ret = __private.buildDailyGiftOverview({
        taskInfo: {
            tasks: [{ id: 1, progress: 1, total_progress: 1, is_claimed: false, is_unlocked: true, desc: '每日任务' }],
            actives: [{ id: 10, status: 1 }],
        },
        bagItems: [{ id: 999, count: 2, name: '礼包宝箱' }],
        serviceStates: {
            vip: { doneToday: false, lastClaimAt: 10, hasGift: true, canClaim: true, result: 'ok' },
            monthCard: { doneToday: false, lastClaimAt: 20, hasCard: true, hasClaimable: true, result: 'ok' },
            openServer: { doneToday: true, lastClaimAt: 30, hasClaimable: false, result: 'none' },
        },
        settings: {
            taskEnabled: true,
            taskActiveEnabled: true,
            giftEnabled: true,
            vipGiftEnabled: true,
            monthCardEnabled: true,
            openServerGiftEnabled: true,
        },
    });

    assert.equal(Array.isArray(ret.gifts), true);
    assert.ok(ret.gifts.some((x) => x.key === 'task_claim' && x.pendingCount === 1));
    assert.ok(ret.gifts.some((x) => x.key === 'bag_gifts' && x.pendingCount === 2));
    assert.ok(ret.gifts.some((x) => x.key === 'vip_daily_gift' && x.canClaim === true));
    assert.ok(ret.gifts.some((x) => x.key === 'month_card_gift' && x.hasClaimable === true));
    assert.ok(ret.gifts.some((x) => x.key === 'open_server_gift' && x.doneToday === true));
});
