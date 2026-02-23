const test = require('node:test');
const assert = require('node:assert/strict');

const friend = require('../src/friend');

function makeGrowingLand({
    id,
    phase = 3,
    weedsTimeOffsetSec = -5,
    insectTimeOffsetSec = -5,
    weedOwners = [],
    insectOwners = [],
    stealable = false,
}) {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        id,
        plant: {
            id: 123,
            name: '测试作物',
            phases: [{
                phase,
                begin_time: nowSec - 60,
                weeds_time: nowSec + weedsTimeOffsetSec,
                insect_time: nowSec + insectTimeOffsetSec,
                dry_time: 0,
            }],
            dry_num: 0,
            weed_owners: weedOwners,
            insect_owners: insectOwners,
            stealable,
        },
    };
}

test('analyzeFriendLands should not throw and should only pick actionable bad-op lands', () => {
    assert.ok(friend.__private && typeof friend.__private.analyzeFriendLands === 'function');

    const lands = [
        makeGrowingLand({ id: 1, weedsTimeOffsetSec: -10, insectTimeOffsetSec: -10 }),
        makeGrowingLand({ id: 2, weedsTimeOffsetSec: 120, insectTimeOffsetSec: 120 }),
        makeGrowingLand({ id: 3, weedsTimeOffsetSec: -10, insectTimeOffsetSec: -10, weedOwners: [111], insectOwners: [111] }),
    ];

    const status = friend.__private.analyzeFriendLands(lands, 111, '测试好友');
    assert.deepEqual(status.canPutWeed, [1, 2]);
    assert.deepEqual(status.canPutBug, [1, 2]);
});

test('analyzeFriendLands relaxed mode should fallback for manual bad-ops when strict window is empty', () => {
    const lands = [
        makeGrowingLand({ id: 10, weedsTimeOffsetSec: 3600, insectTimeOffsetSec: 3600 }),
        makeGrowingLand({ id: 12, weedsTimeOffsetSec: 3600, insectTimeOffsetSec: 3600, weedOwners: [222], insectOwners: [222] }),
        makeGrowingLand({ id: 11, weedsTimeOffsetSec: 3600, insectTimeOffsetSec: 3600, weedOwners: [111], insectOwners: [111] }),
    ];

    const strictStatus = friend.__private.analyzeFriendLands(lands, 111, '测试好友');
    assert.deepEqual(strictStatus.canPutWeed, [10]);
    assert.deepEqual(strictStatus.canPutBug, [10]);

    const relaxedStatus = friend.__private.analyzeFriendLands(lands, 111, '测试好友', { relaxedBadOps: true });
    assert.deepEqual(relaxedStatus.canPutWeed, [10, 12]);
    assert.deepEqual(relaxedStatus.canPutBug, [10, 12]);
});

test('analyzeFriendLands should exclude mature/dead lands from bad-op candidates', () => {
    const lands = [
        makeGrowingLand({ id: 21, phase: 6, stealable: true }), // 成熟
        makeGrowingLand({ id: 22, phase: 7 }), // 枯死
        makeGrowingLand({ id: 23, phase: 4 }), // 生长中
    ];

    const status = friend.__private.analyzeFriendLands(lands, 111, '测试好友');
    assert.deepEqual(status.canPutWeed, [23]);
    assert.deepEqual(status.canPutBug, [23]);
});
