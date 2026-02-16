const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBestCropPair } = require('../src/cropAdvisor');

test('buildBestCropPair returns current and next-level best crops', () => {
    const mockProvider = (level) => ({
        level,
        bestNormalFert: {
            seedId: 20000 + level,
            name: `crop-${level}`,
            requiredLevel: level,
            expPerHour: 100 + level,
        },
    });

    const pair = buildBestCropPair({ level: 30, landsCount: 18, recommendationProvider: mockProvider });
    assert.equal(pair.currentLevelBest.level, 30);
    assert.equal(pair.nextLevelBest.level, 31);
    assert.equal(pair.currentLevelBest.seedName, 'crop-30');
    assert.equal(pair.nextLevelBest.seedName, 'crop-31');
});
