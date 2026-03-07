const { getAllPlants, getFruitPrice, getSeedPrice } = require('./gameConfig');

function parseGrowTime(growPhases) {
    if (!growPhases) return 0;
    const phases = String(growPhases).split(';').filter(Boolean);
    let totalTime = 0;
    for (const phase of phases) {
        const match = String(phase).match(/:(\d+)$/);
        if (match) {
            totalTime += Number.parseInt(match[1], 10) || 0;
        }
    }
    return totalTime;
}

function parseNormalFertilizerReduceSec(growPhases) {
    if (!growPhases) return 0;
    const first = String(growPhases).split(';').filter(Boolean)[0] || '';
    const match = first.match(/:(\d+)$/);
    return match ? (Number.parseInt(match[1], 10) || 0) : 0;
}

function formatTime(seconds) {
    const sec = Math.max(0, Number(seconds) || 0);
    if (sec < 60) return `${sec}秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`;
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
}

function getPlantRankings(sortBy = 'exp') {
    const plants = getAllPlants().filter((plant) => Number(plant && plant.seed_id) > 0 && plant && plant.grow_phases);
    const rows = [];
    for (const plant of plants) {
        const baseGrowTime = parseGrowTime(plant.grow_phases);
        if (baseGrowTime <= 0) continue;
        const seasons = Number(plant.seasons) || 1;
        const isTwoSeason = seasons === 2;
        const growTime = isTwoSeason ? baseGrowTime * 1.5 : baseGrowTime;
        const harvestExpBase = Number(plant.exp) || 0;
        const harvestExp = isTwoSeason ? harvestExpBase * 2 : harvestExpBase;
        const reduceSecBase = parseNormalFertilizerReduceSec(plant.grow_phases);
        const reduceSecApplied = isTwoSeason ? reduceSecBase * 2 : reduceSecBase;
        const fertilizedGrowTime = Math.max(1, growTime - reduceSecApplied);
        const expPerHour = (harvestExp / growTime) * 3600;
        const normalFertilizerExpPerHour = (harvestExp / fertilizedGrowTime) * 3600;
        const fruitId = Number(plant.fruit && plant.fruit.id) || 0;
        const fruitCount = Number(plant.fruit && plant.fruit.count) || 0;
        const fruitPrice = getFruitPrice(fruitId);
        const seedPrice = getSeedPrice(Number(plant.seed_id) || 0);
        const income = (fruitCount * fruitPrice) * (isTwoSeason ? 2 : 1);
        const netProfit = income - seedPrice;
        const goldPerHour = (income / growTime) * 3600;
        const profitPerHour = (netProfit / growTime) * 3600;
        const normalFertilizerProfitPerHour = (netProfit / fertilizedGrowTime) * 3600;
        rows.push({
            id: Number(plant.id) || 0,
            seedId: Number(plant.seed_id) || 0,
            name: String(plant.name || ''),
            seasons,
            level: Number.isFinite(Number(plant.land_level_need)) && Number(plant.land_level_need) > 0
                ? Number(plant.land_level_need)
                : null,
            growTime,
            growTimeStr: formatTime(growTime),
            reduceSec: reduceSecBase,
            reduceSecApplied,
            expPerHour: Number(expPerHour.toFixed(2)),
            normalFertilizerExpPerHour: Number(normalFertilizerExpPerHour.toFixed(2)),
            goldPerHour: Number(goldPerHour.toFixed(2)),
            profitPerHour: Number(profitPerHour.toFixed(2)),
            normalFertilizerProfitPerHour: Number(normalFertilizerProfitPerHour.toFixed(2)),
            income,
            netProfit,
            fruitId,
            fruitCount,
            fruitPrice,
            seedPrice,
        });
    }

    const sorters = {
        exp: (a, b) => b.expPerHour - a.expPerHour,
        fert: (a, b) => b.normalFertilizerExpPerHour - a.normalFertilizerExpPerHour,
        gold: (a, b) => b.goldPerHour - a.goldPerHour,
        profit: (a, b) => b.profitPerHour - a.profitPerHour,
        fert_profit: (a, b) => b.normalFertilizerProfitPerHour - a.normalFertilizerProfitPerHour,
        level: (a, b) => (Number(b.level || -1) - Number(a.level || -1)),
    };
    rows.sort(sorters[sortBy] || sorters.exp);
    return rows;
}

function pickAvailableSeedByStrategy(options = {}) {
    const available = Array.isArray(options.available) ? options.available : [];
    if (available.length === 0) return null;
    const strategy = String(options.strategy || 'preferred').trim() || 'preferred';
    const preferredSeedId = Number.parseInt(options.preferredSeedId, 10) || 0;
    const rankingProvider = typeof options.rankingProvider === 'function' ? options.rankingProvider : getPlantRankings;

    if (strategy === 'preferred' && preferredSeedId > 0) {
        const exact = available.find((item) => Number(item.seedId) === preferredSeedId);
        if (exact) return { ...exact, source: 'preferred' };
    }

    if (strategy === 'level') {
        const sorted = [...available].sort((a, b) => (Number(b.requiredLevel || 0) - Number(a.requiredLevel || 0)) || (Number(b.price || 0) - Number(a.price || 0)));
        return { ...sorted[0], source: 'level' };
    }

    const strategySortMap = {
        preferred: 'fert',
        max_exp: 'exp',
        max_fert_exp: 'fert',
        max_profit: 'profit',
        max_fert_profit: 'fert_profit',
    };
    const sortKey = strategySortMap[strategy] || 'fert';
    const ranked = rankingProvider(sortKey);
    for (const row of ranked) {
        const hit = available.find((item) => Number(item.seedId) === Number(row.seedId));
        if (hit) {
            return {
                ...hit,
                source: strategy === 'preferred' ? 'preferred_fallback' : strategy,
                metric: row,
            };
        }
    }

    const fallback = [...available].sort((a, b) => (Number(b.requiredLevel || 0) - Number(a.requiredLevel || 0)) || (Number(a.price || 0) - Number(b.price || 0)));
    return { ...fallback[0], source: 'fallback' };
}

module.exports = {
    getPlantRankings,
    pickAvailableSeedByStrategy,
};
