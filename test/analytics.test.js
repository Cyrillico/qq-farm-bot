const test = require('node:test');
const assert = require('node:assert/strict');

const { getPlantRankings, pickAvailableSeedByStrategy } = require('../src/analytics');

test('getPlantRankings should sort by configured metric', () => {
    const rankings = getPlantRankings('fert');
    assert.equal(Array.isArray(rankings), true);
    assert.ok(rankings.length > 10);
    assert.ok(rankings[0].normalFertilizerExpPerHour >= rankings[1].normalFertilizerExpPerHour);
});

test('pickAvailableSeedByStrategy should prefer explicit preferred seed when available', () => {
    const available = [
        { seedId: 20003, requiredLevel: 2, price: 2 },
        { seedId: 20074, requiredLevel: 100, price: 20160 },
    ];
    const picked = pickAvailableSeedByStrategy({
        available,
        strategy: 'preferred',
        preferredSeedId: 20074,
        rankingProvider: () => [],
    });
    assert.equal(picked.seedId, 20074);
    assert.equal(picked.source, 'preferred');
});

test('pickAvailableSeedByStrategy should fallback to level strategy ordering', () => {
    const available = [
        { seedId: 20003, requiredLevel: 2, price: 2 },
        { seedId: 20074, requiredLevel: 100, price: 20160 },
    ];
    const picked = pickAvailableSeedByStrategy({
        available,
        strategy: 'level',
        preferredSeedId: 0,
        rankingProvider: () => [],
    });
    assert.equal(picked.seedId, 20074);
    assert.equal(picked.source, 'level');
});
