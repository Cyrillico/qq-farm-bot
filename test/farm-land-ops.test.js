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
