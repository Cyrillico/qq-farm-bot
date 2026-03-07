const test = require('node:test');
const assert = require('node:assert/strict');

const { getSeedOptions } = require('../src/seedsCatalog');

test('getSeedOptions should return named deduped seeds sorted by level and seed id', () => {
    const seeds = getSeedOptions();
    assert.equal(Array.isArray(seeds), true);
    assert.ok(seeds.length > 10);
    assert.ok(seeds.every((item) => Number(item.seedId) > 0));
    assert.ok(seeds.every((item) => String(item.name || '').trim().length > 0));
    assert.ok(seeds.every((item) => String(item.label || '').includes(String(item.seedId))));

    const ids = new Set(seeds.map((item) => item.seedId));
    assert.equal(ids.size, seeds.length);

    for (let i = 1; i < Math.min(seeds.length, 30); i++) {
        const prev = Number(seeds[i - 1].level || 0);
        const curr = Number(seeds[i].level || 0);
        assert.ok(curr >= prev);
        if (curr === prev) {
            assert.ok(Number(seeds[i].seedId) >= Number(seeds[i - 1].seedId));
        }
    }
});
