const { getPlantingRecommendation } = require('../tools/calc-exp-yield');

function normalizeLevel(level) {
    const n = Number.parseInt(level, 10);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return n;
}

function normalizeLands(landsCount) {
    const n = Number.parseInt(landsCount, 10);
    if (!Number.isFinite(n) || n <= 0) return 18;
    return n;
}

function toBestItem(rec, fallbackLevel) {
    if (!rec || !rec.bestNormalFert) return null;
    return {
        level: normalizeLevel(rec.level || fallbackLevel),
        seedId: rec.bestNormalFert.seedId,
        seedName: rec.bestNormalFert.name,
        requiredLevel: rec.bestNormalFert.requiredLevel,
        expPerHour: rec.bestNormalFert.expPerHour,
    };
}

function buildBestCropPair(options = {}) {
    const level = normalizeLevel(options.level);
    const landsCount = normalizeLands(options.landsCount);
    const recommendationProvider = options.recommendationProvider
        || ((lv, lands) => getPlantingRecommendation(lv, lands, { top: 50 }));

    let currentRec = null;
    let nextRec = null;
    try {
        currentRec = recommendationProvider(level, landsCount);
    } catch (e) {
        currentRec = null;
    }
    try {
        nextRec = recommendationProvider(level + 1, landsCount);
    } catch (e) {
        nextRec = null;
    }

    return {
        currentLevelBest: toBestItem(currentRec, level),
        nextLevelBest: toBestItem(nextRec, level + 1),
    };
}

module.exports = {
    buildBestCropPair,
};

