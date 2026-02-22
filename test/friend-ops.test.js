const test = require('node:test');
const assert = require('node:assert/strict');

const friend = require('../src/friend');

function makeGrowingLand({
    id,
    weedsTimeOffsetSec = -5,
    insectTimeOffsetSec = -5,
    weedOwners = [],
    insectOwners = [],
}) {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        id,
        plant: {
            id: 123,
            name: '测试作物',
            phases: [{
                phase: 3,
                begin_time: nowSec - 60,
                weeds_time: nowSec + weedsTimeOffsetSec,
                insect_time: nowSec + insectTimeOffsetSec,
                dry_time: 0,
            }],
            dry_num: 0,
            weed_owners: weedOwners,
            insect_owners: insectOwners,
            stealable: false,
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
    assert.deepEqual(status.canPutWeed, [1]);
    assert.deepEqual(status.canPutBug, [1]);
});

test('analyzeFriendLands relaxed mode should fallback for manual bad-ops when strict window is empty', () => {
    const lands = [
        makeGrowingLand({ id: 10, weedsTimeOffsetSec: 3600, insectTimeOffsetSec: 3600 }),
        makeGrowingLand({ id: 11, weedsTimeOffsetSec: 3600, insectTimeOffsetSec: 3600, weedOwners: [111], insectOwners: [111] }),
    ];

    const strictStatus = friend.__private.analyzeFriendLands(lands, 111, '测试好友');
    assert.deepEqual(strictStatus.canPutWeed, []);
    assert.deepEqual(strictStatus.canPutBug, []);

    const relaxedStatus = friend.__private.analyzeFriendLands(lands, 111, '测试好友', { relaxedBadOps: true });
    assert.deepEqual(relaxedStatus.canPutWeed, [10]);
    assert.deepEqual(relaxedStatus.canPutBug, [10]);
});
