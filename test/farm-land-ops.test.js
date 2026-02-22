const test = require('node:test');
const assert = require('node:assert/strict');

const farm = require('../src/farm');

test('farm helper should pick unlock and upgrade candidates from all lands', () => {
    assert.ok(farm.__private && typeof farm.__private.pickLandActionTargets === 'function');

    const targets = farm.__private.pickLandActionTargets([
        { id: 1, unlocked: false, could_unlock: true },
        { id: 2, unlocked: false, could_unlock: false },
        { id: 3, unlocked: true, could_upgrade: true, level: 1, max_level: 2 },
        { id: 4, unlocked: true, could_upgrade: true, level: 2, max_level: 2 },
    ]);

    assert.deepEqual(targets.unlockLandIds, [1]);
    assert.deepEqual(targets.upgradeLandIds, [3]);
});

test('farm land requirement parser should support direct and conds fields', () => {
    assert.ok(typeof farm.__private.parseLandRequirementCondition === 'function');

    const direct = farm.__private.parseLandRequirementCondition({
        need_level: 20,
        need_gold: 45000,
    });
    assert.equal(direct.needLevel, 20);
    assert.equal(direct.needGold, 45000);

    const conds = farm.__private.parseLandRequirementCondition({
        conds: [
            { type: 1, param: 32 },
            { type: 2, param: 780000 },
        ],
    });
    assert.equal(conds.needLevel, 32);
    assert.equal(conds.needGold, 780000);
});

test('farm land requirement meta should choose unlock vs upgrade labels correctly', () => {
    assert.ok(typeof farm.__private.resolveLandRequirementMeta === 'function');

    const unlockMeta = farm.__private.resolveLandRequirementMeta({
        unlocked: false,
        could_unlock: true,
        unlock_condition: { need_level: 12, need_gold: 6000 },
    }, false);
    assert.equal(unlockMeta.type, 'unlock');
    assert.equal(unlockMeta.label, '解锁需');
    assert.equal(unlockMeta.needLevel, 12);
    assert.equal(unlockMeta.needGold, 6000);

    const upgradeMeta = farm.__private.resolveLandRequirementMeta({
        unlocked: true,
        could_upgrade: true,
        level: 1,
        max_level: 3,
        upgrade_condition: { need_level: 18, need_gold: 20000 },
    }, true);
    assert.equal(upgradeMeta.type, 'upgrade');
    assert.equal(upgradeMeta.label, '升级需');
    assert.equal(upgradeMeta.needLevel, 18);
    assert.equal(upgradeMeta.needGold, 20000);
});
